/* background.js — MV3 service worker
 * 职责：
 *  1. 点击工具栏图标 → 打开/聚焦侧边栏
 *  2. 快捷键 Alt+P 打开侧边栏
 *  3. 接收 sidepanel 的 insert-text 消息 → 向当前标签页注入文本
 *  4. 右键菜单「在 PromptFarm 中搜索选中文本」
 */
'use strict';

// 允许打开侧边栏的前提：当前标签页有 http(s) 或 file 协议
async function openSidePanel(tabId) {
  try {
    await chrome.sidePanel.open({ tabId });
    await chrome.sidePanel.setOptions({
      tabId,
      path: 'sidepanel/sidepanel.html',
      enabled: true
    });
  } catch (e) {
    // 某些页面（chrome:// 等）无法打开，忽略
    console.warn('openSidePanel failed:', e && e.message);
  }
}

// 点击工具栏图标
chrome.action.onClicked.addListener((tab) => {
  openSidePanel(tab.id);
});

// 设置默认在所有标签页启用侧边栏
chrome.runtime.onInstalled.addListener(async () => {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (e) {
    /* 旧版本不支持，忽略 */
  }

  // 右键菜单
  try {
    chrome.contextMenus.create({
      id: 'ph-search-selection',
      title: '在 PromptFarm 中搜索“%s”',
      contexts: ['selection']
    });
  } catch (e) { /* 已存在 */ }
});

// 快捷键命令
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'open-side-panel') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) openSidePanel(tab.id);
  }
});

// 右键菜单：把选中文字传给侧边栏
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'ph-search-selection' && info.selectionText) {
    await openSidePanel(tab.id);
    // 等侧边栏加载后发送查询
    setTimeout(() => {
      chrome.runtime.sendMessage({ type: 'search-query', query: info.selectionText }).catch(() => {});
    }, 400);
  }
});

// 消息处理
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'insert-text') {
    insertTextIntoActiveTab(msg.text).then((ok) => sendResponse({ ok })).catch(() => sendResponse({ ok: false }));
    return true; // 异步响应
  }
  // 通用跨域 HTTP 请求：扩展页面直接 fetch 会受 CORS 限制，
  // 故把网络请求集中在 service worker 执行（已获 host_permissions）
  if (msg && msg.type === 'llm-fetch') {
    llmFetch(msg.spec).then(sendResponse).catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
    return true; // 异步响应
  }
});

// ---------- service worker 保活 ----------
// LLM 请求（尤其 reasoning 模型的高档咨询）可能耗时数十秒，
// MV3 service worker 空闲约 30 秒会被 Chrome 回收，导致进行中的 fetch 中断报 "Failed to fetch"。
// 故在请求期间用 chrome.alarms 周期性唤醒 worker，请求结束即停止。
const KEEPALIVE_ALARM = 'ph-keepalive';
let keepaliveCount = 0; // 并发请求数，归零时才停止保活
function startKeepalive() {
  keepaliveCount++;
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.45 }); // ~27秒，小于30秒回收窗口
}
function stopKeepalive() {
  keepaliveCount = Math.max(0, keepaliveCount - 1);
  if (keepaliveCount === 0) chrome.alarms.clear(KEEPALIVE_ALARM);
}
// alarms 触发时无需做事，其本身即让 worker 续命
chrome.alarms.onAlarm.addListener(() => { /* keepalive tick */ });

// 通用 HTTP：按请求规格执行 fetch 并返回 JSON
async function llmFetch(spec) {
  if (!spec || !spec.url) return { ok: false, error: '缺少 url' };
  const opt = { method: spec.method || 'GET' };
  if (spec.headers) opt.headers = spec.headers;
  if (spec.body != null) opt.body = typeof spec.body === 'string' ? spec.body : JSON.stringify(spec.body);
  startKeepalive();
  try {
    const res = await fetch(spec.url, opt);
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_) { data = { raw: text }; }
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  } finally {
    stopKeepalive();
  }
}

// 把文本插入当前激活标签页中聚焦的输入元素
async function insertTextIntoActiveTab(text) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return false;
  // 受限页面无法注入
  if (/^(chrome|edge|about|chrome-extension):/i.test(tab.url || '')) return false;

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content/inject.js']
    });
    // 注入后再发送插入指令
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'ph-insert', text });
    return !!(res && res.ok);
  } catch (e) {
    console.warn('insertTextIntoActiveTab failed:', e && e.message);
    return false;
  }
}
