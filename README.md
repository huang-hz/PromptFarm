# PromptHub — 提示词管理浏览器插件

一个用于**场景化提示词管理**的浏览器扩展，支持 Chrome / Edge（及所有 Chromium 内核浏览器）。
专注检索体验：模糊匹配、拼写纠错、**拼音/首字母搜索**、标签分类筛选，配合变量模板与一键复制/插入。

> 纯前端、无后端、无构建步骤。数据全部存储在本地（`chrome.storage.local`）。

---

## ✨ 核心特性

| 能力 | 说明 |
|------|------|
| 🔍 **多策略检索** | 精确子串 + 词首前缀 + Levenshtein 容错（纠拼写错误）+ 拼音/首字母。输入 `xy` 即可命中“写作”、`xieyoujian` 命中“写邮件” |
| 🧩 **变量模板** | 提示词中写 `{{变量名}}`、`{{变量名=默认值}}`、`{{变量名|输入提示}}`，使用时弹表单逐个填值 |
| 📋 **一键使用** | 复制到剪贴板 / 自动插入当前页面输入框（textarea、input、contenteditable 均支持，含 React 等框架兼容的 input 事件） |
| 🗂 **分类与标签** | 多级分类 + 标签云，可叠加关键词搜索做精准筛选 |
| ⭐ **收藏与最近** | 常用置顶、按使用频率/最近使用排序，高频内容触手可及 |
| 📥 **导入导出** | JSON 格式一键备份与恢复，支持合并 / 替换两种模式 |
| 🎨 **明暗主题** | 跟随系统或手动切换 |
| ⌨️ **键盘操作** | `↑↓` 选择、`Enter` 使用、`Cmd/Ctrl+K` 聚焦搜索、`Alt+P` 呼出侧边栏 |

---

## 🚀 安装与测试（开发者模式）

### Chrome
1. 打开 `chrome://extensions/`
2. 右上角打开 **「开发者模式」** 开关
3. 点击 **「加载已解压的扩展程序」**
4. 选择本目录 `prompt-manager-extension/`

### Edge
1. 打开 `edge://extensions/`
2. 打开左下 **「开发人员模式」**
3. 点击 **「加载解压缩的扩展」**
4. 选择本目录 `prompt-manager-extension/`

### 使用
- 点击工具栏的 ⚡ 图标 → 打开侧边栏（插件唯一界面，全程不离开面板）
- 顶部 **「🔍 使用 / 🗂 管理」** 切换两个视图：
  - **使用**：搜索 + 筛选 + 一键复制/插入
  - **管理**：提示词卡片列表（分类/标签筛选 + 搜索）+ 点击进入全屏编辑表单做增删改查；底部可导入/导出
- 在任意网页选中文字右键 → 「在 PromptHub 中搜索」

> 首次加载会自动写入 12 条示例提示词（含中文标题），可直接用来验证拼音搜索。

---

## 🎯 检索能力演示

内置示例中尝试这些查询（在侧边栏搜索框）：

| 输入 | 命中 | 原理 |
|------|------|------|
| `xy` | 写一封邮件 / 写邮件 | 拼音首字母 |
| `xieyoujian` | 写邮件 | 拼音全拼 |
| `daim` | 代码解释器 | 首字母 `dm`…（模糊） |
| `SQL` / `sql` | SQL查询优化 | 不区分大小写 |
| `会议` | 会议纪要整理 | 中文精确 |
| `test` | 生成单元测试 | 词根模糊 |

---

## ⌨️ 快捷键

| 快捷键 | 作用 | 备注 |
|--------|------|------|
| `Alt+P` | 打开侧边栏 | 可在扩展快捷键设置中改 |
| `Alt+Shift+P` | 等同点击图标 | `_execute_action` |
| `Cmd/Ctrl+K` | 聚焦搜索框（侧边栏内） | — |
| `Cmd/Ctrl+Enter` | 保存（编辑器内） | — |
| `↑` `↓` | 上下选择结果（使用视图） | — |
| `Enter` | 使用当前选中 | — |
| `Esc` | 清空搜索 / 关闭弹层 | — |

---

## 🏗 项目结构

```
prompt-manager-extension/
├── manifest.json              # MV3 配置、权限、快捷键
├── background.js              # service worker：图标/快捷键/右键菜单/注入
├── lib/
│   ├── store.js               # 存储层 CRUD、导入导出、使用统计
│   ├── search.js              # 检索引擎（多策略打分）
│   ├── fuzzy.js               # Levenshtein 模糊匹配
│   ├── template.js            # {{变量}} 解析与填充
│   └── pinyin/pinyin.min.js   # 拼音库（vendored，离线可用）
├── sidepanel/                 # 侧边栏（插件唯一界面：使用 + 管理 双视图）
│   ├── sidepanel.html         # 单页：顶部视图切换 + 使用视图 + 管理视图 + 编辑器覆盖层
│   ├── sidepanel.css
│   └── sidepanel.js
├── content/inject.js          # 注入页面输入框
├── seed/seed-data.js          # 初始示例提示词
├── icons/                     # 扩展图标（16/32/48/128）
└── tools/make-icons.js        # 图标生成脚本（可选）
```

### 技术说明
- **Manifest V3**，纯原生 JS（IIFE 命名空间 `PH.*`），无框架、无打包、无独立页面
- **单页侧边栏**：顶部切换「使用 / 管理」两个视图，编辑提示词用滑入式全屏覆盖层（sheet），全程不打开新标签页
- **存储**：`chrome.storage.local`，提示词保存时预生成拼音索引，检索零延迟
- **插入输入框**：通过 `chrome.scripting.executeScript` 在用户主动点击时注入，仅申请 `activeTab`，无需宽泛 host 权限
- **拼音**：使用 [pinyin-pro](https://github.com/zh-lx/pinyin-pro)（vendored 到 `lib/pinyin/`），完全离线

### 重新生成图标（可选）
```bash
node tools/make-icons.js
```

---

## 🔐 权限说明

| 权限 | 用途 |
|------|------|
| `storage` | 本地存储提示词数据 |
| `sidePanel` | 侧边栏界面 |
| `activeTab` | 获取当前标签页（仅用户主动操作时） |
| `scripting` | 把文本注入当前页面输入框 |
| `contextMenus` | 右键「搜索选中文字」 |

所有数据均在本地处理，不向任何服务器发送。

---

## 📄 数据格式

导出的 JSON 结构：

```json
{
  "version": 1,
  "exportedAt": "2026-01-01T00:00:00.000Z",
  "prompts": [{
    "id": "p_xxx",
    "title": "写一封邮件",
    "content": "请帮我写邮件…{{主题}}",
    "description": "...",
    "categoryId": "c_write",
    "tags": ["邮件", "商务"],
    "favorite": true,
    "usageCount": 3,
    "createdAt": 1700000000000,
    "updatedAt": 1700000000000
  }],
  "categories": [{ "id": "c_write", "name": "写作", "icon": "✍️" }],
  "settings": { "defaultAction": "copy", "theme": "auto" }
}
```
