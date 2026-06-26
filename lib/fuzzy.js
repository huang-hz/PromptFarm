/* fuzzy.js — 模糊字符串匹配
 * 提供子串匹配、词首匹配、Levenshtein 距离（容错）评分。
 * 挂载到 PH.fuzzy。
 */
(function (root) {
  'use strict';

  const NS = root.PH || (root.PH = {});

  // 带提前终止的 Levenshtein 距离（距离超过 max 则返回 max+1）
  function levenshtein(a, b, max) {
    const al = a.length, bl = b.length;
    if (al === 0) return bl;
    if (bl === 0) return al;
    if (Math.abs(al - bl) > (max || Infinity)) return (max || Infinity) + 1;

    let prev = new Array(bl + 1);
    let cur = new Array(bl + 1);
    for (let j = 0; j <= bl; j++) prev[j] = j;

    const bound = max == null ? Infinity : max;
    for (let i = 1; i <= al; i++) {
      cur[0] = i;
      let rowMin = cur[0];
      const ca = a.charCodeAt(i - 1);
      for (let j = 1; j <= bl; j++) {
        const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
        let del = prev[j] + 1;
        let ins = cur[j - 1] + 1;
        let sub = prev[j - 1] + cost;
        let v = del < ins ? del : ins;
        if (sub < v) v = sub;
        cur[j] = v;
        if (v < rowMin) rowMin = v;
      }
      if (rowMin > bound) return bound + 1;
      const tmp = prev; prev = cur; cur = tmp;
    }
    return prev[bl];
  }

  // 0~1 相似度（1 表示完全相同）
  function similarity(a, b) {
    if (!a && !b) return 1;
    if (!a || !b) return 0;
    const d = levenshtein(a, b, Math.max(a.length, b.length));
    return 1 - d / Math.max(a.length, b.length);
  }

  // 把字符串切成用于匹配的“词”（中英文混合：英文按空格/标点，中文逐字也行但这里按非词符切分）
  function tokenize(s) {
    if (!s) return [];
    return String(s).toLowerCase()
      .split(/[\s,，。.!！?？:：;；()（）\[\]【】"'`|/\\#@&*+—\-—~<>{}]+/)
      .filter(Boolean);
  }

  // 在 text 中查找 query 子串位置（不区分大小写），返回 {score, index} 或 null
  function substringMatch(text, query) {
    if (!query) return null;
    const t = String(text).toLowerCase();
    const q = String(query).toLowerCase();
    const idx = t.indexOf(q);
    if (idx < 0) return null;
    // 开头命中得分最高，越靠后越低
    let score = 1 - (idx / Math.max(t.length, 1)) * 0.3;
    return { score, index: idx };
  }

  // query 是否匹配某个词的开头（前缀），返回最高分或 0
  function prefixMatch(text, query) {
    if (!query) return 0;
    const tokens = tokenize(text);
    let best = 0;
    for (const tok of tokens) {
      if (tok.startsWith(query)) {
        // 完全相等 > 词首前缀
        const s = tok === query ? 1 : 0.8 - (query.length / Math.max(tok.length, 1)) * 0.1;
        if (s > best) best = s;
      }
    }
    return best;
  }

  NS.fuzzy = {
    levenshtein, similarity, tokenize,
    substringMatch, prefixMatch
  };
})(typeof self !== 'undefined' ? self : this);
