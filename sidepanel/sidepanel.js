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
      if (changes[store.KEYS.settings]) { state.settings = Object.assign(state.settings, changes[store.KEYS.settings].newValue); applyTheme(); }
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
  function applyTheme() {
    const t = state.settings.theme || 'auto';
    document.body.style.colorScheme = (t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches)) ? 'dark' : 'light';
  }

  // ========== 使用视图 ==========
  function renderCategoryChips() {
    elFilters.querySelectorAll('.chip[data-category]').forEach((c) => c.remove());
    state.categories.forEach((c) => {
      const btn = document.createElement('button');
      btn.className = 'chip';
      btn.dataset.filter = c.id;
      btn.dataset.category = '1';
      btn.textContent = c.name;
      btn.addEventListener('click', () => selectFilter(c.id));
      elFilters.appendChild(btn);
    });
  }

  function selectFilter(filter) {
    state.activeFilter = filter;
    state.sceneTag = null;
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
    row.hidden = false;
    row.innerHTML = tags.map((t) =>
      '<button class="chip scene' + (state.sceneTag === t ? ' active' : '') + '" data-scene="' + escapeHtml(t) + '">' +
        escapeHtml(t) + '<span class="cnt">' + tagCounts[t] + '</span></button>'
    ).join('');
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
      b.className = 'm-chip' + (state.mCat === c.id ? ' active' : '');
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
          '<button class="m-chip' + (state.mTag === t ? ' active' : '') + '" data-tag="' + escapeHtml(t) + '">' +
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
    updateVarPreview();
    $('#editor-sheet').hidden = false;
    setTimeout(() => form.title.focus(), 50);
  }
  function closeEditor() { $('#editor-sheet').hidden = true; state.editingId = null; }

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
          '<span class="mgr-tag-ico">' + icon('hash') + '</span>' +
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
    const n = await store.importAll(state.pendingImport, mode);
    $('#import-overlay').hidden = true;
    state.pendingImport = null;
    state.prompts = await store.getPrompts();
    state.categories = await store.getCategories();
    renderCategoryChips(); renderManageFilters();
    refresh(); refreshManage();
    toast(mode === 'replace' ? '已替换全部数据' : '已导入 ' + n + ' 条');
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

  // 主题
  $('#btn-theme').addEventListener('click', async () => {
    const cur = state.settings.theme || 'auto';
    const next = cur === 'dark' ? 'light' : (cur === 'light' ? 'auto' : 'dark');
    state.settings = await store.saveSettings({ theme: next });
    applyTheme();
    toast('主题：' + (next === 'auto' ? '跟随系统' : (next === 'dark' ? '暗色' : '亮色')));
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
