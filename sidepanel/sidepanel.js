/* sidepanel.js — 单页双视图主逻辑
 * 视图：use（搜索+使用） / manage（增删改查） + 全屏编辑器。
 * 逻辑层复用 PH.store / PH.search / PH.template。
 */
(function () {
  'use strict';

  const store = PH.store;
  const search = PH.search;
  const template = PH.template;

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  // ---------- 全局状态 ----------
  const state = {
    prompts: [],
    categories: [],
    settings: {},
    view: 'use',                 // use | manage
    // 使用视图
    query: '',
    activeFilter: 'all',
    sceneTag: null,              // null | 标签名（使用视图：某分类下的场景筛选）
    selectedIndex: 0,
    catExpanded: false,          // 使用视图：分类是否展开（显示全部）
    tagExpanded: false,          // 使用视图：标签是否展开（显示全部）
    results: [],
    pendingPrompt: null,
    pendingAction: null,
    // 管理视图
    mQuery: '',
    mCat: 'all',                 // all | <categoryId>
    mTag: null,                  // null | 标签名（仅在某分类下有效）
    // 编辑器
    editingId: null,
    editingCategoryId: null,
    editorModels: {},             // { [modelId]: true } 当前选中的模型
    // 导入
    pendingImport: null
  };

  // ---------- DOM ----------
  const elSearch = $('#search');
  const elClear = $('#search-clear');
  const elFilters = $('#filters');
  const elResults = $('#results');
  const elCount = $('#status-count');
  const elToast = $('#toast');

  // 加载线性图标 sprite 到 #icon-sprite
  async function loadIcons() {
    const host = $('#icon-sprite');
    if (!host) return;
    try {
      const res = await fetch(chrome.runtime.getURL('sidepanel/icons.html'));
      host.innerHTML = await res.text();
    } catch (e) {
      console.warn('loadIcons failed:', e && e.message);
    }
  }

  // ---------- 初始化 ----------
  async function init() {
    await loadIcons();                       // 先注入图标 sprite
    await store.ensureInit(PH.seed);
    state.settings = await store.getSettings();
    state.categories = await store.getCategories();
    state.prompts = await store.getPrompts();
    applyTheme();
    renderCategoryChips();
    renderManageFilters();
    renderSceneRow();
    refresh();
    refreshManage();
    elSearch.focus();

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      let needRefresh = false;
      if (changes[store.KEYS.prompts]) { state.prompts = changes[store.KEYS.prompts].newValue || []; needRefresh = true; }
      if (changes[store.KEYS.categories]) { state.categories = changes[store.KEYS.categories].newValue || []; renderCategoryChips(); renderManageFilters(); renderSceneRow(); needRefresh = true; }
      if (changes[store.KEYS.settings]) {
        state.settings = Object.assign(state.settings, changes[store.KEYS.settings].newValue);
        applyTheme();
        renderCategoryChips();
        renderSceneRow();
      }
      if (needRefresh) { renderSceneRow(); refresh(); refreshManage(); }
    });

    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'search-query' && msg.query) {
        switchView('use');
        elSearch.value = msg.query;
        state.query = msg.query;
        state.selectedIndex = 0;
        refresh();
        elSearch.focus();
      }
    });
  }

  // ---------- 视图切换 ----------
  function switchView(view) {
    state.view = view;
    $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
    $('#view-use').hidden = view !== 'use';
    $('#view-manage').hidden = view !== 'manage';
    if (view === 'use') { elSearch.focus(); refresh(); }
    else { renderManageFilters(); refreshManage(); }
  }

  // ---------- 主题 ----------
  // 通过 body class 切换（theme-dark/theme-light），手动选择立即生效
  function applyTheme() {
    const t = state.settings.theme || 'auto';
    document.body.classList.remove('theme-dark', 'theme-light');
    if (t === 'dark') document.body.classList.add('theme-dark');
    else if (t === 'light') document.body.classList.add('theme-light');
    // auto：不加 class，交给 CSS 媒体查询跟随系统
    const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.body.style.colorScheme = dark ? 'dark' : 'light';
  }

  // ========== 使用视图 ==========
  function renderCategoryChips() {
    elFilters.querySelectorAll('.chip[data-category], .chip.expand-btn').forEach((c) => c.remove());
    const all = state.categories;
    const limit = state.settings.displayCatCount || 0;   // 0 = 全部
    const needCollapse = limit > 0 && all.length > limit; // 只有超出限制才需要收起
    const showAll = !needCollapse || state.catExpanded;
    const cats = showAll ? all : all.slice(0, limit);
    cats.forEach((c) => {
      const btn = document.createElement('button');
      btn.className = 'chip cat-chip';
      btn.dataset.filter = c.id;
      btn.dataset.category = '1';
      btn.textContent = c.name;
      btn.addEventListener('click', () => selectFilter(c.id));
      elFilters.appendChild(btn);
    });
    // 追加展开/收起按钮
    if (needCollapse) {
      const t = document.createElement('button');
      t.className = 'chip expand-btn';
      const expanded = state.catExpanded;
      t.title = expanded ? '收起' : ('展开（还有 ' + (all.length - limit) + ' 个）');
      t.innerHTML = icon(expanded ? 'collapse' : 'expand');
      t.addEventListener('click', () => { state.catExpanded = !state.catExpanded; renderCategoryChips(); });
      elFilters.appendChild(t);
    }
  }

  function selectFilter(filter) {
    state.activeFilter = filter;
    state.sceneTag = null;
    state.tagExpanded = false;   // 切换分类时收起标签（各分类标签数不同）
    elFilters.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c.dataset.filter === filter));
    renderSceneRow();
    state.selectedIndex = 0;
    refresh();
  }

  // 使用视图：场景标签行（随分类联动，与管理视图一致）
  async function renderSceneRow() {
    const row = $('#scene-row');
    // 仅当选了某个分类时显示场景标签
    const isCategory = state.categories.some((c) => c.id === state.activeFilter);
    if (!isCategory) {
      row.hidden = true;
      row.innerHTML = '';
      return;
    }
    // 用 store 的有序标签（合并手动排序 + 新出现的）
    const { tags, counts: tagCounts } = await store.getOrderedTagsForCategory(state.activeFilter);
    if (state.sceneTag && tags.indexOf(state.sceneTag) < 0) state.sceneTag = null;
    if (!tags.length) {
      row.hidden = true;
      row.innerHTML = '';
      return;
    }
    // 按设置截取，但保证当前选中的标签始终可见
    const limit = state.settings.displayTagCount || 0;   // 0 = 全部
    const needCollapse = limit > 0 && tags.length > limit; // 只有超出限制才需要收起
    const showAll = !needCollapse || state.tagExpanded;
    let shown = showAll ? tags.slice() : tags.slice(0, limit);
    // 收起态下，保证当前选中的标签可见（即使它不在前 limit 个）
    if (!showAll && state.sceneTag && shown.indexOf(state.sceneTag) < 0) shown.push(state.sceneTag);
    row.hidden = false;
    let html = shown.map((t) =>
      '<button class="chip tag-chip' + (state.sceneTag === t ? ' active' : '') + '" data-scene="' + escapeHtml(t) + '">' +
        escapeHtml(t) + '<span class="cnt">' + tagCounts[t] + '</span></button>'
    ).join('');
    // 追加展开/收起按钮
    if (needCollapse) {
      const expanded = state.tagExpanded;
      const t = expanded ? '收起' : ('展开（还有 ' + (tags.length - limit) + ' 个）');
      html += '<button class="chip expand-btn" title="' + escapeHtml(t) + '">' + icon(expanded ? 'collapse' : 'expand') + '</button>';
    }
    row.innerHTML = html;
    // 绑定标签点击（复用现有 scene-row 监听，见事件绑定）
  }

  function refresh() {
    const filters = {};
    if (state.activeFilter === 'favorite') filters.favorite = true;
    else if (state.activeFilter === 'recent') filters.recent = true;
    else if (state.activeFilter !== 'all') filters.categoryId = state.activeFilter;
    if (state.sceneTag) filters.tag = state.sceneTag;

    const res = search.search(state.prompts, state.query, {
      fuzzy: state.settings.searchFuzzy,
      pinyin: state.settings.searchPinyin,
      filters,
      limit: state.settings.sidebarCount || 50
    });
    state.results = res.map((r) => r.prompt);
    renderResults(res);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  // 线性图标：icon('star') => <svg class="ic"><use href="#ic-star"/></svg>
  function icon(name, cls) {
    return '<svg class="ic' + (cls ? ' ' + cls : '') + '"><use href="#ic-' + name + '"/></svg>';
  }
  // 模型徽章：把 models[] 渲染为小标签
  // max: 紧凑态最多显示几个；expandable: 是否支持悬浮展开全部（使用视图用）
  function modelBadges(models, max, expandable) {
    max = max || 2;
    if (!models || !models.length) return '';
    const M = PH.models;
    const compact = models.slice(0, max).map((id) => {
      const { model } = M.parseId(id);
      return '<span class="mbadge">' + escapeHtml(model) + '</span>';
    }).join('');
    const extra = models.length > max ? '<span class="mbadge mbadge-more">+' + (models.length - max) + '</span>' : '';

    // 非展开：单层紧凑
    if (!expandable) {
      return '<span class="mbadges">' + compact + extra + '</span>';
    }
    // 展开模式：默认显示紧凑，悬浮时显示全部并自动换行
    const allHtml = models.map((id) => {
      const { company, model } = M.parseId(id);
      return '<span class="mbadge" title="' + escapeHtml(company) + '">' + escapeHtml(model) + '</span>';
    }).join('');
    return '<span class="mbadges mbadges-compact">' + compact + extra + '</span>' +
      '<span class="mbadges mbadges-all">' + allHtml + '</span>';
  }
  function highlight(text, q) {
    if (!q) return escapeHtml(text);
    const lower = String(text).toLowerCase();
    const idx = lower.indexOf(q.toLowerCase());
    if (idx < 0) return escapeHtml(text);
    return escapeHtml(text.slice(0, idx)) + '<mark>' + escapeHtml(text.slice(idx, idx + q.length)) + '</mark>' + escapeHtml(text.slice(idx + q.length));
  }

  function renderResults(res) {
    elCount.textContent = res.length + ' 条';
    elClear.hidden = !state.query;
    if (!res.length) {
      const hasQuery = !!state.query;
      elResults.innerHTML = '<div class="empty"><div class="emoji">' + (hasQuery ? icon('search', 'ic-xl') : icon('inbox', 'ic-xl')) + '</div>' +
        '<div class="msg">' + (hasQuery ? '没有匹配的提示词' : '这里还没有提示词') + '</div>' +
        '<div class="sub">' + (hasQuery ? '试试换个关键词或检查筛选条件' : '切换到「管理」创建第一个') + '</div></div>';
      return;
    }
    const catMap = {};
    state.categories.forEach((c) => { catMap[c.id] = c; });

    elResults.innerHTML = res.map((r, i) => {
      const p = r.prompt;
      const cat = catMap[p.categoryId];
      const tags = (p.tags || []).slice(0, 4).map((t) => '<span class="tag">' + escapeHtml(t) + '</span>').join('');
      const hasVar = template.hasVariables(p.content);
      return '<div class="result-item' + (i === state.selectedIndex ? ' selected' : '') + '" data-idx="' + i + '" data-id="' + p.id + '">' +
        '<div class="result-head">' +
          '<span class="result-title">' + highlight(p.title, state.query) + '</span>' +
          (p.favorite ? '<span class="result-star">' + icon('star-fill') + '</span>' : '') +
        '</div>' +
        (p.description ? '<div class="result-desc">' + escapeHtml(p.description) + '</div>' : '') +
        (tags ? '<div class="result-tags">' + tags + '</div>' : '') +
        (p.models && p.models.length ? '<div class="result-models">' + modelBadges(p.models, 2, true) + '</div>' : '') +
        '<div class="result-meta">' + (hasVar ? '<span>' + icon('variable') + ' 含变量</span>' : '') + (p.usageCount ? '<span>用 ' + p.usageCount + ' 次</span>' : '') + '</div>' +
        '<div class="result-actions">' +
          '<button class="mini-btn act-copy">' + icon('copy') + ' 复制</button>' +
          '<button class="mini-btn act-insert">' + icon('insert') + ' 插入</button>' +
          '<button class="mini-btn act-fav">' + (p.favorite ? '取消收藏' : icon('star') + ' 收藏') + '</button>' +
        '</div>' +
      '</div>';
    }).join('');

    elResults.querySelectorAll('.result-item').forEach((item) => {
      const idx = parseInt(item.dataset.idx, 10);
      item.addEventListener('mouseenter', () => { state.selectedIndex = idx; updateSelection(false); });
      item.addEventListener('click', (e) => {
        if (e.target.closest('.mini-btn')) return;
        selectIndex(idx);
        usePrompt(state.results[idx], 'default');
      });
      item.querySelector('.act-copy').addEventListener('click', (e) => { e.stopPropagation(); usePrompt(state.results[idx], 'copy'); });
      item.querySelector('.act-insert').addEventListener('click', (e) => { e.stopPropagation(); usePrompt(state.results[idx], 'insert'); });
      item.querySelector('.act-fav').addEventListener('click', (e) => { e.stopPropagation(); toggleFav(state.results[idx]); });
    });
  }

  function updateSelection(scroll) {
    elResults.querySelectorAll('.result-item').forEach((item, i) => item.classList.toggle('selected', i === state.selectedIndex));
    if (scroll) { const n = elResults.querySelector('.result-item.selected'); if (n) n.scrollIntoView({ block: 'nearest' }); }
  }
  function selectIndex(i) {
    const len = state.results.length;
    if (!len) return;
    state.selectedIndex = ((i % len) + len) % len;
    updateSelection(true);
  }

  async function usePrompt(prompt, action) {
    if (!prompt) return;
    if (template.hasVariables(prompt.content)) { openVariableModal(prompt, action); return; }
    await finalizeUse(prompt, prompt.content, action);
  }

  async function finalizeUse(prompt, finalText, action) {
    const defaultAction = action === 'default' ? (state.settings.defaultAction || 'copy') : action;
    await store.recordUsage(prompt.id);
    if (defaultAction === 'copy') { await copyText(finalText); toast('已复制到剪贴板'); }
    else if (defaultAction === 'insert') {
      const ok = await insertIntoPage(finalText);
      toast(ok ? '已插入输入框' : '插入失败，已复制到剪贴板');
      if (!ok) await copyText(finalText);
    } else { await copyText(finalText); await insertIntoPage(finalText); toast('已复制并插入'); }
  }

  async function toggleFav(prompt) {
    const fav = await store.toggleFavorite(prompt.id);
    prompt.favorite = fav;
    refresh();
    toast(fav ? '已收藏' : '已取消收藏');
  }

  // ---------- 变量弹层 ----------
  function openVariableModal(prompt, action) {
    state.pendingPrompt = prompt;
    state.pendingAction = action;
    const vars = template.extractVariables(prompt.content);
    $('#modal-title').textContent = prompt.title;
    const body = $('#modal-body');
    body.innerHTML = vars.map((v) =>
      '<div class="var-field" data-name="' + escapeHtml(v.name) + '">' +
        '<label>' + escapeHtml(v.name) + (v.placeholder && v.placeholder !== v.name ? ' <span class="hint">' + escapeHtml(v.placeholder) + '</span>' : '') + '</label>' +
        '<input class="var-input" data-name="' + escapeHtml(v.name) + '" value="' + escapeHtml(v.defaultValue) + '" placeholder="' + escapeHtml(v.placeholder || v.name) + '" />' +
      '</div>'
    ).join('') + '<div class="preview-label">预览</div><div class="preview" id="preview"></div>';
    $('#modal-overlay').hidden = false;
    updatePreview();
    const first = body.querySelector('.var-input');
    if (first) { first.focus(); first.select(); }
  }
  function collectVarValues() {
    const values = {};
    document.querySelectorAll('#modal-body .var-input').forEach((inp) => { values[inp.dataset.name] = inp.value; });
    return values;
  }
  function updatePreview() {
    if (!state.pendingPrompt) return;
    $('#preview').textContent = template.fill(state.pendingPrompt.content, collectVarValues());
  }
  function closeVariableModal() { $('#modal-overlay').hidden = true; state.pendingPrompt = null; }
  async function confirmModal(action) {
    const prompt = state.pendingPrompt;
    if (!prompt) return;
    const filled = template.fill(prompt.content, collectVarValues());
    closeVariableModal();
    await finalizeUse(prompt, filled, action);
  }

  // ---------- 复制 / 插入 ----------
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = text;
      ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      document.body.removeChild(ta); return ok;
    }
  }
  function insertIntoPage(text) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: 'insert-text', text }, (resp) => {
          if (chrome.runtime.lastError) { resolve(false); return; }
          resolve(!!(resp && resp.ok));
        });
      } catch (e) { resolve(false); }
    });
  }

  // ========== 管理视图 ==========
  async function renderManageFilters() {
    // 分类 chips
    const row = $('#m-cat-row');
    const counts = {};
    state.prompts.forEach((p) => { if (p.categoryId) counts[p.categoryId] = (counts[p.categoryId] || 0) + 1; });
    $('#m-cat-all').textContent = state.prompts.length;
    row.querySelectorAll('.m-chip[data-mcat]:not([data-mcat="all"])').forEach((c) => c.remove());
    state.categories.forEach((c) => {
      const b = document.createElement('button');
      b.className = 'm-chip cat-chip' + (state.mCat === c.id ? ' active' : '');
      b.dataset.mcat = c.id;
      b.innerHTML = escapeHtml(c.name) + ' <span class="cnt">' + (counts[c.id] || 0) + '</span>';
      b.addEventListener('click', () => { state.mCat = c.id; state.mTag = null; renderManageFilters(); refreshManage(); });
      row.appendChild(b);
    });
    row.querySelector('[data-mcat="all"]').classList.toggle('active', state.mCat === 'all');
    row.querySelector('[data-mcat="all"]').onclick = () => { state.mCat = 'all'; state.mTag = null; renderManageFilters(); refreshManage(); };

    // 标签行：只统计当前选中分类下的标签（分类下的具体场景）
    // 选「全部」时不显示标签行（标签是分类下的细分，脱离分类无意义）
    const tagGroup = $('#m-tag-group');
    const tagRow = $('#m-tag-row');
    if (state.mCat === 'all') {
      tagGroup.hidden = true;
      tagRow.innerHTML = '';
    } else {
      // 用 store 的有序标签（合并手动排序 + 新出现的）
      const { tags, counts: tagCounts } = await store.getOrderedTagsForCategory(state.mCat);
      // 清理失效的标签筛选（保存/删除后该标签可能已不存在）
      if (state.mTag && tags.indexOf(state.mTag) < 0) state.mTag = null;
      tagGroup.hidden = false;
      if (!tags.length) {
        tagRow.innerHTML = '<span class="no-tag-hint">该分类下暂无标签（可在编辑提示词时添加）</span>';
      } else {
        tagRow.innerHTML = tags.map((t) =>
          '<button class="m-chip tag-chip' + (state.mTag === t ? ' active' : '') + '" data-tag="' + escapeHtml(t) + '">' +
            escapeHtml(t) + '<span class="cnt">' + tagCounts[t] + '</span></button>'
        ).join('');
        tagRow.querySelectorAll('.m-chip').forEach((c) => {
          c.addEventListener('click', () => { state.mTag = state.mTag === c.dataset.tag ? null : c.dataset.tag; renderManageFilters(); refreshManage(); });
        });
      }
    }
  }

  function getManageList() {
    let pool = state.prompts;
    if (state.mCat !== 'all') pool = pool.filter((p) => p.categoryId === state.mCat);
    if (state.mTag) pool = pool.filter((p) => (p.tags || []).indexOf(state.mTag) >= 0);
    if (!state.mQuery) {
      return pool.slice().sort((a, b) => {
        if (!!b.favorite - !!a.favorite) return !!b.favorite - !!a.favorite ? 1 : -1;
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      });
    }
    return search.search(pool, state.mQuery, { fuzzy: true, pinyin: true }).map((r) => r.prompt);
  }

  function refreshManage() {
    const list = getManageList();
    $('#m-count').textContent = list.length + ' 条';
    const catMap = {};
    state.categories.forEach((c) => { catMap[c.id] = c; });
    const wrap = $('#manage-list');

    if (!list.length) {
      wrap.innerHTML = '<div class="empty"><div class="emoji">' + icon('inbox', 'ic-xl') + '</div><div class="msg">' + (state.mQuery ? '没有匹配项' : '还没有提示词') + '</div><div class="sub">点击「新建」创建</div></div>';
      return;
    }

    wrap.innerHTML = list.map((p) => {
      const cat = catMap[p.categoryId];
      const vars = template.extractVariables(p.content);
      const tags = (p.tags || []).slice(0, 3).map((t) => '<span class="m-tag">' + escapeHtml(t) + '</span>').join('');
      return '<div class="m-card" data-id="' + p.id + '">' +
        '<button class="star ' + (p.favorite ? 'on' : '') + '" data-fav="' + p.id + '">' + icon(p.favorite ? 'star-fill' : 'star') + '</button>' +
        '<div class="info">' +
          '<div class="m-title">' + highlight(p.title, state.mQuery) + '</div>' +
          (p.description ? '<div class="m-desc">' + escapeHtml(p.description) + '</div>' : '') +
          '<div class="m-meta">' +
            (cat ? '<span class="m-cat">' + escapeHtml(cat.name) + '</span>' : '') +
            tags +
            (vars.length ? '<span class="m-var">' + vars.length + ' 变量</span>' : '') +
            (p.usageCount ? '<span class="m-use">用 ' + p.usageCount + ' 次</span>' : '') +
          '</div>' +
          (p.models && p.models.length ? '<div class="m-models">' + modelBadges(p.models, 3) + '</div>' : '') +
        '</div>' +
        '<span class="chev">' + icon('chevron') + '</span>' +
      '</div>';
    }).join('');

    wrap.querySelectorAll('.m-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.classList.contains('star')) return;
        openEditor(card.dataset.id);
      });
    });
    wrap.querySelectorAll('[data-fav]').forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      await store.toggleFavorite(b.dataset.fav);
      state.prompts = await store.getPrompts();
      renderManageFilters();
      refreshManage();
    }));
  }

  // ---------- 编辑器 ----------
  function openEditor(id) {
    state.editingId = id || null;
    const p = id ? state.prompts.find((x) => x.id === id) : null;
    $('#editor-title').textContent = p ? ('编辑：' + p.title) : '新建提示词';
    $('#editor-delete').hidden = !p;
    const form = $('#prompt-form');
    fillCategorySelect();
    form.title.value = p ? p.title : '';
    form.description.value = p ? (p.description || '') : '';
    form.categoryId.value = p ? (p.categoryId || '') : '';
    form.tags.value = p ? (p.tags || []).join(', ') : '';
    form.content.value = p ? p.content : '';
    // 初始化模型选中状态
    state.editorModels = {};
    (p && p.models ? p.models : []).forEach((id) => { state.editorModels[id] = true; });
    renderModelPanel();
    updateVarPreview();
    $('#editor-sheet').hidden = false;
    setTimeout(() => form.title.focus(), 50);
  }
  function closeEditor() { $('#editor-sheet').hidden = true; state.editingId = null; }

  function fillCategorySelect() {
    $('#form-category').innerHTML = '<option value="">（未分类）</option>' +
      state.categories.map((c) => '<option value="' + c.id + '">' + escapeHtml(c.name) + '</option>').join('');
  }

  // ---------- 模型多选下拉框 ----------
  // state.editorModels: { [modelId]: true } 当前编辑器选中的模型集合
  // 渲染下拉面板内容（区域 > 供应商(一级,可全选) > 模型(二级)）
  function renderModelPanel() {
    const M = PH.models;
    const panel = $('#mp-panel');
    let html = '';
    // 按公司名首字母排序
    const companies = M.CATALOG.slice().sort((a, b) => a.company.localeCompare(b.company, 'en'));
    companies.forEach((co) => {
      const allIds = co.models.map((m) => M.makeId(co.company, m));
      const checkedCount = allIds.filter((id) => state.editorModels[id]).length;
      const allChecked = checkedCount === allIds.length;
      const partial = checkedCount > 0 && !allChecked;
      html += '<div class="mp-company">';
      // 一级：供应商（带全选 + 折叠展开）
      html += '<div class="mp-company-head">';
      html += '<input type="checkbox" class="mp-company-all" data-company="' + escapeHtml(co.company) + '"' +
        (allChecked ? ' checked' : '') + (partial ? ' data-partial="1"' : '') + ' />';
      html += '<span class="mp-company-toggle" data-company="' + escapeHtml(co.company) + '">' +
        icon('expand') + escapeHtml(co.company) +
        (partial ? ' <em class="mp-partial">' + checkedCount + '/' + allIds.length + '</em>' :
         (checkedCount > 0 ? ' <em class="mp-partial">✓</em>' : '')) + '</span>';
      html += '</div>';
      // 二级：模型列表（默认折叠，有选中时展开）
      const expanded = checkedCount > 0;
      html += '<div class="mp-models' + (expanded ? ' open' : '') + '">';
      co.models.forEach((m) => {
        const id = M.makeId(co.company, m);
        const on = !!state.editorModels[id];
        html += '<label class="mp-model' + (on ? ' on' : '') + '">';
        html += '<input type="checkbox" class="mp-model-cb" data-id="' + escapeHtml(id) + '"' + (on ? ' checked' : '') + ' />';
        html += '<span>' + escapeHtml(m) + '</span></label>';
      });
      html += '</div></div>';
    });
    panel.innerHTML = html;
    updateModelTrigger();
  }

  // 更新触发按钮显示：已选数量或前几个模型名
  function updateModelTrigger() {
    const ids = collectEditorModels();
    const label = $('#mp-trigger-label');
    if (!ids.length) { label.textContent = '未选择（可选）'; return; }
    const M = PH.models;
    const names = ids.map((id) => M.parseId(id).model);
    if (ids.length <= 2) label.textContent = names.join('、');
    else label.textContent = names.slice(0, 2).join('、') + ' +' + (ids.length - 2);
  }

  function updateModelCount() {
    // 保留兼容（旧引用），下拉版用 updateModelTrigger
    updateModelTrigger();
  }

  // 把当前编辑器的选中模型收集为数组
  function collectEditorModels() {
    return Object.keys(state.editorModels).filter((k) => state.editorModels[k]);
  }

  function updateVarPreview() {
    const content = $('#prompt-form').content.value;
    const vars = template.extractVariables(content);
    const box = $('#var-preview');
    if (!vars.length) { box.innerHTML = '<span class="muted">暂无变量</span>'; return; }
    box.innerHTML = vars.map((v) => '<span class="var-pill">' + escapeHtml(v.name) + (v.defaultValue ? '=' + escapeHtml(v.defaultValue) : '') + '</span>').join('');
  }

  async function savePromptFromForm() {
    const form = $('#prompt-form');
    if (!form.reportValidity()) return;
    const tags = form.tags.value.split(/[,，、\s]+/).map((t) => t.trim()).filter(Boolean);
    await store.savePrompt({
      id: state.editingId || undefined,
      title: form.title.value.trim(),
      description: form.description.value.trim(),
      categoryId: form.categoryId.value || null,
      tags: tags,
      models: collectEditorModels(),
      content: form.content.value
    });
    state.prompts = await store.getPrompts();
    closeEditor();
    renderCategoryChips();
    renderManageFilters();
    refresh();
    refreshManage();
    toast(state.editingId ? '已更新' : '已创建');
  }

  async function deleteCurrent() {
    if (!state.editingId) return;
    if (!confirm('确定删除该提示词？此操作不可撤销。')) return;
    await store.deletePrompt(state.editingId);
    state.prompts = await store.getPrompts();
    closeEditor();
    renderCategoryChips();
    renderManageFilters();
    refresh();
    refreshManage();
    toast('已删除');
  }

  // ---------- 分类 ----------
  function openCategoryModal(id) {
    state.editingCategoryId = id || null;
    const c = id ? state.categories.find((x) => x.id === id) : null;
    $('#cat-overlay-title').textContent = c ? '编辑分类' : '新建分类';
    $('#cat-name').value = c ? c.name : '';
    $('#cat-overlay').hidden = false;
    setTimeout(() => $('#cat-name').focus(), 50);
  }
  async function saveCategory() {
    const name = $('#cat-name').value.trim();
    if (!name) { toast('请填写分类名称'); return; }
    await store.saveCategory({
      id: state.editingCategoryId || undefined,
      name: name
    });
    state.categories = await store.getCategories();
    $('#cat-overlay').hidden = true;
    fillCategorySelect();
    renderCategoryChips();
    renderManageFilters();
    renderSceneRow();
    // 若分类管理面板打开着，刷新它
    if (!$('#catm-sheet').hidden) renderCatmList();
    toast(state.editingCategoryId ? '分类已更新' : '分类已创建');
  }

  // ---------- 分类管理面板 ----------
  function openCatmSheet() {
    renderCatmList();
    $('#catm-sheet').hidden = false;
  }
  function renderCatmList() {
    const counts = {};
    state.prompts.forEach((p) => { if (p.categoryId) counts[p.categoryId] = (counts[p.categoryId] || 0) + 1; });
    const list = $('#catm-list');
    if (!state.categories.length) {
      list.innerHTML = '<div class="mgr-empty">还没有分类，点右上「新建」</div>';
      return;
    }
    list.innerHTML =
      '<div class="mgr-hint">共 ' + state.categories.length + ' 个分类。拖动左侧手柄调整顺序，编辑改名，删除会把该分类下提示词变为「未分类」。</div>' +
      state.categories.map((c) =>
        '<div class="mgr-item" data-cid="' + c.id + '" draggable="true">' +
          '<span class="mgr-handle" title="拖动排序">' + icon('grip') + '</span>' +
          '<div class="mgr-main"><div class="mgr-name">' + escapeHtml(c.name) + '</div>' +
            '<div class="mgr-sub">' + (counts[c.id] || 0) + ' 条提示词</div></div>' +
          '<div class="mgr-actions">' +
            '<button class="mini-btn catm-edit" data-cid="' + c.id + '">编辑</button>' +
            '<button class="mini-btn catm-del" data-cid="' + c.id + '">删除</button>' +
          '</div>' +
        '</div>'
      ).join('');
    bindCatmDrag(list);
    list.querySelectorAll('.catm-edit').forEach((b) => b.addEventListener('click', () => openCategoryModal(b.dataset.cid)));
    list.querySelectorAll('.catm-del').forEach((b) => b.addEventListener('click', async () => {
      const c = state.categories.find((x) => x.id === b.dataset.cid);
      const n = counts[b.dataset.cid] || 0;
      if (!confirm('确定删除分类「' + (c ? c.name : '') + '」？' + (n ? '其下 ' + n + ' 条提示词将变为未分类。' : ''))) return;
      await store.deleteCategory(b.dataset.cid);
      state.categories = await store.getCategories();
      state.prompts = await store.getPrompts();
      if (state.mCat === b.dataset.cid) state.mCat = 'all';
      if (state.activeFilter === b.dataset.cid) { state.activeFilter = 'all'; state.sceneTag = null; }
      fillCategorySelect();
      renderCategoryChips();
      renderManageFilters();
      renderSceneRow();
      refresh();
      refreshManage();
      renderCatmList();
      toast('分类已删除');
    }));
  }

  // 通用拖拽排序：在 container 内的 .mgr-item 之间拖动，松手后按新顺序回调 onReorder(orderedItems[])
  function bindDragReorder(container, onReorder) {
    let dragEl = null;
    container.querySelectorAll('.mgr-item').forEach((item) => {
      item.addEventListener('dragstart', (e) => {
        dragEl = item;
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', ''); } catch (err) {}
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        container.querySelectorAll('.mgr-item').forEach((it) => it.classList.remove('drag-over'));
        dragEl = null;
      });
      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (!dragEl || dragEl === item) return;
        e.dataTransfer.dropEffect = 'move';
        container.querySelectorAll('.mgr-item').forEach((it) => it.classList.remove('drag-over'));
        item.classList.add('drag-over');
      });
      item.addEventListener('dragleave', () => { item.classList.remove('drag-over'); });
      item.addEventListener('drop', (e) => {
        e.preventDefault();
        if (!dragEl || dragEl === item) return;
        // 判断插入到目标的前面还是后面
        const rect = item.getBoundingClientRect();
        const after = (e.clientY - rect.top) > rect.height / 2;
        if (after) item.parentNode.insertBefore(dragEl, item.nextSibling);
        else item.parentNode.insertBefore(dragEl, item);
        const ordered = Array.from(container.querySelectorAll('.mgr-item')).map((it) => it);
        onReorder(ordered);
      });
    });
  }

  function bindCatmDrag(container) {
    bindDragReorder(container, async (orderedItems) => {
      const orderedIds = orderedItems.map((it) => it.dataset.cid);
      await store.reorderCategories(orderedIds);
      state.categories = await store.getCategories(); // 已按新 sortOrder 排好
      renderCategoryChips();
      renderManageFilters();
      renderSceneRow();
      fillCategorySelect();
      toast('顺序已保存');
    });
  }

  function bindTagmDrag(container) {
    bindDragReorder(container, async (orderedItems) => {
      const orderedTags = orderedItems.map((it) => it.dataset.tag);
      await store.saveTagOrderForCategory(state.mCat, orderedTags);
      renderManageFilters();
      renderSceneRow();
      toast('顺序已保存');
    });
  }

  // ---------- 标签管理面板（作用于当前分类） ----------
  async function openTagmSheet() {
    // 标签是分类下的细分，必须先选定一个分类
    const isCategory = state.categories.some((c) => c.id === state.mCat);
    if (!isCategory) {
      toast('请先在上方选择一个分类，再管理其标签');
      return;
    }
    await renderTagmList();
    $('#tagm-sheet').hidden = false;
  }
  async function renderTagmList() {
    const cat = state.categories.find((c) => c.id === state.mCat);
    $('#tagm-title').textContent = '管理标签 · ' + (cat ? cat.name : '');
    // 用 store 的有序标签（合并手动排序 + 新出现的）
    const { tags, counts: tagCounts } = await store.getOrderedTagsForCategory(state.mCat);
    const list = $('#tagm-list');
    if (!tags.length) {
      list.innerHTML = '<div class="mgr-empty">该分类下暂无标签<br>标签在编辑提示词时填写，会自动汇总到这里。</div>';
      return;
    }
    list.innerHTML =
      '<div class="mgr-hint">共 ' + tags.length + ' 个标签（仅作用于当前分类）。拖动手柄调整顺序，重命名/删除会批量更新该分类下的提示词。</div>' +
      tags.map((t) =>
        '<div class="mgr-item" data-tag="' + escapeHtml(t) + '" draggable="true">' +
          '<span class="mgr-handle" title="拖动排序">' + icon('grip') + '</span>' +
          '<div class="mgr-main"><div class="mgr-name">' + escapeHtml(t) + '</div>' +
            '<div class="mgr-sub">' + tagCounts[t] + ' 条提示词</div></div>' +
          '<div class="mgr-actions">' +
            '<button class="mini-btn tagm-rename" data-tag="' + escapeHtml(t) + '">重命名</button>' +
            '<button class="mini-btn tagm-del" data-tag="' + escapeHtml(t) + '">删除</button>' +
          '</div>' +
        '</div>'
      ).join('');
    bindTagmDrag(list);
    list.querySelectorAll('.tagm-rename').forEach((b) => {
      b.addEventListener('click', async () => {
        const old = b.dataset.tag;
        const next = prompt('将标签「' + old + '」重命名为：', old);
        if (next == null) return;
        const newName = String(next).trim();
        if (!newName) { toast('标签名不能为空'); return; }
        if (newName === old) return;
        const n = await store.renameTagInCategory(state.mCat, old, newName);
        state.prompts = await store.getPrompts();
        if (state.sceneTag === old) state.sceneTag = newName;
        if (state.mTag === old) state.mTag = newName;
        renderManageFilters();
        renderSceneRow();
        refresh();
        refreshManage();
        await renderTagmList();
        toast('已重命名，影响 ' + n + ' 条');
      });
    });
    list.querySelectorAll('.tagm-del').forEach((b) => {
      b.addEventListener('click', async () => {
        const t = b.dataset.tag;
        const n = tagCounts[t];
        if (!confirm('确定删除标签「' + t + '」？将从该分类下 ' + n + ' 条提示词中移除（不删除提示词本身）。')) return;
        const cnt = await store.deleteTagInCategory(state.mCat, t);
        state.prompts = await store.getPrompts();
        if (state.sceneTag === t) state.sceneTag = null;
        if (state.mTag === t) state.mTag = null;
        renderManageFilters();
        renderSceneRow();
        refresh();
        refreshManage();
        await renderTagmList();
        toast('已删除，影响 ' + cnt + ' 条');
      });
    });
  }

  // 新建标签：标签存在于提示词上，所以把新标签挂到当前分类下第一条提示词
  async function addTagToFirstPrompt(tagName) {
    const target = state.prompts.find((p) => p.categoryId === state.mCat);
    if (!target) { toast('该分类下还没有提示词，请先创建一条'); return; }
    const tags = target.tags || [];
    if (tags.indexOf(tagName) >= 0) { toast('该标签已存在'); return; }
    tags.push(tagName);
    await store.savePrompt({ id: target.id, tags: tags });
    state.prompts = await store.getPrompts();
    renderManageFilters();
    renderSceneRow();
    refresh();
    refreshManage();
    await renderTagmList();
    toast('已新建标签「' + tagName + '」');
  }

  // ---------- 显示设置面板 ----------
  const SETTING_RANGE_MAX = 20;   // 滑块上限（输入框可超过，最高 50）
  function openSettingsSheet() {
    const cc = state.settings.displayCatCount || 0;
    const tc = state.settings.displayTagCount || 0;
    $('#set-cat-count').value = cc;
    $('#set-tag-count').value = tc;
    $('#set-cat-range').value = Math.min(cc, SETTING_RANGE_MAX);
    $('#set-tag-range').value = Math.min(tc, SETTING_RANGE_MAX);
    syncThemeSeg();
    $('#settings-sheet').hidden = false;
  }
  // 同步主题分段按钮的高亮态
  function syncThemeSeg() {
    const cur = state.settings.theme || 'auto';
    document.querySelectorAll('#set-theme .seg').forEach((s) => {
      s.classList.toggle('active', s.dataset.theme === cur);
    });
  }
  function closeSettingsSheet() { $('#settings-sheet').hidden = true; }
  function bindSettingPair(rangeId, numId) {
    const r = $(rangeId), n = $(numId);
    // 滑块 → 输入框
    r.addEventListener('input', () => { n.value = r.value; });
    // 输入框 → 滑块（超过上限则钳到上限位置）
    n.addEventListener('input', () => {
      let v = parseInt(n.value, 10);
      if (isNaN(v) || v < 0) v = 0;
      if (v > 50) v = 50;
      r.value = Math.min(v, SETTING_RANGE_MAX);
    });
    n.addEventListener('blur', () => {
      let v = parseInt(n.value, 10);
      if (isNaN(v) || v < 0) v = 0;
      if (v > 50) v = 50;
      n.value = v;
    });
  }
  async function saveDisplaySettings() {
    let cc = parseInt($('#set-cat-count').value, 10);
    let tc = parseInt($('#set-tag-count').value, 10);
    if (isNaN(cc) || cc < 0) cc = 0;
    if (isNaN(tc) || tc < 0) tc = 0;
    if (cc > 50) cc = 50;
    if (tc > 50) tc = 50;
    state.settings = await store.saveSettings({ displayCatCount: cc, displayTagCount: tc });
    state.catExpanded = false;
    state.tagExpanded = false;
    closeSettingsSheet();
    renderCategoryChips();
    renderSceneRow();
    refresh();
    toast('显示设置已保存');
  }

  // ---------- 导入导出 ----------
  async function doExport() {
    const data = await store.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'prompthub-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click(); URL.revokeObjectURL(url);
    toast('已导出备份');
  }
  function handleImportFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        state.pendingImport = data;
        $('#import-count').textContent = (data.prompts || []).length;
        $('#import-overlay').hidden = false;
      } catch (err) { toast('文件解析失败：' + err.message); }
    };
    reader.readAsText(file);
  }
  async function confirmImport() {
    if (!state.pendingImport) return;
    const mode = $('#import-mode').value;
    const result = await store.importAll(state.pendingImport, mode);
    $('#import-overlay').hidden = true;
    state.pendingImport = null;
    state.prompts = await store.getPrompts();
    state.categories = await store.getCategories();
    renderCategoryChips(); renderManageFilters();
    refresh(); refreshManage();
    // 提示：替换/新增/覆盖
    let msg;
    if (mode === 'replace') {
      msg = '已替换全部数据（' + result.added + ' 条）';
    } else {
      const parts = [];
      if (result.added) parts.push('新增 ' + result.added);
      if (result.updated) parts.push('覆盖 ' + result.updated);
      msg = parts.length ? '已' + parts.join('、') : '无变化（内容均相同）';
    }
    toast(msg);
  }

  // ---------- Toast ----------
  let toastTimer = null;
  function toast(msg) {
    elToast.textContent = msg; elToast.hidden = false;
    requestAnimationFrame(() => elToast.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { elToast.classList.remove('show'); setTimeout(() => { elToast.hidden = true; }, 220); }, 1600);
  }

  // ---------- 事件绑定 ----------
  // 视图切换
  $$('.tab').forEach((t) => t.addEventListener('click', () => switchView(t.dataset.view)));

  // 使用视图：搜索
  let searchDebounce = null;
  elSearch.addEventListener('input', () => {
    state.query = elSearch.value; state.selectedIndex = 0;
    clearTimeout(searchDebounce); searchDebounce = setTimeout(refresh, 80);
  });
  elClear.addEventListener('click', () => { elSearch.value = ''; state.query = ''; state.selectedIndex = 0; refresh(); elSearch.focus(); });
  elFilters.addEventListener('click', (e) => { const chip = e.target.closest('.chip'); if (chip) selectFilter(chip.dataset.filter); });
  // 使用视图：场景标签切换
  $('#scene-row').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    // 展开/收起按钮
    if (chip.classList.contains('expand-btn')) {
      state.tagExpanded = !state.tagExpanded;
      renderSceneRow();
      return;
    }
    state.sceneTag = state.sceneTag === chip.dataset.scene ? null : chip.dataset.scene;
    state.selectedIndex = 0;
    renderSceneRow();
    refresh();
  });

  // 管理视图
  let mDebounce = null;
  $('#m-search').addEventListener('input', (e) => { state.mQuery = e.target.value.trim(); clearTimeout(mDebounce); mDebounce = setTimeout(refreshManage, 100); });
  $('#btn-new').addEventListener('click', () => openEditor(null));

  // 编辑器
  $('#editor-back').addEventListener('click', closeEditor);
  $('#editor-save').addEventListener('click', savePromptFromForm);
  $('#editor-delete').addEventListener('click', deleteCurrent);
  $('#prompt-form').content.addEventListener('input', updateVarPreview);
  $('#add-category').addEventListener('click', () => openCategoryModal(null));

  // 模型下拉框：触发器开关 + 面板内勾选 + 折叠
  $('#mp-trigger').addEventListener('click', () => {
    const panel = $('#mp-panel');
    const open = panel.hidden;
    panel.hidden = !open;
    $('#mp-trigger').classList.toggle('open', open);
  });
  // 点击外部关闭下拉
  document.addEventListener('click', (e) => {
    const dd = $('#mp-dropdown');
    if (!dd.hidden !== undefined && !$('#mp-panel').hidden && !dd.contains(e.target)) {
      $('#mp-panel').hidden = true;
      $('#mp-trigger').classList.remove('open');
    }
  });
  // 面板内交互（事件委托）
  $('#mp-panel').addEventListener('click', (e) => {
    // 折叠/展开某公司
    const toggle = e.target.closest('.mp-company-toggle');
    if (toggle) {
      const models = toggle.parentElement.nextElementSibling;
      if (models) models.classList.toggle('open');
      return;
    }
  });
  $('#mp-panel').addEventListener('change', (e) => {
    const t = e.target;
    // 一级：公司全选
    if (t.classList.contains('mp-company-all')) {
      const co = t.dataset.company;
      PH.models.idsOfCompany(co).forEach((id) => {
        if (t.checked) state.editorModels[id] = true;
        else delete state.editorModels[id];
      });
      renderModelPanel();   // 重渲染更新二级勾选态
      return;
    }
    // 二级：单个模型
    if (t.classList.contains('mp-model-cb')) {
      if (t.checked) state.editorModels[t.dataset.id] = true;
      else delete state.editorModels[t.dataset.id];
      renderModelPanel();   // 重渲染更新一级全选态/计数
      return;
    }
  });

  // 分类弹层
  $('#cat-close').addEventListener('click', () => { $('#cat-overlay').hidden = true; });
  $('#cat-cancel').addEventListener('click', () => { $('#cat-overlay').hidden = true; });
  $('#cat-save').addEventListener('click', saveCategory);
  $('#cat-overlay').addEventListener('click', (e) => { if (e.target === $('#cat-overlay')) $('#cat-overlay').hidden = true; });

  // 分类管理面板
  $('#btn-manage-cat').addEventListener('click', openCatmSheet);
  $('#catm-back').addEventListener('click', () => { $('#catm-sheet').hidden = true; });
  $('#catm-add').addEventListener('click', () => openCategoryModal(null));

  // 标签管理面板
  $('#btn-manage-tag').addEventListener('click', openTagmSheet);
  $('#tagm-back').addEventListener('click', () => { $('#tagm-sheet').hidden = true; });
  $('#tagm-add').addEventListener('click', () => {
    // 新建标签：往当前分类下的某条提示词追加，或提示在编辑时添加
    const cat = state.categories.find((c) => c.id === state.mCat);
    const name = prompt('在分类「' + (cat ? cat.name : '') + '」下新建标签：标签需关联到提示词。\n\n请输入标签名，将添加到该分类下第一条提示词：');
    if (name == null) return;
    const t = String(name).trim();
    if (!t) { toast('标签名不能为空'); return; }
    addTagToFirstPrompt(t);
  });

  // 显示设置面板
  $('#settings-back').addEventListener('click', closeSettingsSheet);
  $('#settings-save').addEventListener('click', saveDisplaySettings);
  bindSettingPair('#set-cat-range', '#set-cat-count');
  bindSettingPair('#set-tag-range', '#set-tag-count');

  // 导入导出
  $('#btn-export').addEventListener('click', doExport);
  $('#btn-import').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', (e) => { if (e.target.files[0]) handleImportFile(e.target.files[0]); e.target.value = ''; });
  $('#import-cancel').addEventListener('click', () => { $('#import-overlay').hidden = true; state.pendingImport = null; });
  $('#import-close').addEventListener('click', () => { $('#import-overlay').hidden = true; state.pendingImport = null; });
  $('#import-confirm').addEventListener('click', confirmImport);

  // 变量弹层
  $('#modal-close').addEventListener('click', closeVariableModal);
  $('#modal-overlay').addEventListener('click', (e) => { if (e.target === $('#modal-overlay')) closeVariableModal(); });
  $('#modal-copy').addEventListener('click', () => confirmModal('copy'));
  $('#modal-insert').addEventListener('click', () => confirmModal('insert'));
  $('#modal-body').addEventListener('input', updatePreview);

  // 顶栏设置按钮（打开显示设置面板）
  $('#btn-settings').addEventListener('click', openSettingsSheet);

  // 设置面板：主题切换（分段按钮）
  $('#set-theme').addEventListener('click', async (e) => {
    const seg = e.target.closest('.seg');
    if (!seg) return;
    const theme = seg.dataset.theme;
    state.settings = await store.saveSettings({ theme: theme });
    applyTheme();
    syncThemeSeg();
  });

  // 全局键盘
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      (state.view === 'manage' ? $('#m-search') : elSearch).focus();
      (state.view === 'manage' ? $('#m-search') : elSearch).select();
      return;
    }
    if (e.key === 'Escape') {
      if (!$('#editor-sheet').hidden) { closeEditor(); return; }
      if (!$('#settings-sheet').hidden) { closeSettingsSheet(); return; }
      if (!$('#catm-sheet').hidden) { $('#catm-sheet').hidden = true; return; }
      if (!$('#tagm-sheet').hidden) { $('#tagm-sheet').hidden = true; return; }
      if (!$('#modal-overlay').hidden) { closeVariableModal(); return; }
      if (!$('#cat-overlay').hidden) { $('#cat-overlay').hidden = true; return; }
      if (!$('#import-overlay').hidden) { $('#import-overlay').hidden = true; return; }
    }
    // 使用视图列表导航
    if (state.view === 'use' && $('#editor-sheet').hidden) {
      const a = document.activeElement;
      if (a === elSearch || a === elResults || a === document.body) {
        if (e.key === 'ArrowDown') { e.preventDefault(); selectIndex(state.selectedIndex + 1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); selectIndex(state.selectedIndex - 1); }
        else if (e.key === 'Enter') { e.preventDefault(); const p = state.results[state.selectedIndex]; if (p) usePrompt(p, 'default'); }
      }
    }
    // 编辑器内 Cmd/Ctrl+Enter 保存
    if (!$('#editor-sheet').hidden && (e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault(); savePromptFromForm();
    }
  });

  init();
})();
