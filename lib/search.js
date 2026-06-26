/* search.js — 检索引擎
 * 多策略并行打分：精确子串 + 词首前缀 + Levenshtein 容错 + 拼音/首字母。
 * 字段权重：标题 > 标签 > 正文 > 说明。
 * 挂载到 PH.search。
 *
 * 依赖：PH.fuzzy、PH.pinyin（拼音，可选）。
 */
(function (root) {
  'use strict';

  const NS = root.PH || (root.PH = {});
  const fuzzy = NS.fuzzy;
  // 拼音库由 pinyin.min.js（UMD）挂载到全局（globalThis/self.pinyinPro）。
  // 通过函数懒获取，避免加载顺序依赖。
  function getPinyin() {
    if (NS.pinyin) return NS.pinyin;
    if (root.pinyinPro) return root.pinyinPro;
    try { if (typeof pinyinPro !== 'undefined') return pinyinPro; } catch (e) {}
    return null;
  }

  // 字段权重（越大越重要）
  const FIELD_WEIGHT = {
    title: 1.0,
    tags: 0.85,
    category: 0.6,
    content: 0.45,
    description: 0.3
  };

  // 归一化查询：去空格、转小写
  function normQuery(q) {
    return String(q || '').trim().toLowerCase();
  }

  // 取一个词的拼音全拼 + 首字母（缓存到对象上避免重复计算）
  function pinyinOf(text, cacheObj, cacheKey) {
    const pinyin = getPinyin();
    if (!pinyin || !text) return { full: '', initial: '' };
    cacheObj.__py = cacheObj.__py || {};
    if (cacheObj.__py[cacheKey]) return cacheObj.__py[cacheKey];
    const full = pinyin.pinyin(text, { toneType: 'none', type: 'array' }).join('');
    const initial = pinyin.pinyin(text, { toneType: 'none', pattern: 'first', type: 'array' }).join('');
    const v = { full: full.toLowerCase(), initial: initial.toLowerCase() };
    cacheObj.__py[cacheKey] = v;
    return v;
  }

  // 为单个提示词构建检索索引（保存时调用）
  function buildIndex(p) {
    const pinyin = getPinyin();
    const idx = {};
    const titleTags = (p.tags || []).join(' ');
    const tryPinyin = (s) => {
      if (!s) return { full: '', initial: '' };
      if (!pinyin) return { full: '', initial: '' };
      try {
        const full = pinyin.pinyin(s, { toneType: 'none', type: 'array' }).join('').toLowerCase();
        const initial = pinyin.pinyin(s, { toneType: 'none', pattern: 'first', type: 'array' }).join('').toLowerCase();
        return { full, initial };
      } catch (e) { return { full: '', initial: '' }; }
    };
    idx.titlePy = tryPinyin(p.title);
    idx.tagsPy = tryPinyin(titleTags);
    return idx;
  }

  // 对单个字段做综合打分（0~1）
  function scoreField(text, q, opts) {
    const f = fuzzy;
    let best = 0;

    // 1) 精确子串
    const sub = f.substringMatch(text, q);
    if (sub) { if (sub.score > best) best = sub.score; }

    // 2) 词首前缀
    const pre = f.prefixMatch(text, q);
    if (pre > best) best = pre;

    // 3) 模糊容错（仅当 query 较短时，避免性能问题）
    if (opts.fuzzy) {
      // 把 query 与 text 的每个 token 比较，取最大相似度
      const tokens = f.tokenize(text);
      for (const tok of tokens) {
        if (Math.abs(tok.length - q.length) > Math.ceil(q.length * 0.4)) continue;
        const sim = f.similarity(tok, q);
        // 相似度门槛
        const threshold = q.length <= 2 ? 0.5 : (q.length <= 4 ? 0.65 : 0.78);
        if (sim >= threshold && sim > best) best = sim * 0.9; // 容错略低于精确
      }
      // 也允许 query 直接对整个 text 做相似度（处理中文无空格）
      if (!tokens.length) {
        const sim = f.similarity(text, q);
        if (sim >= 0.6 && sim > best) best = sim * 0.85;
      }
    }
    return best;
  }

  // 拼音打分：支持全拼连续输入与首字母输入
  function scorePinyin(pyObj, q, opts) {
    if (!opts.pinyin || !pyObj) return 0;
    let best = 0;
    // 全拼连续匹配（如 "xieyoujian"）
    const fullSub = pyObj.full && pyObj.full.indexOf(q) >= 0;
    if (fullSub) best = 0.95;
    // 全拼前缀
    const fullPre = pyObj.full && pyObj.full.startsWith(q);
    if (fullPre && best < 0.9) best = 0.9;
    // 首字母匹配（如 "xy"）
    if (pyObj.initial && pyObj.initial.indexOf(q) >= 0) {
      const s = pyObj.initial === q ? 0.85 : 0.7;
      if (s > best) best = s;
    }
    return best;
  }

  /**
   * 主搜索函数。
   * @param prompts 提示词数组
   * @param query   查询字符串
   * @param opts    { fuzzy, pinyin, limit, filters }
   * @returns {score, prompt, matchedFields}[] 按分数降序
   */
  function search(prompts, query, opts) {
    opts = opts || {};
    const fuzzyEnabled = opts.fuzzy !== false;
    const pinyinEnabled = opts.pinyin !== false;
    const limit = opts.limit || 0;
    const filters = opts.filters || {};
    const q = normQuery(query);
    const searching = q.length > 0;

    // 先做硬性筛选（分类/标签/收藏/最近）
    let pool = prompts;
    if (filters.categoryId) {
      pool = pool.filter((p) => p.categoryId === filters.categoryId);
    }
    if (filters.tag) {
      pool = pool.filter((p) => (p.tags || []).indexOf(filters.tag) >= 0);
    }
    if (filters.favorite) {
      pool = pool.filter((p) => p.favorite);
    }
    if (filters.recent) {
      // 最近使用过的（有 lastUsed），按时间降序取前若干
      pool = pool
        .filter((p) => p.lastUsed)
        .sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
    }

    const results = [];

    if (!searching) {
      // 无查询：按 收藏 > 最近使用 > 使用次数 排序
      const sorted = pool.slice().sort((a, b) => {
        if (!!b.favorite - !!a.favorite) return !!b.favorite - !!a.favorite ? 1 : -1;
        if ((b.lastUsed || 0) !== (a.lastUsed || 0)) return (b.lastUsed || 0) - (a.lastUsed || 0);
        return (b.usageCount || 0) - (a.usageCount || 0);
      });
      for (const p of sorted) {
        results.push({ score: 1, prompt: p, matchedFields: [] });
        if (limit && results.length >= limit) break;
      }
      return results;
    }

    // 有关键词：打分
    const fieldOpts = { fuzzy: fuzzyEnabled };
    for (const p of pool) {
      let total = 0;
      const matched = [];

      const titleScore = scoreField(p.title, q, fieldOpts);
      if (titleScore > 0) { total += titleScore * FIELD_WEIGHT.title; matched.push('title'); }

      const tagText = (p.tags || []).join(' ');
      const tagScore = scoreField(tagText, q, fieldOpts);
      if (tagScore > 0) { total += tagScore * FIELD_WEIGHT.tags; matched.push('tags'); }

      const descScore = p.description ? scoreField(p.description, q, fieldOpts) : 0;
      if (descScore > 0) { total += descScore * FIELD_WEIGHT.description; matched.push('description'); }

      const contentScore = p.content ? scoreField(p.content, q, fieldOpts) : 0;
      if (contentScore > 0) { total += contentScore * FIELD_WEIGHT.content; matched.push('content'); }

      // 拼音（标题 + 标签）
      if (pinyinEnabled) {
        const idx = p._index || {};
        const titlePy = idx.titlePy;
        const tagsPy = idx.tagsPy;
        const pyTitleScore = scorePinyin(titlePy, q, { pinyin: true });
        if (pyTitleScore > 0) {
          const w = pyTitleScore * FIELD_WEIGHT.title;
          if (w > total * 0.9) { total += w * 0.5; matched.push('pinyin-title'); }
          else total += w * 0.3;
        }
        const pyTagScore = scorePinyin(tagsPy, q, { pinyin: true });
        if (pyTagScore > 0) { total += pyTagScore * FIELD_WEIGHT.tags * 0.4; matched.push('pinyin-tags'); }
      }

      if (total > 0) {
        results.push({ score: total, prompt: p, matchedFields: matched });
      }
    }

    results.sort((a, b) => b.score - a.score);
    if (limit && results.length > limit) return results.slice(0, limit);
    return results;
  }

  NS.search = {
    FIELD_WEIGHT, normQuery, buildIndex, scoreField, scorePinyin, search
  };
})(typeof self !== 'undefined' ? self : this);
