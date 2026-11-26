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
    models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    docs: 'https://api-docs.deepseek.com/',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    note: 'OpenAI 兼容协议，思考模式默认开启。',
    // 官方支持 thinking 开关（默认 enabled）；推理强度用 reasoning_effort（high / max）调节
    thinking: {
      param: 'thinking',
      options: [
        { value: 'on', label: '开启（默认）', body: { type: 'enabled' } },
        { value: 'off', label: '关闭（非思考模式）', body: { type: 'disabled' } }
      ],
      hint: '官方默认开启思考；需要调整推理强度时，可在下方自定义参数中追加 reasoning_effort（high / max）。'
    }
  },
  {
    id: 'dashscope',
    name: '通义千问（阿里云百炼）',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen4-max', 'qwen3.7-plus', 'qwen3.8-flash'],
    docs: 'https://help.aliyun.com/zh/model-studio/',
    keyUrl: 'https://bailian.console.aliyun.com/',
    note: '使用兼容模式接口，模型名以控制台为准。',
    thinking: {
      param: 'enable_thinking',
      options: [
        { value: 'on', label: '开启', body: true },
        { value: 'off', label: '关闭', body: false }
      ],
      hint: 'qwen4-max 等混合思考模型支持该开关；推理强度可用自定义参数 reasoning_effort（low / high / xhigh）追加。'
    }
  },
  {
    id: 'moonshot',
    name: 'Kimi（Moonshot）',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['kimi-k3.1-pro', 'kimi-k3.1-pro-highspeed', 'kimi-k3'],
    docs: 'https://platform.kimi.com/docs/',
    keyUrl: 'https://platform.kimi.com/console/api-keys',
    note: 'K3 系列支持 100 万 token 上下文，长文档场景较友好。',
    // K3 系列始终思考，不支持 thinking 开关，只能用顶层 reasoning_effort 调节强度
    thinking: {
      param: 'reasoning_effort',
      options: [
        { value: 'low', label: '低（更快）', body: 'low' },
        { value: 'high', label: '高（增强推理）', body: 'high' },
        { value: 'max', label: '最高（默认）', body: 'max' }
      ],
      hint: 'K3 系列始终开启思考，不支持关闭；用 reasoning_effort 调节推理强度（默认 max）。'
    }
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-5.3', 'glm-5.3-flash', 'glm-4.7-flash'],
    docs: 'https://docs.bigmodel.cn/cn/guide/start/model-overview',
    keyUrl: 'https://bigmodel.cn/usercenter/apikeys',
    note: '兼容 OpenAI 协议。',
    // GLM-5.3 始终思考，传 thinking.type=disabled 会直接报错，因此只调节强度
    thinking: {
      param: 'reasoning_effort',
      options: [
        { value: 'low', label: '低（更快）', body: 'low' },
        { value: 'high', label: '高（增强推理）', body: 'high' },
        { value: 'max', label: '最高（默认）', body: 'max' }
      ],
      hint: 'GLM-5.3 始终开启思考，不再支持关闭；用 reasoning_effort 调节强度（默认 max）。'
    }
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano'],
    docs: 'https://platform.openai.com/docs/api-reference',
    keyUrl: 'https://platform.openai.com/api-keys',
    note: '国内网络可能无法直连，需自备网络条件。',
    thinking: {
      param: 'reasoning_effort',
      options: [
        { value: 'low', label: '低（更快）', body: 'low' },
        { value: 'medium', label: '中（均衡）', body: 'medium' },
        { value: 'high', label: '高（更深入）', body: 'high' },
        { value: 'xhigh', label: '极高（最深入）', body: 'xhigh' }
      ],
      hint: 'GPT-5.x 系列支持 reasoning_effort（none / low / medium / high / xhigh）；普通对话模型会忽略该参数。'
    }
  },
  {
    id: 'ollama',
    name: 'Ollama（本地）',
    baseUrl: 'http://localhost:11434/v1',
    models: ['gpt-oss:20b', 'qwen3:8b', 'llama3.2:3b'],
    docs: 'https://docs.ollama.com/api/openai-compatibility',
    note: '本地模型无需密钥，密钥字段留空即可；11434 是 Ollama 官方默认端口。模型名需与 ollama list 一致。'
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
