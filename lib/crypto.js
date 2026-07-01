/* crypto.js — API Key 与导出文件的本地加密/解密
 * 用途：导出设置时对 aiConfig.apiKey 加密；导出 .pf 文件时整体加密。
 * 挂载到 PH.crypto。
 */
(function (root) {
  'use strict';
  const NS = root.PH || (root.PH = {});
  const subtle = (root.crypto || root.webkitCrypto).subtle;

  // 从 baseUrl 提取主域名段：去协议/端口/路径后，按 . 拆分，取倒数第二段（主域名）。
  // 例：'https://api.deepseek.com' → 'deepseek'；'https://www.x.com' → 'x'；空 → ''
  function deriveKeyMaterial(baseUrl) {
    let h = (baseUrl || '').trim().replace(/^https?:\/\//i, '').replace(/[\/:].*$/, '');
    if (!h) return '';
    const parts = h.split('.');
    if (parts.length < 2) return parts[0]; // 无点（如 localhost）→ 整段
    return parts[parts.length - 2];        // 倒数第二段（主域名）
  }

  // 派生口令：主域名段的首位 + 逆序首位。例 'deepseek' → 'd' + 'k' = 'dk'
  function derivePassphrase(baseUrl) {
    const main = deriveKeyMaterial(baseUrl);
    if (!main) return '';
    const rev = main.split('').reverse().join('');
    return main[0] + (rev[0] || '');
  }

  // Uint8Array → base64
  function toB64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return root.btoa(s);
  }
  // base64 → Uint8Array
  function fromB64(b64) {
    const s = root.atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  // 用 baseUrl 派生的口令，PBKDF2 派生 AES-256-GCM 密钥
  async function deriveAesKey(baseUrl, salt) {
    const pass = derivePassphrase(baseUrl);
    if (!pass) return null; // base 空 → 无法派生
    const enc = new TextEncoder();
    const baseKey = await subtle.importKey('raw', enc.encode(pass), { name: 'PBKDF2' }, false, ['deriveKey']);
    return subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  // 加密：明文 apiKey → base64（salt[16] + iv[12] + ciphertext+tag）
  // base 空 或 plain 空 → 返回 null（调用方据此跳过）
  async function encryptApiKey(plain, baseUrl) {
    if (!plain || !baseUrl) return null;
    const salt = root.crypto.getRandomValues(new Uint8Array(16));
    const iv = root.crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveAesKey(baseUrl, salt);
    if (!key) return null;
    const enc = new TextEncoder();
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain));
    // assemble: salt + iv + ciphertext(with tag at tail)
    const blob = new Uint8Array(salt.length + iv.length + ct.byteLength);
    blob.set(salt, 0);
    blob.set(iv, 16);
    blob.set(new Uint8Array(ct), 28);
    return toB64(blob);
  }

  // 解密：base64（含 salt/iv/ct）→ 明文 apiKey。失败 → null
  async function decryptApiKey(b64, baseUrl) {
    if (!b64 || !baseUrl) return null;
    try {
      const raw = fromB64(b64);
      if (raw.length < 29) return null;            // 不足 salt+iv+1 → 非法
      const salt = raw.slice(0, 16);
      const iv = raw.slice(16, 28);
      const ct = raw.slice(28);
      const key = await deriveAesKey(baseUrl, salt);
      if (!key) return null;
      const dec = await subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
      return new TextDecoder().decode(dec);
    } catch (e) {
      return null; // 解密失败（密钥不匹配/数据损坏）→ 返回 null，调用方置空
    }
  }

  // ---------- 文件级加密（导出 .pf 文件整体加密）----------
  const FILE_AUTH = 'PROMPTFARM_FILE_V1';
  const FILE_SALT = 'pf_2026_static_salt_!@#';
  let _fileSigCache = null; // 预计算的 _pf_sig（异步算一次后缓存）
  async function computeFileSig() {
    if (_fileSigCache) return _fileSigCache;
    const enc = new TextEncoder();
    const buf = await subtle.digest('SHA-256', enc.encode(FILE_AUTH + FILE_SALT));
    _fileSigCache = Array.from(new Uint8Array(buf)).slice(0, 16)
      .map((b) => b.toString(16).padStart(2, '0')).join('');
    return _fileSigCache;
  }
  // 生成文件标识（嵌入 JSON，防伪：伪造需猜中 2^128）
  async function makeFileMarker() {
    return { _pf_auth: FILE_AUTH, _pf_sig: await computeFileSig() };
  }
  // 校验文件标识真伪
  async function checkFileMarker(obj) {
    if (!obj || obj._pf_auth !== FILE_AUTH) return false;
    return obj._pf_sig === await computeFileSig();
  }
  // 整份 JSON 加密 → base64（AES-256-GCM，passphrase 经 PBKDF2 派生）
  async function encryptData(jsonStr, passphrase) {
    if (!jsonStr || !passphrase) return null;
    const salt = root.crypto.getRandomValues(new Uint8Array(16));
    const iv = root.crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const baseKey = await subtle.importKey('raw', enc.encode(passphrase), { name: 'PBKDF2' }, false, ['deriveKey']);
    const key = await subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
      baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt']
    );
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(jsonStr));
    const blob = new Uint8Array(salt.length + iv.length + ct.byteLength);
    blob.set(salt, 0); blob.set(iv, 16); blob.set(new Uint8Array(ct), 28);
    return toB64(blob);
  }
  // 解密 base64 → 原文 jsonStr；失败返回 null
  async function decryptData(b64, passphrase) {
    if (!b64 || !passphrase) return null;
    try {
      const raw = fromB64(b64);
      if (raw.length < 29) return null;
      const salt = raw.slice(0, 16), iv = raw.slice(16, 28), ct = raw.slice(28);
      const enc = new TextEncoder();
      const baseKey = await subtle.importKey('raw', enc.encode(passphrase), { name: 'PBKDF2' }, false, ['deriveKey']);
      const key = await subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
        baseKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
      );
      const dec = await subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
      return new TextDecoder().decode(dec);
    } catch (e) {
      return null;
    }
  }

  NS.crypto = {
    deriveKeyMaterial, derivePassphrase, encryptApiKey, decryptApiKey,
    FILE_AUTH, makeFileMarker, checkFileMarker, encryptData, decryptData
  };
})(typeof self !== 'undefined' ? self : this);
