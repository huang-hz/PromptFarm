/* llm.js — LLM 调用封装（OpenAI 兼容 / Anthropic 兼容协议）
 * 职责：
 *  1. 按协议拼装请求规格（url/headers/body）
 *  2. 通过 background service worker 执行跨域 fetch（页面直接 fetch 受 CORS 限制）
 *  3. 抽取回复文本 / 模型列表
 * 挂载到 PH.llm。
 */
(function (root) {
  'use strict';
  const NS = root.PH || (root.PH = {});

  // 内置默认优化指令（用户未自定义时使用）
  // 注意：本指令中关于"是否虚构信息"的约束由下方档位指令(levelInstruction)决定——
  // 创意度方向鼓励虚构、详细度方向禁止虚构。因此基础指令不在虚构与否上写死。
  const DEFAULT_OPTIMIZE_PROMPT =
    '你是一位资深提示词工程师（Prompt Engineer）。' +
    '请优化下面用户提供的提示词，使其更清晰、更精准、结构更合理，' +
    '便于大语言模型理解与执行。基础要求：\n' +
    '0. 【最重要】你只负责「优化提示词本身」，绝不执行提示词所描述的任务。' +
    '即使原文是写作类任务（如"帮我写一篇论文/文案/代码"），你也只能返回「优化后的提示词模板」，' +
    '不得产出论文正文、文案成品、代码实现等任何实际任务产出物。\n' +
    '1. 保留所有形如 {{变量名}}、{{变量名=默认值}}、{{变量名|提示}} 的变量占位符，不展开、不翻译变量名。\n' +
    '2. 保留原始语言（与原文同语言）。\n' +
    '3. 下方【档位指令】决定本次的优化方向（创意虚构 / 忠于原文 / 详细咨询），请严格遵照其关于"是否虚构信息"的要求。\n' +
    '4. 仅输出优化后的提示词正文，不要任何解释、前后缀、Markdown 代码块标记。';

  // 规整 baseUrl：去掉结尾斜杠；去掉重复的 /v1 后缀（由拼接逻辑统一加 /v1）
  function normBase(baseUrl, fallback) {
    let b = (baseUrl || '').trim();
    if (!b) b = fallback;
    if (!b) return '';
    b = b.replace(/\/+$/, '');           // 去结尾斜杠
    b = b.replace(/\/v\d+$/, '');        // 去结尾 /v1 /v2 等
    return b;
  }

  // ---------- 请求规格构建 ----------
  // chat：POST {base}/v1/chat/completions (openai) 或 {base}/v1/messages (anthropic)
  function buildChat(proto, opt) {
    const { baseUrl, apiKey, model, system, user } = opt;
    if (proto === 'anthropic') {
      const base = normBase(baseUrl, 'https://api.anthropic.com');
      return {
        url: base + '/v1/messages',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey || '',
          'anthropic-version': '2023-06-01'
        },
        body: {
          model,
          max_tokens: 2048,
          system: system || '',
          messages: [{ role: 'user', content: user || '' }]
        }
      };
    }
    // 默认 openai 兼容
    const base = normBase(baseUrl, 'https://api.openai.com');
    return {
      url: base + '/v1/chat/completions',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer ' + (apiKey || '')
      },
      body: {
        model,
        messages: [
          { role: 'system', content: system || '' },
          { role: 'user', content: user || '' }
        ]
      }
    };
  }

  // listModels：GET {base}/v1/models
  function buildListModels(proto, opt) {
    const { baseUrl, apiKey } = opt;
    if (proto === 'anthropic') {
      const base = normBase(baseUrl, 'https://api.anthropic.com');
      return {
        url: base + '/v1/models',
        method: 'GET',
        headers: {
          'x-api-key': apiKey || '',
          'anthropic-version': '2023-06-01'
        }
      };
    }
    const base = normBase(baseUrl, 'https://api.openai.com');
    return {
      url: base + '/v1/models',
      method: 'GET',
      headers: {
        'authorization': 'Bearer ' + (apiKey || '')
      }
    };
  }

  // ---------- 通过 background 执行 fetch ----------
  function fetchViaBackground(spec) {
    return new Promise((resolve) => {
      const runtime = (typeof chrome !== 'undefined' && chrome.runtime);
      if (!runtime || !runtime.sendMessage) {
        resolve({ ok: false, error: '无 chrome.runtime，无法发起请求' });
        return;
      }
      runtime.sendMessage({ type: 'llm-fetch', spec }, (resp) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message || String(chrome.runtime.lastError) });
          return;
        }
        resolve(resp || { ok: false, error: '无响应' });
      });
    });
  }

  // 友好化错误：尽量从 API 返回 body 中取人类可读信息
  function explainError(res, fallback) {
    if (!res) return fallback;
    if (res.error) return String(res.error);
    const d = res.data;
    if (d && typeof d === 'object') {
      // openai: { error: { message } }；anthropic: { error: { message } }；其它：{ message }
      if (d.error && d.error.message) return d.error.message;
      if (d.message) return d.message;
    }
    if (res.status) return fallback + '（HTTP ' + res.status + '）';
    return fallback;
  }

  // ---------- 高层 API ----------
  // chat(opt) → { ok, text, error }
  async function chat(opt) {
    const spec = buildChat(opt.proto, opt);
    const res = await fetchViaBackground(spec);
    if (!res.ok) return { ok: false, error: explainError(res, '优化请求失败') };
    const d = res.data;
    let text = '';
    try {
      if (opt.proto === 'anthropic') {
        // { content: [ { type:'text', text } ] }
        const parts = Array.isArray(d.content) ? d.content : [];
        text = parts.filter((p) => p && p.type === 'text').map((p) => p.text || '').join('').trim();
      } else {
        // { choices: [ { message: { content } } ] }
        const choices = Array.isArray(d.choices) ? d.choices : [];
        text = (choices[0] && choices[0].message && choices[0].message.content || '').trim();
      }
    } catch (e) {
      return { ok: false, error: '解析回复失败：' + (e.message || e) };
    }
    // 去掉模型常见的 ``` 代码块包裹
    text = stripCodeFence(text);
    if (!text) return { ok: false, error: '模型返回了空结果' };
    return { ok: true, text };
  }

  // listModels(opt) → { ok, models:[id...], error }
  async function listModels(opt) {
    const spec = buildListModels(opt.proto, opt);
    const res = await fetchViaBackground(spec);
    if (!res.ok) return { ok: false, error: explainError(res, '获取模型列表失败'), models: [] };
    const d = res.data;
    let ids = [];
    try {
      const arr = Array.isArray(d.data) ? d.data : (Array.isArray(d.models) ? d.models : []);
      ids = arr.map((m) => (typeof m === 'string' ? m : (m && m.id))).filter(Boolean);
    } catch (e) {
      return { ok: false, error: '解析模型列表失败：' + (e.message || e), models: [] };
    }
    if (!ids.length) return { ok: false, error: '模型列表为空', models: [] };
    ids.sort((a, b) => a.localeCompare(b));
    return { ok: true, models: ids };
  }

  // ---------- 提示词优化：单滑块 20 档（创意度↔详细度 对立）----------
  // 滑块 1-10 = 创意度方向（虚构，量递增）：位置1→创意度10(极致虚构)，位置10→创意度1(极轻微虚构)
  // 滑块 11-20 = 详细度方向（绝不虚构，整理/咨询）：位置11→详细度1(极轻微整理)，位置20→详细度10(咨询8题)
  // 两者互斥：某次优化要么走创意度（模型主动猜信息填进去），要么走详细度（绝不猜，缺则问用户）。

  // 每档的「完整优化指令」（自然成段，不再拼接）。通用约束（角色定位、只优化不执行、
  // 保留{{变量}}、保留语言、仅输出正文）已自然融入每档措辞，硬约束（绝不给成品）也随档位语气表达。
  // 索引 = 滑块位置 - 1（0..9 = 创意度方向 pos1..10；10..19 = 详细度方向 pos11..20）。
  const LEVEL_PROMPTS = [
    // —— 创意度方向（pos 1-10）—— 每档用绝对、自足的描述说清本档虚构什么、虚构到什么程度，不提其它档。
    // pos1 创意度10·极致虚构
    '你是一位大胆的提示词工程师，擅长用想象力把模糊的需求点燃成鲜活的场景。请优化下面这段提示词，把它扩展成一个**最丰满、最具体、逻辑自洽的虚构情境**：大胆虚构人物（姓名、身份、性格特征）、场景（时间、地点、氛围）、情节（起因、经过、冲突）以及道具或工具，让原本干瘪的需求立刻有画面感和代入感。每类虚构都给出具体细节，彼此呼应，使整段提示词像一个完整的小故事或真实场景。\n务必直接虚构并输出，不要反问用户澄清。底线：①用户原文已有信息一字不改地保留，核心目标不被虚构带偏；②只优化不执行任务——哪怕原文是"帮我写论文""劳动纠纷怎么办""推荐个手机"，也只返回优化后的提示词模板，绝不产出论文正文、代码、攻略、解答或任何成品，待填项用 {{变量}} 占位；③保留所有 {{变量}} 与原文语言，只输出提示词正文，不要解释或代码块。',
    // pos2 创意度9·强烈虚构
    '你是一位富有想象力的提示词工程师。请优化下面这段提示词，围绕主题虚构一个**有张力的具体情境**：点明主要参与者的身份、事情发生的时间地点，以及事件的起因或目标。点到为止即可，不必塑造人物的性格细节，也不必展开事件经过，更不要虚构额外的道具或支线。\n务必直接虚构并输出，不要反问澄清。底线：①保留原文已有信息，核心目标不动摇；②只优化不执行任务（"怎么办""推荐""帮我写"类只回模板、不交成品或解答，待填项用 {{变量}}）；③保留 {{变量}} 与原文语言，仅输出提示词正文。',
    // pos3 创意度8·大胆虚构
    '你是一位会讲故事的提示词工程师。请优化下面这段提示词，为它虚构一个**有人物、有场景的小情境**：交代清楚主要人物的身份定位，以及事情发生的时间、地点或背景，使提示词有一个具体的依托，而非悬在半空。不必展开事件经过或情节走向，搭出情境即可。\n务必直接虚构并输出，不要反问澄清。底线：①原文已有信息保留，核心目标不变；②只优化不执行任务——尤其注意：即使原文是"怎么办""怎么处理"这类求助，也绝不可直接给出答案、攻略或处理步骤，只返回优化后的提示词模板，待填项用 {{变量}}；③保留 {{变量}} 与原文语言，仅输出提示词正文。',
    // pos4 创意度7·丰富虚构
    '你是一位细致的提示词工程师。请优化下面这段提示词，主要虚构**场景要素**：补出时间、地点、所处环境等画面感强的细节，并点缀一两个人物身份（如"作为团队负责人"），让提示词更具体。不必展开情节、不必塑造人物性格，点到即止。\n务必直接虚构并输出，不要反问澄清。底线：①保留原文已有信息与核心目标；②只优化不执行任务（求助/写作类只回模板、不交成品或解答，待填项用 {{变量}}）；③保留 {{变量}} 与原文语言，仅输出提示词正文。',
    // pos5 创意度6·较多虚构
    '你是一位擅长营造氛围的提示词工程师。请优化下面这段提示词，**补充几个场景要素**（如时间、地点、参与者身份、环境氛围），让提示词有清晰的情境依托。不必写人物对话或情节片段。\n务必直接虚构并输出，不要反问澄清。底线：①保留原文已有信息与核心目标；②只优化不执行任务（求助/写作类只回模板、不交成品或解答，待填项用 {{变量}}）；③保留 {{变量}} 与原文语言，仅输出提示词正文。',
    // pos6 创意度5·中等虚构
    '你是一位善于搭框架的提示词工程师。请优化下面这段提示词，**补充约两个粗略背景要素**（如一个时间、一个简单的动机或用途），让需求有一点来龙去脉，但不展开细节，保持克制。\n务必直接虚构并输出，不要反问澄清。底线：①保留原文已有信息与核心目标；②只优化不执行任务（求助/写作类只回模板、不交成品或解答，待填项用 {{变量}}）；③保留 {{变量}} 与原文语言，仅输出提示词正文。',
    // pos7 创意度4·适度虚构
    '你是一位稳健的提示词工程师。请优化下面这段提示词，**补充一个要素即可**：或给执行者一个自然的身份定位（如"作为团队负责人"），或补一个时间/地点，让情境略微落地，不做多余展开。\n务必直接虚构并输出，不要反问澄清。底线：①保留原文已有信息与核心目标；②只优化不执行任务（求助/写作类只回模板、不交成品或解答，待填项用 {{变量}}）；③保留 {{变量}} 与原文语言，仅输出提示词正文。',
    // pos8 创意度3·少量虚构
    '你是一位克制的提示词工程师。请优化下面这段提示词，**只点缀一两个最轻的小词**（如时间"周末"、地点"公司里"），让提示词有一点画面感，但不展开人物或情节，整体仍贴近原文。\n务必直接虚构并输出，不要反问澄清。底线：①保留原文已有信息与核心目标；②只优化不执行任务（求助/写作类只回模板、不交成品或解答，待填项用 {{变量}}）；③保留 {{变量}} 与原文语言，仅输出提示词正文。',
    // pos9 创意度2·轻微虚构
    '你是一位严谨的提示词工程师。请优化下面这段提示词，**只点缀一个小细节**（比如一个时间或一个简单场景），其余严格忠于原文，几乎看不出改动痕迹。\n务必直接虚构并输出，不要反问澄清。底线：①保留原文已有信息与核心目标；②只优化不执行任务（求助/写作类只回模板、不交成品或解答，待填项用 {{变量}}）；③保留 {{变量}} 与原文语言，仅输出提示词正文。',
    // pos10 创意度1·极轻微虚构
    '你是一位忠于原文的提示词工程师。请优化下面这段提示词，**仅可点缀一个最自然的小细节**（如时间"周末"），其余完全忠于原文，只修正明显的语病，改动越少越好。只做点缀式润色，不结构化、不补步骤、不提取 {{变量}}，保持原文的简短原貌。\n务必直接输出，不要反问澄清。底线：①保留原文已有信息与核心目标；②只优化不执行任务（求助/写作类只回模板、不交成品或解答，待填项用 {{变量}}）；③保留 {{变量}} 与原文语言，仅输出提示词正文。',

    // —— 详细度方向（pos 11-20）—— 绝不虚构，只整理/补充现有信息与格式；每档明确"补什么"，避免相邻档混淆。
    // 共享两条硬约束：①绝不虚构任何原文没有的信息，待填项用 {{变量}} 占位 ②只优化不执行任务（求助/写作类只回模板、不交成品或解答），保留 {{变量}} 与原文语言、仅输出提示词正文。
    // pos11 详细度1·极轻微整理（只改通顺，不改结构、不加信息）
    '你是一位严谨的提示词工程师。请优化下面这段提示词，**只做最基本的润色**：修正错别字、语病与不通顺之处，不增不减任何信息，不改变结构与措辞风格，保持原文原貌。原文中隐含的需要用户提供的具体信息（如主题、参数、场景等），提取为 {{变量}} 表示。底线：①绝不虚构任何原文没有的信息；②只优化不执行任务（如"怎么办""推荐""帮我写"类需求只回提示词模板，不交解答、攻略或任何成品），保留 {{变量}} 与原文语言，仅输出提示词正文。',
    // pos12 详细度2·轻度整理
    '你是一位清晰的提示词工程师。请优化下面这段提示词，**理顺逻辑、消除歧义**：调整语句顺序、补全必要的逻辑衔接，使表达更通顺，但不添加任何原文没有的信息。原文中隐含的需要用户提供的具体信息，提取为 {{变量}} 表示。底线：①绝不虚构原文没有的信息，待填项用 {{变量}} 占位；②只优化不执行任务（求助/写作类只回模板、不交成品或解答），保留 {{变量}} 与原文语言，仅输出提示词正文。',
    // pos13 详细度3·结构化
    '你是一位条理分明的提示词工程师。请优化下面这段提示词，把它**结构化**：用分点、小标题或编号把原文信息组织得层次分明、易于阅读，但不新增任何事实或细节。底线：①绝不虚构原文没有的信息，待填项用 {{变量}} 占位；②只优化不执行任务（求助/写作类只回模板、不交成品或解答），保留 {{变量}} 与原文语言，仅输出提示词正文。',
    // pos14 详细度4·标准整理
    '你是一位规范的提示词工程师。请优化下面这段提示词，在忠于原意的基础上**补充必要的输出格式说明**（如分几部分、用什么格式、按什么结构呈现），使要求更明确，但不增任何事实。底线：①绝不虚构原文没有的信息，待填项用 {{变量}} 占位；②只优化不执行任务（求助/写作类只回模板、不交成品或解答），保留 {{变量}} 与原文语言，仅输出提示词正文。',
    // pos15 详细度5·较完整
    '你是一位周到的提示词工程师。请优化下面这段提示词，**补充主要的约束与步骤**（如关键约束、大致步骤、输出格式），把模糊的要求落成相对清晰的任务，但所有补充都须基于已有信息，不得虚构。底线：①绝不虚构原文没有的信息，待填项用 {{变量}} 占位；②只优化不执行任务（求助/写作类只回模板、不交成品或解答），保留 {{变量}} 与原文语言，仅输出提示词正文。',
    // pos16 详细度6·详细整理
    '你是一位严谨详尽的提示词工程师。请优化下面这段提示词，**补充完整的结构、步骤、约束与输出格式**，把每一项要求都讲清楚、说明白，使提示词可以直接照着执行，但不虚构任何信息。本档聚焦核心任务本身，不必展开边界情况、异常处理或可访问性等延伸项。底线：①绝不虚构原文没有的信息，待填项用 {{变量}} 占位；②只优化不执行任务（求助/写作类只回模板、不交成品或解答），保留 {{变量}} 与原文语言，仅输出提示词正文。',
    // pos17 详细度7·极详细整理
    '你是一位追求极致严谨的提示词工程师。请优化下面这段提示词，**在结构与步骤之外，进一步补充边界情况、异常处理、注意事项**等延伸要求，把能想到的相关要求都纳入，但仍只基于已有信息，绝不编造任何原文没有的事实。底线：①绝不虚构原文没有的信息，待填项用 {{变量}} 占位；②只优化不执行任务（求助/写作类只回模板、不交成品或解答），保留 {{变量}} 与原文语言，仅输出提示词正文。',
    // pos18 详细度8·咨询约3问
    '你是一位善于澄清的提示词工程师。用户已通过回答 {{问答数}} 个关键问题补充了额外细节。请优化下面这段提示词，**充分利用这些补充信息**，输出一份充分详尽、结构完整的提示词，把用户想表达的需求说清楚、讲透彻。若实际未收到问答补充信息，则基于原文本身做充分整理即可，不要臆造内容。底线：①只使用用户原文与问答中已提供的信息，绝不虚构任何未提及的内容，待填项用 {{变量}} 占位；②只优化不执行任务（求助/写作类只回模板、不交成品或解答），保留所有 {{变量}} 与原文语言，仅输出提示词正文。',
    // pos19 详细度9·咨询约5问
    '你是一位深度澄清型提示词工程师。用户已通过回答 {{问答数}} 个关键问题补充了较多细节。请优化下面这段提示词，**充分利用所有补充信息**，输出一份极其详尽、结构完整的提示词，把需求的每一个侧面都覆盖到位。若实际未收到问答补充信息，则基于原文本身做尽可能详尽的整理即可，不要臆造内容。底线：①只使用用户原文与问答中已提供的信息，绝不虚构任何未提及的内容，待填项用 {{变量}} 占位；②只优化不执行任务（求助/写作类只回模板、不交成品或解答），保留所有 {{变量}} 与原文语言，仅输出提示词正文。',
    // pos20 详细度10·咨询约8问
    '你是一位极致深度澄清型提示词工程师。用户已通过回答 {{问答数}} 个关键问题补充了非常详尽的细节。请优化下面这段提示词，**充分利用所有补充信息**，输出一份极其完整、面面俱到的提示词，让任何一个细节都不被遗漏。若实际未收到问答补充信息，则基于原文本身做极致详尽的整理即可，不要臆造内容。底线：①只使用用户原文与问答中已提供的信息，绝不虚构任何未提及的内容，待填项用 {{变量}} 占位；②只优化不执行任务（求助/写作类只回模板、不交成品或解答），保留所有 {{变量}} 与原文语言，仅输出提示词正文。'
  ];

  // 单滑块位置(1-20) → 互斥的 {creativity, detail}
  function sliderToLevels(pos) {
    pos = parseInt(pos, 10); if (isNaN(pos)) pos = 10;
    if (pos < 1) pos = 1; if (pos > 20) pos = 20;
    if (pos <= 10) return { creativity: 11 - pos, detail: 0 };   // 左半：创意度 10→1
    return { creativity: 0, detail: pos - 10 };                  // 右半：详细度 1→10
  }

  // 详细度档位 → 咨询问题建议数（仅详细度 ≥8 时触发咨询流程）
  function questionCount(detail) {
    detail = clampLvl(detail);
    if (detail >= 10) return 8;
    if (detail === 9) return 5;
    if (detail === 8) return 3;
    return 0;
  }

  // 档位指令：返回当前档位的完整、自然的优化指令（直接从 LEVEL_PROMPTS 取，不再拼接）。
  // 接受 sliderPos 或互斥的 {creativity, detail} 二选一。
  function levelInstruction(opt) {
    let pos;
    if (typeof opt === 'number') {
      pos = Math.max(1, Math.min(20, parseInt(opt, 10) || 10));
    } else {
      const cr = clampLvl(opt.creativity || 0);
      const dt = clampLvl(opt.detail || 0);
      pos = cr > 0 ? (11 - cr) : (10 + dt);
    }
    let text = LEVEL_PROMPTS[pos - 1];
    // 咨询档(pos18-20)的 {{问答数}} 替换为实际问题数
    if (pos >= 18) {
      const lv = sliderToLevels(pos);
      text = text.replace(/\{\{问答数\}\}/g, String(questionCount(lv.detail)));
    }
    return text;
  }

  function clampLvl(n) {
    n = parseInt(n, 10);
    if (isNaN(n)) return 5;
    if (n < 1) return 1;
    if (n > 10) return 10;
    return n;
  }

  // 单滑块位置 → 人类可读标签（供 UI 展示）
  const CREATIVITY_LABELS = ['极轻微', '轻微', '少量', '适度', '中等', '较多', '丰富', '大胆', '强烈', '极致'];
  const DETAIL_LABELS = ['极轻微整理', '轻度整理', '结构化', '标准整理', '较完整', '详细整理', '极详细'];
  function sliderLabel(pos) {
    const lv = sliderToLevels(pos);
    if (lv.creativity > 0) return '创意度 ' + lv.creativity + '/10 · ' + CREATIVITY_LABELS[lv.creativity - 1] + '虚构';
    if (lv.detail >= 8) return '详细度 ' + lv.detail + '/10 · 咨询约' + questionCount(lv.detail) + '问';
    return '详细度 ' + lv.detail + '/10 · ' + DETAIL_LABELS[lv.detail - 1];
  }

  // 格式化问答列表为模型可读文本
  function formatQa(qa) {
    if (!qa || !qa.length) return '';
    return qa.map((item, i) => {
      const ans = Array.isArray(item.answer) ? item.answer.join('；') : (item.answer || '');
      return (i + 1) + '. ' + item.q + '\n   答：' + ans;
    }).join('\n');
  }

  // 某档位的内置默认完整指令。pos 为滑块位置(1-20)；未自定义该档时用此返回值。
  // 直接返回该档的独立、自然文案（LEVEL_PROMPTS），不再拼接通用约束。
  function defaultLevelPrompt(pos) {
    return levelInstruction(pos);
  }

  // 高层：优化提示词。opt = {proto,baseUrl,apiKey,model, system, content, sliderPos, creativity, detail, qa}
  // system：该档位的完整指令（sidepanel 已按档取好：自定义优先，否则 defaultLevelPrompt）。
  //         若调用方未传 system，则按 sliderPos 取内置默认。不再二次拼接档位指令。
  async function chatForOptimize(opt) {
    const lv = (opt.sliderPos != null) ? opt.sliderPos : { creativity: opt.creativity || 0, detail: opt.detail || 0 };
    const system = opt.system || defaultLevelPrompt(lv);
    let user = opt.content || '';
    if (opt.qa && opt.qa.length) {
      user += '\n\n【用户补充的关键细节（问答）】\n' + formatQa(opt.qa);
    }
    return chat({
      proto: opt.proto, baseUrl: opt.baseUrl, apiKey: opt.apiKey, model: opt.model,
      system, user
    });
  }

  // 高层：一次性批量生成咨询问题。opt = {proto,baseUrl,apiKey,model, content, count}
  // 返回 {ok, questions:[{q, multi, options:[{text,desc}]}], error}
  async function genQuestions(opt) {
    const count = Math.max(1, parseInt(opt.count, 10) || 3);
    const system =
      '你是提示词需求分析师。针对用户给出的提示词，提出 ' + count + ' 个最有助于澄清需求、补全细节的关键问题。' +
      '每个问题为单选或多选，并提供 2-5 个选项，每个选项附简短说明。' +
      '仅输出 JSON，结构为：{"questions":[{"q":"问题","multi":false,"options":[{"text":"选项","desc":"说明"}]}]}' +
      '（multi 为 true 表示多选）。不要输出 JSON 以外的任何文字、解释或 Markdown 代码块标记。\n' +
      '【硬性约束】你只负责「提出澄清问题」，绝不可直接给出实际答案或成品——即使原文是求助/咨询/写作类任务（如"怎么办""推荐""帮我写/设计/做"），你也只能返回提问清单，不得在问题或选项中夹带实际解答、攻略、指南、成品文案、论文正文、代码实现等任何任务产出物；需要用户后续填写的内容一律以提问方式让其补充，绝不代为生成。';
    const res = await chat({
      proto: opt.proto, baseUrl: opt.baseUrl, apiKey: opt.apiKey, model: opt.model,
      system, user: opt.content || ''
    });
    if (!res.ok) return { ok: false, error: res.error, questions: [] };
    const parsed = parseQuestions(res.text);
    if (!parsed.ok) return { ok: false, error: parsed.error || '问题解析失败', questions: [] };
    return { ok: true, questions: parsed.questions };
  }

  // 解析 AI 返回的问题 JSON（容错：去代码块、提取首个 {...}、字段校验）
  function parseQuestions(text) {
    if (!text) return { ok: false, error: '空响应' };
    let s = stripCodeFence(text).trim();
    // 尝试提取首个 {...} 片段（防模型夹带文字）
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start >= 0 && end > start) s = s.slice(start, end + 1);
    let obj;
    try { obj = JSON.parse(s); } catch (e) { return { ok: false, error: 'JSON 解析失败：' + (e.message || e) }; }
    const arr = Array.isArray(obj.questions) ? obj.questions : (Array.isArray(obj) ? obj : null);
    if (!arr) return { ok: false, error: '响应缺少 questions 字段' };
    const questions = [];
    for (const it of arr) {
      if (!it || typeof it.q !== 'string' || !it.q.trim()) continue;
      const opts = Array.isArray(it.options) ? it.options : [];
      const options = opts.map((o) => ({
        text: typeof o === 'string' ? o : (o && typeof o.text === 'string' ? o.text : ''),
        desc: (o && typeof o.desc === 'string') ? o.desc : ''
      })).filter((o) => o.text);
      if (!options.length) continue;
      questions.push({ q: it.q.trim(), multi: !!it.multi, options });
    }
    if (!questions.length) return { ok: false, error: '未解析到有效问题' };
    return { ok: true, questions };
  }

  // 去掉首尾的 ```lang ... ``` 包裹（仅当整体被包裹时）
  function stripCodeFence(s) {
    if (!s) return s;
    const m = s.match(/^\s*```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```\s*$/);
    return m ? m[1] : s;
  }

  NS.llm = {
    DEFAULT_OPTIMIZE_PROMPT,
    normBase,
    buildChat, buildListModels,
    chat, listModels,
    sliderToLevels, levelInstruction, questionCount,
    sliderLabel, formatQa, defaultLevelPrompt,
    chatForOptimize, genQuestions, parseQuestions
  };
})(typeof self !== 'undefined' ? self : this);
