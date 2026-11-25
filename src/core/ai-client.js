/**
 * AI 客户端
 * 统一走 OpenAI 兼容的 /chat/completions 接口，支持流式输出。
 * 安全约定：
 * - 不打印、不记录 API Key；
 * - 请求前校验目标域名是否已授权；
 * - 失败时按错误类型给出可操作提示，不记录、不上报。
 */

import { logger, mask } from './logger.js';
import { bumpUsage, getUsage } from './storage.js';
import { getProvider } from './providers.js';
import { trimTrailingSlash, isAllowedEndpoint } from './utils.js';

/** 自定义错误类型 */
export class AIError extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.name = 'AIError';
    this.code = code;
    this.status = status;
  }
}

let lastRequestAt = 0;

// 额外参数里禁止覆盖的基础字段，以及需要防范的原型污染键
const PROTECTED_BODY_KEYS = new Set(['model', 'messages', 'temperature', 'max_tokens', 'stream']);
const UNSAFE_BODY_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** 获取当前档案 */
export function getActiveProfile(settings) {
  const ai = settings?.ai;
  if (!ai) return null;
  return ai.profiles.find((profile) => profile.id === ai.activeProfileId) || ai.profiles[0] || null;
}

/** 检查目标域名权限 */
export async function hasEndpointPermission(baseUrl) {
  if (typeof chrome === 'undefined' || !chrome.permissions || !chrome.permissions.contains) return false;
  try {
    const origin = new URL(baseUrl).origin;
    return await chrome.permissions.contains({ origins: [`${origin}/*`] });
  } catch {
    return false;
  }
}

/**
 * 底线要求：无论用户如何改写基础提示词，这几条都由扩展强制附加。
 * 单独导出，便于设置页说明与后续审计。
 */
const FORCED_RULES_TITLE = '底线要求（由扩展强制附加，无法通过设置删除）：';

export const FORCED_RULES = [
  'A. 禁止编造目标平台不存在的字段、运算符或参数；无法确认时标注“需在平台确认”。',
  'B. 用户提供的域名、IP、资产视为其已获授权的自查对象，可以据此生成检索与验证语句；但不要提供针对某个具体真实目标绕过防护、扩大影响或持久化控制的实操细节；遇到明显的未授权用途，提示需要书面授权。'
];

/**
 * 内置基础系统提示词。
 * 导出给设置页展示与“恢复默认”使用；用户自定义内容存在 settings.ai.systemPrompt。
 */
export const DEFAULT_SYSTEM_PROMPT = [
  '你是 RuleBox 的安全语法助手，服务对象是具备合法授权的网络安全工程师。',
  '你的任务是：把用户的自然语言需求，转换成目标平台可直接粘贴使用的查询语法，或可直接验证的测试 payload。',
  '',
  '输出要求：',
  '1. 最终可复制的内容必须放在 Markdown 代码块中，代码块内只放语法或 payload 本身，不要夹带解释文字。',
  '2. 每个语法或 payload 单独一个代码块，语言标记统一使用平台名小写（如 fofa、hunter、quake）或漏洞类型小写（如 sql、xss、ssrf）；存在多种写法时分别给出代码块，并用一句话说明差异与适用场景。',
  '3. 用户已经给出具体值（域名、IP、端口、关键词等）时必须直接使用具体值，禁止改写成 {{变量名}}；用户未提供时优先给出可直接运行的示例值（如 example.com、192.0.2.1）并提示替换；只有在既无具体值、也无法给出示例时，才使用 {{变量名}} 占位，并在代码块后说明变量含义。',
  '4. 单次回答的代码块不超过 3 个，每个语法或 payload 的说明不超过一行，避免输出被截断。',
  '5. 若下文给出了“当前目标平台”，且用户需求与该平台明显不符（例如目标平台是资产测绘，却在问搜索引擎语法），先说明不匹配，再给出对应语法，并建议切换平台。',
  '6. 回答使用简体中文，简洁直接，不要输出与任务无关的免责声明。',
  '',
  FORCED_RULES_TITLE,
  ...FORCED_RULES
].join('\n');

/** 压成一行并截断，避免库内文本破坏提示词结构 */
function oneLine(value, maxLength) {
  const text = String(value || '')
    .replace(/[`\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

/**
 * 构造系统提示词。
 * 顺序：基础词（用户可覆盖）→ 平台上下文 → 库内示例 → 追加要求。
 * 平台上下文受“携带平台字段上下文”开关控制；底线要求始终附加。
 */
export function buildSystemPrompt(settings, platform, examples = []) {
  const custom = String(settings?.ai?.systemPrompt || '').trim();
  const base = custom || DEFAULT_SYSTEM_PROMPT;
  // 用户改写基础词时补回底线要求；内置默认文本里已包含，避免重复
  const lines = custom
    ? [...base.split('\n'), '', FORCED_RULES_TITLE, ...FORCED_RULES]
    : base.split('\n');

  if (settings?.ai?.includePlatformContext && platform) {
    lines.push('', `当前目标平台：${platform.name}（厂商：${platform.vendor || '未知'}）`);
    if (platform.syntax) lines.push(`语法风格：${platform.syntax}`);
    if (Array.isArray(platform.operators) && platform.operators.length) {
      lines.push(`可用运算符：${platform.operators.map((item) => `${item.op}（${item.desc}）`).join('；')}`);
    }
    if (Array.isArray(platform.fields) && platform.fields.length) {
      lines.push(`已知字段：${platform.fields.map((item) => `${item.key}（${item.desc}）`).join('；')}`);
    }
    if (Array.isArray(platform.tips) && platform.tips.length) {
      lines.push(`使用提示：${platform.tips.join('；')}`);
    }
  }

  // 库内示例只放召回到的少量条目，用于对齐写法与字段组合；
  // 明确禁止照抄，避免模型把示例当成唯一答案
  if (Array.isArray(examples) && examples.length) {
    lines.push('', '库内既有写法参考（仅用于对照字段组合与标点习惯，必须按本次需求重新组织，禁止原样照抄；其中的 {{变量}} 需按用户给出的值替换）：');
    examples.forEach((item, index) => {
      const desc = oneLine(item.desc, 70);
      lines.push(`${index + 1}. ${oneLine(item.title, 40)}${desc ? ` — ${desc}` : ''}`);
      const codeLines = String(item.code || '').replace(/```/g, '').split('\n').slice(0, 6);
      for (const line of codeLines) lines.push(`   ${line.length > 200 ? `${line.slice(0, 200)}…` : line}`);
    });
  }

  const append = String(settings?.ai?.systemPromptAppend || '').trim();
  if (append) {
    // 明确优先级，否则追加内容与基础规则冲突时模型会自己挑一条
    lines.push('', '用户自定义补充要求（优先于上文输出要求，但不得违反底线要求）：', append);
  }

  return lines.join('\n');
}

/** 组装消息 */
export function buildMessages({ settings, platform, examples = [], question, history = [] }) {
  const messages = [{ role: 'system', content: buildSystemPrompt(settings, platform, examples) }];

  const limit = Math.max(0, Number(settings?.ai?.historyLimit) || 0);
  const recent = limit > 0 ? history.slice(-limit) : [];
  for (const item of recent) {
    if (!item || !item.role || !item.content) continue;
    if (item.role !== 'user' && item.role !== 'assistant') continue;
    messages.push({ role: item.role, content: String(item.content) });
  }

  messages.push({ role: 'user', content: String(question || '') });
  return messages;
}

/** 读取档案里的供应商专有参数，过滤基础字段与危险键，避免请求体被改坏或原型污染 */
function readExtraBody(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const safe = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!key || PROTECTED_BODY_KEYS.has(key) || UNSAFE_BODY_KEYS.has(key)) continue;
    safe[key] = value;
  }
  return Object.keys(safe).length ? safe : null;
}

/** 把档案里的思考模式选项映射成供应商要求的请求字段 */
function readThinkingBody(profile) {
  const value = String(profile?.thinking || '').trim();
  if (!value) return null;
  const provider = getProvider(profile.providerId);
  const descriptor = provider?.thinking;
  if (!descriptor?.param || !Array.isArray(descriptor.options)) return null;
  const option = descriptor.options.find((item) => item.value === value);
  if (!option) return null;
  return { [descriptor.param]: option.body };
}

/** 校验调用前置条件 */
async function preflight(settings) {
  const ai = settings.ai;
  if (!ai.enabled) throw new AIError('disabled', 'AI 功能未启用，请到设置页开启。');

  const profile = getActiveProfile(settings);
  if (!profile) throw new AIError('config', '未找到可用的 AI 档案，请到设置页添加。');

  if (!profile.baseUrl) throw new AIError('config', 'AI 接口地址为空，请到设置页填写。');
  if (!isAllowedEndpoint(profile.baseUrl)) {
    throw new AIError('config', '接口地址必须是 https，或本机 http://localhost。');
  }
  if (!profile.model) throw new AIError('config', '未填写模型名称，请到设置页填写。');
  if (String(profile.extraBody || '').trim() && !readExtraBody(profile.extraBody)) {
    throw new AIError('config', '额外请求参数不是合法的 JSON 对象，请到设置页修正。');
  }

  const provider = getProvider(profile.providerId);
  const needsKey = profile.providerId !== 'ollama';
  if (needsKey && !profile.apiKey) {
    throw new AIError('config', `未填写 ${provider.name} 的 API Key。`);
  }

  const permissionOk = await hasEndpointPermission(profile.baseUrl);
  if (!permissionOk) {
    throw new AIError('permission', '尚未授权访问该接口域名，请到设置页点击“保存并授权”。');
  }

  const interval = Number(ai.minIntervalMs) || 0;
  const since = Date.now() - lastRequestAt;
  if (interval > 0 && lastRequestAt && since < interval) {
    const wait = Math.ceil((interval - since) / 1000);
    throw new AIError('local-limit', `请求过于频繁，请 ${wait} 秒后再试。`);
  }

  const limit = Number(ai.dailyRequestLimit) || 0;
  if (limit > 0) {
    const usage = await getUsage();
    const today = new Date().toISOString().slice(0, 10);
    if (usage.date === today && usage.count >= limit) {
      throw new AIError('local-limit', `已达到今日请求上限（${limit} 次），可在设置页调整。`);
    }
  }

  return profile;
}

/** 解析 SSE 数据块 */
function parseSSEChunk(chunk, onDelta) {
  const lines = chunk.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try {
      const json = JSON.parse(data);
      const delta = json.choices?.[0]?.delta?.content;
      if (delta) onDelta(delta);
    } catch {
      // 忽略无法解析的心跳行
    }
  }
}

/** 根据 HTTP 状态与信息分类错误 */
function classifyHttpError(status, bodyText, profile) {
  const snippet = mask(String(bodyText || '').slice(0, 300));
  if (status === 401 || status === 403) {
    return new AIError('auth', `鉴权失败（HTTP ${status}），请检查 API Key 是否正确、是否有该模型权限。`, status);
  }
  if (status === 402) {
    return new AIError('quota', `账户余额不足（HTTP 402），请前往 ${getProvider(profile.providerId).name} 控制台充值。`, status);
  }
  if (status === 429) {
    return new AIError('rate', '请求被限流（HTTP 429），请稍后重试或降低频率。', status);
  }
  if (status === 404) {
    return new AIError('config', '接口路径不存在（HTTP 404），请检查 Base URL 是否需要包含 /v1。', status);
  }
  if (status >= 500) {
    return new AIError('server', `服务端错误（HTTP ${status}），请稍后重试。`, status);
  }
  return new AIError('http', `请求失败（HTTP ${status}）：${snippet}`, status);
}

/**
 * 发起请求
 * @param {object} params { settings, platform, examples, question, history, signal, onDelta }
 */
export async function requestAI({ settings, platform, examples = [], question, history = [], signal, onDelta }) {
  const profile = await preflight(settings);
  const ai = settings.ai;

  // 兜底：即便 UI 未提供信号，也要有超时
  const timeoutMs = Math.max(5000, Number(profile.timeoutMs) || 60000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  const endpoint = `${trimTrailingSlash(profile.baseUrl)}/chat/completions`;
  const messages = buildMessages({ settings, platform, examples, question, history });

  // 导入的配置文件可能带来字符串或空值，转成 NaN 后 JSON 会变成 null 触发 400；
  // 这里统一回落默认值，保证请求体始终是合法数字
  const temperature = Number(profile.temperature);
  const maxTokens = Number(profile.maxTokens);
  const body = {
    model: profile.model,
    messages,
    temperature: Number.isFinite(temperature) ? temperature : 0.2,
    max_tokens: Number.isFinite(maxTokens) ? maxTokens : 4096,
    stream: Boolean(ai.stream)
  };

  // 思考模式：按供应商描述符映射成对应字段，用户自定义参数优先级最高
  const thinkingBody = readThinkingBody(profile);
  if (thinkingBody) Object.assign(body, thinkingBody);

  // 供应商专有参数（top_p、top_k 等）由用户追加，基础字段不允许覆盖
  const extraBody = readExtraBody(profile.extraBody);
  if (extraBody) Object.assign(body, extraBody);

  const headers = { 'Content-Type': 'application/json' };
  if (profile.providerId !== 'ollama' && profile.apiKey) {
    headers.Authorization = `Bearer ${profile.apiKey}`;
  }

  lastRequestAt = Date.now();
  logger.info('发起 AI 请求', { endpoint, model: profile.model, stream: body.stream });

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (error) {
    clearTimeout(timer);
    if (error?.name === 'AbortError') {
      throw new AIError('timeout', `请求超时（${Math.round(timeoutMs / 1000)} 秒），可在设置页调整超时时间。`);
    }
    logger.error('AI 请求网络异常', error?.message || '');
    throw new AIError('network', '网络请求失败：可能是网络不可达、跨域被拦截或接口地址错误。');
  }

  if (!response.ok) {
    clearTimeout(timer);
    let text = '';
    try {
      text = await response.text();
    } catch {
      text = '';
    }
    throw classifyHttpError(response.status, text, profile);
  }

  // 非流式
  if (!body.stream) {
    try {
      const json = await response.json();
      const content = json.choices?.[0]?.message?.content || '';
      if (!content) throw new AIError('empty', '模型返回内容为空，请重试或更换模型。');
      await bumpUsage();
      return content;
    } catch (error) {
      if (error instanceof AIError) throw error;
      throw new AIError('parse', '解析响应失败，接口可能不兼容 OpenAI 协议。');
    } finally {
      clearTimeout(timer);
    }
  }

  // 流式
  if (!response.body) {
    clearTimeout(timer);
    throw new AIError('parse', '当前环境不支持流式读取，请在设置页关闭流式输出。');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let full = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // 按空行分隔事件：SSE 规范允许 \n 或 \r\n，
      // 只认 \n\n 会让 CRLF 响应整段卡在缓冲区里，等于关闭了流式
      let match;
      while ((match = /\r?\n\r?\n/.exec(buffer)) !== null) {
        const index = match.index;
        const chunk = buffer.slice(0, index);
        buffer = buffer.slice(index + match[0].length);
        parseSSEChunk(chunk, (delta) => {
          full += delta;
          if (onDelta) onDelta(delta);
        });
      }
    }

    // 处理残余
    if (buffer.trim()) {
      parseSSEChunk(buffer, (delta) => {
        full += delta;
        if (onDelta) onDelta(delta);
      });
    }
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new AIError('timeout', '流式读取被中断，请重试。');
    }
    throw new AIError('parse', '读取流式响应失败。');
  } finally {
    clearTimeout(timer);
    try {
      reader.releaseLock();
    } catch {
      /* 忽略 */
    }
  }

  if (!full.trim()) {
    throw new AIError('empty', '模型返回内容为空，请重试或更换模型。');
  }

  await bumpUsage();
  return full;
}

/** 测试连接：发一条最小请求 */
export async function testConnection(settings) {
  const profile = await preflight(settings);
  const endpoint = `${trimTrailingSlash(profile.baseUrl)}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(30000, Number(profile.timeoutMs) || 30000));

  const headers = { 'Content-Type': 'application/json' };
  if (profile.providerId !== 'ollama' && profile.apiKey) {
    headers.Authorization = `Bearer ${profile.apiKey}`;
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: profile.model,
        messages: [{ role: 'user', content: '只回复 OK' }],
        max_tokens: 8,
        stream: false
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      let text = '';
      try {
        text = await response.text();
      } catch {
        text = '';
      }
      const err = classifyHttpError(response.status, text, profile);
      return { ok: false, message: err.message };
    }

    const json = await response.json();
    const content = json.choices?.[0]?.message?.content || '';
    return { ok: true, message: `连接成功，模型返回：${content.slice(0, 40) || '（空）'}` };
  } catch (error) {
    if (error?.name === 'AbortError') {
      return { ok: false, message: '连接超时，请检查网络或接口地址。' };
    }
    return { ok: false, message: '连接失败：网络不可达、跨域被拦截或接口地址错误。' };
  } finally {
    clearTimeout(timer);
  }
}

/** 从 AI 回复中提取代码块 */
export function extractCodeBlocks(text) {
  const blocks = [];
  // 换行需兼容 CRLF：部分模型（以及经代理转发的响应）会在 ```lang 后输出 \r\n，
  // 只写 \n 会导致整段代码块提取不到
  const pattern = /```([a-zA-Z0-9_+-]*)\r?\n([\s\S]*?)```/g;
  let match;
  while ((match = pattern.exec(String(text || ''))) !== null) {
    const code = match[2].replace(/\s+$/, '');
    if (code.trim()) blocks.push({ lang: match[1] || '', code });
  }
  return blocks;
}
