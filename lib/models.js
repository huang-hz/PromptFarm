/* models.js — LLM 模型清单（截至 2026-06-27，官方名称）
 * 结构：区域（美国/中国）→ 公司 → 模型
 * 模型标识格式："公司/模型名"（如 "OpenAI/GPT-5.5"），存到提示词的 models[]。
 * 挂载到 PH.models。
 */
(function (root) {
  'use strict';
  const NS = root.PH || (root.PH = {});

  // 清单：每家公司含 company/models（内置默认，可被 store 持久化版本覆盖）
  const DEFAULT_CATALOG = [
    { company: 'OpenAI', models: ['GPT-5.5', 'GPT-5.5 Pro', 'GPT-5.5 Instant', 'GPT-5.4', 'GPT-5.4 mini', 'GPT-5.4 nano', 'GPT-Image-2'] },
    { company: 'Anthropic', models: ['Claude Fable 5', 'Claude Mythos 5', 'Claude Opus 4.8', 'Claude Opus 4.7', 'Claude Sonnet 4.6'] },
    { company: 'Google', models: ['Gemini 3.1 Pro', 'Gemini 3 Deep', 'Nano Banana 2', 'Nano Banana Pro'] },
    { company: 'xAI', models: ['Grok 4.3', 'Grok 4.20', 'Grok Build 0.1', 'Grok Imagine'] },
    { company: 'Black Forest Labs', models: ['FLUX.2 Pro', 'FLUX.2 Max'] },
    { company: 'DeepSeek', models: ['DeepSeek-V4-Pro', 'DeepSeek-V4-Flash'] },
    { company: 'Zhipu', models: ['GLM-5.2', 'GLM-5.2-Air', 'GLM-5.1', 'GLM-Image'] },
    { company: 'Alibaba', models: ['Qwen3.7-Max', 'Qwen3.7-Plus', 'Qwen3.6-Plus', 'Qwen3.6-Flash', 'Qwen3-Max-Thinking', 'Qwen3.5-Plus', 'Z-Image-Turbo', 'Qwen-Image-2.0-Pro'] },
    { company: 'Moonshot', models: ['Kimi K2.6', 'Kimi K2.7 Code'] },
    { company: 'ByteDance', models: ['Doubao-Seed-2.0-Pro', 'Doubao-Seed-2.0-Lite', 'Doubao-Seed-Evolving', 'Seedream 5.0', 'Seedream 5.0 Lite'] },
    { company: 'Baidu', models: ['ERNIE-Image', 'ERNIE-Image Turbo'] }
  ];
  // 运行时目录（默认=内置；store 初始化后用持久化版本覆盖）
  let CATALOG = DEFAULT_CATALOG;

  // 构造模型标识："公司/模型名"
  function makeId(company, model) { return company + '/' + model; }

  // 解析标识 → { company, model }
  function parseId(id) {
    const i = String(id).indexOf('/');
    if (i < 0) return { company: '', model: id };
    return { company: id.slice(0, i), model: id.slice(i + 1) };
  }

  // 取某公司下所有模型标识
  function idsOfCompany(company) {
    const c = CATALOG.find((x) => x.company === company);
    return c ? c.models.map((m) => makeId(company, m)) : [];
  }

  // 用持久化版本覆盖运行时目录（深拷贝避免外部修改）
  function setCatalog(arr) {
    CATALOG = Array.isArray(arr) && arr.length
      ? arr.map((c) => ({ company: c.company || '', models: Array.isArray(c.models) ? c.models.slice() : [] }))
      : DEFAULT_CATALOG.map((c) => Object.assign({}, c, { models: c.models.slice() }));
  }

  // 当前目录下所有模型 id（展平）
  function allIds() {
    const out = [];
    CATALOG.forEach((c) => c.models.forEach((m) => out.push(makeId(c.company, m))));
    return out;
  }

  NS.models = {
    DEFAULT_CATALOG,
    get CATALOG() { return CATALOG; },   // 实时绑定，随 setCatalog 变化
    makeId, parseId, idsOfCompany,
    setCatalog, allIds
  };
})(typeof self !== 'undefined' ? self : this);
