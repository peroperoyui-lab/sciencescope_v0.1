# KB-5 知识库接口与编辑会话

- 起草：Claude，2026-10-20。依据：`architecture/KNOWLEDGE_BASE.md`（已定稿）§3.6、§7、§8、§10 KB-5；`decisions/DECISIONS.md` 2026-10-07（历史版本与撤销）、2026-10-19（知识库）。接在 KB-4 之后；Claude 的 KB-9（表格与节点详情）和 KB-10（图视图）用这些接口。
- 执行：Sol（Windows）；审阅：Claude。约 2 小时，一步交付；超出就停下汇报。

## 目标

界面能读写知识库：列实体、看一个节点的详情和相连关系、建改删实体和边、合并、加减标签和项目归属、看和撤回历史版本。图视图打开期间的修改归入一个编辑会话，离开时形成一个 `leave-page` 版本；会话里的撤销、重做在宿主做，写进同一个版本。

## 用户会怎么用

本任务没有界面（KB-9、KB-10 由 Claude 做）。它支撑这些操作：

- 知识库页「实体」标签：按种类、名称、标签、「只看 AI 添加」筛选和翻页；单击一行，右侧详情显示字段、别名、标签、按关系分组的相连项、每条边的证据（资料段落或用户消息），以及「由 方法专家 在《某对话》中添加」。
- 图视图里拖线建边、改关系、多选合并（先看到会改挂几条边）、删除；Ctrl+Z / Ctrl+Shift+Z 撤销重做本页的修改；离开页面后历史里多一个「离开页面」版本，可整组撤回。
- 回答下方「本轮修改了知识库」（KB-12）按 `turnId` 找到那一版，看变更清单、撤回。

## 要做的

1. **新文件 `app/server/routes/knowledge.js`**，在 `app/server/server.js` 注册，都要口令。全部调已有的知识库服务（`app/services/knowledge/store.js`、`versions.js`、`jobs.js`），不在路由里写 SQL。用户操作的 actor 是 `{actorId: 'person_user', origin: 'user'}`；请求体带 `sessionId` 时作为 `versionId` 传给服务，不带时照现有行为每次一个自动版本。
2. **实体与边**：
   - `GET /api/knowledge/entities`：`projectId?`、`kind?`、`q?`（名称和别名）、`label?`、`origin?`（`ai` 只看 AI 添加）、`offset`、`limit`；结果 `{rows, total, remaining}`，每行带 `degree`（`active` 边数）和最近修改时间。
   - `POST /api/knowledge/entities`；`GET/PATCH/DELETE /api/knowledge/entities/:id`。读取返回字段、别名、标签、项目归属，相连边按关系分组并分页（`edgesOffset`、`edgesLimit`），每条边带对端的 `{ref, name, kind}`、`layer`、`origin`、证据，以及来源说明（见第 4 条）。
   - `GET /api/knowledge/entities/merge-preview?into=&from=`（调 `mergePreview`）和 `POST /api/knowledge/entities/merge {into, from[]}`。
   - `POST /api/knowledge/edges`；`PATCH/DELETE /api/knowledge/edges/:id`。
   - `POST /api/knowledge/labels {ref, add?, remove?}`、`POST /api/knowledge/memberships {projectId, ref, remove?}`。
   - `GET /api/knowledge/graph`：参数同 KB-4 的 `kb_graph`，直接调同一个实现，结果也一样轻量。
3. **编辑会话**（新文件 `app/services/knowledge/sessions.js`）：
   - `POST /api/knowledge/session {projectId?}` 开一个 `leave-page` 版本，返回 `{id}`；`POST /api/knowledge/session/:id/close` 关闭（没有修改时不留版本，照 `versions.close` 现有行为）。
   - `POST /api/knowledge/session/:id/undo`、`/redo`：撤销或重做本会话最近一步。一次接口调用算一步（合并一次算一步）。撤销写回这一步改动前的状态，重做再写回改动后的状态，都记进同一个版本（`op` 用 `undo` / `redo`），发 `knowledge.changed`。某条记录在这一步之后被别人（例如 AI 发言）改过，就跳过它并在结果里列出，和整组撤回的规则一样。会话内有新修改时清空重做栈。栈放内存，应用重启后丢失可以接受。
   - 版本摘要按每条记录的净变化计：同一记录在一个版本里改多次算一次，建了又撤销的不计（改 `versions.close` 的计数；KB-4 的 `ai-turn-end` 版本同样受益）。
   - 应用启动时关闭所有还开着的 `leave-page` 版本（上次窗口直接关掉留下的），有修改的照常留版本。
4. **来源说明**：实体和边的读取结果带 `createdBy {participantId, name, meetingId, meetingTitle, turnId, messageId?}`（AI 写的才有；参与者和对话已删除时只给 id）；证据 `chunk:<id>` 解析成 `{sourceId, title, page?, quote}`，`message:<id>` 解析成 `{meetingId, meetingTitle, messageId, excerpt}`，找不到时标 `missing: true`，不报错。
5. **版本与历史**：
   - `GET /api/knowledge/versions`（`projectId?`、`meetingId?`、`turnId?`、分页）、`GET /api/knowledge/versions/:id`（变更明细：每条带 ref、名称、种类、op、改动前后）、`POST /api/knowledge/versions/:id/restore`（结果原样带 `skipped`）。
   - `GET /api/knowledge/history?ref=`（分页）、`POST /api/knowledge/revisions/:id/restore`。
6. **整理状态**：`GET /api/knowledge/jobs` 返回 `jobs.summary()`（汇总和失败列表）；`POST /api/knowledge/jobs {action: 'retry'}` 调 `retryFailed`。`card`、`topic` 两个动作等 KB-6、KB-13 再加。
7. **资料关系数**：`GET /api/research/sources` 每项加 `relations`（`active` 边数，含派生层），给文献表的「关系数」列用。

## 可以改的

`app/server/routes/knowledge.js`（新）及其测试、`app/server/server.js`（注册）、`app/server/routes/research.js`（只加第 7 条）、`app/services/knowledge/`（新增 `sessions.js`，`queries.js` 加列表筛选、来源说明和证据解析）、`app/app.js`（启动时关闭遗留会话的接线）、`docs/product/FEATURES.md`（接口一节）、`docs/log/IMPLEMENTATION_LOG.md`（不超过 5 行）。

## 不做的

- 不改 `app/ui/`。
- 不做 `layout`、`viewport`、`positions`（KB-10a），`gaps`（KB-14），卡片和深挖动作（KB-6、KB-13）。
- 不改 KB-4 的工具行为；`kb_graph` 和接口共用实现，只能抽出函数，不改结果。
- 不加参数上限或权限校验；分页并写明剩余数。
- 不动 `<预览安装目录>` 及其数据。

## 完成标准

- 干净检出 `npm run check` 全部通过（含 Windows 测试）。
- 路由功能测试走一次完整编辑会话：开会话 → 建 2 个实体、1 条带 `chunk:` 证据的边、加 1 个标签和 1 个项目归属 → 改实体名 → 撤销、重做 → 合并（先看 merge-preview 的改挂边数）→ 删 1 条边 → 关会话后只有一个 `leave-page` 版本，摘要数对；整组撤回后回到开会话前的状态。另测：撤回时之后又被 AI 改过的记录出现在 `skipped`；实体读取带 `createdBy` 和解析后的证据，证据指向的段落删掉后是 `missing: true`；启动时遗留的会话被关闭；没有修改的会话关闭后不留版本。
- `FEATURES.md` 列出全部新接口。

## 交付

- 分支：`codex/kb-5-routes-YYYYMMDD`，从 KB-4 分支（或已合并 KB-4 的集成分支）开始，报告里写明基于哪个提交。报告不超过 15 行，给出远程分支与 SHA。不建 PR、不合并。
