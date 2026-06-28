/* models.js — LLM 模型清单（截至 2026-06-27，官方名称）
 * 结构：区域（美国/中国）→ 公司 → 模型
 * 模型标识格式："公司/模型名"（如 "OpenAI/GPT-5.5"），存到提示词的 models[]。
 * 挂载到 PH.models。
 */
(function (root) {
  'use strict';
  const NS = root.PH || (root.PH = {});

  // 清单：按区域分组，每家公司含 region/company/models
  const CATALOG = [
    // ===== 美国 =====
    { region: 'us', company: 'OpenAI', models: ['GPT-5.5', 'GPT-5.5 Pro', 'GPT-5.5 Instant', 'GPT-5.4', 'GPT-5.4 mini', 'GPT-5.4 nano'] },
    { region: 'us', company: 'Anthropic', models: ['Claude Fable 5', 'Claude Mythos 5', 'Claude Opus 4.8', 'Claude Opus 4.7', 'Claude Sonnet 4.6'] },
    { region: 'us', company: 'Google', models: ['Gemini 3.1 Pro', 'Gemini 3 Deep'] },
    { region: 'us', company: 'xAI', models: ['Grok 4.3', 'Grok 4.20', 'Grok Build 0.1'] },
    // ===== 中国 =====
    { region: 'cn', company: 'DeepSeek', models: ['DeepSeek-V4-Pro', 'DeepSeek-V4-Flash'] },
    { region: 'cn', company: 'Zhipu', models: ['GLM-5.2', 'GLM-5.2-Air', 'GLM-5.1'] },
    { region: 'cn', company: 'Alibaba', models: ['Qwen3.7-Max', 'Qwen3.7-Plus', 'Qwen3.6-Plus', 'Qwen3.6-Flash', 'Qwen3-Max-Thinking', 'Qwen3.5-Plus'] },
    { region: 'cn', company: 'Moonshot', models: ['Kimi K2.6', 'Kimi K2.7 Code'] },
    { region: 'cn', company: 'ByteDance', models: ['Doubao-Seed-2.0-Pro', 'Doubao-Seed-2.0-Lite', 'Doubao-Seed-Evolving'] }
  ];

  const REGION_LABEL = { us: '美国', cn: '中国' };

  // 构造模型标识："公司/模型名"
  function makeId(company, model) { return company + '/' + model; }

  // 解析标识 → { company, model }
  function parseId(id) {
    const i = String(id).indexOf('/');
    if (i < 0) return { company: '', model: id };
    return { company: id.slice(0, i), model: id.slice(i + 1) };
  }

  // 公司 → 区域
  function regionOfCompany(company) {
    const c = CATALOG.find((x) => x.company === company);
    return c ? c.region : '';
  }

  // 取某公司下所有模型标识
  function idsOfCompany(company) {
    const c = CATALOG.find((x) => x.company === company);
    return c ? c.models.map((m) => makeId(company, m)) : [];
  }

  // 取某区域下所有公司
  function companiesInRegion(region) {
    return CATALOG.filter((c) => c.region === region);
  }

  NS.models = {
    CATALOG, REGION_LABEL,
    makeId, parseId, regionOfCompany, idsOfCompany, companiesInRegion
  };
})(typeof self !== 'undefined' ? self : this);
