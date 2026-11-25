/**
 * AI 供应商预设
 * 全部为 OpenAI 兼容的 Chat Completions 接口，便于统一调用与自由切换。
 * 注意：这里的 baseUrl 仅作为默认值，用户可在设置中修改；密钥只保存在本地 storage。
 */

export const PROVIDERS = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    docs: 'https://platform.deepseek.com/api-docs/',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    note: 'OpenAI 兼容协议，性价比高。',
    // DeepSeek 没有独立的思考开关，思考能力由模型决定，因此只给提示不提供下拉
    thinking: {
      hint: 'DeepSeek 的思考模式由模型决定：把上方“模型”改为 deepseek-reasoner 即可，无需额外参数。'
    }
  },
  {
    id: 'dashscope',
    name: '通义千问（阿里云百炼）',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-plus', 'qwen-max', 'qwen-turbo'],
    docs: 'https://help.aliyun.com/zh/model-studio/',
    keyUrl: 'https://bailian.console.aliyun.com/',
    note: '使用兼容模式接口，模型名以控制台为准。',
    thinking: {
      param: 'enable_thinking',
      options: [
        { value: 'on', label: '开启', body: true },
        { value: 'off', label: '关闭', body: false }
      ],
      hint: 'Qwen3 等混合思考模型支持该开关，普通模型会自动忽略。'
    }
  },
  {
    id: 'moonshot',
    name: 'Moonshot Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    docs: 'https://platform.moonshot.cn/docs/',
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
    note: '长上下文场景较友好。',
    thinking: {
      hint: 'Kimi 的思考能力由模型决定，请把上方“模型”改为控制台提供的思考模型；如有专有参数可用下方自定义请求参数补充。'
    }
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4-plus', 'glm-4-flash', 'glm-4-air'],
    docs: 'https://open.bigmodel.cn/dev/api',
    keyUrl: 'https://bigmodel.cn/usercenter/apikeys',
    note: '兼容 OpenAI 协议。',
    thinking: {
      param: 'thinking',
      options: [
        { value: 'on', label: '开启', body: { type: 'enabled' } },
        { value: 'off', label: '关闭', body: { type: 'disabled' } }
      ],
      hint: 'GLM-4.5 等模型支持该开关，不支持的模型会自动忽略。'
    }
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o-mini', 'gpt-4o'],
    docs: 'https://platform.openai.com/docs/api-reference',
    keyUrl: 'https://platform.openai.com/api-keys',
    note: '国内网络可能无法直连，需自备网络条件。',
    thinking: {
      param: 'reasoning_effort',
      options: [
        { value: 'low', label: '低（更快）', body: 'low' },
        { value: 'medium', label: '中（均衡）', body: 'medium' },
        { value: 'high', label: '高（更深入）', body: 'high' }
      ],
      hint: '推理模型（o 系列 / GPT-5）支持推理强度；普通对话模型会忽略该参数。'
    }
  },
  {
    id: 'ollama',
    name: 'Ollama（本地）',
    baseUrl: 'http://localhost:11434/v1',
    models: ['qwen2.5:7b', 'llama3.1:8b'],
    docs: 'https://github.com/ollama/ollama/blob/main/docs/openai.md',
    note: '本地模型无需密钥，密钥字段留空即可。'
  },
  {
    id: 'custom',
    name: '自定义（OpenAI 兼容）',
    baseUrl: '',
    models: [],
    docs: '',
    note: '填写任意 OpenAI 兼容端点，需在保存时授权该域名。'
  }
];

/** 根据 ID 获取供应商 */
export function getProvider(providerId) {
  return PROVIDERS.find((item) => item.id === providerId) || PROVIDERS[PROVIDERS.length - 1];
}

/** 常用模型候选（用于输入框 datalist） */
export function getProviderModels(providerId) {
  const provider = getProvider(providerId);
  return provider.models || [];
}
