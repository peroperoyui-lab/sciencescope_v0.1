# 可选功能开关（Feature flags）与对应任务书

- 下达：Claude，2026-09-25（用户要求：删除所有"此功能尚未开发"一类提示，把对应功能写成任务书）。
- 执行：GPT / Codex。通用规则见 `docs/tasks/RB_COMMON.md`（基线、交付分支、许可、测试目录、文档更新），交付不开 PR、不合并。

## 规则

1. **界面上不出现"尚未开发 / 即将提供 / 待接入 / 原型 / 示例"一类文字。** 功能没做完时，它的入口（按钮、菜单项、设置页、路由）不显示；
   做完并端到端验证后才显示。不要为了"有东西可点"而保留一个只弹提示的按钮。
2. 开关只有一个来源：宿主 `GET /api/status` 返回的 `features`（`scripts/desktop-api.mjs` 中的 `capabilities.features`）。
   前端 `desktop/features.mjs` 读取它，隐藏对应的 CSS 选择器、菜单项和路由（导航到隐藏路由不生效；指向隐藏路由的菜单项和命令面板条目也不出现）。
3. 实现某个功能的任务：
   - 在 `capabilities.features` 中把对应开关改为**真实检测结果**（例如"服务已创建"），不要写死 `true`；
   - 如果新增了入口，把它登记到 `desktop/features.mjs` 的 `FEATURES` 表（`hide` 选择器、`routes`、`menu` 过滤函数）；
   - 说明性文字用 `infoTip()`（`desktop/info-tip.mjs`）放在标题或标签旁的"i"中；错误、警告、状态直接显示；
   - 更新 `docs/SYSTEM_SPEC.md`、`docs/DESKTOP_IMPLEMENTATION.md` 和本表。
4. 原型设计包里的页面目录（`help`）、逐页开发说明（`page-doc`）及演示页（`resume`、`run`、`compose`、`free`、`welcome`）在桌面版中永远不可达，不属于任何任务。

## 开关一览

| 开关 | 隐藏的入口 | 负责任务 | 打开条件 |
|---|---|---|---|
| `pythonEnvs` | （没有时 Python 字段只提供"系统 Python"） | T11 | 已接通（2026-09-29）：检测实际 Python service；设置/绑定/审批/真实解释器通过 |
| `folderPicker` | 新建窗口的"选择…"、创建项目页的"选择已有文件夹" | T11 | 已接通（2026-09-29）：Tauri主窗口 `pick_folder` +宿主 `SCIENCESCOPE_NATIVE_FEATURES=pickFolder`；真实Win32选择/取消及原生项目写入通过 |
| `inAppBrowser` | 顶栏/视图菜单"内置浏览器"、设置"内置浏览器"页、路由 `browser` `browser-settings` | T08 | 浏览器窗口与网页保存可用；在此之前学术站点用系统浏览器打开（`POST /api/open-url`，已实现） |
| `branch` | 消息操作/菜单/输入框上方的“从此回复分支 / 从此处重新提问”（按消息完成状态选择）、路由 `branch` | T12 | 已接通（2026-10-03）：浏览器与 Windows Tauri/WebView2 验收后，检测宿主 `forkSession` 和 `sessionTurns`；旧消息未知序号、未完成轮次与助手会话不显示入口 |
| `usage` | 设置"用量分析"、路由 `usage` | T13 | 用量记录与 `/api/usage` 可用 |
| `materialsPanel` | 附件菜单"项目材料与引用"、路由 `context` | T05 | 已接通：宿主检测 Research Base 服务；真实资源/条目选择、草稿恢复及模型输入已通过浏览器与原生 smoke（2026-09-27） |
| `memoryConsolidation` | 秘书设置的记忆整理表单、对话菜单“整理这段对话” | T09 | 检测宿主 `startSession/send` 与应用整理服务；2026-10-04 浏览器及 Windows Tauri/WebView2 的空闲提议、确认、来源定位和下一轮 Main 简报通过 |
| `mapHistory` | 导图编辑器"更新历史"、路由 `map-history` `version-note` `diff` | T14 | 导图历史、版本说明页、版本比较接通真实数据 |
| `changeLog` | 对话菜单"修改记录"、命令面板"查看修改记录"、路由 `changes` | T14 | 修改记录由真实事件生成 |
| `pluginManagement` | （目前只删除了"尚待接入"说明；插件区只读） | T15 | 插件安装、更新、启停可用 |
| `dataRelocation` | （目前只删除了"尚未开放"说明；路径只读） | T16 | 更改目录与数据迁移可用 |

## 现状（2026-09-25，Claude）

- 2026-09-27 T05：`materialsPanel` 已按真实服务检测开启，原型材料面板被实际资料库替换；其他未完成开关保持关闭。验收详见 DESKTOP_IMPLEMENTATION 的 T05 小节。

- 已实现：开关机制、上表的隐藏、`/api/open-url`（只接受 http/https，经 API 口令保护）、学术站点改为系统浏览器打开。
- 截图与验证见 `docs/DESKTOP_IMPLEMENTATION.md` 当日小节。
