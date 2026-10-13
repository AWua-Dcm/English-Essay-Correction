/**
 * providers.js — 服务商预设表（设计文档 §6.2，2026-10-13 实测）
 * 全部走 OpenAI 兼容协议（POST /chat/completions）。
 * UMD-lite：浏览器挂 window.EEC.providers，Node 下 module.exports。
 */
(function (root) {
  'use strict';

  var PROVIDERS = [
    {
      id: 'deepseek', name: 'DeepSeek', baseURL: 'https://api.deepseek.com',
      defaultModel: 'deepseek-chat', visionModels: [],
      browserDirect: 'verified', contextWindow: 65536, maxOutput: 8192,
      lastChecked: '2026-10-13',
      note: '默认服务商；预检与错误响应 CORS 均已实测通过',
    },
    {
      id: 'kimi', name: 'Kimi（Moonshot）', baseURL: 'https://api.moonshot.cn/v1',
      defaultModel: 'kimi-latest', visionModels: ['kimi-latest'],
      browserDirect: 'verified', contextWindow: 131072, maxOutput: 8192,
      lastChecked: '2026-10-13',
      note: 'kimi-latest 支持视觉（读图批改）',
    },
    {
      id: 'dashscope', name: '通义（DashScope 兼容模式）',
      baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      defaultModel: 'qwen-plus', visionModels: ['qwen-vl-max', 'qwen-vl-plus'],
      browserDirect: 'verified', contextWindow: 131072, maxOutput: 8192,
      lastChecked: '2026-10-13',
      note: '视觉模型：qwen-vl-max / qwen-vl-plus',
    },
    {
      id: 'zhipu', name: '智谱 GLM', baseURL: 'https://open.bigmodel.cn/api/paas/v4',
      defaultModel: 'glm-4-plus', visionModels: ['glm-4v-plus', 'glm-4v'],
      browserDirect: 'verified', contextWindow: 131072, maxOutput: 4096,
      lastChecked: '2026-10-13',
      note: '视觉模型：glm-4v-plus',
    },
    {
      id: 'siliconflow', name: '硅基流动', baseURL: 'https://api.siliconflow.cn/v1',
      defaultModel: 'deepseek-ai/DeepSeek-V3', visionModels: ['Qwen/Qwen2.5-VL-72B-Instruct'],
      browserDirect: 'partial', contextWindow: 65536, maxOutput: 8192,
      lastChecked: '2026-10-13',
      note: 'Allow-Headers 为通配符，Chrome 可能拦截 Authorization；直连未完全验证',
    },
    {
      id: 'openrouter', name: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1',
      defaultModel: 'openai/gpt-4o-mini', visionModels: ['openai/gpt-4o-mini', 'openai/gpt-4o'],
      browserDirect: 'verified', contextWindow: 131072, maxOutput: 8192,
      lastChecked: '2026-10-13',
      note: '模型名可自填（如 openai/gpt-4o-mini）；部分模型需代理',
    },
    {
      id: 'openai', name: 'OpenAI', baseURL: 'https://api.openai.com/v1',
      defaultModel: 'gpt-4o-mini', visionModels: ['gpt-4o-mini', 'gpt-4o'],
      browserDirect: 'proxy-required', contextWindow: 131072, maxOutput: 16384,
      lastChecked: '2026-10-13',
      note: '国内需代理才能访问',
    },
    {
      id: 'custom', name: '自定义（OpenAI 兼容接口）', baseURL: '', defaultModel: '',
      visionModels: [], browserDirect: 'custom', contextWindow: 32768, maxOutput: 4096,
      lastChecked: '2026-10-13',
      note: '填入任意 OpenAI 兼容接口地址与模型名（如 one-api 类网关，可用于 Claude）',
    },
  ];

  var DEFAULT_PROVIDER_ID = 'deepseek';

  function byId(id) {
    for (var i = 0; i < PROVIDERS.length; i++) {
      if (PROVIDERS[i].id === id) return PROVIDERS[i];
    }
    return undefined;
  }

  var api = { PROVIDERS: PROVIDERS, DEFAULT_PROVIDER_ID: DEFAULT_PROVIDER_ID, byId: byId };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.EEC = root.EEC || {}).providers = api;
})(typeof self !== 'undefined' ? self : globalThis);
