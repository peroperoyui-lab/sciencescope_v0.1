# T14 · 导图历史、版本说明页、版本比较与修改记录

共同规则见 `docs/tasks/RB_COMMON.md`；开关机制见 `docs/tasks/FEATURE_FLAGS.md`（开关 `mapHistory`、`changeLog`）。交付分支：`codex/t14-history-YYYYMMDD`。

## 背景
原型中的"导图更新历史"、"版本说明"、"版本比较"、"修改记录"页面显示的是示例内容，桌面版已把它们的入口隐藏。
真实数据已有一部分：文献版本（`workbench` 的 versions，原件在 `paper_versions/`）、秘书整理出的说明 MD（`version-organizer.mjs`）、
导图保存（`workbench/save` 的 `map`）、工具记录（`tool-activity.mjs`，含工具名、参数预览、涉及的文件）。

## A. 版本说明页（路由 `version-note`，开关 `mapHistory`）
- `GET /api/workbench/version-note?projectId&versionId` → `{version, note: {markdown, path, updated} | null, previous}`。
- 页面：用 T04 的 Markdown 阅读器显示说明 MD；按钮"打开原件"、"重新整理"（调用已有的 `workbench/organize`）、"补充说明"。
- `POST /api/workbench/version-note {projectId, versionId, append, revision}`：把用户补充追加到说明 MD 末尾（带时间），用 revision 防止覆盖秘书同时写入。
- 没有说明时页面只显示状态"尚无整理说明"和"整理说明"按钮。

## B. 版本比较（路由 `diff`）
- `GET /api/workbench/diff?projectId&from=<versionId>&to=<versionId>` → 词级差异（用 `diff` 包，BSD 许可），文本来自 T04 的提取结果；
  不能提取文本的格式返回 422 并说明原因。
- 页面：并排或内联显示，标出增删；从版本说明页的"与上一版比较"进入。

## C. 导图历史（路由 `map-history`）
- 每次导图保存写一条快照（项目目录 `.sciencescope/map-history/<时间>.json`，保留最近 100 条），记录作者（用户 / 秘书）和摘要（增删改了哪些节点）。
- `GET /api/workbench/map-history?projectId` 列表；`POST /api/workbench/map-history/restore {projectId, id, revision}` 恢复为一次新的保存（不删除历史）。
- 页面列出每次变化，点开看差异，"恢复到这一版"需要确认。

## D. 修改记录（路由 `changes`，开关 `changeLog`）
- 定义：本对话中模型通过工具**写入或修改**的文件（从工具记录中取写类工具及其路径），加上用户在工作站中对这些文件的保存。
- `GET /api/chats/changes?chatId` → `[{time, tool, path, action: created|modified|deleted, messageId}]`；页面按时间列出，可"打开"、"在文件夹中显示"、"定位到消息"。

## 开关
`capabilities.features.mapHistory` 在 A、B、C 都完成后为 true；`changeLog` 在 D 完成后为 true。可以分两次交付。

## 验收
- 单元测试：说明追加的 revision 冲突、词级差异、快照保留上限、写类工具路径提取。
- 界面 smoke：开关关闭时入口不可见；打开后各页显示真实数据，不再出现原型示例文字（在测试中断言页面不含"示例""原型"）。
