# ScienceScope · 交互优化版 v0.3

## 桌面客户端开发状态

本轮试用与网页端讨论入口：[2026-09-20 交接清单](docs/WEB_REVIEW_HANDOFF.md)。
Claude 深度审阅、已修复缺陷与路线建议：[2026-09-23 审阅](docs/REVIEW_CLAUDE_2026-09-23.md)。
列明已实现、实际验证、未完成项和建议试用路径；不代表 alpha 已发布。

当前仓库包含已批准的 HTML 设计基线，以及 `desktop/`、`scripts/`、`src-tauri/`
中的实际桌面实现。以下设计包说明不是生产功能清单。

下一目标是 `1.0.0-alpha`：完整计划、真实接线与验收范围见
[开发手册](docs/DESKTOP_IMPLEMENTATION.md)，本机开发启动见
[Windows 环境说明](docs/NATIVE_SETUP.md)。当前尚无完成验收的正式安装包。

Publisher: **peroperoyui**。Contributors: **Codex (AI-assisted development)**、**Claude (Anthropic, AI-assisted review & development)**。
此署名不是 Windows 数字签名或已发布声明。

## 原始设计包

先打开 **ScienceScope.html**。不需要 npm 或服务器。底栏“页面目录”可浏览 49 个页面状态；Ctrl K 搜索与命令。

本轮保持上版视觉与用户 PPT 结构，修复菜单/浮层、置顶、项目折叠、浏览全部、上下文悬停、消息操作、计划日志及多窗口体验。

## 体验路径

工作对话 → 右上角项目摘要 → 文件预览与批注 → 会议秘书 → 编辑下一步提示词。

工作站 → 添加计划/日志 → 拖入附件 → 保存/删除/撤销；点日志卡打开详情并定位消息。

项目/对话 … 或右键 → 手动置顶/归档/重命名；侧栏底部浏览全部支持搜索。

左下角全局助手 → 独立窗口 → 收起为球 → 展开 → 点击项目/工作站定位主应用。

## 包内文件

- `CODEX_START.md`：本地开发总入口。
- `docs/`：总说明、交互与窗口说明、十条反馈、研究参考、49 份逐页文档、五份流程说明。
- `screenshots/index.html`：全页面截图索引。
- `qa/results.json` 与 `qa/test_interactions.py`：本轮可重复检查及结果。
- `src/`：保留的上版源文件和本轮可读样式/交互改动，`build.py` 可生成独立 HTML。
- `reference/`：用户 PPT、Logo 与本轮 Codex 截图。

## 使用范围

页面的导航、编辑、附件、批注、消息和独立浏览窗口可操作；数据保存在本次内存，刷新会重置，可显式导出。模型/API/秘书总结、统计值和外部网页属于示例或待接入。真实 DSH 及 Windows 原生窗口/目录由本地 Codex 实现。

普通浏览器可能将弹窗作为新标签或阻止弹窗，请允许当前文件打开辅助窗口。OS 悬浮球、透明窗、always-on-top 由正式桌面宿主提供。

没有字体文件、依赖目录、API 密钥、数据库或本地研究数据。源 PPT 内的原有示例文字仅作用户设计依据。
