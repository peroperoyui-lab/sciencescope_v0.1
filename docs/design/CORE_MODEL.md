# 核心模型（R1 / R2 的依据）

- 起草：Claude，2026-10-05。总纲见 `ARCHITECTURE.md`。本文随实现修订；实现与本文不一致时，以代码和测试为准，并同步本文。
- **R1 已实现（2026-10-05）**：§1–§5、§9 的数据层、事件、工作区、参与者、会议、消息、本地接口与命令行，代码在 `app/core`、`app/server`、`app/main.js`、`app/cli.js`。§6–§8（发言规则的执行、上下文组装、内置工具）在 R2 实现。
- **R2 已实现（2026-10-05）**：运行时接口 `app/runtime/port.js`；DSH 适配 `app/runtime/dsh/`（一个插件 + 桥接服务）；测试用 `app/runtime/scripted.js`；上下文组装 `app/core/context.js`；发言记录 `app/core/turns.js`；内置工具 `app/services/tools.js`；`direct` 发言规则 `app/services/conductor.js` + `turn-runner.js`；服务商 `app/services/providers.js`；整体装配 `app/app.js`。`round`、`autonomous` 与后台参与者在 R4。
- **R3 已实现（2026-10-05）**：界面骨架 `app/ui/`（Preact + htm，无构建步骤；由本地服务直接提供，见 §10）。

## 1. 数据根

```
<数据根>/                          安装版为安装目录下的 data/；开发版为 .sciencescope-local/data/
  sciencescope.sqlite
  settings.json
  agents/<id>.md                   AI 参与者定义
  skills/<name>/SKILL.md           技能
  projects/<slug>-<id>/            项目的文件资源（见 §4）
  library/originals/               资料原件
  runtime/                         运行时工作数据（DSH home）
  models/  python/  secret/  backups/
```

- 数据根由启动参数或环境变量 `SCIENCESCOPE_DATA` 给出；代码不写死路径。
- 测试使用 `.sciencescope-local/temp/<测试名>-<随机>`。

## 2. SQLite 表（R1）

迁移注册表 `app/core/db/migrations/NNN-name.js`：每个文件导出 `up(db)`，按编号执行，版本记在 `PRAGMA user_version`。迁移前用 SQLite backup API 备份到 `backups/`。数据库版本高于程序时拒绝打开。

| 表 | 主要列 | 说明 |
|---|---|---|
| `projects` | id, name, description, dir_name, folder（外部文件夹，可空）, pinned, archived, created_at, updated_at | 项目；文件目录 `projects/<dir_name>/`，`dir_name` = 名称-id，改名时目录一起改名 |
| `participants` | id, kind(`human`/`ai`), name, created_at | 人与 AI 的登记；AI 的定义在 `agents/<id>.md`，名称以文件为准。预置：`person_user`（本地用户）、`agent_main`、`agent_secretary`、`agent_assistant` |
| `meetings` | id, project_id（可空 = 全局）, title, policy_json, parent_meeting_id, fork_message_id, attached_to_meeting_id, work_folder, pinned, archived, temporary, created_at, updated_at | 会议；`policy_json` 是发言规则（§6） |
| `meeting_members` | meeting_id, participant_id, role_note | 谁在场；`role_note` 是在本会议中的说明（如"审核"） |
| `messages` | id, meeting_id, seq, author_id, text, status(`streaming`/`done`/`max_tokens`/`failed`/`cancelled`), turn_id, reply_to, refs_json（标记、附件、引用）, adopted（审核结论是否采纳）, created_at | 会议记录正本；`seq` 在会议内递增 |
| `turns` | id, meeting_id, participant_id, trigger_message_id, status, stop_reason, usage_json, started_at, ended_at | AI 的一次发言 |
| `tool_calls` | id, turn_id, seq, name, args_json, result_json, status, presented（是否展示给用户）, started_at, ended_at | 工具调用，完整保存，不截断 |
| `runtime_sessions` | meeting_id, participant_id, runtime, session_id, last_seq | AI 在某会议中的工作记忆指针；`last_seq` = 它已看到的最后一条消息 |
| `revisions` | id, resource, resource_key（`资源:键`）, op, before_text, after_text, after_hash, actor_id, meeting_id, turn_id, undone_by, created_at | 每次修改保存前后全文；撤销 = 写一条反向修订；程序外的修改记为 `external` |
| `events` | seq, type, project_id, meeting_id, actor_id, payload_json, created_at | 变更流，给界面与后台参与者订阅 |

资料库 `rb_*` 表已在 R4-1a 纳入迁移 `003-research-base.js`（见 §11）；设置不进数据库。

## 3. 事件

- 每次状态变化，在**同一个事务**里写状态表，并追加一条事件。
- 界面通过 `GET /api/events?since=<seq>`（SSE）订阅：先补发 `since` 之后的事件，再实时推送。
- 后台参与者用同样的订阅方式。

| 类型 | payload |
|---|---|
| `project.created/updated/archived` | project |
| `meeting.created/updated` | meeting |
| `message.created` | message |
| `message.delta` | messageId, text（增量；不写数据库，只推送） |
| `message.updated` | message（结束、状态变化、采纳） |
| `turn.started/ended` | turn |
| `tool.started/ended` | toolCall |
| `resource.changed` | resource, resourceId, revisionId |
| `revision.undone` | revisionId |
| `research.changed` | action（source.imported、item.created/updated/superseded）, sourceId 或 itemId；事件上下文带 projectId、actorId |

## 4. 工作区资源

资源注册表 `app/core/workspace/resources/*.js`：每类资源导出 `{ name, read(ctx, id), list(ctx, query), apply(ctx, op) → { before, after } }`。`apply` 由工作区统一包装：写文件或表 → 记修订 → 发事件。

| 资源 | 存放 | 格式 |
|---|---|---|
| `map` | `projects/<p>/workbench/map.json` | `{ nodes, edges }`（沿用旧格式） |
| `plans` | `projects/<p>/workbench/plans.md`；全局计划在 `plans.md` | Markdown 任务列表 |
| `log` | `projects/<p>/workbench/log.md` | Markdown，每条一个二级标题（日期 + 标题） |
| `versions` | `projects/<p>/workbench/versions/<组>/` | 原件 + `.notes.md` |
| `minutes` | `projects/<p>/minutes/<会议 id>.md`；不属于项目的会议在 `minutes/<会议 id>.md` | Markdown；历史版本在 `revisions` |
| `notes` | `projects/<p>/notes/*.md` | Markdown |
| `agent` | `agents/<id>.md` | YAML 头（name、model、effort、tools、skills）+ 正文（人设） |
| `skill` | `skills/<name>/SKILL.md` | 运行时的技能格式 |
| `settings` | `settings.json`（键固定为 `app`） | JSON；读取时与默认值合并；操作 `patch` / `write` |

键：`map`、`log` 为项目 id；`plans` 为项目 id 或 `global`；`minutes` 为会议 id；`notes` 为 `项目 id/名称`；`agent` 为参与者 id。文本资源的操作：`write`、`append`、`replace`（`find` → `with`）、`delete`；导图另有 `addNode`、`updateNode`、`removeNode`（连同子树与相关连线）、`addEdge`、`removeEdge`。撤销时如果之后还有修改，返回 `REVISION_CONFLICT`。

用户在程序外编辑文件：读取时比较修改时间和哈希，变化了就记一条 `actor = external` 的修订并发事件。

## 5. 参与者定义（`agents/<id>.md`）

```markdown
---
name: 统计审稿人
model: { provider: deepseek, model: deepseek-v4.1-flash, effort: high }
skills: [statistics-review]
tools: { prefer: [research_search], avoid: [] }
---
你是……（人设与工作方式）
```

- 内置默认参与者（主专家、秘书、全局助手）只是预置的定义文件，用户和 AI 都可以改。
- 本地用户是 `kind = human` 的参与者，名称来自个人资料。

## 6. 发言规则（`meetings.policy_json`）

| mode | 行为 |
|---|---|
| `direct`（默认） | 人发消息后，被 @ 的参与者回应；没有 @ 时由会议的默认回应者（通常是主专家）回应 |
| `round` | 选定的参与者并行回应同一上下文，按固定顺序展示；可选审核者在全部结束后回应；审核结论在用户采纳（`messages.adopted`）后才进入其他参与者的上下文 |
| `autonomous` | 一位参与者朝目标连续发言，直到完成、失败或被叫停 |

R4-3a 已实现：规则与选择保存在会议中。工作模式 @ 候选为会议 AI 成员及启用的参加专家，独立审核不能被 @；首次发言将职责写入会议成员。每轮按 order 预建回答，再并行运行各自会话，输入固定截止触发用户消息；不同轮排队。审核在所有专家结束后读取署名回答及完成状态，初始 adopted=false，只有 done 可采纳。refs.contextReadBy 记录实际送入后续发言的已采纳审核；已被读取的采纳不能撤回（409）。重试和继续仅运行原作者，停止同时取消当前轮及排队请求，未开始的审核不再启动。

后台参与者不由发言规则驱动，而是订阅事件并按规则触发。R4-4a 的纪要由 `services/secretary/` 小服务执行：一次性运行时会话记录 `agent_secretary` 的 turn、结束原因与用量，不创建主会议消息，也不复用前台秘书会话。文本整理轮次显式选择无工具执行，秘书前台发言仍使用共用工具。

迁移 005 的 `minutes_coverage` 把覆盖序号与已消费消息绑定到文件修订；用户编辑继承覆盖范围，撤销沿修订 ancestry 恢复。覆盖只在完整输出、纪要原子写入成功后推进。过时模型输出用文件队列内的 expectedRevisionId 检查让位于用户或外部编辑；即使文本相同也保存可撤销的新覆盖修订。未完成输出保存在 `minutes_status`，不推进覆盖。

总结订阅消息、前台 turn 结束和 `discussion.finished`，按设置防抖，同会议不重叠，等待前台完成。默认讨论后、20 条消息、30000 估算 token、进入/离开项目、Markdown 导出开启；工作台导图/计划/日志只有 off/apply，默认关闭，修改只追加或标记并写修订及纪要来源。项目切换由 focus 接口通知，关闭时 `secretary_pending_projects` 持久保留未整理项目，下次启动再补。外部 Markdown 是只写副本，错误在状态中可见。已知模型窗口时按 token 估算选择完整消息批次（含旧纪要、提示与模型输出预留），逐批提交；无窗口元数据时发送完整原文，服务商拒绝则明确保留待处理状态。已有纪要或单条完整消息无法装入窗口时不截断、不推进覆盖。

### R4-4b 秘书会话

秘书是普通参与者，第一次打开时建立 user + agent_secretary 的附属会议；迁移 006 的 secretary_chats 唯一绑定主会议与附属会议。消息与运行时游标分别保存。共同 runner 在每轮前通过注入的 followup 装配最新主会议纪要与上次成功跟进后原文，丢失会话则重新提供纪要及全部尾部；消息高水位在等待总结前冻结，之后的新消息留给下一轮。大积压按模型窗口估算触发纪要更新，最多等待 60 秒，超时仍保留全部可用原文，停止会立即取消等待。仅 done 才提交 secretary_cursors，失败、停止、输出未完成不推进。

propose_main_draft 属于共享工具，只保存 main_draft_proposals 卡片，不发主会议消息。用户编辑并填入主输入框后仍需亲自发送；修改与决策写 main_draft_proposal_history，可撤销，重启保留。会议 policy.model 保存局部模型/推理选择，优先于角色定义，未选择则使用秘书定义、所属主会议模型与应用默认值；明确换模型不更换对话历史。

## 7. 上下文组装（`app/core/context.js`）

参与者 P 在会议 M 中发言时：

1. **系统部分**：P 的定义正文 + 会议说明（在场者与各自身份、P 自己是谁）+ 工作区简介（项目、可用工具的使用说明）。
2. **历史部分**：
   - 如果 P 在 M 中有可用的运行时会话：只发送 `last_seq` 之后其他参与者的新消息（标明发言人），加上触发消息；本轮固定截止触发消息，游标记录实际读到的位置。同轮同行回答下轮补读，之后才采纳的旧审核按每位参与者的读取记录补入；
   - 否则重建：M 的最新纪要 + 纪要覆盖序号之后的全部消息原文（标明发言人），以及尚未被该纪要消费、后来才采纳的旧审核。纪要文本和修订来自同一文件队列读；若最新纪要已经涵盖排队请求之后的消息，改用该请求截止前的完整原文，不泄露未来问题。
3. **可见性**：
   - 其他参与者看到的是回答的最终文字，以及该回答展示的文件；
   - 看不到工具调用、工具结果和前言；
   - 未采纳的审核结论不进入其他参与者的上下文。
4. **不截断**。超出模型上下文窗口时，先换用更新的纪要；仍然超出，就在开头写明省略了哪些消息，并说明可以用 `workspace_read` 回查（R4 实现；R2 尚未做窗口估算）。
5. **工具前言**：同一步里写在工具调用之前的文字，记在该工具调用的 `preamble` 上，不进入回答正文。
6. **闲置释放**：一个会话闲置 10 分钟后结束其进程，下次发言时按会话 id 恢复（DSH 持久化了工作记忆）。

## 8. 内置工具（R2）

| 工具 | 参数 | 作用 |
|---|---|---|
| `workspace_read` | `resource`, `id?`, `query?` | 读或列出任意资源；包括会议与消息（可跨会议、跨项目） |
| `workspace_edit` | `resource`, `op`, `args` | 修改资源，记修订，返回修订 id |
| `workspace_undo` | `revisionId` | 撤销一条修订 |

`workspace_read` 的 `target` 另有 `overview`（全部项目与会议）、`project`、`meeting`（分页读记录）、`changes`（更改记录）。
| `research_search` / `research_read` | 见 §11 | R4-1a 已实现；所有角色共用，资料库写入工具属后续任务 |

运行时自带的文件、命令、present、技能、MCP 工具原样提供。

## 9. 本地接口（`app/server`）

- JSON 接口（R1 已实现）：
  - `GET/POST /api/projects`、`GET/PATCH /api/projects/:id`
  - `GET/POST /api/participants`、`GET/PATCH /api/participants/:id`
  - `GET/POST /api/meetings`（`?projectId=`、`?global=1`、`?attachedTo=`）、`GET/PATCH /api/meetings/:id`、`POST /api/meetings/:id/fork`
  - `GET /api/meetings/:id/messages`（`before` / `after` / `limit`）、`POST /api/meetings/:id/messages`（R2 起按发言规则触发回应）、`PATCH /api/messages/:id`（审核采纳）
  - `GET /api/resources`、`GET /api/resources/:resource?key=`、`GET /api/resources/:resource/keys?scope=`、`POST /api/resources/:resource`（`{ key, op, args }`）
  - `GET /api/revisions`、`GET /api/revisions/:id`、`POST /api/revisions/:id/undo`
  - `GET/PATCH /api/settings`
- 错误统一为 `{ code, message }` 加对应状态码。
- 启动：`node app/main.js [--data <目录>] [--port <端口>]`，标准输出一行 `{ url, token, dataRoot }`。数据根：`--data`，其次 `SCIENCESCOPE_DATA`，开发默认 `.sciencescope-local/data`。
- 命令行：`node app/cli.js <命令>`（projects、project-create、meetings、meeting-create、post、messages、read、edit、history、undo）。
- 事件：`GET /api/events?since=<seq>`（SSE；浏览器的 EventSource 用 `?token=` 传口令）。
- R2 新增：`POST /api/meetings/:id/interrupt`、`GET /api/turns/:id`（含工具调用）、`POST /api/providers/keys/:keyRef`（只写入凭据文件，不返回）。服务商与默认模型在 `/api/settings` 的 `providers`、`models.default` 中。
- R4-4b 新增：GET/POST `/api/meetings/:id/secretary`、GET `/api/meetings/:id/secretary/proposals`、PATCH `/api/secretary/proposals/:id`；提案 history 与 proposal-revisions/:id/undo 提供更改记录/撤销。附属会议发送、停止、重试/继续共用会议接口。
- R4-4a 新增：GET/POST `/api/meetings/:id/minutes`（编辑携带 expectedRevision）、POST `/api/meetings/:id/minutes/refresh`、POST `/api/projects/:id/focus`（focused）；状态含覆盖、距阈值剩余量、导出/工作台错误和未完成输出。
- R4-3a 新增：`POST /api/messages/:id/continue`（定向原作者，不发用户消息）、`GET /api/meetings/:id/contexts`（每位参与者最新 turn 的 context，用于上下文环）；审核消息额外返回 `adoptionLocked`，基于已存的读取记录。
- 本地口令：每次启动生成，所有接口校验（沿用旧版做法）。
- 路由文件只做参数解析与调用 core / services，每个领域一个文件。
- R3 新增：`GET /api/events/head`（`{ seq }`，界面加载完现状后从这里开始订阅）。`/api/` 以外的 GET 返回界面静态文件，不需要口令。

## 10. 界面（`app/ui`，R3）

- **原则：界面沿用旧主界面的设计，一比一复刻**（2026-10-05 用户确认）。组件输出与旧界面相同的 DOM 结构和类名，样式直接使用旧界面的样式表：`styles/legacy/` 依次为已批准原型（`prototype.css`，取自 `ScienceScope.html`）和旧桌面的 `chat`、`workspace`、`workbench`、`desktop-behavior`、`refresh`，加载顺序与旧界面相同；`styles/app.css` 只放新界面需要的少量补充。图标路径取自原型的 `iconPaths`。重构的重点在后端，界面不另行设计。
- 入口：`node app/main.js` 输出的 `ui` 地址（`<url>/?token=<口令>`）；口令随后存入会话存储并从地址栏去掉。原生外壳打开同一地址。
- 依赖：`preact`、`htm`、`marked`、`dompurify` 与思源黑体字体，由 `app/server/static.js` 从 `node_modules` 提供，页面用 import map 引用；不打包、不复制到仓库。
- 结构：`api.js`（请求与事件流）→ `state.js`（一个状态对象；`applyEvent` 按 id 合并事件，重放无害；`overlay` 放菜单、对话框、提示与搜索面板）→ `actions.js`（用户操作）→ `components/`。组件只读状态、调用 actions，不互相包裹或覆盖。
- 路由在地址的 hash：`#/`（新对话欢迎页，发出第一条消息才建会议）、`#/new/<projectId>`（项目内新对话）、`#/meeting/<id>`、`#/workbench/<projectId>`、`#/all`（浏览全部）。
- 文字：组件里写中文，`i18n/en.js` 给出英文；测试检查每个中文字符串都有英文条目。语言存于 `settings.appearance.language`，在"视图"菜单切换。
- 已复原的入口与待复原的 R4 队列：`design/UI_RESTORE.md`。
- 后端补充：`GET /api/search?q=`（消息全文）；`GET/POST /api/projects/:id/files`（列表；mkdir、rename、add、open）与 `GET /api/projects/:id/export`（zip）；`GET /api/meetings/:id/export`（Markdown）；`POST /api/messages/:id/retry`；`GET /api/system`、`POST /api/system/open`；`GET /api/providers/keys`（只有名称）、`POST /api/providers/discover`；`GET /api/events/head`。设置新增 `sites`、`shortcuts`、`appearance`（theme、density、font、codeFontSize、chatFontSize、reduceMotion、scrollbars、transcript）；服务商模型可写 `contextWindow`、`maxTokens`、`efforts`。AI 定义文件新增 `role`、`panel`（expert / reviewer）、`enabled`、`position`，默认专家名册随首次启动创建。DSH 回合结束时报告上下文占用（`usage.context`），供输入框的上下文环。

## 11. 研究资料库（R4-1a，2026-10-06）

`app/services/research/` 通过 core 注入的共享 `db`、`events`、`paths` 工作。迁移 003 建立 `rb_sources`、`rb_chunks`、`rb_items`、`rb_revisions`、`rb_fts`；旧数据库先备份再升级。原件独立保存在 `<数据根>/library/originals/<uuid>.<扩展名>`，数据库只记相对路径，解析段落与 FTS 是派生数据。

- 导入 PDF、DOCX、Markdown、LaTeX、纯文本；保留全文，不设文件长度截断。分段沿用 1200 字目标与长段 2400 字分片，不跨页/章节合并。PDF 保留栏顺序、公式、参考文献与页码坐标；DOCX 有显式分页时提供页码，无可靠分页时返回 `null`。扫描件不做 OCR，原件仍保留并返回解析状态。
- 来源按项目或个人范围编号 `S1…`；段落返回 `[S3 p.4]`，未知页码只有 `[S3]`。兼容复合、中文及全角引用，未知格式连同原文记录。不同范围可能有相同编号，工具结果同时给出 `sourceId` 和 `projectId`，后续读取应使用来源 id 或明确范围。
- 条目保存类型、正文、结构化 payload、origin、visibility 与版本。更新把旧快照写入 `rb_revisions`；取代保留旧行、结束有效期并链接新条目。默认只检索 active，显式 `includeSuperseded` 可查看历史；私有条目不进入 AI 检索或读取候选。
- `research_search({query,projectId?,includePersonal?,includeSuperseded?,limit?,offset?})` 使用 SQLite FTS5 关键词排序，中文使用重叠双字；默认当前会议项目加个人范围。返回全文命中、引用、total/remaining，不做语义检索。
- `research_read({type?,id?,label?,projectId?,offset?,limit?,includeSuperseded?})` 读取 source/chunk/item；source 支持页码引用与段落分页，返回 total/remaining。所有 AI 角色共用两个工具。
- HTTP：`GET /api/research/sources?projectId=`；`POST /api/research/sources`（name、base64、projectId 等）；`GET /api/research/sources/:id`（limit/offset）；`GET /api/research/search?q=&projectId=`；`GET/POST/PATCH /api/research/items`；`GET/PATCH /api/research/items/:id`（详情含旧版本）。修改可带 expectedRevision；POST 带 supersedes 实施取代。
- 导入完成（包括解析失败状态）及条目增改/取代与 `research.changed` 在同一数据库事务提交后送达。资料库界面、向量检索、记忆整理均属后续任务。
- Windows `npm run check` 50/50、零跳过；包含真实 PDF/DOCX 功能测试、脚本化会议引用、修订/取代保留、v2 数据备份升级与既有三项 Edge 测试。付费请求为 0。

### R4-1b 界面与混合检索（2026-10-06）

- 新界面路由 `#/database/<projectId>`、`#/library`、`#/sources` 对应项目材料、个人资料、外部站点；旧资料库样式表与列/卡片沿用。文献分页每页50条，段落详情每页20段且可定位搜索命中；知识、模型、主张支持编辑/取代/历史/置顶/归档，memory/inbox/brief与文件预览/附件留在后续任务。
- 来源接口新增 PATCH（title/kind/metadata 合并且索引同步）、POST reparse/open。GET sources支持kind/readStatus/tag/sort/direction；默认返回数组，带page/pageSize返回 `{sources,total,page,pageSize,remaining}`。GET chunks/:id返回段落与来源；条目筛选支持type/subtype/status/pinned，置顶存payload.pinned。
- 导入上传不设单文件长度限制；仅资料导入路径豁免现有通用JSON请求边界。重新解析复用原件及来源id，用户元数据保留。
- 迁移004创建 `rb_vec_docs` 与sqlite-vec `rb_vec`（384维）；同一个core数据库连接，数据库构造允许扩展加载，迁移和向量服务仅在加载sqlite-vec时启用。来源/条目/原件为正本，向量删除后可重建。
- `createApp` 装配一个 `createSemantic` 实例，传入 research、HTTP 和工具。`research_search` 与HTTP均异步共用混合检索：本地向量与关键词加权RRF融合，返回mode。关闭、模型缺失、索引不完整/版本不同或向量阶段300ms超时整次退回关键词；分页排序稳定。
- `settings.semantic.enabled` 默认false；本地模型位于 `<数据根>/models/multilingual-e5-small/`。清单沿用 `models/default-embedding.json` 的固定revision、SHA256与int8模型；用户点击下载，公开模型文件可从官方源/镜像获取，推理只访问本机文件。硬件要求AVX2、8GB内存、5GB可用空间。单工作线程处理query:/passage:前缀、模型512-token窗口、均值池化/L2归一化，不截断资料原文。
- GET `/api/research/semantic/status`，POST download/rebuild。`research.semantic.changed` 为瞬态完整状态，UI直接消费，不每秒请求进度。宿主就绪不等待预热；turn.started/ended暂停恢复批次索引，close终止工作线程再关闭数据库。
- Windows手动设置下载五文件校验、9/9索引、中文路径、重启与真实混合搜索/段落读取通过。自动测试只用假嵌入；付费模型0请求/0token。
