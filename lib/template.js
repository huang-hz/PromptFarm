/* template.js — 变量模板解析与填充
 * 语法：
 *   {{name}}              必填变量
 *   {{name=默认值}}       带默认值
 *   {{name|输入提示}}     带占位提示
 *   {{name|提示=默认值}}  提示 + 默认值
 * 挂载到 PH.template。
 */
(function (root) {
  'use strict';

  const NS = root.PH || (root.PH = {});

  // 匹配 {{...}}，内部可含中文/字母/数字/下划线/|=空格
  const VAR_RE = /\{\{([^{}]+)\}\}/g;

  // 从模板内容中提取变量定义（按出现顺序去重）
  function extractVariables(content) {
    const out = [];
    const seen = {};
    if (!content) return out;
    let m;
    VAR_RE.lastIndex = 0;
    while ((m = VAR_RE.exec(content)) !== null) {
      const raw = m[1].trim();
      if (!raw) continue;
      const v = parseVarSpec(raw);
      if (!seen[v.name]) {
        seen[v.name] = true;
        out.push(v);
      }
    }
    return out;
  }

  // 解析单个 {{ }} 内部规格
  function parseVarSpec(raw) {
    let name = raw, placeholder = '', defaultValue = '';
    // 先切出 name（第一个 | 或 = 之前的部分）
    const pipeIdx = raw.indexOf('|');
    const eqIdx = raw.indexOf('=');
    // 找到最先出现的分隔符
    const cut = (pipeIdx >= 0 && (eqIdx < 0 || pipeIdx < eqIdx)) ? pipeIdx : eqIdx;
    if (cut >= 0) name = raw.slice(0, cut).trim();
    const rest = cut >= 0 ? raw.slice(cut + 1) : '';

    if (pipeIdx >= 0 && eqIdx >= 0) {
      // 两者都有：判断顺序
      if (pipeIdx < eqIdx) {
        placeholder = raw.slice(pipeIdx + 1, eqIdx).trim();
        defaultValue = raw.slice(eqIdx + 1).trim();
      } else {
        defaultValue = raw.slice(eqIdx + 1, pipeIdx).trim();
        placeholder = raw.slice(pipeIdx + 1).trim();
      }
    } else if (pipeIdx >= 0) {
      placeholder = rest.trim();
    } else if (eqIdx >= 0) {
      defaultValue = rest.trim();
    }
    return { name, placeholder: placeholder || name, defaultValue };
  }

  // 用提供的 values 填充模板，返回最终文本
  function fill(content, values) {
    if (!content) return '';
    values = values || {};
    return content.replace(VAR_RE, (full, inner) => {
      const v = parseVarSpec(inner.trim());
      const val = values[v.name];
      if (val == null || val === '') {
        return v.defaultValue != null ? v.defaultValue : full; // 未填则用默认值或保留原占位
      }
      return String(val);
    });
  }

  // 判断模板是否含变量
  function hasVariables(content) {
    if (!content) return false;
    VAR_RE.lastIndex = 0;
    return VAR_RE.test(content);
  }

  NS.template = {
    VAR_RE, extractVariables, parseVarSpec, fill, hasVariables
  };
})(typeof self !== 'undefined' ? self : this);
