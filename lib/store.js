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
    tagOrder: 'ph_tag_order'  // { [categoryId]: [tagName, ...] } 每个分类的标签手动排序
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
      list.push(p);
    } else {
      const i = list.findIndex((x) => x.id === p.id);
      if (i >= 0) {
        list[i] = Object.assign({}, list[i], p);
        list[i].id = p.id; // 保留 id
      } else {
        list.push(p);
      }
    }
    p.updatedAt = ts;
    // 保存时预生成拼音索引，加速检索
    if (NS.search) {
      p._index = NS.search.buildIndex(p);
    }
    await set(KEYS.prompts, list);
    return p;
  }

  async function deletePrompt(id) {
    const list = await getPrompts();
    const next = list.filter((p) => p.id !== id);
    await set(KEYS.prompts, next);
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

  // 批量替换（用于导入）
  async function replaceAllPrompts(prompts) {
    const ts = now();
    prompts.forEach((p) => {
      if (!p.id) p.id = uid();
      if (!p.createdAt) p.createdAt = ts;
      if (p.usageCount == null) p.usageCount = 0;
      if (p.lastUsed == null) p.lastUsed = 0;
      if (p.favorite == null) p.favorite = false;
      if (NS.search) p._index = NS.search.buildIndex(p);
    });
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
    sidebarCount: 50
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
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      prompts: await getPrompts(),
      categories: await getCategories(),
      settings: await getSettings()
    };
  }

  // mode: 'replace' 全部替换 | 'merge' 按 id/title 合并
  async function importAll(data, mode) {
    if (!data || typeof data !== 'object') throw new Error('数据格式无效');
    let imported = 0;
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
        imported = data.prompts.length;
      } else {
        const cur = await getPrompts();
        for (const p of data.prompts) {
          if (!cur.find((x) => (p.id && x.id === p.id) || x.title === p.title)) {
            cur.push(p); imported++;
          }
        }
        await replaceAllPrompts(cur);
      }
    }
    return imported;
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
    getPrompts, getPrompt, savePrompt, deletePrompt,
    renameTagInCategory, deleteTagInCategory,
    replaceAllPrompts, recordUsage, toggleFavorite, rebuildIndexes,
    getSettings, saveSettings, DEFAULT_SETTINGS,
    exportAll, importAll, getStats,
    ensureInit
  };
})(typeof self !== 'undefined' ? self : this);
