# Changelog

All notable changes to this project will be documented in this file.

## 0.2.0 - 2026-07-21

### 界面重设计
- 全新「生长」设计系统：嫩绿主色 + 麦黄点缀 + 暖调中性色，设计令牌（CSS 变量）覆盖全部视图，亮色/暗色/跟随系统三套主题同步重调。
- 列表卡片、按钮体系、标签/变量/模型徽章、弹层等全部组件视觉焕新。
- 20 档优化滑块升级为招牌组件：渐变轨道 + 刻度指示 + 动态变色滑块钮 + 每档中文描述。
- 空状态插画与文案更新（"还没有种下任何提示词"）。

### 品牌图标
- 重新设计扩展图标：绿色渐变圆角砖 + 白色输入框 + 嫩绿新芽，手工绘制的 SVG 源文件替换自动描摹版本。
- 新增 16/32/48/128 多尺寸 PNG，16/32 使用加粗简化版保证小图可读性。
- 新增 `tools/build-icons.js`：用本机无头浏览器把 SVG 一键渲染成全部尺寸 PNG。

### 文档
- README 不再展示界面截图，更新项目结构说明（补充 crypto.js、tools/ 脚本与图标多尺寸产物）。

## 0.1.1 - 2026-07-01

### AI 优化
- 详细度 8–10 档问答后新增「补充细节」独立页，可自由补充文本（可留空）再进入优化。

### 批量管理
- 「批量删除」面板更名为「批量管理」。
- 新增「导出勾选」按钮，按勾选项导出为 JSON（文件名含条数与日期）。

### 导出导入
- 导出改为 `.pf` 文件格式，导出弹窗可选加密方式：不加密 / 固定密钥（promptfarm）/ 自定义密钥。
- 新增文件级 AES-256-GCM 加密与固定标识防伪，伪造需猜中 2^128。
- 导出可选包含设置与 API Key（Key 用 Base URL 主域名段派生密钥单独加密）。
- 导入解密链：明文试读 → 固定密钥自动解 → 弹窗问用户密钥 → 失败报错。
- 导入防御性校验文件标识，拒绝伪造/损坏文件。

### 其他
- README 升级为产品落地页风格（品牌 slogan、横排徽章、真实截图）。
- 项目正式更名 PromptFarm 并更新图标。

## 0.1.0 - 2026-06-30

- Initial open source preparation.
- Local prompt management in a Chrome/Edge side panel.
- Search with fuzzy matching and pinyin/initial support.
- Variable templates, copy, and active-page insertion.
- Categories, tags, favorites, import/export, batch delete, and trash.
- User-editable provider/model catalog.
- Optional OpenAI-compatible and Anthropic-compatible AI optimization flow.
