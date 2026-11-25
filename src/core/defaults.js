/**
 * 默认配置
 * 所有可调项集中在此，避免散落在 UI 中硬编码。
 */

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
  pendingSearch: 'rb.pendingSearch'
};

export const DEFAULT_SETTINGS = {
  version: 1,
  theme: 'auto',
  ui: {
    // 复制后是否自动关闭弹窗（侧边栏模式下不关闭）
    closeAfterCopy: true,
    // 最近使用保留条数
    recentsLimit: 20,
    // 默认打开的标签页：snippets | payloads | ai
    defaultTab: 'snippets',
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
        model: 'deepseek-chat',
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
    merged.ai.profiles = merged.ai.profiles.map((profile, index) => ({
      id: profile.id || `profile_${index}`,
      name: profile.name || `档案 ${index + 1}`,
      providerId: profile.providerId || 'custom',
      baseUrl: profile.baseUrl || '',
      model: profile.model || '',
      apiKey: profile.apiKey || '',
      temperature: Number.isFinite(profile.temperature) ? profile.temperature : 0.2,
      maxTokens: Number.isFinite(profile.maxTokens) ? profile.maxTokens : 2048,
      timeoutMs: Number.isFinite(profile.timeoutMs) ? profile.timeoutMs : 60000,
      thinking: typeof profile.thinking === 'string' ? profile.thinking : '',
      extraBody: typeof profile.extraBody === 'string' ? profile.extraBody : ''
    }));
  }

  // 保证 activeProfileId 指向存在的档案
  if (!merged.ai.profiles.some((item) => item.id === merged.ai.activeProfileId)) {
    merged.ai.activeProfileId = merged.ai.profiles[0].id;
  }

  return merged;
}
