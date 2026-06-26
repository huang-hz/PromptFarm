/* tools/make-icons.js — 生成扩展图标（纯 Node，无外部依赖）
 * 渲染：圆角方形蓝底 + 白色闪电。输出 16/32/48/128 四个尺寸。
 * 运行：node tools/make-icons.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---------- PNG 编码（RGBA） ----------
function crc32(buf) {
  let c = ~crc32.table;
  if (!crc32.table) {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let x = n;
      for (let k = 0; k < 8; k++) x = x & 1 ? 0xedb88320 ^ (x >>> 1) : x >>> 1;
      t[n] = x >>> 0;
    }
    crc32.table = t;
    c = ~0;
  }
  for (let i = 0; i < buf.length; i++) c = crc32.table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ ~0) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  // 加过滤字节(0)前缀每行
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- 像素画布 ----------
function makeCanvas(size) {
  const buf = Buffer.alloc(size * size * 4);
  return {
    size, buf,
    set: (x, y, r, g, b, a) => {
      x = Math.round(x); y = Math.round(y);
      if (x < 0 || y < 0 || x >= size || y >= size) return;
      const i = (y * size + x) * 4;
      // alpha 混合（源 over 目标）
      const sa = a / 255;
      const da = buf[i + 3] / 255;
      const oa = sa + da * (1 - sa);
      if (oa <= 0) return;
      buf[i]     = Math.round((r * sa + buf[i]     * da * (1 - sa)) / oa);
      buf[i + 1] = Math.round((g * sa + buf[i + 1] * da * (1 - sa)) / oa);
      buf[i + 2] = Math.round((b * sa + buf[i + 2] * da * (1 - sa)) / oa);
      buf[i + 3] = Math.round(oa * 255);
    }
  };
}

// 圆角矩形覆盖（带 alpha 边缘平滑：对边缘像素做超采样）
function fillRoundRect(cv, x0, y0, x1, y1, r, rgb, ss) {
  ss = ss || 4;
  for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
    for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
      let hits = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const px = x + (sx + 0.5) / ss;
          const py = y + (sy + 0.5) / ss;
          // 圆角距离判定
          const cx = Math.max(x0 + r, Math.min(x1 - r, px));
          const cy = Math.max(y0 + r, Math.min(y1 - r, py));
          const dx = px - cx, dy = py - cy;
          if (px >= x0 && px <= x1 && py >= y0 && py <= y1 && (dx * dx + dy * dy) <= r * r) hits++;
        }
      }
      if (hits > 0) cv.set(x, y, rgb[0], rgb[1], rgb[2], Math.round(255 * hits / (ss * ss)));
    }
  }
}

// 多边形扫描线填充（归一化坐标 0~1），带超采样抗锯齿边缘
function fillPolygon(cv, poly, rgb, ss) {
  ss = ss || 4;
  const S = cv.size;
  const pts = poly.map(([x, y]) => [x * S, y * S]);
  let minY = Infinity, maxY = -Infinity;
  pts.forEach((p) => { if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; });
  for (let y = Math.floor(minY); y < Math.ceil(maxY); y++) {
    for (let sub = 0; sub < ss; sub++) {
      const yc = y + (sub + 0.5) / ss;
      // 求交点
      const xs = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) {
          const t = (yc - a[1]) / (b[1] - a[1]);
          xs.push(a[0] + t * (b[0] - a[0]));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xstart = xs[k], xend = xs[k + 1];
        for (let x = Math.floor(xstart); x < Math.ceil(xend); x++) {
          const cov = (Math.min(xend, x + 1) - Math.max(xstart, x)) / (1 / ss) * (1 / ss);
          // 用 sub 采样累加成 alpha
          cv._polyAA = cv._polyAA || {};
          const key = x + ',' + y;
          cv._polyAA[key] = (cv._polyAA[key] || 0) + cov;
        }
      }
    }
  }
  // 把累积的 alpha 写回
  if (cv._polyAA) {
    for (const key in cv._polyAA) {
      const [x, y] = key.split(',').map(Number);
      const a = Math.max(0, Math.min(1, cv._polyAA[key]));
      if (a > 0) cv.set(x, y, rgb[0], rgb[1], rgb[2], Math.round(a * 255));
    }
  }
}

// ---------- 绘制 ----------
function draw(size) {
  const cv = makeCanvas(size);
  // 背景圆角方形（渐变模拟：上深下浅，分两块）
  const pad = Math.max(0.5, size * 0.04);
  const r = size * 0.22;
  fillRoundRect(cv, pad, pad, size - pad, size - pad, r, [79, 124, 255], 4);
  // 高光叠层（顶部稍亮）
  fillRoundRect(cv, pad, pad, size - pad, size * 0.55, r, [110, 150, 255], 4);

  // 闪电多边形（归一化 0~1，居中偏左上）
  const bolt = [
    [0.56, 0.18],
    [0.34, 0.55],
    [0.47, 0.55],
    [0.40, 0.82],
    [0.68, 0.42],
    [0.54, 0.42],
    [0.62, 0.18]
  ];
  fillPolygon(cv, bolt, [255, 255, 255], 4);

  return encodePNG(size, size, cv.buf);
}

// ---------- 输出 ----------
const outDir = path.join(__dirname, '..', 'icons');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
[16, 32, 48, 128].forEach((s) => {
  const png = draw(s);
  fs.writeFileSync(path.join(outDir, 'icon-' + s + '.png'), png);
  console.log('wrote icon-' + s + '.png (' + png.length + ' bytes)');
});
console.log('done');
