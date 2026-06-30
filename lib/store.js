/* store.js — 数据存储层
 * 负责提示词、分类、设置的增删改查，使用统计，以及导入导出。
 * 挂载到全局命名空间 PH.store。
 */
(function (root) {
  'use strict';

  const NS = root.PH || (root.PH = {});
  const storage = (typeof chrome !== 'undefined' && chrome.storage) ? chrome.storage.local : null;

  const KEYS = {
    prompts: 'ph_prompts',
    categories: 'ph_categories',
    settings: 'ph_settings',
    meta: 'ph_meta',          // 版本号、是否已初始化等
    tagOrder: 'ph_tag_order', // { [categoryId]: [tagName, ...] } 每个分类的标签手动排序
    trash: 'ph_trash',        // 被删除提示词的回收站（软删除）
    catalog: 'ph_catalog',    // 供应商-模型目录（用户可编辑）
    activeModels: 'ph_active_models', // 激活的模型 id 列表
    aiConfig: 'ph_ai_config'  // 提示词AI优化配置（供应商/base/key/模型/优化指令）
  };

  // ---------- 基础读写 ----------
  function get(key) {
    return new Promise((resolve) => {
      if (!storage) return resolve({});
      storage.get(key, (res) => resolve(res[key] || null));
    });
  }

  function set(key, value) {
    return new Promise((resolve) => {
      if (!storage) return resolve();
      const obj = {}; obj[key] = value;
      storage.set(obj, () => resolve());
    });
  }

  // ---------- 内容指纹（SHA-256） ----------
  // 把提示词的内容字段规范化为稳定字符串（顺序无关：tags/models 排序后拼接）
  function contentSignature(p) {
    const tags = (p.tags || []).slice().sort().join(',');
    const models = (p.models || []).slice().sort().join(',');
    return [
      String(p.title || ''),
      String(p.description || ''),
      String(p.categoryId || ''),
      tags,
      models,
      String(p.content || '')
    ].join('\u0001'); // 用不可见分隔符避免字段值含换行造成歧义
  }

  // SHA-256 异步哈希（浏览器原生 crypto.subtle）；Node 环境降级
  // 统一加 "PF-" 前缀，标识 PromptFlash 的内容指纹
  async function sha256(text) {
    const data = new TextEncoder().encode(text);
    let hex = null;
    // 浏览器：Web Crypto API
    if (root.crypto && root.crypto.subtle) {
      const buf = await root.crypto.subtle.digest('SHA-256', data);
      hex = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    // Node 降级（测试用）
    else if (typeof require === 'function') {
      try { hex = require('crypto').createHash('sha256').update(text).digest('hex'); } catch (e) {}
    }
    return hex ? ('PF-' + hex) : null; // 无可用实现时返回 null（不阻塞，仅无指纹）
  }

  // 计算并写入提示词的 _hash（异步，不抛错）
  async function computeHash(p) {
    try {
      p._hash = await sha256(contentSignature(p));
    } catch (e) { /* 忽略，保证保存不因哈希失败而中断 */ }
    return p;
  }

  // ---------- 工具函数 ----------
  function uid() {
    return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function now() { return Date.now(); }

  // ---------- 分类 ----------
  async function getCategories() {
    let list = await get(KEYS.categories);
    if (!list) list = [];
    return list.slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  }

  async function saveCategory(cat) {
    const list = await getCategories();
    if (!cat.id) {
      cat.id = 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
      cat.sortOrder = cat.sortOrder != null ? cat.sortOrder : list.length;
      cat.createdAt = now();
      list.push(cat);
    } else {
      const i = list.findIndex((c) => c.id === cat.id);
      if (i >= 0) list[i] = Object.assign({}, list[i], cat);
      else list.push(cat);
    }
    await set(KEYS.categories, list);
    return cat;
  }

  async function deleteCategory(id, reassignTo) {
    const list = await getCategories();
    const next = list.filter((c) => c.id !== id);
    await set(KEYS.categories, next);
    // 把该分类下的提示词迁移到 reassignTo，或置空
    const prompts = await getPrompts();
    let changed = false;
    prompts.forEach((p) => {
      if (p.categoryId === id) { p.categoryId = reassignTo || null; changed = true; }
    });
    if (changed) await set(KEYS.prompts, prompts);
  }

  // 批量重排分类顺序：传入按目标顺序排列的分类 id 数组
  async function reorderCategories(orderedIds) {
    const list = await getCategories();
    const map = {};
    list.forEach((c) => { map[c.id] = c; });
    const next = [];
    orderedIds.forEach((id, i) => { if (map[id]) { map[id].sortOrder = i; next.push(map[id]); delete map[id]; } });
    // 任何遗漏的分类追加到末尾（容错）
    Object.keys(map).forEach((id) => { map[id].sortOrder = next.length; next.push(map[id]); });
    await set(KEYS.categories, next);
  }

  // ---------- 标签排序（按分类存储） ----------
  async function getTagOrder() {
    return (await get(KEYS.tagOrder)) || {};
  }

  // 获取某分类下的标签有序列表：合并【手动排序】+【提示词里实际出现的标签】
  // 手动排序的在前、未排过的（新出现的）按使用次数追加在后
  async function getOrderedTagsForCategory(categoryId) {
    const orderMap = await getTagOrder();
    const ordered = orderMap[categoryId] || [];
    const prompts = await getPrompts();
    const counts = {};
    prompts
      .filter((p) => p.categoryId === categoryId)
      .forEach((p) => (p.tags || []).forEach((t) => { counts[t] = (counts[t] || 0) + 1; }));
    // 手动排序里仍存在的标签，按顺序保留
    const result = ordered.filter((t) => counts[t] != null);
    // 未排过序的新标签按使用次数追加
    Object.keys(counts).sort((a, b) => counts[b] - counts[a]).forEach((t) => {
      if (result.indexOf(t) < 0) result.push(t);
    });
    return { tags: result, counts: counts };
  }

  // 更新某分类的标签顺序：传入按目标顺序排列的标签名数组
  async function saveTagOrderForCategory(categoryId, orderedTags) {
    const orderMap = await getTagOrder();
    orderMap[categoryId] = orderedTags.slice();
    await set(KEYS.tagOrder, orderMap);
  }

  // ---------- 提示词 ----------
  async function getPrompts() {
    let list = await get(KEYS.prompts);
    if (!list) list = [];
    return list;
  }

  async function getPrompt(id) {
    const list = await getPrompts();
    return list.find((p) => p.id === id) || null;
  }

  async function savePrompt(p) {
    const list = await getPrompts();
    const ts = now();
    if (!p.id) {
      p.id = uid();
      p.createdAt = ts;
      p.usageCount = p.usageCount || 0;
      p.lastUsed = p.lastUsed || 0;
      p.favorite = !!p.favorite;
      p.models = Array.isArray(p.models) ? p.models : [];
      list.push(p);
    } else {
      const i = list.findIndex((x) => x.id === p.id);
      if (i >= 0) {
        list[i] = Object.assign({}, list[i], p);
        list[i].id = p.id; // 保留 id
        if (!Array.isArray(list[i].models)) list[i].models = [];
      } else {
        if (!Array.isArray(p.models)) p.models = [];
        list.push(p);
      }
    }
    p.updatedAt = ts;
    // 保存时预生成拼音索引，加速检索
    if (NS.search) {
      p._index = NS.search.buildIndex(p);
    }
    // 保存时计算内容指纹（SHA-256），用于导入去重
    await computeHash(p);
    await set(KEYS.prompts, list);
    return p;
  }

  // 单条删除（软删除）：移入回收站，加 deletedAt 时间戳
  async function deletePrompt(id) {
    const list = await getPrompts();
    const victim = list.find((p) => p.id === id);
    if (!victim) return;
    const trash = await getTrash();
    trash.push(Object.assign({}, victim, { deletedAt: now() }));
    await set(KEYS.trash, trash);
    await set(KEYS.prompts, list.filter((p) => p.id !== id));
  }

  // 批量删除（软删除）：命中项移入回收站，一次写回两个 key
  async function deletePrompts(ids) {
    if (!Array.isArray(ids) || !ids.length) return 0;
    const idSet = {};
    ids.forEach((id) => { idSet[id] = true; });
    const list = await getPrompts();
    const ts = now();
    const trash = await getTrash();
    const remain = [];
    list.forEach((p) => {
      if (idSet[p.id]) trash.push(Object.assign({}, p, { deletedAt: ts }));
      else remain.push(p);
    });
    await set(KEYS.trash, trash);
    await set(KEYS.prompts, remain);
    return ids.length;
  }

  // ---------- 回收站 ----------
  async function getTrash() {
    let list = await get(KEYS.trash);
    return Array.isArray(list) ? list : [];
  }

  // 还原：从回收站移回主列表；若原分类已删则回退到未分类
  async function restorePrompt(id) {
    const trash = await getTrash();
    const item = trash.find((p) => p.id === id);
    if (!item) return;
    const cats = await getCategories();
    const categoryId = cats.some((c) => c.id === item.categoryId) ? item.categoryId : null;
    // 走 savePrompt 重建搜索索引与指纹（它已确保 id 唯一、补全字段）
    const restored = Object.assign({}, item, { categoryId });
    delete restored.deletedAt;
    delete restored._index;
    await savePrompt(restored);             // 写回 ph_prompts
    const trash2 = await getTrash();
    await set(KEYS.trash, trash2.filter((p) => p.id !== id));
  }

  // 永久删除单条
  async function purgePrompt(id) {
    const trash = (await getTrash()).filter((p) => p.id !== id);
    await set(KEYS.trash, trash);
  }

  // 清空回收站
  async function emptyTrash() {
    await set(KEYS.trash, []);
  }


  // 批量重命名标签（限定在某分类范围内，符合"每个分类各自独立标签"模型）
  // oldName -> newName，categoryId 为空表示全局
  async function renameTagInCategory(categoryId, oldName, newName) {
    const list = await getPrompts();
    newName = String(newName || '').trim();
    if (!newName) throw new Error('新标签名不能为空');
    let count = 0;
    list.forEach((p) => {
      if (categoryId && p.categoryId !== categoryId) return;
      if (!p.tags || p.tags.indexOf(oldName) < 0) return;
      p.tags = p.tags.filter((t) => t !== oldName);
      if (p.tags.indexOf(newName) < 0) p.tags.push(newName);
      count++;
    });
    if (count) {
      list.forEach((p) => { if (NS.search) p._index = NS.search.buildIndex(p); });
      await set(KEYS.prompts, list);
      // 同步标签排序：把 oldName 替换为 newName
      if (categoryId) {
        const orderMap = await getTagOrder();
        const arr = orderMap[categoryId] || [];
        const i = arr.indexOf(oldName);
        if (i >= 0) { arr[i] = newName; orderMap[categoryId] = arr; await set(KEYS.tagOrder, orderMap); }
      }
    }
    return count;
  }

  // 批量删除标签（限定在某分类范围内）
  async function deleteTagInCategory(categoryId, tagName) {
    const list = await getPrompts();
    let count = 0;
    list.forEach((p) => {
      if (categoryId && p.categoryId !== categoryId) return;
      if (!p.tags || p.tags.indexOf(tagName) < 0) return;
      p.tags = p.tags.filter((t) => t !== tagName);
      count++;
    });
    if (count) {
      list.forEach((p) => { if (NS.search) p._index = NS.search.buildIndex(p); });
      await set(KEYS.prompts, list);
      // 同步标签排序：移除该标签
      if (categoryId) {
        const orderMap = await getTagOrder();
        const arr = orderMap[categoryId] || [];
        const i = arr.indexOf(tagName);
        if (i >= 0) { arr.splice(i, 1); orderMap[categoryId] = arr; await set(KEYS.tagOrder, orderMap); }
      }
    }
    return count;
  }

  // 批量替换（用于导入/初始化）
  async function replaceAllPrompts(prompts) {
    const ts = now();
    for (const p of prompts) {
      if (!p.id) p.id = uid();
      if (!p.createdAt) p.createdAt = ts;
      if (p.usageCount == null) p.usageCount = 0;
      if (p.lastUsed == null) p.lastUsed = 0;
      if (p.favorite == null) p.favorite = false;
      if (!Array.isArray(p.models)) p.models = [];
      if (NS.search) p._index = NS.search.buildIndex(p);
      if (!p._hash || p._hash.indexOf('PF-') !== 0) await computeHash(p);   // 无 PF- 前缀指纹则补算
    }
    await set(KEYS.prompts, prompts);
  }

  async function recordUsage(id) {
    const list = await getPrompts();
    const p = list.find((x) => x.id === id);
    if (!p) return;
    p.usageCount = (p.usageCount || 0) + 1;
    p.lastUsed = now();
    await set(KEYS.prompts, list);
  }

  async function toggleFavorite(id) {
    const list = await getPrompts();
    const p = list.find((x) => x.id === id);
    if (!p) return null;
    p.favorite = !p.favorite;
    await set(KEYS.prompts, list);
    return p.favorite;
  }

  // 重建所有提示词的拼音索引（首次升级或迁移后调用）
  async function rebuildIndexes() {
    const list = await getPrompts();
    if (!NS.search) return;
    let changed = false;
    list.forEach((p) => {
      const idx = NS.search.buildIndex(p);
      if (JSON.stringify(idx) !== JSON.stringify(p._index)) {
        p._index = idx; changed = true;
      }
    });
    if (changed) await set(KEYS.prompts, list);
  }

  // ---------- 设置 ----------
  const DEFAULT_SETTINGS = {
    defaultAction: 'copy',       // copy | insert | menu
    theme: 'auto',               // auto | light | dark
    searchFuzzy: true,
    searchPinyin: true,
    copyOnInsert: false,
    sidebarCount: 50,
    displayCatCount: 0,          // 使用界面默认展示前几条分类，0=全部
    displayTagCount: 0           // 使用界面默认展示前几条标签，0=全部
  };

  async function getSettings() {
    const s = await get(KEYS.settings);
    return Object.assign({}, DEFAULT_SETTINGS, s || {});
  }

  async function saveSettings(patch) {
    const cur = await getSettings();
    const next = Object.assign({}, cur, patch);
    await set(KEYS.settings, next);
    return next;
  }

  // ---------- 导入导出 ----------
  async function exportAll() {
    const prompts = await getPrompts();
    // 确保所有提示词都有指纹（兼容旧数据）
    for (const p of prompts) { if (!p._hash) await computeHash(p); }
    if (prompts.some((p) => !p._hash)) await set(KEYS.prompts, prompts);
    return {
      version: 2,                          // v2：提示词含 _hash
      exportedAt: new Date().toISOString(),
      prompts: prompts,
      categories: await getCategories(),
      settings: await getSettings()
    };
  }

  // mode: 'replace' 全部替换 | 'merge' 按内容指纹合并（相同哈希→覆盖，不同→新增）
  // 返回 { added, updated }：新增数、覆盖更新数
  async function importAll(data, mode) {
    if (!data || typeof data !== 'object') throw new Error('数据格式无效');
    let added = 0, updated = 0;

    // 分类：合并时按 id 去重，替换时直接覆盖
    if (Array.isArray(data.categories) && data.categories.length) {
      if (mode === 'replace') {
        await set(KEYS.categories, data.categories);
      } else {
        const cur = await getCategories();
        for (const c of data.categories) {
          if (!cur.find((x) => x.id === c.id)) cur.push(c);
        }
        await set(KEYS.categories, cur);
      }
    }

    if (Array.isArray(data.prompts)) {
      if (mode === 'replace') {
        await replaceAllPrompts(data.prompts);
        added = data.prompts.length;
      } else {
        // merge：按内容指纹匹配
        const cur = await getPrompts();
        // 确保现有数据都有指纹（旧数据可能没有）
        // 确保现有数据都有指纹（旧数据可能没有，或无 PF- 前缀）
        for (const p of cur) {
          if (!p._hash || p._hash.indexOf('PF-') !== 0) await computeHash(p);
        }
        // 建立现有指纹 → 索引 映射
        const hashIndex = {};
        cur.forEach((p, i) => { if (p._hash) hashIndex[p._hash] = i; });

        for (const incoming of data.prompts) {
          // 为导入项计算指纹（无 PF- 前缀则重算，保证一致性）
          if (!incoming._hash || incoming._hash.indexOf('PF-') !== 0) await computeHash(incoming);
          const hash = incoming._hash;
          const existIdx = hash ? hashIndex[hash] : -1;
          if (existIdx >= 0) {
            // 内容相同 → 覆盖字段，但保留使用统计/收藏/创建时间
            const old = cur[existIdx];
            cur[existIdx] = Object.assign({}, incoming, {
              id: old.id,                       // 保留原 id
              createdAt: old.createdAt,         // 保留创建时间
              usageCount: old.usageCount || 0,  // 保留使用次数
              lastUsed: old.lastUsed || 0,      // 保留最近使用
              favorite: old.favorite            // 保留收藏
            });
            if (NS.search) cur[existIdx]._index = NS.search.buildIndex(cur[existIdx]);
            updated++;
          } else {
            // 内容不同 → 新增
            cur.push(incoming);
            if (hash) hashIndex[hash] = cur.length - 1;
            added++;
          }
        }
        await replaceAllPrompts(cur);
      }
    }
    return { added: added, updated: updated };
  }

  // ---------- 统计 ----------
  async function getStats() {
    const prompts = await getPrompts();
    const tags = {};
    prompts.forEach((p) => {
      (p.tags || []).forEach((t) => { tags[t] = (tags[t] || 0) + 1; });
    });
    return {
      total: prompts.length,
      favorites: prompts.filter((p) => p.favorite).length,
      tags: tags,
      categoryCount: (await getCategories()).length
    };
  }

  // ---------- 初始化 ----------
  // ---------- 供应商-模型目录（用户可编辑） ----------
  async function getCatalog() {
    let list = await get(KEYS.catalog);
    return Array.isArray(list) ? list : [];
  }
  async function saveCatalog(arr) {
    await set(KEYS.catalog, Array.isArray(arr) ? arr : []);
    return arr;
  }
  async function getActiveModels() {
    let list = await get(KEYS.activeModels);
    return Array.isArray(list) ? list : [];
  }
  async function setActiveModels(ids) {
    await set(KEYS.activeModels, Array.isArray(ids) ? ids : []);
    return ids;
  }

  // ---------- 提示词AI优化配置 ----------
  // proto: 'openai' | 'anthropic'（兼容协议）
  // baseUrl: 用户自填（不含 /v1 后缀），为空时取协议默认
  // apiKey: 密钥
  // levelPrompts: { "1":"自定义指令", "12":"..." } 仅存用户改过的档（key=滑块位置1-20）；
  //               某档不存在/为空 → 用内置默认（见 lib/llm.js 的 defaultLevelPrompt）
  const DEFAULT_AI_CONFIG = {
    proto: 'openai',
    baseUrl: '',
    apiKey: '',
    model: '',
    levelPrompts: {}
  };
  async function getAiConfig() {
    const c = await get(KEYS.aiConfig);
    const merged = Object.assign({}, DEFAULT_AI_CONFIG, c || {});
    // 字符串字段兜底，避免历史脏数据
    ['proto', 'baseUrl', 'apiKey', 'model'].forEach((k) => {
      if (typeof merged[k] !== 'string') merged[k] = DEFAULT_AI_CONFIG[k];
    });
    // levelPrompts 必须是对象（历史数据可能是旧的 systemPrompt 字符串，忽略）
    if (!merged.levelPrompts || typeof merged.levelPrompts !== 'object' || Array.isArray(merged.levelPrompts)) {
      merged.levelPrompts = {};
    } else {
      // 清理空值与非法 key，规整为 { "pos": "text" }
      const clean = {};
      Object.keys(merged.levelPrompts).forEach((k) => {
        const v = merged.levelPrompts[k];
        if (typeof v === 'string' && v.trim() && /^\d+$/.test(k)) clean[k] = v;
      });
      merged.levelPrompts = clean;
    }
    return merged;
  }
  async function saveAiConfig(patch) {
    const cur = await getAiConfig();
    const next = Object.assign({}, cur, patch || {});
    await set(KEYS.aiConfig, next);
    return next;
  }
  // 仅更新某一档的自定义指令（绕开 saveAiConfig 的浅合并，避免整对象覆盖丢其它档）
  async function saveLevelPrompt(pos, text) {
    const cur = await getAiConfig();
    const lp = Object.assign({}, cur.levelPrompts || {});
    const p = parseInt(pos, 10);
    if (p >= 1 && p <= 20 && typeof text === 'string' && text.trim()) {
      lp[String(p)] = text;
    }
    const next = Object.assign({}, cur, { levelPrompts: lp });
    await set(KEYS.aiConfig, next);
    return next;
  }
  // 清除某一档的自定义指令（回退到内置默认）
  async function clearLevelPrompt(pos) {
    const cur = await getAiConfig();
    const lp = Object.assign({}, cur.levelPrompts || {});
    delete lp[String(parseInt(pos, 10))];
    const next = Object.assign({}, cur, { levelPrompts: lp });
    await set(KEYS.aiConfig, next);
    return next;
  }

  async function ensureInit(seed) {
    const meta = await get(KEYS.meta);
    if (meta && meta.initialized) {
      // 仍可能需要为旧数据补建索引
      await rebuildIndexes();
      return false;
    }
    const cats = await get(KEYS.categories);
    if (!cats || !cats.length) {
      await set(KEYS.categories, seed.categories || []);
    }
    const prompts = await get(KEYS.prompts);
    if (!prompts || !prompts.length) {
      await replaceAllPrompts(seed.prompts || []);
    }
    const settings = await get(KEYS.settings);
    if (!settings) await set(KEYS.settings, DEFAULT_SETTINGS);
    await set(KEYS.meta, { initialized: true, version: 1, installedAt: now() });
    return true;
  }

  NS.store = {
    KEYS, uid, now,
    getCategories, saveCategory, deleteCategory, reorderCategories,
    getTagOrder, getOrderedTagsForCategory, saveTagOrderForCategory,
    getPrompts, getPrompt, savePrompt, deletePrompt, deletePrompts,
    getTrash, restorePrompt, purgePrompt, emptyTrash,
    renameTagInCategory, deleteTagInCategory,
    replaceAllPrompts, recordUsage, toggleFavorite, rebuildIndexes,
    getSettings, saveSettings, DEFAULT_SETTINGS,
    exportAll, importAll, getStats,
    getCatalog, saveCatalog, getActiveModels, setActiveModels,
    getAiConfig, saveAiConfig, saveLevelPrompt, clearLevelPrompt, DEFAULT_AI_CONFIG,
    ensureInit
  };
})(typeof self !== 'undefined' ? self : this);
