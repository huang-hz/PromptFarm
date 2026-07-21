/* build-icons.js — 用本机 Chrome/Edge 无头模式把 icons/*.svg 渲染成各尺寸 PNG。
 * 用法：node tools/build-icons.js
 * 产物：icons/promptfarm.png (128) / promptfarm-48.png / promptfarm-32.png / promptfarm-16.png
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const ICONS = path.join(ROOT, 'icons');

const BROWSER = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => fs.existsSync(p));

const JOBS = [
  { size: 128, svg: 'promptfarm.svg', out: 'promptfarm.png' },
  { size: 48, svg: 'promptfarm.svg', out: 'promptfarm-48.png' },
  { size: 32, svg: 'promptfarm-small.svg', out: 'promptfarm-32.png' },
  { size: 16, svg: 'promptfarm-small.svg', out: 'promptfarm-16.png' },
];

if (!BROWSER) {
  console.error('未找到 Chrome/Edge，无法渲染图标');
  process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-icons-'));

for (const job of JOBS) {
  const html = path.join(tmp, `render-${job.size}.html`);
  // 内联 SVG（不用 <img>，避免截图早于图片加载）
  const svg = fs
    .readFileSync(path.join(ICONS, job.svg), 'utf8')
    .replace('<svg ', `<svg width="${job.size}" height="${job.size}" `);
  fs.writeFileSync(
    html,
    '<!doctype html><meta charset="utf-8">' +
      '<style>html,body{margin:0;padding:0}svg{display:block}</style>' +
      svg
  );
  const shot = path.join(tmp, `icon-${job.size}.png`);
  const url = 'file:///' + html.replace(/\\/g, '/');
  execFileSync(
    BROWSER,
    [
      '--headless',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--force-device-scale-factor=1',
      `--user-data-dir=${path.join(tmp, `profile-${job.size}`)}`,
      '--default-background-color=00000000',
      `--window-size=${job.size},${job.size}`,
      `--screenshot=${shot}`,
      url,
    ],
    { stdio: 'pipe' }
  );
  fs.copyFileSync(shot, path.join(ICONS, job.out));
  console.log(`${job.out}  (${job.size}x${job.size} <- ${job.svg})`);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('done');
