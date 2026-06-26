/* content/inject.js — 注入到页面，负责把文本插入当前聚焦的输入元素
 * 由 background 通过 chrome.scripting.executeScript 动态注入，
 * 收到 ph-insert 消息后执行插入。
 */
(function () {
  'use strict';
  // 避免重复注册
  if (window.__PH_INJECT_BOUND__) return;
  window.__PH_INJECT_BOUND__ = true;

  // 记录最近获得焦点的可编辑元素（用户点了侧边栏后，输入框已失焦）
  let lastFocused = null;
  document.addEventListener('focusin', (e) => {
    const t = e.target;
    if (isEditable(t)) lastFocused = t;
  }, true);

  function isEditable(el) {
    if (!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'textarea' || tag === 'input') {
      const type = (el.type || '').toLowerCase();
      // 仅文本类 input
      return ['text', 'search', 'url', 'email', 'tel', 'password', ''].indexOf(type) >= 0;
    }
    if (el.isContentEditable) return true;
    return false;
  }

  // 在元素的光标位置插入文本
  function insertAtCursor(el, text) {
    if (!el) return false;
    el.focus();

    if (el.isContentEditable) {
      return insertIntoContentEditable(el, text);
    }

    // input / textarea
    try {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      if (start == null) {
        // 无法获取选区，直接追加
        el.value += text;
      } else {
        const before = el.value.slice(0, start);
        const after = el.value.slice(end);
        el.value = before + text + after;
        const pos = start + text.length;
        el.selectionStart = el.selectionEnd = pos;
      }
      // 触发框架（React/Vue）能识别的 input 事件
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    } catch (e) {
      return false;
    }
  }

  // contenteditable 插入：用 execCommand（兼容性最好），降级用 Range
  function insertIntoContentEditable(el, text) {
    // 优先恢复选区到该元素
    const sel = window.getSelection();
    try {
      if (!sel.rangeCount || !el.contains(sel.anchorNode)) {
        // 把光标移到末尾
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    } catch (e) { /* ignore */ }

    // 换行处理：contenteditable 需要用 <br> 或插入文本节点
    let ok = false;
    try {
      ok = document.execCommand('insertText', false, text);
    } catch (e) { ok = false; }

    if (!ok) {
      // 降级：插入纯文本节点
      try {
        const node = document.createTextNode(text);
        sel.deleteFromDocument();
        const range = sel.getRangeAt(0);
        range.insertNode(node);
        range.setStartAfter(node);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        ok = true;
      } catch (e2) { ok = false; }
    }
    if (ok) el.dispatchEvent(new InputEvent('input', { bubbles: true }));
    return ok;
  }

  // 查找目标输入元素：优先 lastFocused，其次页面里可见的可编辑元素
  function findTarget() {
    if (isEditable(lastFocused) && document.contains(lastFocused)) return lastFocused;
    const active = document.activeElement;
    if (isEditable(active)) return active;
    // 兜底：取第一个可见的 textarea
    const ta = document.querySelector('textarea');
    return ta || null;
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'ph-insert') {
      const target = findTarget();
      if (!target) { sendResponse({ ok: false, reason: 'no-target' }); return; }
      const ok = insertAtCursor(target, msg.text);
      sendResponse({ ok });
    }
  });
})();
