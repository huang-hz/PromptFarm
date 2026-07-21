<div align="center">

<img src="icons/promptfarm.png" alt="PromptFarm" width="120">

# PromptFarm

**Sow a prompt, watch it grow, harvest better prompts.**<br>
*播种一条提示词，看它生长，收获更优的提示词。*

*A local-first prompt manager that lives in your browser sidebar.*<br>
*本地优先的提示词管理器，常驻浏览器侧边栏。*

<a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a><a href="CHANGELOG.md"><img src="https://img.shields.io/badge/version-0.2.0-blue.svg" alt="Version"></a><a href="#安装"><img src="https://img.shields.io/badge/platform-Chrome%20%7C%20Edge%20%7C%20Chromium-4285F4.svg" alt="Platform"></a><a href="https://developer.chrome.com/docs/extensions/mv3/intro/"><img src="https://img.shields.io/badge/Manifest-V3-34A853.svg" alt="Manifest"></a><a href="#项目结构"><img src="https://img.shields.io/badge/build-none-FBBC05.svg" alt="No Build"></a><a href="CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-ff69b4.svg" alt="PRs Welcome"></a>

*No backend · No build step · No default remote service · Your prompts never leave your device unless you opt in.*<br>
*无后端 · 无构建 · 无默认远程服务 · 除非你主动开启 AI 优化，提示词永不离开本地*

</div>

---

## ✨ 它能做什么 / What it does

PromptFarm 是一个纯前端的 Chrome / Edge（及其他 Chromium 内核）侧边栏扩展，用来**收集、组织、检索和复用**你常用的 LLM 提示词。所有数据存在本地，不依赖任何服务器。

A pure front-end sidebar extension for collecting, organizing, searching and reusing LLM prompts. Everything is stored locally — no server required.

### 💡 核心亮点

| | 亮点 | 说明 |
| --- | --- | --- |
| 🔍 | **多策略极速搜索** | 中文关键词、英文、模糊匹配、**拼音全拼 / 首字母**（输入 `xy` 即搜「写信」，`xieyoujian` 也能命中）。保存时预生成拼音索引，搜索零延迟。 |
| 🧩 | **变量模板** | `{{变量名}}` / `{{变量名=默认值}}` / `{{变量名|输入提示}}` —— 使用时自动弹出表单填值，再把成品复制或插入网页。 |
| ⚡ | **一键复用** | 复制到剪贴板，或直接插入当前网页的 `<input>` / `<textarea>` / `contenteditable`（受限页面自动降级为复制）。 |
| 🗂️ | **分类 / 标签 / 收藏** | 分类可排序；标签按分类汇总，支持重命名、删除、手动排序；常用提示词可收藏置顶。 |
| 🤖 | **可选的 AI 优化** | 自带 **20 档「创意 ↔ 详细」单滑块**优化，支持 OpenAI / Anthropic 兼容接口；高档详细度会**先问你几个澄清问题**，再生成优化结果。 |
| 🌙 | **主题与无障碍** | 「生长」设计语言：嫩绿 + 暖调中性色 + 麦黄点缀；跟随系统 / 亮色 / 暗色；原生自定义弹层替代 `confirm`/`prompt`。 |

---

## 🤖 AI 优化：20 档单滑块（核心特色）

这是 PromptFarm 区别于普通「提示词收藏夹」的地方。在提示词编辑页点 ✨，弹出单滑块，**左右是两种对立的优化哲学**：

<div align="center">

```
← 创意·虚构                          详细·咨询 →
┌───────┬──────────────────────┬───────────────┐
│ pos1  │      pos 2 – 10      │   pos 11–20   │
│极致虚构│   创意度 9 → 1 虚构   │  详细度 1→10  │
└───────┴──────────────────────┴───────────────┘
   ↑                                  ↑
 主动虚构场景信息                   绝不虚构，缺信息就问你
```

</div>

- **左半（创意度）**：模型会在保留原目标的前提下，**主动虚构**人物、时间、地点、情境等场景信息，把干瘪的需求点燃成鲜活的画面。越靠左，虚构越多。
- **右半（详细度）**：模型**不虚构**任何原文没有的信息，只做结构化、补充约束、整理格式。越靠右越详尽。
- **详细度 ≥ 8（pos 18–20）**：进入**咨询流程** —— 模型先按档位生成 1–7 个澄清问题，你逐轮作答（可跳过、可回退），再据此生成贴合你真实需求的优化结果。

> 🎚️ **每档优化指令都可自定义**：设置 → 提示词AI优化 → 拖动 20 档滑块，可逐档查看、编辑、重置内置指令，互不影响。

**隐私前提**：AI 优化默认关闭，不访问任何远程服务。仅当你主动配置 Base URL + API Key 后才生效，且密钥只存本地。

---

## 📦 安装 / Installation

> 未上架应用商店，以「开发者模式 + 加载已解压扩展」方式安装。

**Chrome**
1. 打开 `chrome://extensions/`
2. 右上角开启「**开发者模式**」
3. 「**加载已解压的扩展程序**」→ 选择本仓库根目录

**Edge**
1. 打开 `edge://extensions/`
2. 开启「**开发人员模式**」
3. 「**加载解压缩的扩展**」→ 选择本仓库根目录

**打开侧边栏**：点击工具栏图标，或按快捷键 `Alt+P`（macOS 同样 `Alt+P`）。

---

## 🚀 使用速览

- **搜索**：侧边栏顶部输入框，支持中文 / 英文 / 拼音 / 首字母（试试 `xy`、`xieyoujian`）。
- **新建**：点「+ 新建」进入详情页，填写标题、内容、分类、标签。
- **使用**：列表卡片上的按钮可直接复制 / 插入 / 收藏 / 创建副本；进入详情页可预览变量替换后的成品。
- **AI 优化**：编辑提示词内容时，点文本框右下角的 ✨ 图标，拖动 20 档滑块选择优化方向。
- **备份**：底部支持导入 / 导出 JSON 备份（合并时按内容指纹去重）；删除先进回收站，可还原。

---

## 🗂️ 项目结构

```text
prompt-manager-extension/
├── manifest.json              # MV3 配置、权限、快捷键
├── background.js              # service worker：侧边栏、右键菜单、文本插入、LLM 请求代理 + 保活
├── content/
│   └── inject.js              # 注入当前网页输入框
├── lib/
│   ├── fuzzy.js               # Levenshtein、子串、前缀等基础匹配
│   ├── search.js              # 多字段加权搜索 + 拼音索引
│   ├── template.js            # {{变量}} 解析与填充
│   ├── models.js              # 本地供应商/模型目录
│   ├── store.js               # chrome.storage.local 数据层
│   ├── llm.js                 # OpenAI/Anthropic 兼容请求封装 + 20 档优化指令
│   ├── crypto.js              # PBKDF2 + AES-256-GCM：API Key 与 .pf 文件加密
│   └── pinyin/pinyin.min.js   # vendored pinyin-pro
├── seed/
│   └── seed-data.js           # 首次安装示例数据
├── sidepanel/
│   ├── sidepanel.html         # 侧边栏单页 UI
│   ├── sidepanel.css
│   ├── sidepanel.js           # 状态机 + 手工 DOM 渲染
│   └── icons.html             # SVG sprite
├── icons/                     # 品牌图标（SVG 源文件 + 16/32/48/128 PNG）
└── tools/
    ├── make-icons.js          # 图标检查工具
    ├── build-icons.js         # 用无头浏览器把 SVG 渲染成多尺寸 PNG
    └── check-classes.js       # 校验 HTML/JS 中的 class 在 CSS 中均有定义
```

---

## 💻 开发

本项目**无需安装依赖、无需构建**，clone 后直接「加载已解压扩展」即可调试。修改代码后在 `chrome://extensions/` 点扩展卡片上的 🔄 刷新即生效。

界面样式集中在 `sidepanel/sidepanel.css` 的设计令牌（CSS 变量）中，支持跟随系统的自动暗色模式。

- 检查图标资源：`node tools/make-icons.js`
- 修改 `icons/*.svg` 后重新生成 PNG：`node tools/build-icons.js`（调用本机 Chrome/Edge 无头渲染）
- 改动 UI 后校验 class 覆盖：`node tools/check-classes.js`

发布前手动测试清单见 [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md)。

---

## 🤝 贡献与许可

- 欢迎提 Issue 和 PR，贡献前请读 [CONTRIBUTING.md](CONTRIBUTING.md)。
- **MIT License**，详见 [LICENSE](LICENSE)；第三方组件声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

---

<div align="center">

**🌱 种下你的提示词，收获复用的效率。**

Made with care · 如果这个项目对你有帮助，欢迎 ⭐ Star

</div>
