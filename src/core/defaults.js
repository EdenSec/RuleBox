/**
 * 默认配置
 * 所有可调项集中在此，避免散落在 UI 中硬编码。
 */

import { SEARCH_PROVIDERS, SEARCH_PAGE_SIZES } from './search-providers.js';

export const STORAGE_KEYS = {
  settings: 'rb.settings',
  favorites: 'rb.favorites',
  recents: 'rb.recents',
  variables: 'rb.variables',
  custom: 'rb.custom',
  // 内置条目的隐藏名单（kind:id），仅影响展示，不删除任何数据
  hidden: 'rb.hidden',
  aiHistory: 'rb.aiHistory',
  usage: 'rb.usage',
  // 右键菜单“搜索”传递的待搜索关键词（一次性，面板消费后即删除）
  pendingSearch: 'rb.pendingSearch',
  // 聚合查询会话快照（语法、平台、页码、结果），重开面板时恢复，避免重复消耗额度
  cyberSession: 'rb.cyberSession',
  // 上次使用的标签页（snippets | payloads | cyber | ai），供“跟随上次使用”读取
  lastTab: 'rb.lastTab'
};

export const DEFAULT_SETTINGS = {
  version: 1,
  theme: 'auto',
  ui: {
    // 复制后是否自动关闭弹窗（侧边栏模式下不关闭）
    closeAfterCopy: true,
    // 最近使用保留条数
    recentsLimit: 20,
    // 列表“常用优先”排序：复制次数越多越靠前，未使用过的条目保持原有顺序
    frequentFirst: true,
    // 默认打开的标签页：snippets | payloads | cyber | ai
    defaultTab: 'snippets',
    // 打开方式：last = 跟随上次使用；fixed = 固定打开 defaultTab
    openMode: 'last',
    // 是否显示风险等级徽标
    showRiskBadges: true,
    // 默认复制格式：code（仅代码）| markdown（代码块）| title-code（标题+代码）
    copyFormat: 'code',
    // 是否在列表中显示说明文本
    showDesc: true
  },
  features: {
    sidePanel: true,
    contextMenu: true,
    ai: true
  },
  search: {
    // 聚合查询总开关（关闭后面板仍保留入口提示，但不会发起任何测绘 API 请求）
    enabled: true,
    // 复制语法后是否提示“一站式查询”
    promptAfterCopy: true,
    // 每页结果数量，仅允许 10 / 20 / 50
    pageSize: 20,
    // 上次选择的平台，下次打开时恢复；空数组表示还没有使用记录
    lastProviders: [],
    // 各平台 API Key：只保存在本地，不参与导出
    providers: Object.fromEntries(SEARCH_PROVIDERS.map((provider) => [provider.id, { apiKey: '' }]))
  },
  ai: {
    enabled: false,
    activeProfileId: 'default',
    // 可以配置多个档案，自由切换供应商
    profiles: [
      {
        id: 'default',
        name: '默认档案',
        providerId: 'deepseek',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-v4-flash',
        apiKey: '',
        temperature: 0.2,
        maxTokens: 4096,
        timeoutMs: 60000,
        // 思考模式选项值（不同供应商取值不同，空字符串表示不设置）
        thinking: '',
        // 供应商专有参数（JSON 文本），如 top_p、top_k
        extraBody: ''
      }
    ],
    // 基础系统提示词；空字符串表示使用内置默认（设置页“恢复默认”即写回空）
    systemPrompt: '',
    // 追加到系统提示词之后，便于团队统一输出风格
    systemPromptAppend: '',
    // 是否把当前平台字段说明作为上下文发给模型
    includePlatformContext: true,
    // 是否把本地检索到的少量库内条目作为示例发给模型
    includeLibraryExamples: true,
    // 携带的历史消息条数（不含系统消息）
    historyLimit: 6,
    // 是否流式输出
    stream: true,
    // 两次请求最小间隔，防止误触刷接口
    minIntervalMs: 1500,
    // 每日请求上限，0 表示不限制
    dailyRequestLimit: 200
  },
  limits: {
    // 自定义数据导入大小上限（字节）
    maxImportBytes: 512000,
    // 自定义条目上限
    maxCustomItems: 500
  }
};

export const DEFAULT_CUSTOM = {
  platforms: [],
  items: []
};

export const DEFAULT_USAGE = {
  date: '',
  count: 0
};

/**
 * 供应商官方已下线 / 停用的旧模型名 → 同系列现行模型。
 * 仅用于升级时自动修正旧档案，避免用户升级后请求直接失败。
 */
const LEGACY_MODEL_ALIAS = {
  deepseek: {
    'deepseek-chat': 'deepseek-v4-flash',
    'deepseek-reasoner': 'deepseek-v4-pro'
  },
  moonshot: {
    'moonshot-v1-8k': 'kimi-k3.1-pro',
    'moonshot-v1-32k': 'kimi-k3.1-pro',
    'moonshot-v1-128k': 'kimi-k3.1-pro',
    'moonshot-v1-auto': 'kimi-k3.1-pro'
  }
};

/** 深合并默认配置，保证旧版本配置缺失字段时仍可运行 */
export function mergeSettings(input) {
  const base = structuredClone(DEFAULT_SETTINGS);
  if (!input || typeof input !== 'object') return base;

  const merged = base;
  if (typeof input.theme === 'string') merged.theme = input.theme;

  for (const group of ['ui', 'features', 'ai', 'limits']) {
    if (input[group] && typeof input[group] === 'object') {
      merged[group] = { ...merged[group], ...input[group] };
    }
  }

  // 标签页设置逐项校验，避免手改配置后写出不存在的 tab 或打开方式
  const TAB_IDS = ['snippets', 'payloads', 'cyber', 'ai'];
  merged.ui.defaultTab = TAB_IDS.includes(merged.ui.defaultTab) ? merged.ui.defaultTab : 'snippets';
  merged.ui.openMode = merged.ui.openMode === 'fixed' ? 'fixed' : 'last';
  merged.ui.frequentFirst = merged.ui.frequentFirst !== false;

  // 测绘查询：逐项校验，避免旧配置或手改 JSON 把开关写成字符串、把平台写成不存在的 ID
  const search = input.search && typeof input.search === 'object' ? input.search : {};
  merged.search.enabled = search.enabled !== false;
  merged.search.promptAfterCopy = search.promptAfterCopy !== false;
  merged.search.pageSize = SEARCH_PAGE_SIZES.includes(Number(search.pageSize))
    ? Number(search.pageSize)
    : DEFAULT_SETTINGS.search.pageSize;
  const lastProviders = Array.isArray(search.lastProviders)
    ? Array.from(new Set(search.lastProviders.map((id) => String(id || ''))))
      .filter((id) => SEARCH_PROVIDERS.some((provider) => provider.id === id))
      .slice(0, SEARCH_PROVIDERS.length)
    : [];
  // 保留空数组：面板据此判断“还没有使用记录”，从而回退到已配置 Key 的平台
  merged.search.lastProviders = lastProviders;
  merged.search.providers = {};
  for (const provider of SEARCH_PROVIDERS) {
    const saved = search.providers?.[provider.id];
    merged.search.providers[provider.id] = {
      apiKey: saved && typeof saved === 'object' ? String(saved.apiKey || '') : ''
    };
  }

  // 旧版本曾支持邮箱、Webhook 与告警提醒，现已移除；顺带清理历史配置里残留的字段
  delete merged.ai.adminEmail;
  delete merged.ai.alertWebhookUrl;
  delete merged.ai.notifyOnQuotaError;

  // 提示词允许导入，但必须是字符串，避免配置文件污染导致设置页渲染异常
  if (typeof merged.ai.systemPrompt !== 'string') merged.ai.systemPrompt = '';
  if (typeof merged.ai.systemPromptAppend !== 'string') merged.ai.systemPromptAppend = '';
  if (typeof merged.ai.includeLibraryExamples !== 'boolean') merged.ai.includeLibraryExamples = true;

  // profiles 需保证是数组且至少一条
  if (!Array.isArray(merged.ai.profiles) || merged.ai.profiles.length === 0) {
    merged.ai.profiles = structuredClone(DEFAULT_SETTINGS.ai.profiles);
  } else {
    merged.ai.profiles = merged.ai.profiles.map((profile, index) => {
      const providerId = profile.providerId || 'custom';
      const legacyModel = LEGACY_MODEL_ALIAS[providerId]?.[profile.model];
      return {
        id: profile.id || `profile_${index}`,
        name: profile.name || `档案 ${index + 1}`,
        providerId,
        baseUrl: profile.baseUrl || '',
        model: legacyModel || profile.model || '',
        apiKey: profile.apiKey || '',
        temperature: Number.isFinite(profile.temperature) ? profile.temperature : 0.2,
        maxTokens: Number.isFinite(profile.maxTokens) ? profile.maxTokens : 2048,
        timeoutMs: Number.isFinite(profile.timeoutMs) ? profile.timeoutMs : 60000,
        thinking: typeof profile.thinking === 'string' ? profile.thinking : '',
        extraBody: typeof profile.extraBody === 'string' ? profile.extraBody : ''
      };
    });
  }

  // 保证 activeProfileId 指向存在的档案
  if (!merged.ai.profiles.some((item) => item.id === merged.ai.activeProfileId)) {
    merged.ai.activeProfileId = merged.ai.profiles[0].id;
  }

  return merged;
}
