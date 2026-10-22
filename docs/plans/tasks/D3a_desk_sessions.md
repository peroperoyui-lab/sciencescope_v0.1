# D3a 编辑台会话服务（docx）

- 起草：Claude，2026-10-22。依据：`architecture/EDITING_DESK.md` §3.2「同步」、§3.5、§4.1–4.2、§8、§10 D3；D1 的版本图（迁移 024 已建 `desk_sessions`、`desk_changes`）；D2 的 `desk/docx/` 读写（`readDocx`、`writeDocx`）。D3 拆成两步：D3a 做 docx 会话，D3b 做 tex 和 md、文件列表、进入编辑台和图片。
- 执行：Sol（Windows）；审阅：Claude。约 2 小时，一步交付；超出就停下汇报。

## 目标

后端能打开一份 docx 文稿编辑：登记项目文件、开会话、按块收修改、记修改记录、逐处撤回、写工作副本、写回项目文件、关闭时生成版本，项目文件在外面被改过时不悄悄覆盖。界面（U1、U2）之后直接接这些接口。

## 用户会怎么用

本任务没有界面，它支撑这些操作：

- 用户第一次打开项目文件夹里的 `thesis.docx`：它被登记成一个版本组，复制成 v1，编辑台开一个会话，显示全部段落。
- 用户改了几句、拆了一段、删了一段，每处都是一条修改记录；撤回其中一处，其余不变。应用崩溃后重开，最多丢最后 2 秒的输入。
- 用户按 Ctrl+S，`thesis.docx` 被改写，Word 打开正常；离开编辑台时生成 v2，父版本是 v1。
- 用户关掉编辑台，在 Word 里改了 `thesis.docx` 再回来：应用把外面这一版导入成新版本再打开，不覆盖。

## 要做的

1. **登记文件**（`app/services/desk/index.js`，新）：`registerDocument({ projectId, path })`，`path` 是项目文件夹内的相对路径（用 `project-files.js` 的路径检查，不能出项目文件夹），只接受 `.docx`（`.tex` 留给 D3b）。同一 `source_path` 已有组就返回它；没有就走现有导入（`importFiles`）建组和 v1（`origin='import'`、`format='docx'`、记 `content_hash`），再记上 `source_path`。
2. **开会话** `openSession({ groupId, versionId?, meetingId? })`：默认从组里最新版本开；同一组已有 `open` 的会话就返回它（不开第二个）。打开前做外部修改检查（第 7 条）。把版本原件复制成工作副本 `data/projects/<目录>/desk/<会话 id>/<原文件名>`，`readDocx` 后返回 `{ session, blocks, changes }`：`blocks` 每项是 `{ id, kind, style, level, inlines, text }`（照 §3.2，`opaque` 块也返回，只读）；`changes` 是本会话未撤回、未保留的修改记录。会话在内存里持有块列表和 `seq`；进程重启后再打开同一会话时从工作副本重新读入，`seq` 取表里的值。
3. **收修改** `updateBlocks(sessionId, { baseSeq, blocks, inserted, removed }, actor)`：`blocks` 是 `{ id: inlines }`，`inserted`、`removed` 照 D2b 的 `writeDocx` 约定。
   - 冲突按块判断：`baseSeq` 落后时，只要这次动到的块在 `baseSeq` 之后没被别人改过就照常接受；否则整次拒绝，返回 `DESK_CONFLICT` 和这些块的当前内容。
   - 新段落的 id 在这一步就定下：会话分配包内唯一的 paraId（给 `writeDocx` 的 `inserted` 项加可选 `paraId`，有就用它），返回 `{ seq, inserted: { 客户端 id: 'p:<paraId>' } }`，之后都用新 id。
   - 每个块一条 `desk_changes`：`op` 为 `edit`、`insert-block`、`remove-block`，`before_json`、`after_json` 存块的 `inlines`（`remove-block` 的 `before_json` 另存它前一个块的 id，撤回时放回原处；`insert-block` 存 `after` 和 `like`）。记 `actor_id`；AI 的修改另记 `meeting_id`、`turn_id`、`instruction`（D5 用，这次接口先收下）。`seq` 加一，发事件 `desk.changed { sessionId, seq, blockIds, changeIds }`。
   - 写回器报错（`DOCX_SECTION_BREAK`、`DOCX_LAST_CELL_PARAGRAPH`、`DOCX_DUPLICATE_ATOM`、`DOCX_OPAQUE_BLOCK` 等）时整次不生效，`seq` 不变。
4. **工作副本**：修改先在内存里生效；空闲 2 秒后用 `writeDocx` 把累积的修改写进工作副本文件（一次写回，不逐条写）。保存、关闭、进程正常退出前先把没写的写掉。写入用临时文件加改名，写到一半断电时旧的工作副本还在。
5. **撤回与保留** `undoChange(changeId, actor)`、`settleChanges(sessionId, ids?)`：撤回的条件同工作区撤销：块的当前内容等于这条记录的 `after` 才能撤回，否则返回 `DESK_UNDO_BLOCKED`，提示先撤回之后的修改。撤回本身也是一条修改记录，原记录填 `undone_by`。`insert-block` 撤回就是删掉那段，`remove-block` 撤回就是放回原处。`settle` 只把 `settled` 设为 1，不改正文；不传 `ids` 时保留本会话全部。
6. **保存** `save(sessionId, { to: 'project' | 'version', label?, tier? }, actor)`：
   - `to: 'project'`：先做外部修改检查，再把工作副本写回项目文件（临时文件加改名），`saved_seq = seq`。项目文件对应的版本不是会话的基础版本时（从旧版本打开的），接口要求带 `confirm: true`，否则返回 `DESK_SAVE_CONFIRM` 和项目文件当前对应的版本号，由界面问用户。不过批准流程（那是 D5 的 AI 工具 `save {to:"project"}` 的事）。
   - `to: 'version'`：用工作副本 `createVersion`（父版本是会话的 `base_version_id`，`origin='desk'`，`session_id`，可带 `label`、`tier`），本会话到此为止的修改记录填上 `version_id`；之后会话的 `base_version_id` 改成这个新版本。
7. **外部修改**：打开和写回项目文件前，比较项目文件的 SHA-256 与组里最新版本的 `content_hash`。不同就先把项目文件导入成新版本（`origin='external'`，父版本是组里最新版本）。打开时没有未写回的修改就直接从新版本开；有未写回的修改时不覆盖，返回 `DESK_EXTERNAL_CHANGE` 和新版本 id，由界面让用户选「以外部版本为准重新打开」（关闭当前会话并丢弃，再开）或「保留我的修改另存为分支」（`save {to:'version'}`，自然成为分支）。项目文件被删了也返回可读错误，工作副本不动。
8. **关闭** `closeSession(sessionId, actor)`：先写掉工作副本；工作副本哈希和基础版本不同就生成版本（同第 6 条 `to: 'version'`，`result_version_id` 填它）；`status='closed'`、`closed_at`，删除工作副本目录，发 `desk.session { sessionId, state: 'closed' }`。工作副本没变时只关闭，不生成版本。关闭不写回项目文件。
9. **接口**（新文件 `app/server/routes/desk.js`，都要口令）：`POST /api/desk/documents`（第 1 条）、`POST /api/desk/sessions`（第 2 条）、`GET /api/desk/sessions/:id`（重连）、`PATCH /api/desk/sessions/:id/blocks`、`POST /api/desk/changes/:id/undo`、`POST /api/desk/sessions/:id/settle`、`POST /api/desk/sessions/:id/save`、`POST /api/desk/sessions/:id/close`。错误都是可读的 `AppError`（中文消息），冲突用 409。
10. **测试**（合成 docx 用代码生成，可复用 `desk/docx` 测试里的样例写法）：登记同一文件两次只有一个组；打开 → 改一段 → 拆一段 → 删一段 → 撤回删段（段落回到原处）→ 保留 → 存版本 → 关闭，版本图里父子正确；`baseSeq` 落后但改的是别的块时接受，改同一块时 `DESK_CONFLICT`；撤回顺序不对时 `DESK_UNDO_BLOCKED`；写回器报错时 `seq` 和工作副本都不变；空闲后工作副本写入一次（测试里把 2 秒做成可注入的定时）；重启（重新 `createApp` 同一数据目录）后打开同一会话内容一致；外部修改：没有未写回修改时导入并从新版本开，有时返回 `DESK_EXTERNAL_CHANGE`；写回项目文件后 Word 结构合法（用 `readDocx` 再读一次，块文字一致）。

## 可以改的

新增 `app/services/desk/index.js`（可再拆文件）、`app/server/routes/desk.js` 及测试；`app/services/desk/docx/write.js`（只加 `inserted[].paraId`）；`app/app.js`、`app/server/` 的路由登记；`app/services/versions/` 里为 `origin='desk'|'external'` 和 `session_id` 需要的最小改动；`docs/architecture/EDITING_DESK.md`（§3.5、§4.2、§8 按实际行为改）、`docs/product/FEATURES.md`、`docs/log/IMPLEMENTATION_LOG.md`（不超过 5 行）。

## 不做的

- 不改 `app/ui/`（U1、U2 由 Claude 做），不加 `features.editingDesk` 开关。
- 不做 tex、md、文件列表、`/api/desk/enter`、图片字节（D3b），不做批注接口、来源绑定（D6），不做 AI 工具和划选改写（D5），不做比较（D4）。
- 不动 `<预览安装目录>` 及其数据，不把稿件、截图提交进仓库。

## 完成标准

- 干净检出 `npm run check` 全部通过（含 Windows 测试）。
- 第 10 条的测试都在。
- 用 D2b 验收过的英文期刊稿和学位论文各走一遍：登记 → 改一句、拆一段、删一段 → 撤回一处 → 写回项目文件 → 关闭生成版本；Word 打开写回的文件无修复提示；记录学位论文打开会话、一次 `updateBlocks`、空闲写工作副本、写回项目文件各自的耗时。稿件只放 `.sciencescope-local/temp/desk-d3/`。

## 交付

- 分支：`codex/d3a-desk-sessions-YYYYMMDD`，从 `main` 最新提交开始。报告不超过 15 行，给出远程分支与 SHA、两份稿件的结论和学位论文的四项耗时。不建 PR、不合并。
