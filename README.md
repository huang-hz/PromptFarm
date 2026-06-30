# PromptFlash

PromptFlash 是一个本地优先的提示词管理浏览器扩展，支持 Chrome、Edge 以及其他 Chromium 内核浏览器。它提供提示词搜索、分类标签、变量模板、复制/插入、导入导出、回收站、模型适配标记，以及可选的 AI 提示词优化能力。

项目是纯前端实现：无后端、无构建步骤、无默认远程服务。提示词数据默认存储在 `chrome.storage.local`。

## 功能

| 能力 | 说明 |
| --- | --- |
| 多策略搜索 | 支持中文关键词、大小写不敏感搜索、模糊匹配、拼音全拼和首字母搜索 |
| 分类与标签 | 分类可排序；标签按分类汇总，可重命名、删除、排序 |
| 变量模板 | 支持 `{{变量名}}`、`{{变量名=默认值}}`、`{{变量名|输入提示}}` |
| 一键使用 | 可复制到剪贴板，或插入当前网页的 `input`、`textarea`、`contenteditable` |
| 详情编辑 | 主列表进入详情页，支持编辑/预览切换、创建副本、适配模型标记 |
| 批量管理 | 可按分类/标签筛选并批量移入回收站 |
| 回收站 | 删除的提示词先软删除，可还原或永久删除 |
| 导入导出 | JSON 备份，支持合并和替换；合并时按内容指纹去重 |
| 模型目录 | 内置供应商/模型清单，可本地编辑并控制激活模型 |
| AI 优化 | 可配置 OpenAI 兼容或 Anthropic 兼容接口，对提示词进行多档位优化 |
| 主题 | 支持跟随系统、亮色、暗色 |

## 安装

### Chrome

1. 打开 `chrome://extensions/`
2. 打开右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本目录 `prompt-manager-extension/`

### Edge

1. 打开 `edge://extensions/`
2. 打开「开发人员模式」
3. 点击「加载解压缩的扩展」
4. 选择本目录 `prompt-manager-extension/`

## 使用

- 点击工具栏图标或按 `Alt+P` 打开侧边栏。
- 在主列表顶部搜索提示词。可以输入中文、英文、拼音或拼音首字母，例如 `xy`、`xieyoujian`。
- 点击提示词卡片进入详情页；卡片按钮可直接复制、插入、收藏或创建副本。
- 在提示词内容中写变量占位符，使用时会弹出表单填写变量值。
- 底部可导入、导出备份，也可打开回收站。
- 设置中可调整主题、分类/标签展示数量、供应商模型目录和 AI 优化配置。

## AI 优化

AI 优化是可选功能，默认不会访问任何 AI 服务。使用前需要在「设置 -> 提示词AI优化」中配置：

- 接口协议：OpenAI 兼容或 Anthropic 兼容
- Base URL：可留空使用协议默认地址，也可填写中转服务地址
- API Key：保存在本地 `chrome.storage.local`
- 模型：可手动输入，也可通过接口拉取模型列表

优化流程使用 20 档滑块：

- 左侧偏创意/虚构：模型会在保持原目标的前提下补充场景化信息。
- 右侧偏详细/咨询：模型不会虚构信息，高档位会先生成澄清问题，再生成优化结果。

## 权限说明

| 权限 | 用途 |
| --- | --- |
| `storage` | 保存提示词、分类、设置、回收站、AI 配置等本地数据 |
| `sidePanel` | 显示扩展侧边栏 |
| `activeTab` | 在用户主动操作后访问当前标签页 |
| `scripting` | 动态注入 `content/inject.js`，把文本插入当前网页输入框 |
| `contextMenus` | 在网页选中文字后右键「在 PromptFlash 中搜索」 |
| `alarms` | 在长时间 AI 请求期间保持 MV3 service worker 存活 |
| `<all_urls>` | 允许 background 代理用户配置的跨域 LLM API 请求，并支持在普通网页中插入文本 |

更完整的隐私说明见 [PRIVACY.md](PRIVACY.md)。

## 项目结构

```text
prompt-manager-extension/
├── manifest.json              # MV3 配置、权限、快捷键
├── background.js              # service worker：侧边栏、右键菜单、插入、LLM 请求代理
├── content/
│   └── inject.js              # 注入当前网页输入框
├── lib/
│   ├── fuzzy.js               # Levenshtein、子串、前缀等基础匹配
│   ├── search.js              # 多字段加权搜索和拼音索引
│   ├── template.js            # {{变量}} 解析与填充
│   ├── models.js              # 本地供应商/模型目录
│   ├── store.js               # chrome.storage.local 数据层
│   ├── llm.js                 # OpenAI/Anthropic 兼容请求封装
│   └── pinyin/pinyin.min.js   # vendored pinyin-pro
├── seed/
│   └── seed-data.js           # 首次安装示例数据
├── sidepanel/
│   ├── sidepanel.html         # 侧边栏单页 UI
│   ├── sidepanel.css
│   ├── sidepanel.js
│   └── icons.html             # SVG sprite
├── icons/                     # 扩展 PNG 图标
└── tools/
    └── make-icons.js          # 生成扩展图标
```

## 技术设计

- Manifest V3 扩展。
- 无框架、无打包，脚本通过 `<script>` 顺序加载。
- 模块使用 IIFE 挂载到全局命名空间 `PH.*`。
- 主界面是一个 side panel 单页应用，使用一个 `state` 对象和手工 DOM 渲染管理状态。
- 提示词保存时预生成拼音索引 `_index`，搜索时减少拼音计算。
- 导出数据使用 `_hash` 内容指纹，合并导入时按指纹去重。
- 删除采用软删除，数据先进入 `ph_trash`。
- LLM 请求集中由 background service worker 发起，side panel 通过 `chrome.runtime.sendMessage` 调用。

## 数据格式

导出的 JSON 大致结构：

```json
{
  "version": 2,
  "exportedAt": "2026-01-01T00:00:00.000Z",
  "prompts": [
    {
      "id": "p_xxx",
      "title": "写一封商务邮件",
      "content": "请帮我撰写一封商务邮件。{{邮件主题}}",
      "description": "快速生成正式的商务沟通邮件。",
      "categoryId": "c_write",
      "tags": ["邮件", "商务"],
      "models": ["OpenAI/GPT-5.5"],
      "favorite": true,
      "usageCount": 3,
      "lastUsed": 1700000000000,
      "createdAt": 1700000000000,
      "updatedAt": 1700000000000,
      "_hash": "PF-..."
    }
  ],
  "categories": [
    { "id": "c_write", "name": "写作", "sortOrder": 0 }
  ],
  "settings": {
    "defaultAction": "copy",
    "theme": "auto"
  }
}
```

## 开发

本项目目前不需要安装依赖。

重新生成扩展图标：

```bash
node tools/make-icons.js
```

运行 `tools/eval-*.mjs` 评估脚本前，需要通过环境变量提供 API Key，不要把密钥写进脚本：

```bash
PF_EVAL_API_KEY=your_key node tools/eval-deepseek20.mjs
```

也可以使用脚本对应的供应商变量，例如 `DEEPSEEK_API_KEY` 或 `VVEAI_API_KEY`。

建议发布前手动测试：

- 首次安装是否写入示例数据
- 中文、英文、拼音、首字母搜索
- 新建、编辑、复制、插入、收藏、创建副本
- 变量模板填写和预览
- 分类/标签管理和排序
- 批量删除、回收站还原、永久删除
- 导入导出合并/替换
- AI 配置为空时的提示
- 配置 AI 后模型列表拉取、问题生成和优化结果
- 在受限页面插入失败时是否降级复制

## 开源许可

本项目使用 MIT License，详见 [LICENSE](LICENSE)。

第三方组件和资源说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 贡献

欢迎提交 issue 和 pull request。贡献前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。
