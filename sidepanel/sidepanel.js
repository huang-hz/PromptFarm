/* sidepanel.js — 单页架构：主列表 + 提示词详情页（预览/编辑双模式）
 * 逻辑层复用 PH.store / PH.search / PH.template / PH.models。
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
    // 列表筛选
    query: '',
    activeFilter: 'all',         // all | favorite | recent | <categoryId>
    sceneTag: null,              // null | 标签名
    selectedIndex: 0,
    catExpanded: false,
    tagExpanded: false,
    // 详情页
    editingId: null,             // 当前详情页的提示词 id（null=新建）
    currentPrompt: null,         // 当前详情页的源提示词对象（供副本等操作引用）
    detailMode: 'edit',          // edit | preview
    editorModels: {},            // { [modelId]: true }
    // 分类/标签管理
    editingCategoryId: null,
    pendingImport: null,
    // 批量删除：筛选项 + 卡片勾选（"__null__" 代表未分类）
    batchSelCats: {},
    batchSelTags: {},
    batchChecked: {},
    // 回收站
    trash: [],
    trashHoverTimer: null,
    // 供应商-模型管理
    catalog: [],
    activeModels: []            // 激活的模型 id 数组
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
    } catch (e) { console.warn('loadIcons failed:', e && e.message); }
  }

  // ---------- 初始化 ----------
  async function init() {
    await loadIcons();
    await store.ensureInit(PH.seed);
    state.settings = await store.getSettings();
    state.categories = await store.getCategories();
    state.prompts = await store.getPrompts();
    state.trash = await store.getTrash();
    await loadCatalogAndActive();   // 载入持久化目录与激活列表，覆盖 PH.models.CATALOG
    applyTheme();
    renderCategoryChips();
    renderSceneRow();
    refresh();
    updateTrashCount();
    elSearch.focus();

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      let needRefresh = false;
      if (changes[store.KEYS.prompts]) { state.prompts = changes[store.KEYS.prompts].newValue || []; needRefresh = true; }
      if (changes[store.KEYS.categories]) { state.categories = changes[store.KEYS.categories].newValue || []; renderCategoryChips(); renderSceneRow(); needRefresh = true; }
      if (changes[store.KEYS.trash]) {
        state.trash = changes[store.KEYS.trash].newValue || [];
        updateTrashCount();
        if (!$('#trash-sheet').hidden) renderTrashList();
      }
      if (changes[store.KEYS.catalog] || changes[store.KEYS.activeModels]) {
        loadCatalogAndActive().then(() => {
          if (!$('#mm-sheet').hidden) renderMM();
        });
      }
      if (changes[store.KEYS.settings]) {
        state.settings = Object.assign(state.settings, changes[store.KEYS.settings].newValue);
        applyTheme();
        renderCategoryChips();
        renderSceneRow();
      }
      if (needRefresh) { renderSceneRow(); refresh(); }
    });

    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'search-query' && msg.query) {
        elSearch.value = msg.query;
        state.query = msg.query;
        state.selectedIndex = 0;
        refresh();
        elSearch.focus();
      }
    });
  }

  // ---------- 主题 ----------
  function applyTheme() {
    const t = state.settings.theme || 'auto';
    document.body.classList.remove('theme-dark', 'theme-light');
    if (t === 'dark') document.body.classList.add('theme-dark');
    else if (t === 'light') document.body.classList.add('theme-light');
    const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.body.style.colorScheme = dark ? 'dark' : 'light';
  }

  // ========== 列表筛选区 ==========
  function renderCategoryChips() {
    elFilters.querySelectorAll('.cat-chip, .expand-btn, .manage-tiny-btn').forEach((c) => c.remove());
    const limit = state.settings.displayCatCount || 0;
    const needCollapse = limit > 0 && state.categories.length > limit;
    const showAll = !needCollapse || state.catExpanded;
    const cats = showAll ? state.categories.slice() : state.categories.slice(0, limit);
    // 收起态下，若当前选中的分类不在前 limit 个，则追加保留展示（与场景标签一致）
    if (!showAll && state.activeFilter) {
      const sel = state.categories.find((c) => c.id === state.activeFilter);
      if (sel && cats.indexOf(sel) < 0) cats.push(sel);
    }
    cats.forEach((c) => {
      const btn = document.createElement('button');
      btn.className = 'chip cat-chip' + (state.activeFilter === c.id ? ' active' : '');
      btn.dataset.filter = c.id;
      btn.dataset.category = '1';
      btn.textContent = c.name;
      btn.addEventListener('click', () => selectFilter(c.id));
      elFilters.appendChild(btn);
    });
    if (needCollapse) {
      const t = document.createElement('button');
      t.className = 'expand-btn';
      const expanded = state.catExpanded;
      t.title = expanded ? '收起' : ('展开（还有 ' + (state.categories.length - limit) + ' 个）');
      t.innerHTML = icon(expanded ? 'collapse' : 'expand');
      t.addEventListener('click', () => { state.catExpanded = !state.catExpanded; renderCategoryChips(); });
      elFilters.appendChild(t);
    }
    // 分类管理入口（放在筛选区末尾）
    const mgr = document.createElement('button');
    mgr.className = 'manage-tiny-btn icon-only';
    mgr.innerHTML = icon('gear');
    mgr.title = '管理分类（增删改）';
    mgr.addEventListener('click', openCatmSheet);
    elFilters.appendChild(mgr);
  }

  function selectFilter(filter) {
    state.activeFilter = filter;
    state.sceneTag = null;
    state.tagExpanded = false;
    elFilters.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c.dataset.filter === filter));
    renderSceneRow();
    state.selectedIndex = 0;
    refresh();
  }

  // 场景标签行（随分类联动）
  async function renderSceneRow() {
    const row = $('#scene-row');
    const isCategory = state.categories.some((c) => c.id === state.activeFilter);
    if (!isCategory) { row.hidden = true; row.innerHTML = ''; return; }
    const { tags, counts: tagCounts } = await store.getOrderedTagsForCategory(state.activeFilter);
    if (state.sceneTag && tags.indexOf(state.sceneTag) < 0) state.sceneTag = null;
    if (!tags.length) { row.hidden = true; row.innerHTML = ''; return; }
    const limit = state.settings.displayTagCount || 0;
    const needCollapse = limit > 0 && tags.length > limit;
    const showAll = !needCollapse || state.tagExpanded;
    let shown = showAll ? tags.slice() : tags.slice(0, limit);
    if (!showAll && state.sceneTag && shown.indexOf(state.sceneTag) < 0) shown.push(state.sceneTag);
    row.hidden = false;
    let html = shown.map((t) =>
      '<button class="chip tag-chip' + (state.sceneTag === t ? ' active' : '') + '" data-scene="' + escapeHtml(t) + '">' +
        escapeHtml(t) + '<span class="cnt">' + tagCounts[t] + '</span></button>'
    ).join('');
    if (needCollapse) {
      const expanded = state.tagExpanded;
      const tt = expanded ? '收起' : ('展开（还有 ' + (tags.length - limit) + ' 个）');
      html += '<button class="chip expand-btn" title="' + escapeHtml(tt) + '">' + icon(expanded ? 'collapse' : 'expand') + '</button>';
    }
    // 标签管理入口
    html += '<button class="manage-tiny-btn icon-only" id="btn-manage-tag-inline" title="管理标签（增删改）">' + icon('gear') + '</button>';
    row.innerHTML = html;
  }

  // ========== 列表渲染 ==========
  function getFilteredList() {
    const filters = {};
    if (state.activeFilter === 'favorite') filters.favorite = true;
    else if (state.activeFilter === 'recent') filters.recent = true;
    else if (state.activeFilter !== 'all') filters.categoryId = state.activeFilter;
    if (state.sceneTag) filters.tag = state.sceneTag;
    return search.search(state.prompts, state.query, {
      fuzzy: state.settings.searchFuzzy,
      pinyin: state.settings.searchPinyin,
      filters,
      limit: state.settings.sidebarCount || 50
    });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function icon(name, cls) {
    return '<svg class="ic' + (cls ? ' ' + cls : '') + '"><use href="#ic-' + name + '"/></svg>';
  }
  function modelBadges(models, max, expandable) {
    max = max || 2;
    if (!models || !models.length) return '';
    const M = PH.models;
    const compact = models.slice(0, max).map((id) => {
      const { model } = M.parseId(id);
      return '<span class="mbadge">' + escapeHtml(model) + '</span>';
    }).join('');
    const extra = models.length > max ? '<span class="mbadge mbadge-more">+' + (models.length - max) + '</span>' : '';
    if (!expandable) return '<span class="mbadges">' + compact + extra + '</span>';
    const allHtml = models.map((id) => {
      const { company, model } = M.parseId(id);
      return '<span class="mbadge" title="' + escapeHtml(company) + '">' + escapeHtml(model) + '</span>';
    }).join('');
    return '<span class="mbadges mbadges-compact">' + compact + extra + '</span>' +
      '<span class="mbadges mbadges-all">' + allHtml + '</span>';
  }
  // 自定义确认弹层（替换原生 confirm），返回 Promise<boolean>
  function showConfirm(message, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      const ov = $('#confirm-overlay');
      $('#confirm-title').textContent = opts.title || '确认';
      $('#confirm-msg').textContent = message;
      const okBtn = $('#confirm-ok');
      okBtn.className = 'btn ' + (opts.danger === false ? 'primary' : 'danger');
      okBtn.textContent = opts.okText || '确定';
      const cancel = $('#confirm-cancel');
      const done = (v) => { ov.hidden = true; okBtn.onclick = cancel.onclick = null; state._confirmResolve = null; resolve(v); };
      okBtn.onclick = () => done(true);
      cancel.onclick = () => done(false);
      state._confirmResolve = () => done(false);   // 供点遮罩/Esc 调用
      ov.hidden = false;
      setTimeout(() => okBtn.focus(), 30);
    });
  }
  // 自定义输入弹层（替换原生 prompt），返回 Promise<string|null>
  function showPrompt(message, defaultValue, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      const ov = $('#prompt-overlay');
      $('#prompt-title').textContent = opts.title || '输入';
      $('#prompt-msg').textContent = message;
      const inp = $('#prompt-input');
      inp.value = defaultValue || '';
      inp.placeholder = opts.placeholder || '';
      const ok = $('#prompt-ok');
      const cancel = $('#prompt-cancel');
      const close = $('#prompt-close');
      const done = (v) => { ov.hidden = true; ok.onclick = cancel.onclick = close.onclick = null; inp.onkeydown = null; state._promptResolve = null; resolve(v); };
      ok.onclick = () => done(inp.value);
      cancel.onclick = () => done(null);
      close.onclick = () => done(null);
      inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); done(inp.value); } };
      state._promptResolve = () => done(null);   // 供点遮罩/Esc 调用
      ov.hidden = false;
      setTimeout(() => { inp.focus(); inp.select(); }, 30);
    });
  }
  function highlight(text, q) {
    if (!q) return escapeHtml(text);
    const lower = String(text).toLowerCase();
    const idx = lower.indexOf(q.toLowerCase());
    if (idx < 0) return escapeHtml(text);
    return escapeHtml(text.slice(0, idx)) + '<mark>' + escapeHtml(text.slice(idx, idx + q.length)) + '</mark>' + escapeHtml(text.slice(idx + q.length));
  }

  function refresh() {
    const res = getFilteredList();
    state.results = res.map((r) => r.prompt);
    renderResults(res);
  }

  function renderResults(res) {
    elCount.textContent = res.length + ' 条';
    elClear.hidden = !state.query;
    if (!res.length) {
      const hasQuery = !!state.query;
      elResults.innerHTML = '<div class="empty"><div class="emoji">' + (hasQuery ? icon('search', 'ic-xl') : icon('inbox', 'ic-xl')) + '</div>' +
        '<div class="msg">' + (hasQuery ? '没有匹配的提示词' : '这里还没有提示词') + '</div>' +
        '<div class="sub">' + (hasQuery ? '试试换个关键词或检查筛选条件' : '点右上角 ＋ 创建第一个') + '</div></div>';
      return;
    }
    const catMap = {};
    state.categories.forEach((c) => { catMap[c.id] = c; });
    elResults.innerHTML = res.map((r, i) => {
      const p = r.prompt;
      const cat = catMap[p.categoryId];
      const tags = (p.tags || []).slice(0, 4).map((t) => '<span class="tag">' + escapeHtml(t) + '</span>').join('');
      const hasVar = template.hasVariables(p.content);
      // 简短描述为空时，回退展示提示词内容前两行（同样被 line-clamp 截断为 …）
      const descText = (p.description && p.description.trim()) ? p.description : (p.content || '');
      const descClass = (p.description && p.description.trim()) ? 'result-desc' : 'result-desc result-desc-fallback';
      return '<div class="result-item' + (i === state.selectedIndex ? ' selected' : '') + '" data-idx="' + i + '" data-id="' + p.id + '">' +
        '<div class="result-head">' +
          '<span class="result-title">' + highlight(p.title, state.query) + '</span>' +
          (p.favorite ? '<span class="result-star">' + icon('star-fill') + '</span>' : '') +
        '</div>' +
        (descText ? '<div class="' + descClass + '">' + escapeHtml(descText) + '</div>' : '') +
        (tags ? '<div class="result-tags">' + tags + '</div>' : '') +
        (p.models && p.models.length ? '<div class="result-models">' + modelBadges(p.models, 2, true) + '</div>' : '') +
        '<div class="result-meta">' + (hasVar ? '<span>{含变量}</span>' : '') + (p.usageCount ? '<span>用 ' + p.usageCount + ' 次</span>' : '') + '</div>' +
        '<div class="result-actions">' +
          '<button class="mini-btn act-copy">' + icon('copy') + ' 复制</button>' +
          '<button class="mini-btn act-insert">' + icon('insert') + ' 插入</button>' +
          '<button class="mini-btn act-dup" title="创建副本">' + icon('duplicate') + ' 副本</button>' +
          '<button class="mini-btn act-fav">' + (p.favorite ? '取消收藏' : icon('star') + ' 收藏') + '</button>' +
        '</div>' +
      '</div>';
    }).join('');

    elResults.querySelectorAll('.result-item').forEach((item) => {
      const idx = parseInt(item.dataset.idx, 10);
      item.addEventListener('mouseenter', () => { state.selectedIndex = idx; updateSelection(false); });
      // 点击卡片（非按钮区域）→ 进入详情页
      item.addEventListener('click', (e) => {
        if (e.target.closest('.mini-btn')) return;
        selectIndex(idx);
        openDetail(state.results[idx]);
      });
      item.querySelector('.act-copy').addEventListener('click', (e) => { e.stopPropagation(); usePrompt(state.results[idx], 'copy'); });
      item.querySelector('.act-insert').addEventListener('click', (e) => { e.stopPropagation(); usePrompt(state.results[idx], 'insert'); });
      item.querySelector('.act-dup').addEventListener('click', (e) => { e.stopPropagation(); duplicatePrompt(state.results[idx]); });
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

  // ========== 使用提示词 ==========
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
  // 创建副本：取源提示词内容字段，剥掉 id → store 走新建分支
  // 故意不复制 favorite/usageCount/lastUsed/createdAt：副本是全新记录
  async function duplicatePrompt(prompt) {
    if (!prompt) return;
    await store.savePrompt({
      title: (prompt.title || '未命名') + '（副本）',
      description: prompt.description || '',
      categoryId: prompt.categoryId || null,
      tags: (prompt.tags || []).slice(),
      models: (prompt.models || []).slice(),
      content: prompt.content || ''
    });
    state.prompts = await store.getPrompts();
    renderCategoryChips();
    renderSceneRow();
    refresh();
    toast('已创建副本');
  }

  // ========== 详情页（预览/编辑） ==========
  function openDetail(prompt) {
    state.editingId = prompt ? prompt.id : null;
    state.currentPrompt = prompt || null;   // 供「创建副本」按钮引用源提示词
    state.detailMode = 'edit';   // 默认编辑模式
    fillCategorySelect();
    const p = prompt;
    const form = $('#prompt-form');
    form.title.value = p ? p.title : '';
    form.description.value = p ? (p.description || '') : '';
    form.categoryId.value = p ? (p.categoryId || '') : '';
    form.tags.value = p ? (p.tags || []).join(', ') : '';
    form.content.value = p ? p.content : '';
    state.editorModels = {};
    (p && p.models ? p.models : []).forEach((id) => { state.editorModels[id] = true; });
    renderModelPanel();
    updateVarPreview();
    $('#detail-title').textContent = p ? p.title : '新建提示词';
    $('#detail-delete').hidden = !p;
    $('#detail-duplicate').hidden = !p;     // 仅编辑已有提示词时可创建副本
    renderDetailPreview(p);
    applyDetailMode();
    $('#detail-sheet').hidden = false;
    setTimeout(() => { if (state.detailMode === 'edit') form.title.focus(); }, 60);
  }
  function closeDetail() {
    $('#detail-sheet').hidden = true;
    state.editingId = null;
    state.currentPrompt = null;
  }
  function applyDetailMode() {
    const isEdit = state.detailMode === 'edit';
    $$('.mode-tab').forEach((t) => t.classList.toggle('active', t.dataset.mode === state.detailMode));
    $('#detail-preview').hidden = isEdit;
    $('#prompt-form').hidden = !isEdit;
  }
  function switchDetailMode(mode) {
    state.detailMode = mode;
    if (mode === 'preview') {
      // 切到预览时，用当前表单值（未保存的也能预览）
      const p = currentFormPrompt();
      renderDetailPreview(p);
    }
    applyDetailMode();
  }
  // 把当前表单内容组装成临时 prompt 对象（预览用）
  function currentFormPrompt() {
    const form = $('#prompt-form');
    return {
      title: form.title.value,
      description: form.description.value,
      categoryId: form.categoryId.value || null,
      tags: form.tags.value.split(/[,，、\s]+/).map((t) => t.trim()).filter(Boolean),
      models: collectEditorModels(),
      content: form.content.value
    };
  }
  function renderDetailPreview(p) {
    if (!p) { $('#detail-preview').innerHTML = ''; return; }
    const catMap = {};
    state.categories.forEach((c) => { catMap[c.id] = c; });
    const cat = catMap[p.categoryId];
    const tags = (p.tags || []).map((t) => '<span class="pv-tag">' + escapeHtml(t) + '</span>').join('');
    const hasVar = template.hasVariables(p.content);
    const box = $('#detail-preview');
    box.innerHTML =
      '<div class="pv-title">' + escapeHtml(p.title || '(未命名)') + '</div>' +
      (p.description ? '<div class="pv-desc">' + escapeHtml(p.description) + '</div>' : '') +
      '<div class="pv-meta">' +
        (cat ? '<span class="pv-cat">' + escapeHtml(cat.name) + '</span>' : '') +
        tags +
        (p.models && p.models.length ? '<span class="mbadges">' + modelBadges(p.models, 99) + '</span>' : '') +
      '</div>' +
      (hasVar ? '<div class="pv-section-label">变量</div><div class="var-preview">' +
        template.extractVariables(p.content).map((v) => '<span class="var-pill">' + escapeHtml(v.name) + (v.defaultValue ? '=' + escapeHtml(v.defaultValue) : '') + '</span>').join('') +
        '</div>' : '') +
      '<div class="pv-section-label">提示词内容</div>' +
      '<div class="pv-content">' + escapeHtml(p.content || '') + '</div>';
  }

  function fillCategorySelect() {
    $('#form-category').innerHTML = '<option value="">（未分类）</option>' +
      state.categories.map((c) => '<option value="' + c.id + '">' + escapeHtml(c.name) + '</option>').join('');
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
    closeDetail();
    renderCategoryChips();
    renderSceneRow();
    refresh();
    toast(state.editingId ? '已更新' : '已创建');
  }
  async function deleteCurrent() {
    if (!state.editingId) return;
    if (!await showConfirm('确定删除该提示词？\n将移到回收站，可在回收站还原。')) return;
    await store.deletePrompt(state.editingId);
    state.prompts = await store.getPrompts();
    state.trash = await store.getTrash();
    closeDetail();
    renderCategoryChips();
    renderSceneRow();
    refresh();
    updateTrashCount();
    toast('已移到回收站');
  }

  // ---------- 模型多选下拉框 ----------
  function renderModelPanel() {
    const M = PH.models;
    const panel = $('#mp-panel');
    let html = '';
    const companies = M.CATALOG.slice().sort((a, b) => a.company.localeCompare(b.company, 'en'));
    companies.forEach((co) => {
      // 仅渲染「激活」或「已选」的模型（未激活且未选的不出现在下拉框）
      const activeOrSelected = co.models.filter((m) => {
        const id = M.makeId(co.company, m);
        return isActiveModel(id) || state.editorModels[id];
      });
      if (!activeOrSelected.length) return;   // 该供应商无可显示模型 → 跳过
      const allIds = activeOrSelected.map((m) => M.makeId(co.company, m));
      const checkedCount = allIds.filter((id) => state.editorModels[id]).length;
      const allChecked = checkedCount === allIds.length;
      const partial = checkedCount > 0 && !allChecked;
      html += '<div class="mp-company">';
      html += '<div class="mp-company-head">';
      html += '<input type="checkbox" class="mp-company-all" data-company="' + escapeHtml(co.company) + '"' +
        (allChecked ? ' checked' : '') + (partial ? ' data-partial="1"' : '') + ' />';
      html += '<span class="mp-company-toggle" data-company="' + escapeHtml(co.company) + '">' +
        icon('expand') + escapeHtml(co.company) +
        (partial ? ' <em class="mp-partial">' + checkedCount + '/' + allIds.length + '</em>' :
         (checkedCount > 0 ? ' <em class="mp-partial">✓</em>' : '')) + '</span>';
      html += '</div>';
      const expanded = checkedCount > 0;
      html += '<div class="mp-models' + (expanded ? ' open' : '') + '">';
      activeOrSelected.forEach((m) => {
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
  function updateModelTrigger() {
    const ids = collectEditorModels();
    const label = $('#mp-trigger-label');
    if (!ids.length) { label.textContent = '未选择（可选）'; return; }
    const M = PH.models;
    const names = ids.map((id) => M.parseId(id).model);
    if (ids.length <= 2) label.textContent = names.join('、');
    else label.textContent = names.slice(0, 2).join('、') + ' +' + (ids.length - 2);
  }
  function collectEditorModels() {
    return Object.keys(state.editorModels).filter((k) => state.editorModels[k]);
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
    await store.saveCategory({ id: state.editingCategoryId || undefined, name: name });
    state.categories = await store.getCategories();
    $('#cat-overlay').hidden = true;
    fillCategorySelect();
    renderCategoryChips();
    renderSceneRow();
    if (!$('#catm-sheet').hidden) renderCatmList();
    toast(state.editingCategoryId ? '分类已更新' : '分类已创建');
  }

  // ---------- 分类管理面板 ----------
  function openCatmSheet() { renderCatmList(); $('#catm-sheet').hidden = false; }
  function renderCatmList() {
    const counts = {};
    state.prompts.forEach((p) => { if (p.categoryId) counts[p.categoryId] = (counts[p.categoryId] || 0) + 1; });
    const list = $('#catm-list');
    if (!state.categories.length) { list.innerHTML = '<div class="mgr-empty">还没有分类，点右上「新建」</div>'; return; }
    list.innerHTML = '<div class="mgr-hint">共 ' + state.categories.length + ' 个分类。拖动手柄调整顺序，编辑改名，删除会把该分类下提示词变为「未分类」。</div>' +
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
      const msg = '确定删除分类「' + (c ? c.name : '') + '」？' + (n ? '\n其下 ' + n + ' 条提示词将变为未分类。' : '');
      if (!await showConfirm(msg)) return;
      await store.deleteCategory(b.dataset.cid);
      state.categories = await store.getCategories();
      state.prompts = await store.getPrompts();
      if (state.activeFilter === b.dataset.cid) { state.activeFilter = 'all'; state.sceneTag = null; }
      fillCategorySelect();
      renderCategoryChips();
      renderSceneRow();
      refresh();
      renderCatmList();
      toast('分类已删除');
    }));
  }

  // ---------- 标签管理面板 ----------
  async function openTagmSheet() {
    const isCategory = state.categories.some((c) => c.id === state.activeFilter);
    if (!isCategory) { toast('请先在上方选择一个分类，再管理其标签'); return; }
    await renderTagmList();
    $('#tagm-sheet').hidden = false;
  }
  async function renderTagmList() {
    const cat = state.categories.find((c) => c.id === state.activeFilter);
    $('#tagm-title').textContent = '管理标签 · ' + (cat ? cat.name : '');
    const { tags, counts: tagCounts } = await store.getOrderedTagsForCategory(state.activeFilter);
    const list = $('#tagm-list');
    if (!tags.length) { list.innerHTML = '<div class="mgr-empty">该分类下暂无标签<br>标签在编辑提示词时填写，会自动汇总到这里。</div>'; return; }
    list.innerHTML = '<div class="mgr-hint">共 ' + tags.length + ' 个标签（仅作用于当前分类）。拖动手柄调整顺序，重命名/删除会批量更新该分类下的提示词。</div>' +
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
        const next = await showPrompt('将标签「' + old + '」重命名为：', old);
        if (next == null) return;
        const newName = String(next).trim();
        if (!newName) { toast('标签名不能为空'); return; }
        if (newName === old) return;
        const n = await store.renameTagInCategory(state.activeFilter, old, newName);
        state.prompts = await store.getPrompts();
        if (state.sceneTag === old) state.sceneTag = newName;
        renderSceneRow();
        refresh();
        await renderTagmList();
        toast('已重命名，影响 ' + n + ' 条');
      });
    });
    list.querySelectorAll('.tagm-del').forEach((b) => {
      b.addEventListener('click', async () => {
        const t = b.dataset.tag;
        const n = tagCounts[t];
        if (!await showConfirm('确定删除标签「' + t + '」？\n将从该分类下 ' + n + ' 条提示词中移除（不删除提示词本身）。')) return;
        const cnt = await store.deleteTagInCategory(state.activeFilter, t);
        state.prompts = await store.getPrompts();
        if (state.sceneTag === t) state.sceneTag = null;
        renderSceneRow();
        refresh();
        await renderTagmList();
        toast('已删除，影响 ' + cnt + ' 条');
      });
    });
  }
  async function addTagToFirstPrompt(tagName) {
    const target = state.prompts.find((p) => p.categoryId === state.activeFilter);
    if (!target) { toast('该分类下还没有提示词，请先创建一条'); return; }
    const tags = target.tags || [];
    if (tags.indexOf(tagName) >= 0) { toast('该标签已存在'); return; }
    tags.push(tagName);
    await store.savePrompt({ id: target.id, tags: tags });
    state.prompts = await store.getPrompts();
    renderSceneRow();
    refresh();
    await renderTagmList();
    toast('已新建标签「' + tagName + '」');
  }

  // ---------- 通用拖拽排序 ----------
  function bindDragReorder(container, onReorder) {
    let dragEl = null;
    container.querySelectorAll('.mgr-item').forEach((item) => {
      item.addEventListener('dragstart', (e) => {
        dragEl = item; item.classList.add('dragging');
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
        const rect = item.getBoundingClientRect();
        const after = (e.clientY - rect.top) > rect.height / 2;
        if (after) item.parentNode.insertBefore(dragEl, item.nextSibling);
        else item.parentNode.insertBefore(dragEl, item);
        onReorder(Array.from(container.querySelectorAll('.mgr-item')));
      });
    });
  }
  function bindCatmDrag(container) {
    bindDragReorder(container, async (orderedItems) => {
      await store.reorderCategories(orderedItems.map((it) => it.dataset.cid));
      state.categories = await store.getCategories();
      renderCategoryChips();
      renderSceneRow();
      fillCategorySelect();
      toast('顺序已保存');
    });
  }
  function bindTagmDrag(container) {
    bindDragReorder(container, async (orderedItems) => {
      await store.saveTagOrderForCategory(state.activeFilter, orderedItems.map((it) => it.dataset.tag));
      renderSceneRow();
      toast('顺序已保存');
    });
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

  // ---------- 显示设置 ----------
  const SETTING_RANGE_MAX = 20;
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
  function syncThemeSeg() {
    const cur = state.settings.theme || 'auto';
    document.querySelectorAll('#set-theme .seg').forEach((s) => s.classList.toggle('active', s.dataset.theme === cur));
  }
  function closeSettingsSheet() { $('#settings-sheet').hidden = true; }
  function bindSettingPair(rangeId, numId) {
    const r = $(rangeId), n = $(numId);
    r.addEventListener('input', () => { n.value = r.value; });
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

  // ---------- 批量删除（两级下拉筛选：分类→标签，勾选要删的提示词） ----------
  function openBatchSheet() {
    state.batchSelCats = {};
    state.batchSelTags = {};
    state.batchChecked = {};
    renderBatchFilterDropdown();
    applyBatchFilter();          // 算出匹配集 → 默认全选 → 渲染列表+计数
    $('#batch-sheet').hidden = false;
  }
  function closeBatchSheet() {
    closeBatchFilterDropdown();
    $('#batch-sheet').hidden = true;
  }
  // 渲染两级下拉面板：一级分类（含未分类），二级为该分类下标签
  function renderBatchFilterDropdown() {
    const panel = $('#bd-filter-panel');
    // 按 prompt.categoryId 分桶；__null__ = 未分类
    const byCat = { '__null__': [] };
    state.categories.forEach((c) => { byCat[c.id] = []; });
    state.prompts.forEach((p) => {
      const k = p.categoryId ? p.categoryId : '__null__';
      if (!byCat[k]) byCat[k] = [];
      byCat[k].push(p);
    });
    // 构造分组列表：先真实分类，再未分类
    const groups = state.categories.map((c) => ({ catId: c.id, name: c.name, prompts: byCat[c.id] || [] }));
    if ((byCat['__null__'] || []).length) groups.push({ catId: '__null__', name: '未分类', prompts: byCat['__null__'] });
    if (!state.prompts.length) { panel.innerHTML = '<div class="mp-empty">暂无提示词</div>'; updateBatchFilterLabel(); return; }
    let html = '';
    groups.forEach((g) => {
      const catSel = !!state.batchSelCats[g.catId];
      const total = g.prompts.length;
      // 该分类下的标签计数（按使用次数倒序）
      const tagCounts = {};
      g.prompts.forEach((p) => (p.tags || []).forEach((t) => { tagCounts[t] = (tagCounts[t] || 0) + 1; }));
      const tags = Object.keys(tagCounts).sort((a, b) => tagCounts[b] - tagCounts[a]);
      // 该分类下被选中的标签数（决定标签部分态）
      const tagSelCount = tags.filter((t) => state.batchSelTags[g.catId + '\u0000' + t]).length;
      const partial = tagSelCount > 0 && tagSelCount < tags.length;
      const expanded = catSel || tagSelCount > 0;    // 有选中则默认展开
      html += '<div class="mp-company">';
      html += '<div class="mp-company-head">';
      html += '<input type="checkbox" class="mp-company-all bd-cat-cb" data-cat="' + escapeHtml(g.catId) + '"' + (catSel ? ' checked' : '') + ' />';
      html += '<span class="mp-company-toggle" data-cat="' + escapeHtml(g.catId) + '">' +
        icon('expand') + escapeHtml(g.name) +
        (partial ? ' <em class="mp-partial">' + tagSelCount + '/' + tags.length + '</em>' :
         (catSel ? ' <em class="mp-partial">✓</em>' :
          (tagSelCount > 0 ? ' <em class="mp-partial">' + tagSelCount + '/' + tags.length + '</em>' : ''))) +
        ' <em class="mp-cnt">' + total + '</em></span>';
      html += '</div>';
      html += '<div class="mp-models' + (expanded ? ' open' : '') + '">';
      tags.forEach((t) => {
        const tSel = !!state.batchSelTags[g.catId + '\u0000' + t];
        html += '<label class="mp-model' + (tSel ? ' on' : '') + '">';
        html += '<input type="checkbox" class="mp-model-cb bd-tag-cb" data-cat="' + escapeHtml(g.catId) + '" data-tag="' + escapeHtml(t) + '"' + (tSel ? ' checked' : '') + '>';
        html += '<span>' + escapeHtml(t) + '</span><em class="mp-cnt">' + tagCounts[t] + '</em></label>';
      });
      if (!tags.length) html += '<div class="mp-models-empty">无标签</div>';
      html += '</div></div>';
    });
    panel.innerHTML = html;
    updateBatchFilterLabel();
  }
  // 触发器文案：统计选中的分类数 + 标签数
  function updateBatchFilterLabel() {
    const cats = Object.keys(state.batchSelCats).filter((k) => state.batchSelCats[k]).length;
    const tags = Object.keys(state.batchSelTags).filter((k) => state.batchSelTags[k]).length;
    const label = $('#bd-filter-label');
    if (!cats && !tags) { label.textContent = '全部提示词'; return; }
    const parts = [];
    if (cats) parts.push(cats + ' 个分类');
    if (tags) parts.push(tags + ' 个标签');
    label.textContent = parts.join(' · ');
  }
  // 开关下拉面板
  function toggleBatchFilterDropdown(open) {
    const panel = $('#bd-filter-panel');
    const willOpen = open == null ? panel.hidden : open;
    panel.hidden = !willOpen;
    $('#bd-filter-trigger').classList.toggle('open', willOpen);
  }
  function closeBatchFilterDropdown() {
    $('#bd-filter-panel').hidden = true;
    $('#bd-filter-trigger').classList.remove('open');
  }
  // 筛选语义（OR 叠加）：命中 = 该分类被选中，或（该提示词所在分类下其某个标签被选中）
  function getBatchFiltered() {
    const selCats = state.batchSelCats;
    const selTags = state.batchSelTags;
    const anySel = Object.keys(selCats).some((k) => selCats[k]) || Object.keys(selTags).some((k) => selTags[k]);
    if (!anySel) return state.prompts.slice();   // 都没选 = 全部
    return state.prompts.filter((p) => {
      const ck = p.categoryId ? p.categoryId : '__null__';
      if (selCats[ck]) return true;                       // 一级分类被选中 → 命中
      return (p.tags || []).some((t) => selTags[ck + '\u0000' + t]);  // 该分类下某标签被选中
    });
  }

  // 筛选条件变化后：匹配集 → 默认全选 → 渲染列表+计数
  function applyBatchFilter() {
    const list = getBatchFiltered();
    state.batchChecked = {};
    list.forEach((p) => { state.batchChecked[p.id] = true; });
    renderBatchList(list);
    updateBatchCount(list);
  }
  // 渲染匹配的提示词卡片（带右上角勾选框）
  function renderBatchList(list) {
    const box = $('#bd-list');
    const catMap = {};
    state.categories.forEach((c) => { catMap[c.id] = c; });
    if (!list.length) {
      box.innerHTML = '<div class="mgr-empty">' + icon('inbox', 'ic-xl') + '<div>没有匹配的提示词</div></div>';
      return;
    }
    box.innerHTML = list.map((p) => {
      const checked = state.batchChecked[p.id];
      const cat = catMap[p.categoryId];
      const tags = (p.tags || []).slice(0, 4).map((t) => '<span class="tag">' + escapeHtml(t) + '</span>').join('');
      const descText = (p.description && p.description.trim()) ? p.description : (p.content || '');
      const descClass = (p.description && p.description.trim()) ? 'result-desc' : 'result-desc result-desc-fallback';
      return '<div class="bd-item' + (checked ? ' checked' : '') + '" data-id="' + escapeHtml(p.id) + '">' +
        '<input type="checkbox" class="bd-cb"' + (checked ? ' checked' : '') + '>' +
        '<div class="result-head"><span class="result-title">' + escapeHtml(p.title) + '</span>' +
          (p.favorite ? '<span class="result-star">' + icon('star-fill') + '</span>' : '') + '</div>' +
        (descText ? '<div class="' + descClass + '">' + escapeHtml(descText) + '</div>' : '') +
        (tags ? '<div class="result-tags">' + tags + '</div>' : '') +
        (p.models && p.models.length ? '<div class="result-models">' + modelBadges(p.models, 2, true) + '</div>' : '') +
        '<div class="result-meta">' + (cat ? '<span>' + escapeHtml(cat.name) + '</span>' : '<span>未分类</span>') + '</div>' +
      '</div>';
    }).join('');
    // 卡片勾选框：更新 state + 计数（不重渲染整列，避免抖动）
    box.querySelectorAll('.bd-cb').forEach((cb) => {
      cb.addEventListener('change', () => {
        const item = cb.closest('.bd-item');
        const id = item.dataset.id;
        state.batchChecked[id] = cb.checked;
        item.classList.toggle('checked', cb.checked);
        updateBatchCount(getBatchFiltered());
      });
      // 点击卡片体也切换勾选
      cb.closest('.bd-item').addEventListener('click', (e) => {
        if (e.target === cb) return;
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event('change'));
      });
    });
  }
  function updateBatchCount(list) {
    const total = list.length;
    const checked = Object.keys(state.batchChecked).filter((id) => state.batchChecked[id] && list.some((p) => p.id === id)).length;
    $('#bd-count').textContent = '匹配 ' + total + ' 条，勾选 ' + checked + ' 条';
    $('#bd-delete').textContent = '删除勾选 (' + checked + ')';
    $('#bd-delete').disabled = checked === 0;
  }
  // 全选/全不选当前匹配集
  function batchSelectAll(on) {
    const list = getBatchFiltered();
    list.forEach((p) => { state.batchChecked[p.id] = on; });
    $('#bd-list').querySelectorAll('.bd-item').forEach((item) => {
      item.classList.toggle('checked', on);
      const cb = item.querySelector('.bd-cb');
      if (cb) cb.checked = on;
    });
    updateBatchCount(list);
  }
  // 删除勾选中的提示词
  async function doBatchDelete() {
    const list = getBatchFiltered();
    const ids = list.filter((p) => state.batchChecked[p.id]).map((p) => p.id);
    if (!ids.length) { toast('没有勾选任何提示词'); return; }
    if (!await showConfirm('确定删除勾选的 ' + ids.length + ' 条提示词？\n将移到回收站，可在回收站还原。')) return;
    await store.deletePrompts(ids);
    state.prompts = await store.getPrompts();
    state.trash = await store.getTrash();
    refresh();
    renderCategoryChips();
    renderSceneRow();
    closeBatchSheet();
    updateTrashCount();
    toast('已移到回收站 ' + ids.length + ' 条');
  }

  // ---------- 回收站（软删除提示词：还原 / 永久删除 / 悬浮预览） ----------
  async function openTrashSheet() {
    state.trash = await store.getTrash();
    renderTrashList();
    $('#trash-sheet').hidden = false;
  }
  function closeTrashSheet() {
    hideTrashPreview();
    $('#trash-sheet').hidden = true;
  }
  // 渲染回收站列表（最新删除在前）
  function renderTrashList() {
    const list = (state.trash || []).slice().sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
    $('#trash-title').textContent = '回收站' + (list.length ? ' · ' + list.length : '');
    $('#trash-empty').style.display = list.length ? '' : 'none';
    const box = $('#trash-list');
    if (!list.length) {
      box.innerHTML = '<div class="mgr-empty">' + icon('trash', 'ic-xl') + '<div>回收站为空</div><div class="mgr-empty-sub">删除的提示词会暂存在这里</div></div>';
      return;
    }
    const catMap = {};
    state.categories.forEach((c) => { catMap[c.id] = c; });
    box.innerHTML = '<div class="mgr-hint">悬浮查看内容；还原可恢复，永久删除不可撤销。</div>' +
      list.map((p) => {
        const cat = catMap[p.categoryId];
        const tags = (p.tags || []).slice(0, 3).map((t) => '<span class="tag">' + escapeHtml(t) + '</span>').join('');
        const t = p.deletedAt ? new Date(p.deletedAt) : null;
        const when = t ? (t.getMonth() + 1) + '/' + t.getDate() + ' ' + String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0') : '';
        return '<div class="mgr-item trash-item" data-id="' + escapeHtml(p.id) + '">' +
          '<div class="mgr-main"><div class="mgr-name">' + escapeHtml(p.title || '（无标题）') + '</div>' +
            '<div class="mgr-sub">' + (cat ? escapeHtml(cat.name) : '未分类') + (tags ? ' · ' + tags : '') + (when ? ' · 删于 ' + when : '') + '</div></div>' +
          '<div class="mgr-actions">' +
            '<button class="mini-btn trash-restore" data-id="' + escapeHtml(p.id) + '">' + icon('restore') + ' 还原</button>' +
            '<button class="mini-btn trash-purge" data-id="' + escapeHtml(p.id) + '">永久删除</button>' +
          '</div>' +
        '</div>';
      }).join('');
    // 悬浮预览 + 行内操作
    box.querySelectorAll('.trash-item').forEach((row) => {
      row.addEventListener('mouseenter', () => scheduleTrashPreview(row.dataset.id, row));
      row.addEventListener('mouseleave', hideTrashPreview);
    });
    box.querySelectorAll('.trash-restore').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); restoreFromTrash(b.dataset.id); }));
    box.querySelectorAll('.trash-purge').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); purgeFromTrash(b.dataset.id); }));
  }
  // 悬浮气泡：延迟显示，避免快速划过闪烁
  function scheduleTrashPreview(id, row) {
    clearTimeout(state.trashHoverTimer);
    state.trashHoverTimer = setTimeout(() => {
      const p = (state.trash || []).find((x) => x.id === id);
      if (!p) return;
      const pv = $('#trash-preview');
      pv.innerHTML = '<div class="trash-pv-title">' + escapeHtml(p.title || '（无标题）') + '</div>' +
        '<div class="trash-pv-content">' + escapeHtml(p.content || '（无内容）') + '</div>';
      positionTrashPreview(pv, row);
      pv.hidden = false;
    }, 350);
  }
  function hideTrashPreview() {
    clearTimeout(state.trashHoverTimer);
    $('#trash-preview').hidden = true;
  }
  // 锚定到条目右侧；右侧空间不足时改为下方
  function positionTrashPreview(pv, row) {
    const r = row.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    pv.style.maxHeight = Math.min(320, vh - 24) + 'px';
    pv.style.left = '0px'; pv.style.top = '0px';   // 先显示以测宽高
    pv.style.visibility = 'hidden'; pv.hidden = false;
    const pw = pv.offsetWidth, ph = pv.offsetHeight;
    pv.style.visibility = '';
    let left = r.right + 10;
    if (left + pw > vw - 8) left = r.left - pw - 10;   // 右侧放不下→尝试左侧
    if (left < 8) { left = Math.max(8, Math.min(r.left, vw - pw - 8)); pv.style.top = (r.bottom + 8) + 'px'; }  // 左侧也放不下→下方
    else { pv.style.top = Math.max(8, Math.min(r.top, vh - ph - 8)) + 'px'; }
    pv.style.left = left + 'px';
  }
  async function restoreFromTrash(id) {
    await store.restorePrompt(id);
    state.trash = await store.getTrash();
    state.prompts = await store.getPrompts();
    renderTrashList();
    refresh();
    renderCategoryChips();
    renderSceneRow();
    updateTrashCount();
    toast('已还原');
  }
  async function purgeFromTrash(id) {
    const p = (state.trash || []).find((x) => x.id === id);
    if (!await showConfirm('永久删除「' + (p ? p.title : '该提示词') + '」？此操作不可撤销。')) return;
    await store.purgePrompt(id);
    state.trash = await store.getTrash();
    renderTrashList();
    updateTrashCount();
    toast('已永久删除');
  }
  async function emptyAllTrash() {
    if (!state.trash || !state.trash.length) { toast('回收站已经是空的'); return; }
    if (!await showConfirm('确定清空回收站的 ' + state.trash.length + ' 条提示词？此操作不可撤销。')) return;
    await store.emptyTrash();
    state.trash = [];
    renderTrashList();
    updateTrashCount();
    toast('回收站已清空');
  }
  // 更新状态栏回收站计数徽章
  function updateTrashCount() {
    const n = (state.trash || []).length;
    const el = $('#trash-count');
    if (!el) return;
    el.textContent = n;
    el.hidden = n === 0;
  }

  // ---------- 供应商-模型管理 ----------
  // 载入持久化目录与激活列表；首次为空则用内置全集初始化，并默认全激活
  async function loadCatalogAndActive() {
    let cat = await store.getCatalog();
    let act = await store.getActiveModels();
    if (!cat || !cat.length) {
      cat = PH.models.DEFAULT_CATALOG.map((c) => Object.assign({}, c, { models: c.models.slice() }));
      await store.saveCatalog(cat);
    }
    const allIds = [];
    cat.forEach((c) => c.models.forEach((m) => allIds.push(PH.models.makeId(c.company, m))));
    if (!act || !act.length) {
      act = allIds.slice();
      await store.setActiveModels(act);
    }
    state.catalog = cat;
    state.activeModels = act;
    PH.models.setCatalog(cat);     // 覆盖运行时 CATALOG，使现有消费者读到编辑后的目录
  }
  function isActiveModel(id) { return state.activeModels.indexOf(id) >= 0; }

  function openMMSheet() {
    renderMM();
    $('#mm-sheet').hidden = false;
  }
  function closeMMSheet() {
    $('#mm-sheet').hidden = true;
  }
  function renderMM() {
    const box = $('#mm-cat-list');
    const M = PH.models;
    const cat = state.catalog;
    if (!cat.length) { box.innerHTML = '<div class="mgr-empty">目录为空，点右上「+」添加供应商/模型</div>'; return; }
    box.innerHTML = cat.map((c) => {
      const allIds = c.models.map((m) => M.makeId(c.company, m));
      const checkedCount = allIds.filter((id) => isActiveModel(id)).length;
      const allChecked = checkedCount === allIds.length;
      const partial = checkedCount > 0 && !allChecked;
      const modelsHtml = c.models.map((m) => {
        const id = M.makeId(c.company, m);
        const on = isActiveModel(id);
        return '<label class="mm-model' + (on ? ' active' : '') + '">' +
          '<input type="checkbox" class="mm-cb" data-id="' + escapeHtml(id) + '"' + (on ? ' checked' : '') + '>' +
          '<span class="mm-name">' + escapeHtml(m) + '</span>' +
          '<span class="mm-actions">' +
            '<button class="icon-mini mm-rename-model" data-id="' + escapeHtml(id) + '" title="重命名模型">' + icon('edit') + '</button>' +
            '<button class="icon-mini mm-del-model" data-id="' + escapeHtml(id) + '" title="删除模型">' + icon('trash') + '</button>' +
          '</span>' +
        '</label>';
      }).join('');
      return '<div class="mm-company">' +
        '<div class="mm-company-head">' +
          '<input type="checkbox" class="mm-company-all" data-company="' + escapeHtml(c.company) + '"' + (allChecked ? ' checked' : '') + (partial ? ' data-partial="1"' : '') + '>' +
          '<span class="mm-company-toggle">' + icon('expand') + escapeHtml(c.company) + (partial ? ' <em class="mp-partial">' + checkedCount + '/' + allIds.length + '</em>' : '') + '<em class="mm-count">' + c.models.length + '</em></span>' +
          '<button class="icon-mini mm-rename-company" data-company="' + escapeHtml(c.company) + '" title="重命名供应商">' + icon('edit') + '</button>' +
          '<button class="icon-mini mm-del-company" data-company="' + escapeHtml(c.company) + '" title="删除整个供应商">' + icon('trash') + '</button>' +
        '</div>' +
        '<div class="mm-models open">' + modelsHtml + '</div>' +
      '</div>';
    }).join('');
    bindMMEvents();
  }
  function bindMMEvents() {
    const box = $('#mm-cat-list');
    // 折叠/展开公司
    box.querySelectorAll('.mm-company-toggle').forEach((t) => {
      t.addEventListener('click', () => { const m = t.parentElement.nextElementSibling; if (m) m.classList.toggle('open'); });
    });
    // 公司全选：勾选该公司全部模型
    box.querySelectorAll('.mm-company-all').forEach((cb) => {
      cb.addEventListener('change', () => {
        const co = cb.dataset.company;
        const entry = state.catalog.find((c) => c.company === co);
        if (entry) entry.models.forEach((m) => {
          const id = PH.models.makeId(co, m);
          const i = state.activeModels.indexOf(id);
          if (cb.checked) { if (i < 0) state.activeModels.push(id); }
          else if (i >= 0) state.activeModels.splice(i, 1);
        });
        store.setActiveModels(state.activeModels).then(renderMM);
      });
    });
    // 单个模型勾选
    box.querySelectorAll('.mm-cb').forEach((cb) => {
      cb.addEventListener('change', () => {
        const id = cb.dataset.id;
        const i = state.activeModels.indexOf(id);
        if (cb.checked) { if (i < 0) state.activeModels.push(id); }
        else if (i >= 0) state.activeModels.splice(i, 1);
        store.setActiveModels(state.activeModels).then(renderMM);
      });
    });
    box.querySelectorAll('.mm-rename-model').forEach((b) => b.addEventListener('click', () => renameModel(b.dataset.id)));
    box.querySelectorAll('.mm-del-model').forEach((b) => b.addEventListener('click', () => deleteModelFromCatalog(b.dataset.id)));
    box.querySelectorAll('.mm-rename-company').forEach((b) => b.addEventListener('click', () => renameCompany(b.dataset.company)));
    box.querySelectorAll('.mm-del-company').forEach((b) => b.addEventListener('click', () => deleteCompany(b.dataset.company)));
  }
  // 写回目录与激活列表，并覆盖运行时 CATALOG
  async function persistCatalog() {
    await store.saveCatalog(state.catalog);
    await store.setActiveModels(state.activeModels);
    PH.models.setCatalog(state.catalog);
    renderMM();
  }
  // 删除单个模型（同时取消激活）
  async function deleteModelFromCatalog(id) {
    if (!await showConfirm('删除该模型？\n（已使用该模型的提示词不受影响，仅目录与下拉框不再列出）')) return;
    const { company, model } = PH.models.parseId(id);
    state.catalog.forEach((c) => { if (c.company === company) c.models = c.models.filter((m) => m !== model); });
    state.catalog = state.catalog.filter((c) => c.models.length > 0);   // 清空模型的公司一并移除
    state.activeModels = state.activeModels.filter((x) => x !== id);
    await persistCatalog();
  }
  // 删除整个供应商
  async function deleteCompany(company) {
    if (!await showConfirm('删除供应商「' + company + '」及其全部模型？')) return;
    state.catalog = state.catalog.filter((c) => c.company !== company);
    state.activeModels = state.activeModels.filter((id) => PH.models.parseId(id).company !== company);
    await persistCatalog();
  }
  // 重命名模型（同步更新已选激活列表中的旧 id）
  async function renameModel(id) {
    const { company, model } = PH.models.parseId(id);
    const next = await showPrompt('将模型「' + model + '」重命名为：', model);
    if (next == null) return;
    const newName = String(next).trim();
    if (!newName) { toast('名称不能为空'); return; }
    if (newName === model) return;
    const entry = state.catalog.find((c) => c.company === company);
    if (!entry) return;
    if (entry.models.indexOf(newName) >= 0) { toast('该供应商下已存在同名模型'); return; }
    entry.models = entry.models.map((m) => m === model ? newName : m);
    const newId = PH.models.makeId(company, newName);
    const i = state.activeModels.indexOf(id);
    if (i >= 0) { state.activeModels.splice(i, 1); if (state.activeModels.indexOf(newId) < 0) state.activeModels.push(newId); }
    await persistCatalog();
    toast('已重命名');
  }
  // 重命名供应商（同步更新激活列表中的旧 id 前缀）
  async function renameCompany(company) {
    const next = await showPrompt('将供应商「' + company + '」重命名为：', company);
    if (next == null) return;
    const newName = String(next).trim();
    if (!newName) { toast('名称不能为空'); return; }
    if (newName === company) return;
    if (state.catalog.some((c) => c.company === newName)) { toast('已存在同名供应商'); return; }
    const entry = state.catalog.find((c) => c.company === company);
    if (!entry) return;
    entry.company = newName;
    // 重写激活列表里该公司所有 id 的前缀
    state.activeModels = state.activeModels.map((id) => {
      const p = PH.models.parseId(id);
      return p.company === company ? PH.models.makeId(newName, p.model) : id;
    });
    await persistCatalog();
    toast('已重命名');
  }
  // 新建弹层：可新建供应商（模型名留空）或供应商+模型
  function openMMOverlay() {
    const sel = $('#mm-company');
    sel.innerHTML = '<option value="">（选择已有供应商）</option>' +
      state.catalog.map((c) => '<option value="' + escapeHtml(c.company) + '">' + escapeHtml(c.company) + '</option>').join('');
    $('#mm-company-new').value = '';
    $('#mm-model-name').value = '';
    $('#mm-overlay-title').textContent = '新建';
    $('#mm-confirm').textContent = '添加';
    $('#mm-overlay').hidden = false;
    setTimeout(() => { if (state.catalog.length) $('#mm-model-name').focus(); else $('#mm-company-new').focus(); }, 30);
  }
  function closeMMOverlay() { $('#mm-overlay').hidden = true; }
  async function confirmAddModel() {
    const name = $('#mm-model-name').value.trim();
    const company = ($('#mm-company-new').value.trim() || $('#mm-company').value).trim();
    if (!company) { toast('请选择或输入供应商'); return; }
    let entry = state.catalog.find((c) => c.company === company);
    if (!entry) { entry = { company: company, models: [] }; state.catalog.push(entry); }
    if (!name) {   // 只新建供应商
      await persistCatalog();
      closeMMOverlay();
      toast('已新建供应商「' + company + '」');
      return;
    }
    const id = PH.models.makeId(company, name);
    if (entry.models.indexOf(name) >= 0) { toast('该模型已存在'); return; }
    entry.models.push(name);
    if (state.activeModels.indexOf(id) < 0) state.activeModels.push(id);   // 新增默认激活
    await persistCatalog();
    closeMMOverlay();
    toast('已添加 ' + company + '/' + name);
  }


  // ---------- 导入导出 ----------
  async function doExport() {
    const data = await store.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'promptflash-backup-' + new Date().toISOString().slice(0, 10) + '.json';
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
    renderCategoryChips();
    renderSceneRow();
    refresh();
    let msg;
    if (mode === 'replace') msg = '已替换全部数据（' + result.added + ' 条）';
    else {
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

  // ==================== 事件绑定 ====================
  // 列表搜索
  let searchDebounce = null;
  elSearch.addEventListener('input', () => {
    state.query = elSearch.value; state.selectedIndex = 0;
    clearTimeout(searchDebounce); searchDebounce = setTimeout(refresh, 80);
  });
  elClear.addEventListener('click', () => { elSearch.value = ''; state.query = ''; state.selectedIndex = 0; refresh(); elSearch.focus(); });
  elFilters.addEventListener('click', (e) => { const chip = e.target.closest('.chip'); if (chip) selectFilter(chip.dataset.filter); });
  $('#scene-row').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) {
      const mgr = e.target.closest('#btn-manage-tag-inline');
      if (mgr) openTagmSheet();
      return;
    }
    if (chip.classList.contains('expand-btn')) { state.tagExpanded = !state.tagExpanded; renderSceneRow(); return; }
    state.sceneTag = state.sceneTag === chip.dataset.scene ? null : chip.dataset.scene;
    state.selectedIndex = 0;
    renderSceneRow();
    refresh();
  });

  // 新建 + 设置
  $('#btn-new').addEventListener('click', () => openDetail(null));
  $('#btn-settings').addEventListener('click', openSettingsSheet);
  $('#set-theme').addEventListener('click', async (e) => {
    const seg = e.target.closest('.seg');
    if (!seg) return;
    state.settings = await store.saveSettings({ theme: seg.dataset.theme });
    applyTheme();
    syncThemeSeg();
  });

  // 详情页
  $('#detail-back').addEventListener('click', closeDetail);
  $('#detail-delete').addEventListener('click', deleteCurrent);
  $('#detail-duplicate').addEventListener('click', () => duplicatePrompt(state.currentPrompt));
  $('#detail-save').addEventListener('click', savePromptFromForm);
  $('#prompt-form').content.addEventListener('input', updateVarPreview);
  $('#add-category').addEventListener('click', () => openCategoryModal(null));
  $$('.mode-tab').forEach((t) => t.addEventListener('click', () => switchDetailMode(t.dataset.mode)));

  // 模型下拉框
  $('#mp-trigger').addEventListener('click', () => {
    const panel = $('#mp-panel');
    const open = panel.hidden;
    panel.hidden = !open;
    $('#mp-trigger').classList.toggle('open', open);
  });
  document.addEventListener('click', (e) => {
    const dd = $('#mp-dropdown');
    if (!$('#mp-panel').hidden && !dd.contains(e.target)) {
      $('#mp-panel').hidden = true;
      $('#mp-trigger').classList.remove('open');
    }
  });
  $('#mp-panel').addEventListener('click', (e) => {
    const toggle = e.target.closest('.mp-company-toggle');
    if (toggle) {
      const models = toggle.parentElement.nextElementSibling;
      if (models) models.classList.toggle('open');
      return;
    }
  });
  $('#mp-panel').addEventListener('change', (e) => {
    const t = e.target;
    if (t.classList.contains('mp-company-all')) {
      const co = t.dataset.company;
      PH.models.idsOfCompany(co).forEach((id) => {
        if (t.checked) state.editorModels[id] = true;
        else delete state.editorModels[id];
      });
      renderModelPanel();
      return;
    }
    if (t.classList.contains('mp-model-cb')) {
      if (t.checked) state.editorModels[t.dataset.id] = true;
      else delete state.editorModels[t.dataset.id];
      renderModelPanel();
      return;
    }
  });

  // 分类管理面板
  $('#catm-back').addEventListener('click', () => { $('#catm-sheet').hidden = true; });
  $('#catm-add').addEventListener('click', () => openCategoryModal(null));
  // 标签管理面板
  $('#tagm-back').addEventListener('click', () => { $('#tagm-sheet').hidden = true; });
  $('#tagm-add').addEventListener('click', async () => {
    const cat = state.categories.find((c) => c.id === state.activeFilter);
    const name = await showPrompt(
      '在分类「' + (cat ? cat.name : '') + '」下新建标签：\n标签需关联到提示词，将添加到该分类下第一条提示词。',
      '',
      { title: '新建标签', placeholder: '请输入标签名' }
    );
    if (name == null) return;
    const t = String(name).trim();
    if (!t) { toast('标签名不能为空'); return; }
    addTagToFirstPrompt(t);
  });

  // 分类弹层
  $('#cat-close').addEventListener('click', () => { $('#cat-overlay').hidden = true; });
  $('#cat-cancel').addEventListener('click', () => { $('#cat-overlay').hidden = true; });
  $('#cat-save').addEventListener('click', saveCategory);
  $('#cat-overlay').addEventListener('click', (e) => { if (e.target === $('#cat-overlay')) $('#cat-overlay').hidden = true; });
  // 确认/输入弹层：点遮罩空白处取消
  $('#confirm-overlay').addEventListener('click', (e) => { if (e.target === $('#confirm-overlay') && state._confirmResolve) state._confirmResolve(); });
  $('#prompt-overlay').addEventListener('click', (e) => { if (e.target === $('#prompt-overlay') && state._promptResolve) state._promptResolve(); });

  // 设置面板
  $('#settings-back').addEventListener('click', closeSettingsSheet);
  $('#settings-save').addEventListener('click', saveDisplaySettings);
  bindSettingPair('#set-cat-range', '#set-cat-count');
  bindSettingPair('#set-tag-range', '#set-tag-count');

  // 供应商-模型管理
  $('#open-mm').addEventListener('click', openMMSheet);
  $('#mm-back').addEventListener('click', closeMMSheet);
  $('#mm-add').addEventListener('click', openMMOverlay);
  $('#mm-close').addEventListener('click', closeMMOverlay);
  $('#mm-cancel').addEventListener('click', closeMMOverlay);
  $('#mm-confirm').addEventListener('click', confirmAddModel);
  $('#mm-overlay').addEventListener('click', (e) => { if (e.target === $('#mm-overlay')) closeMMOverlay(); });
  $('#mm-model-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); confirmAddModel(); } });

  // 批量删除面板
  $('#btn-batch').addEventListener('click', openBatchSheet);
  $('#batch-back').addEventListener('click', closeBatchSheet);
  // 下拉框：触发器开关
  $('#bd-filter-trigger').addEventListener('click', () => toggleBatchFilterDropdown(null));
  // 点击外部关闭下拉
  document.addEventListener('click', (e) => {
    if (!$('#bd-filter-panel').hidden && !$('#bd-filter-dd').contains(e.target)) closeBatchFilterDropdown();
  });
  // 面板内：点分类名展开/折叠其标签
  $('#bd-filter-panel').addEventListener('click', (e) => {
    const toggle = e.target.closest('.mp-company-toggle');
    if (!toggle) return;
    const models = toggle.parentElement.nextElementSibling;
    if (models) models.classList.toggle('open');
  });
  // 面板内复选变更：分类全选 / 标签单选
  $('#bd-filter-panel').addEventListener('change', (e) => {
    const t = e.target;
    if (t.classList.contains('bd-cat-cb')) {
      // 一级分类：选/不选该分类（不影响其下标签的独立勾选）
      const c = t.dataset.cat;
      if (t.checked) state.batchSelCats[c] = true; else delete state.batchSelCats[c];
      renderBatchFilterDropdown();   // 重渲染以更新 ✓ 标记
      applyBatchFilter();
      return;
    }
    if (t.classList.contains('bd-tag-cb')) {
      const c = t.dataset.cat, tg = t.dataset.tag;
      const key = c + '\u0000' + tg;
      if (t.checked) state.batchSelTags[key] = true; else delete state.batchSelTags[key];
      renderBatchFilterDropdown();   // 重渲染以更新部分态标记
      applyBatchFilter();
      return;
    }
  });
  // 全选 / 全不选 / 删除
  $('#bd-select-all').addEventListener('click', () => batchSelectAll(true));
  $('#bd-select-none').addEventListener('click', () => batchSelectAll(false));
  $('#bd-delete').addEventListener('click', doBatchDelete);

  // 导入导出
  $('#btn-export').addEventListener('click', doExport);
  $('#btn-import').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', (e) => { if (e.target.files[0]) handleImportFile(e.target.files[0]); e.target.value = ''; });
  $('#import-cancel').addEventListener('click', () => { $('#import-overlay').hidden = true; state.pendingImport = null; });
  $('#import-close').addEventListener('click', () => { $('#import-overlay').hidden = true; state.pendingImport = null; });
  $('#import-confirm').addEventListener('click', confirmImport);

  // 回收站
  $('#btn-trash').addEventListener('click', openTrashSheet);
  $('#trash-back').addEventListener('click', closeTrashSheet);
  $('#trash-empty').addEventListener('click', emptyAllTrash);

  // 变量弹层
  $('#modal-close').addEventListener('click', closeVariableModal);
  $('#modal-overlay').addEventListener('click', (e) => { if (e.target === $('#modal-overlay')) closeVariableModal(); });
  $('#modal-copy').addEventListener('click', () => confirmModal('copy'));
  $('#modal-insert').addEventListener('click', () => confirmModal('insert'));
  $('#modal-body').addEventListener('input', updatePreview);

  // 全局键盘
  document.addEventListener('keydown', (e) => {
    // Ctrl+K 聚焦搜索
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (!$('#detail-sheet').hidden) { if (state.detailMode === 'edit') $('#prompt-form').title.focus(); }
      else { elSearch.focus(); elSearch.select(); }
      return;
    }
    // 详情页内：E 切换预览/编辑
    if (!$('#detail-sheet').hidden) {
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      const inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (document.activeElement && document.activeElement.isContentEditable);
      if (!inField && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        switchDetailMode(state.detailMode === 'edit' ? 'preview' : 'edit');
        return;
      }
      // Ctrl+Enter 保存（编辑模式）
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); savePromptFromForm(); return; }
    }
    if (e.key === 'Escape') {
      if (!$('#confirm-overlay').hidden) { if (state._confirmResolve) state._confirmResolve(); return; }
      if (!$('#prompt-overlay').hidden) { if (state._promptResolve) state._promptResolve(); return; }
      if (!$('#detail-sheet').hidden) { closeDetail(); return; }
      if (!$('#catm-sheet').hidden) { $('#catm-sheet').hidden = true; return; }
      if (!$('#tagm-sheet').hidden) { $('#tagm-sheet').hidden = true; return; }
      if (!$('#settings-sheet').hidden) { closeSettingsSheet(); return; }
      if (!$('#batch-sheet').hidden) { closeBatchSheet(); return; }
      if (!$('#trash-sheet').hidden) { closeTrashSheet(); return; }
      if (!$('#mm-sheet').hidden) { closeMMSheet(); return; }
      if (!$('#mm-overlay').hidden) { closeMMOverlay(); return; }
      if (!$('#modal-overlay').hidden) { closeVariableModal(); return; }
      if (!$('#cat-overlay').hidden) { $('#cat-overlay').hidden = true; return; }
      if (!$('#import-overlay').hidden) { $('#import-overlay').hidden = true; return; }
    }
    // 列表键盘导航
    if ($('#detail-sheet').hidden && $('#catm-sheet').hidden && $('#tagm-sheet').hidden && $('#settings-sheet').hidden && $('#batch-sheet').hidden && $('#trash-sheet').hidden && $('#mm-sheet').hidden) {
      const a = document.activeElement;
      if (a === elSearch || a === elResults || a === document.body) {
        if (e.key === 'ArrowDown') { e.preventDefault(); selectIndex(state.selectedIndex + 1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); selectIndex(state.selectedIndex - 1); }
        else if (e.key === 'Enter') {
          e.preventDefault();
          const p = state.results[state.selectedIndex];
          if (p) openDetail(p);
        }
      }
    }
  });

  init();
})();
