/**
 * 数据加载层
 * 所有语法、Payload、平台与提示词均为 JSON 文件，UI 不硬编码任何条目。
 */

import { getCustom } from './storage.js';
import { extractVars } from './template.js';

const DATA_ROOT = 'src/data';

let cache = null;
let loadingPromise = null;

/** 解析资源地址，兼容扩展环境与本地预览 */
function resolve(path) {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
    return chrome.runtime.getURL(path);
  }
  // 本地预览：以站点根目录为基准，便于用静态服务器直接打开 popup.html
  return new URL(path, `${window.location.origin}/`).href;
}

/** 读取 JSON */
async function fetchJson(path) {
  const url = resolve(`${DATA_ROOT}/${path}`);
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error(`加载失败：${path}（HTTP ${response.status}）`);
  }
  return response.json();
}

/**
 * 统一变量定义格式
 * 语法库使用对象写法（name/label/placeholder/example），Payload 库与自定义条目使用字符串写法，
 * 这里统一成对象，避免 UI 直接拿到 String(Object) 产生「{{[object Object]}}」。
 */
function normalizeVars(vars, code, literalBraces = false) {
  if (!Array.isArray(vars)) vars = [];
  const result = [];
  for (const entry of vars) {
    const name = (typeof entry === 'string' ? entry : entry?.name || '').toString().trim();
    if (!name || result.some((item) => item.name === name)) continue;
    result.push({
      name,
      label: typeof entry === 'object' && entry ? String(entry.label || '') : '',
      placeholder: typeof entry === 'object' && entry ? String(entry.placeholder || '') : '',
      example: typeof entry === 'object' && entry ? String(entry.example || '') : ''
    });
  }
  // 代码里出现但未声明的占位符也纳入，避免复制出未替换的 {{xxx}}
  // literalBraces：payload 本身就是模板语法（如 Handlebars 的 {{this}}），不能把花括号当变量
  if (!literalBraces) {
    for (const name of extractVars(code)) {
      if (!result.some((item) => item.name === name)) {
        result.push({ name, label: '', placeholder: '', example: '' });
      }
    }
  }
  return result;
}

/** 规范化语法条目 */
function normalizeSnippet(item, platformId) {
  return {
    id: String(item.id || ''),
    kind: 'snippet',
    platform: platformId || item.platform || '',
    title: String(item.title || ''),
    category: String(item.category || '未分类'),
    code: String(item.code || ''),
    desc: String(item.desc || ''),
    tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
    vars: normalizeVars(item.vars, item.code, item.literalBraces),
    // 可选：建议文件名。声明后卡片会提供「存为文件」，把代码直接下载成可上传 / 可执行的成品
    file: String(item.file || ''),
    // 可选：二进制前缀（Base64）。图片马等样本需要真 PNG/GIF 字节头，下载时先解码再拼接代码
    filePrefix: String(item.filePrefix || ''),
    risk: item.risk || 'low',
    source: String(item.source || ''),
    custom: Boolean(item.custom)
  };
}

/** 规范化 Payload 条目 */
function normalizePayload(item, groupName) {
  return {
    id: String(item.id || ''),
    kind: 'payload',
    platform: '',
    group: groupName || '',
    title: String(item.title || ''),
    category: String(item.category || '未分类'),
    code: String(item.code || ''),
    desc: String(item.desc || ''),
    tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
    vars: normalizeVars(item.vars, item.code, item.literalBraces),
    // 可选：建议文件名（见 normalizeSnippet 同名注释）
    file: String(item.file || ''),
    // 可选：二进制前缀（见 normalizeSnippet 同名注释）
    filePrefix: String(item.filePrefix || ''),
    risk: item.risk || 'attack',
    source: String(item.source || ''),
    custom: Boolean(item.custom)
  };
}

/** 加载全部数据 */
export async function loadAll(force = false) {
  if (cache && !force) return cache;
  if (loadingPromise && !force) return loadingPromise;

  // 用局部变量持有本次请求，finally 里做身份校验再置空：
  // force 重入时会新起一次加载并覆盖 loadingPromise，旧请求结束时若无条件置空，
  // 会把新请求的去重标记一起清掉，导致随后的并发调用重复拉取全量 JSON
  const promise = (async () => {
    const index = await fetchJson('index.json');
    const [platformsDoc, promptsDoc] = await Promise.all([fetchJson('platforms.json'), fetchJson('prompts.json')]);

    const snippetFiles = await Promise.all(
      (index.snippets || []).map(async (entry) => {
        const doc = await fetchJson(entry.path);
        const items = (doc.items || []).map((item) => normalizeSnippet(item, entry.platform));
        return { platform: entry.platform, categories: doc.categories || [], notice: doc.notice || '', items };
      })
    );

    const payloadFiles = await Promise.all(
      (index.payloads || []).map(async (entry) => {
        const doc = await fetchJson(entry.path);
        const items = (doc.items || []).map((item) => normalizePayload(item, doc.group));
        return { group: doc.group || '未分组', categories: doc.categories || [], items };
      })
    );

    const custom = await getCustom();

    const customPlatforms = (custom.platforms || []).map((platform) => ({
      id: String(platform.id || ''),
      name: String(platform.name || '自定义平台'),
      vendor: String(platform.vendor || '自定义'),
      kind: 'custom',
      color: platform.color || '#8b949e',
      docUrl: platform.docUrl || '',
      syntax: platform.syntax || '',
      summary: platform.summary || '用户自定义平台',
      operators: Array.isArray(platform.operators) ? platform.operators : [],
      fields: Array.isArray(platform.fields) ? platform.fields : [],
      tips: Array.isArray(platform.tips) ? platform.tips : [],
      custom: true
    }));

    const builtinPlatforms = platformsDoc.platforms || [];
    // 导入的配置可能带与内置平台同 ID、彼此重复或空 ID 的自定义平台：
    // 直接拼接会让平台下拉里出现重复条目，且 platformMap 会被后者覆盖，这里统一去重
    const seenPlatformIds = new Set(builtinPlatforms.map((platform) => platform.id));
    const platforms = [...builtinPlatforms];
    for (const platform of customPlatforms) {
      if (!platform.id || seenPlatformIds.has(platform.id)) continue;
      seenPlatformIds.add(platform.id);
      platforms.push(platform);
    }

    const customItems = (custom.items || []).map((item) => {
      if (item.kind === 'payload') return normalizePayload({ ...item, custom: true }, item.group || '自定义');
      return normalizeSnippet({ ...item, custom: true }, item.platform);
    });

    const snippets = [
      ...snippetFiles.flatMap((file) => file.items),
      ...customItems.filter((item) => item.kind === 'snippet')
    ];

    const payloads = [
      ...payloadFiles.flatMap((file) => file.items),
      ...customItems.filter((item) => item.kind === 'payload')
    ];

    // 平台分组信息（含自定义平台的空分组）
    const snippetGroups = platforms.map((platform) => {
      const file = snippetFiles.find((entry) => entry.platform === platform.id);
      return {
        platformId: platform.id,
        name: platform.name,
        categories: file?.categories || [],
        notice: file?.notice || '',
        count: snippets.filter((item) => item.platform === platform.id).length
      };
    });

    const payloadGroups = payloadFiles.map((file) => ({
      group: file.group,
      categories: file.categories,
      count: payloads.filter((item) => item.group === file.group).length
    }));

    // 补充自定义 payload 分组
    for (const item of payloads.filter((entry) => entry.custom)) {
      if (!payloadGroups.some((group) => group.group === item.group)) {
        payloadGroups.push({ group: item.group, categories: [], count: 0 });
      }
    }
    for (const group of payloadGroups) {
      group.count = payloads.filter((item) => item.group === group.group).length;
    }

    cache = {
      version: index.version || 1,
      updated: index.updated || '',
      platforms,
      platformMap: new Map(platforms.map((platform) => [platform.id, platform])),
      snippets,
      snippetGroups,
      payloads,
      payloadGroups,
      prompts: promptsDoc.groups || []
    };

    return cache;
  })();

  loadingPromise = promise;
  try {
    return await promise;
  } finally {
    if (loadingPromise === promise) loadingPromise = null;
  }
}

/** 清空缓存（导入自定义数据后调用） */
export function invalidateCache() {
  cache = null;
}

/** 获取平台 */
export function getPlatform(id) {
  return cache?.platformMap.get(id) || null;
}

/** 按平台获取语法 */
export function getSnippetsByPlatform(platformId) {
  if (!cache) return [];
  if (!platformId || platformId === 'all') return cache.snippets;
  return cache.snippets.filter((item) => item.platform === platformId);
}

/** 按分组获取 Payload */
export function getPayloadsByGroup(group) {
  if (!cache) return [];
  if (!group || group === 'all') return cache.payloads;
  return cache.payloads.filter((item) => item.group === group);
}
