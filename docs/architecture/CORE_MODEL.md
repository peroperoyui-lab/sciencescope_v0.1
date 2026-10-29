# 核心模型（R1 / R2 的依据）

- 起草：Claude，2026-10-05。总纲见 `ARCHITECTURE.md`。本文随实现修订；实现与本文不一致时，以代码和测试为准，并同步本文。
- **R1 已实现（2026-10-05）**：§1–§5、§9 的数据层、事件、工作区、参与者、会议、消息、本地接口与命令行，代码在 `app/core`、`app/server`、`app/main.js`、`app/cli.js`。§6–§8（发言规则的执行、上下文组装、内置工具）在 R2 实现。
- **R2 已实现（2026-10-05）**：运行时接口 `app/runtime/port.js`；DSH 适配 `app/runtime/dsh/`（一个插件 + 桥接服务；P1 起换成 pi-ai，代码在 `app/runtime/pi/`，DSH 已在 R5 删除）；测试用 `app/runtime/scripted.js`；上下文组装 `app/core/context.js`；发言记录 `app/core/turns.js`；内置工具 `app/services/tools.js`；`direct` 发言规则 `app/services/conductor.js` + `turn-runner.js`；服务商 `app/services/providers.js`；整体装配 `app/app.js`。`round`、`autonomous` 与后台参与者在 R4。
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

| 表                            | 主要列                                                                                                                                                                                        | 说明                                                                                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projects`                    | id, name, description, dir_name, folder（外部文件夹，可空）, pinned, archived, created_at, updated_at                                                                                         | 项目；文件目录 `projects/<dir_name>/`，`dir_name` = 名称-id，改名时目录一起改名                                                                   |
| `participants`                | id, kind(`human`/`ai`), name, created_at                                                                                                                                                      | 人与 AI 的登记；AI 的定义在 `agents/<id>.md`，名称以文件为准。预置：`person_user`（本地用户）、`agent_main`、`agent_secretary`、`agent_assistant` |
| `meetings`                    | id, project_id（可空 = 全局）, title, policy_json, parent_meeting_id, fork_message_id, attached_to_meeting_id, work_folder, pinned, archived, temporary, created_at, updated_at               | 会议；`policy_json` 是发言规则（§6）                                                                                                              |
| `meeting_members`             | meeting_id, participant_id, role_note                                                                                                                                                         | 谁在场；`role_note` 是在本会议中的说明（如"审核"）                                                                                                |
| `messages`                    | id, meeting_id, seq, author_id, text, status(`streaming`/`done`/`max_tokens`/`failed`/`cancelled`), turn_id, reply_to, refs_json（标记、附件、引用）, adopted（审核结论是否采纳）, created_at | 会议记录正本；`seq` 在会议内递增                                                                                                                  |
| `turns`                       | id, meeting_id, participant_id, trigger_message_id, status, stop_reason, usage_json, started_at, ended_at                                                                                     | AI 的一次发言                                                                                                                                     |
| `tool_calls`                  | id, turn_id, seq, name, args_json, result_json, status, presented（是否展示给用户）, started_at, ended_at                                                                                     | 工具调用，完整保存，不截断                                                                                                                        |
| `runtime_sessions`            | meeting_id, participant_id, runtime, session_id, last_seq                                                                                                                                     | AI 在某会议中的工作记忆指针；`last_seq` = 它已看到的最后一条消息                                                                                  |
| `revisions`                   | id, resource, resource_key（`资源:键`）, op, before_text, after_text, after_hash, actor_id, meeting_id, turn_id, undone_by, created_at                                                        | 每次修改保存前后全文；撤销 = 写一条反向修订；程序外的修改记为 `external`                                                                          |
| `resource_snapshots`          | id, resource, resource_key, content_text/hash, actor_id, source, revision_id, created_at                                                                                                      | 编辑边界的可恢复内容快照；revisions 继续存内部细粒度历史                                                                                          |
| `kb_entities`                 | id, kind, name/name_en, aliases_json, description, attrs_json, layer, origin, created_by, meeting_id/turn_id, visibility, status, merged_into, revision                                       | 全局实体正本；项目视图通过归属关联                                                                                                                |
| `kb_edges`                    | id, from_ref/to_ref, relation, attrs_json/evidence_json, layer/origin, created_by, meeting_id/turn_id, status, revision                                                                       | 四种节点引用；派生层按端点与关系覆盖，不留版本                                                                                                    |
| `kb_labels`、`kb_memberships` | ref + label / project_id, created_by / added_by, created_at                                                                                                                                   | 标签和项目归属，来源通过修订和版本回溯                                                                                                            |
| `kb_versions`                 | source, project_id, actor_id, meeting_id/turn_id, summary_json, restored_by, closed_at                                                                                                        | 一组修改；ai-turn-end / leave-page / build / before-restore                                                                                       |
| `kb_revisions`                | version_id, ref, op, before_json/after_json, actor_id, origin, created_at                                                                                                                     | 图的独立修订；origin 同时标记标签/归属修改来源                                                                                                    |
| `kb_jobs`                     | source_id, layer, topic, state, content_version, error, attempts                                                                                                                              | 后续整理服务的持久任务状态；本任务仅建表                                                                                                          |
| `events`                      | seq, type, project_id, meeting_id, actor_id, payload_json, created_at                                                                                                                         | 变更流，给界面与后台参与者订阅                                                                                                                    |

资料库 `rb_*` 表已在 R4-1a 纳入迁移 `003-research-base.js`（见 §11）；设置不进数据库。

知识库存储迁移为 022（021 是 A2-2 删除自动化）。rb_sources 新增 folder_path 与项目/路径唯一索引。
服务 app.knowledge 提供 create/update/removeEntity、mergePreview/mergeEntities、create/update/removeEdge、label、membership、getEntity(ref)、listEntities、neighbors(ref)；页返回 rows/total/offset/limit/remaining。
versions 提供 open/close/closeTurn、list/get/changes/history、restore(versionId)、restoreRevision(revisionId)；restore 返回 version/skipped/refs，记录使用 camelCase 字段和已解码 JSON。
写入 actor 可传 origin、actorId、projectId、meetingId、turnId、versionId；AI 首次写入按 turnId 自动开版本，所有修订独立于 workspace.revisions。标签引用为 label:<ref>#<编码标签>，归属为 membership:<project>#<ref>。

## 3. 事件

- 每次状态变化，在**同一个事务**里写状态表，并追加一条事件。
- 界面通过 `GET /api/events?since=<seq>`（SSE）订阅：先补发 `since` 之后的事件，再实时推送。
- 后台参与者用同样的订阅方式。

| 类型                               | payload                                                                                                         |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `project.created/updated/archived` | project                                                                                                         |
| `meeting.created/updated`          | meeting                                                                                                         |
| `message.created`                  | message                                                                                                         |
| `message.delta`                    | messageId, text（增量；不写数据库，只推送）                                                                     |
| `message.updated`                  | message（结束、状态变化、采纳）                                                                                 |
| `turn.started/ended`               | turn                                                                                                            |
| `tool.started/ended`               | toolCall                                                                                                        |
| `resource.changed`                 | resource, resourceId, revisionId                                                                                |
| `revision.undone`                  | revisionId                                                                                                      |
| `knowledge.changed`                | refs（受影响引用列表），事务提交后通知；同时发 research.changed action=knowledge.changed                        |
| `research.changed`                 | action（source.imported、item.created/updated/superseded）, sourceId 或 itemId；事件上下文带 projectId、actorId |

## 4. 工作区资源

资源注册表 `app/core/workspace/resources/*.js`：每类资源导出 `{ name, read(ctx, id), list(ctx, query), apply(ctx, op) → { before, after } }`。`apply` 由工作区统一包装：写文件或表 → 记修订 → 发事件。

| 资源       | 存放                                                                           | 格式                                                                |
| ---------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `map`      | `projects/<p>/workbench/map.json`                                              | `{ nodes, edges }`（沿用旧格式）                                    |
| `plans`    | `projects/<p>/workbench/plans.md`；全局计划在 `plans.md`                       | Markdown 任务列表                                                   |
| `log`      | `projects/<p>/workbench/log.md`                                                | Markdown，每条一个二级标题（日期 + 标题）                           |
| `versions` | `projects/<p>/versions/<组 id>/v<号>-<版本 id>/`                               | 原件 + `<原件名>.notes.md`；读取原文由解析器分页，编辑只修改说明    |
| `minutes`  | `projects/<p>/minutes/<会议 id>.md`；不属于项目的会议在 `minutes/<会议 id>.md` | Markdown；历史版本在 `resource_snapshots`，细粒度修订在 `revisions` |
| `notes`    | `projects/<p>/notes/*.md`                                                      | Markdown                                                            |
| `agent`    | `agents/<id>.md`                                                               | YAML 头（name、model、effort、tools、skills）+ 正文（人设）         |
| `skill`    | `skills/<name>/SKILL.md`                                                       | 运行时的技能格式                                                    |
| `settings` | `settings.json`（键固定为 `app`）                                              | JSON；读取时与默认值合并；操作 `patch` / `write`                    |

键：`map`、`log` 为项目 id；`plans` 为项目 id 或 `global`；`minutes` 为会议 id；`notes` 为 `项目 id/名称`；`agent` 为参与者 id。文本资源的操作：`write`、`append`、`replace`（`find` → `with`）、`delete`；导图另有 `addNode`、`updateNode`、`removeNode`（连同子树与相关连线）、`addEdge`、`removeEdge`。撤销时如果之后还有修改，返回 `REVISION_CONFLICT`。

用户在程序外编辑文件：读取时比较修改时间和哈希，变化了就记一条 `actor = external` 的修订并发事件。

## 4a. 引用（R4-7，schema 1）

结构定义在 `app/core/references.js`：`{ schema: 1, kind, id?, projectId?, path?, sourceId?, meetingId?, location?, label? }`。
`location` 可含 `page`、`paragraph`、`characters: {start,end}`、`lines: {start,end}` 和 `quote: {exact,prefix?,suffix?}`。
页、段落和行从 1 起算，字符从 0 起算、右端不包含；未知页码不填，不猜测。`label` 仅用于显示，不作身份。

| kind                      | 稳定目标                                                                |
| ------------------------- | ----------------------------------------------------------------------- |
| `version`                 | 版本 id + projectId；可带页、段落、字符范围                             |
| `project-file` / `script` | projectId + 相对路径；可带行、字符范围；script 是项目代码文件           |
| `source` / `chunk`        | 来源 id，或段落 id + sourceId；可带页、引用原文；原件与来源记录仍是正本 |
| `item`                    | 资料库条目 id                                                           |
| `message`                 | 消息 id + meetingId                                                     |
| `map-node`                | 节点 id + projectId；用于版本说明关联导图节点                           |

版本说明的关联链接和日志关联文件使用此对象。后续写作工作台直接复用，不增加存储框架。
R4-2 标记不改存储：`target.kind/id/projectId/path` 对应上述目标；消息标记的 `messageId/meetingId` 对应 message；
其 location.page/paragraph 对应同名字段，line 对应 lines.start；offset 对应 characters.start，characters.end 为 offset 加标记原文长度；
R4-2 的 offset 来自渲染文字，故填 textBasis=rendered（解析段落默认 parsed），description 保留，原文进 quote.exact，不在另一投影里猜字符位置；
标记备注和 selectionId 是批注与草稿身份，不属于引用对象，仍与转换后的引用并列保存，所以转换无信息损失。

R4-7a：迁移015的version_groups／manuscript_versions只存组、编号、相对原件路径、导入者、基线与说明状态。
`workspace_read target=versions,scope=<项目>`列组；`key=<项目>/<版本>,offset/limit`按解析段落读完整原文与说明。
`workspace_edit resource=versions`只编辑同目录notes Markdown，经既有revisions和resource_snapshots留历史。
导入按用户顺序分配递增编号，回收站删除不复用编号；版本路径在应用内部项目目录，不随外部工作目录绑定变化。
GET /api/versions、POST /api/versions/import、GET/DELETE /api/versions/:id、POST /:id/open、PATCH /api/version-groups/:id；
元数据变化和versions.changed同事务保存，原件支持默认程序／文件夹打开及R4-2预览，解析失败仍可打开原件。

R4-7b：迁移016保存项目自动整理设置、说明关联引用、生成发言，以及每项目秘书后台会议身份。
导入事件按项目顺序触发R4-4后台入口；主专家消息和游标不变。完整词级提取差异、纪要、计划、导图和可编辑模板交给秘书，长原文通过共用workspace_read分页回查。
秘书生成说明以agent_secretary写入原有versions资源并保存历史快照；保存前检查说明修订与基线，用户并发修改胜出。中断状态重启后显示失败、手动重试，不静默改写。
说明使用schema1引用对象；P14支持原件／MD打开、补充及全文编辑、历史恢复、换基线重新整理，以及通过R4-2输入材料引用当前说明全文。总结更新versions默认off，apply只追加研究上下文、不声称原件被改。

R4-7c：GET `/api/versions/:id/compare?baseline=<id>` 完整比较同组任意两版的提取文字；中文以 Intl.Segmenter 词粒度比较，完整保留未变、增、删片段。解析失败仍可打开两个原件；相同文字显示无变化。
POST `/:id/save-as-new` 复制旧原件成递增编号的新版本，不覆盖原件或旧说明。
日志关联使用同一 schema1 引用：每个 `##` 日志条目正文旁可写 `<!-- sciencescope:references [引用对象...] -->`，标签仅显示，版本按 id、项目文件／脚本按 projectId + path 打开。
Markdown 是正本，迁移017 `log_file_references` 是按条目起始行和序号重建的投影，不提供第二套写入口；读取、外部修改、撤销和历史恢复都刷新投影。秘书总结的 log append 可携 references，通过既有工作区修订写入并留历史。
日志详情 P12 恢复简述／文件列表／日志详情三栏签和双列布局，用户可关联、移除和修改正文；保存检查修订，遇到并发更新保留用户草稿并报冲突。POST `/api/projects/:id/log-file/open` 调用系统默认程序。

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

| mode             | 行为                                                                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `direct`（默认） | 人发消息后，被 @ 的参与者回应；没有 @ 时由会议的默认回应者（通常是主专家）回应                                                                 |
| `round`          | 选定的参与者并行回应同一上下文，按固定顺序展示；可选审核者在全部结束后回应；审核结论在用户采纳（`messages.adopted`）后才进入其他参与者的上下文 |
| `autonomous`     | 一位参与者朝目标连续发言，直到完成、失败或被叫停                                                                                               |

R4-6a：迁移014的meeting_goals保存当前会议目标、状态、轮数/用户最多轮数（默认30）、原因和时间。conductor逐轮调用共同runner，上下文组装附目标及继续指令；新用户消息经outbox在下一轮前入会，不额外派发回答。共享goal_update complete/blocked分别完成或等待用户，用户回复自动继续。暂停等当前轮完成，结束中断；失败/达到轮数暂停，重启running转paused且不自动续跑。附属会话及assistant_state中的助手不提供自动化，round与未结束目标互斥。每轮保留既有turn.ended秘书总结事件。

GET/POST/PATCH /api/meetings/:id/goal读取/设定/控制目标；PATCH接action pause/resume/end及maxRounds。状态与goal.changed在同事务保存；GET/api/activity只用于初次装载目标、运行发言与队列快照，后续订阅事件。

R4-3a 已实现：规则与选择保存在会议中。工作模式 @ 候选为会议 AI 成员及启用的参加专家，独立审核不能被 @；首次发言将职责写入会议成员。每轮按 order 预建回答，再并行运行各自会话，输入固定截止触发用户消息；不同轮排队。审核在所有专家结束后读取署名回答及完成状态，初始 adopted=false，只有 done 可采纳。refs.contextReadBy 记录实际送入后续发言的已采纳审核；已被读取的采纳不能撤回（409）。重试和继续仅运行原作者，停止同时取消当前轮及排队请求，未开始的审核不再启动。

后台参与者不由发言规则驱动，而是订阅事件并按规则触发。R4-4a 的纪要由 `services/secretary/` 小服务执行：一次性运行时会话记录 `agent_secretary` 的 turn、结束原因与用量，不创建主会议消息，也不复用前台秘书会话。文本整理轮次显式选择无工具执行，秘书前台发言仍使用共用工具。

迁移 005 的 `minutes_coverage` 把覆盖序号与已消费消息绑定到文件修订；用户编辑继承覆盖范围，撤销沿修订 ancestry 恢复。覆盖只在完整输出、纪要原子写入成功后推进。过时模型输出用文件队列内的 expectedRevisionId 检查让位于用户或外部编辑；即使文本相同也保存可撤销的新覆盖修订。未完成输出保存在 `minutes_status`，不推进覆盖。

总结订阅消息、前台 turn 结束和 `discussion.finished`，按设置防抖，同会议不重叠，等待前台完成。默认讨论后、20 条消息、30000 估算 token、进入/离开项目、Markdown 导出开启；工作台导图/计划/日志只有 off/apply，默认关闭，修改只追加或标记并写修订及纪要来源。项目切换由 focus 接口通知，关闭时 `secretary_pending_projects` 持久保留未整理项目，下次启动再补。外部 Markdown 是只写副本，错误在状态中可见。已知模型窗口时按 token 估算选择完整消息批次（含旧纪要、提示与模型输出预留），逐批提交；无窗口元数据时发送完整原文，服务商拒绝则明确保留待处理状态。已有纪要或单条完整消息无法装入窗口时不截断、不推进覆盖。

### R4-4b 秘书会话

秘书是普通参与者，第一次打开时建立 user + agent_secretary 的附属会议；迁移 006 的 secretary_chats 唯一绑定主会议与附属会议。消息与运行时游标分别保存。共同 runner 在每轮前通过注入的 followup 装配最新主会议纪要与上次成功跟进后原文，丢失会话则重新提供纪要及全部尾部；消息高水位在等待总结前冻结，之后的新消息留给下一轮。大积压按模型窗口估算触发纪要更新，最多等待 60 秒，超时仍保留全部可用原文，停止会立即取消等待。仅 done 才提交 secretary_cursors，失败、停止、输出未完成不推进。

propose_main_draft 属于共享工具，只保存 main_draft_proposals 卡片，不发主会议消息。用户编辑并填入主输入框后仍需亲自发送；修改与决策写 main_draft_proposal_history，可撤销，重启保留。会议 policy.model 保存局部模型/推理选择，优先于角色定义，未选择则使用秘书定义、所属主会议模型与应用默认值；明确换模型不更换对话历史。

### R4-4c 记忆整理

services/memory 订阅会议事件，空闲默认10分钟后触发 meeting.idle；秘书后台抽取与核对只读取未处理纪要修订的增删差异及对应原文，不重新总结全历史。来源按模型窗口分批，完整片段保留位置；新纪要高水位在整理开始冻结。迁移007保存游标、提取/核对检查点、用量状态与记忆修改记录，失败与预算跳过不推进未处理游标，重启可接着核对。纪要引用保留作者，核对必须同时读对应原文；同容量内候选合批核对，返回逐条判断。已完整生成且来源校验可重用的抽取输出在预算判断前直接恢复，不重复付费抽取。

候选是 type=memory/status=proposed 的资料库条目；逐条或批量接受后active，拒绝rejected。抽取和核对turn署名agent_secretary且记录用量，候选创建署名同一参与者；用户编辑和确认署名person_user。memory_item_history补充资料库修订保存前后状态，变更可从条目历史或工作台撤销。出处保留消息id/seq和纪要修订，网页、文献及外部条目标为external，确认编辑不会删除此标记。

每次整理累计输入与输出token预算默认100000，用户可改或留空关闭；沿用旧版预算依据（T09已记录的54次用量P50/P95/最大9969/15641/17084，默认允许两次32768输出预留）。请求前按输入与配置输出容量估算；缺输出元数据用明确标记的32768估算预留，不改变模型输出设置。请求后累计服务商报告，缺失时估算并标明；请求可超预算完成，后续批次暂停。DSH桥接累计assistant/message与失败attempt的已报告用量，多步和重试都计数；未知attempt单独标记，context measurement不当作用量。

projectBrief由有效、已确认、shared、项目scope的memory派生，置顶优先，无字符上限；界面/API与Main每次发言的系统指令使用同一原文，恢复会话也刷新。external条目显示为资料而非用户命令。个人资料库不加入项目简报。秘书附属会议不触发整理。

## 7. 上下文组装（`app/services/context-assembly.js` 与 `app/core/context.js`）

`createApp` 注入上下文组装服务，负责成员/工作目录、模型继承、系统指令、纪要覆盖、未读采纳审核、秘书跟进及本轮审核原文。`core/context.js` 保留纯格式化函数；`turn-runner.js` 负责会话开始/恢复、发送、流式输出、工具记录、收尾与中断。恢复会话先固定新消息再等待秘书跟进；重建在会话开始后读取同一纪要修订的文本与覆盖范围，保持既有时序。

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

### 全局助手（R4-5b）

迁移011的assistant_state保存唯一全局会议及已确认概览哈希；成员是person_user和agent_assistant，无项目归属，历史与草稿独立。会议不出现在侧栏/浏览全部，也不触发自动纪要。GET/POST /api/assistant取得同一会议。上下文组装每轮生成项目目标、计划、导图要点和研究会议纪要目标/待办；仅变化或运行时重建时发送，完成后确认哈希。私有资料条目、临时会议和附属秘书私聊不参与；共享工具仍可按项目id查阅和修改，轮末历史归agent_assistant。主窗口助手与秘书复用AssistantSurface/message/model和会议队列；隐藏仅收起视图，保留草稿与运行，链接导航主页面。

### 原生助手窗口（R4-5c）

原生主窗口启动消费settings.assistant.startup：closed（默认）/orb/expanded。独立助手通过?surface=assistant复用共享面板，浮球通过assistant-orb仅加载窗口操作，不请求研究状态。原生窗口获得每次启动注入的API口令；主窗与两助手窗在同一宿主origin获得窗口能力，隐藏不取消发言。跨窗导航使用Tauri定向事件回主窗，浏览器仍使用面板；浮球沿旧窗口级拖动监听、置顶并夹紧到工作区，尺寸保存data/assistant-window.json，关闭主窗结束宿主/DSH进程树。

### R4-2a 研究输入（2026-10-08，待审阅）

迁移012保存按会议（未建会议时按新对话草稿）区分的research_input_drafts、message_research_input和队列input_json。原件复用资料库；发送时冻结材料身份与条目正文，消息分支复制快照；队列只在发出时转成正式消息。草稿按操作修改、单调版本同步，发送确认只移除提交时的selectionId。POSTmessages接收researchInput；GET/PATCH /api/research-input/:owner读取或操作材料草稿。上下文组装统一编译material/quote/annotation；文件只给来源id、名称、页数和research_read读取指引，不注入全文；runner不变。助手概览按assistant_state.meeting_id排除助手会议。

## 8. 内置工具（R2）

R4-8a（待审阅）：迁移013的python_environments保存原始packages与解析lock、安装状态，python_bindings保存meeting/project绑定，python_operations保存actor/reason/结果及完整日志。环境与uv缓存均在dataPaths().python。上下文组装按meeting→project→settings.python.defaultEnvironment→system解析；每轮固定env与工具目标，runner仅转发。python_env_install共用、直接执行；删除环境清除绑定，默认指向被删环境时改为system。GET/POST /api/python管理环境，/binding/:scope/:id、/:id/packages、/:id/manifest、/cache/prune供界面使用；python.changed推送状态。

R4-2c（待审阅）：research_input_drafts/message_research_input的marks数组记录稳定id、选中版本selectionId、消息或原件target、原文、备注及page/段落/行/offset。mark-add/edit/remove/marks-clear操作写入既有迁移012表；编辑只更新草稿版本，消息快照不变。共享编译器输出quote/annotation，发送消费与消息写入同事务；失败恢复按id合并且保留更新后的草稿。无需新增表或在refs中保存状态。

R4-2b（待审阅）：GET /api/preview/document与/content按来源、交付物或项目文件定位原件；独立阅读投影不受模型输入大小影响。GET /api/messages/:id/citations复用资料库解析器，把已识别标签解析为来源/page/highlight，优先本轮所附来源；未知写法原样返回。PDF.js/CodeMirror/docx-preview等从本机依赖提供，浏览器阅读器不调用模型。

| 工具             | 参数                        | 作用                                                 |
| ---------------- | --------------------------- | ---------------------------------------------------- |
| `workspace_read` | `resource`, `id?`, `query?` | 读或列出任意资源；包括会议与消息（可跨会议、跨项目） |
| `workspace_edit` | `resource`, `op`, `args`    | 修改资源，记修订，返回修订 id                        |
| `workspace_undo` | `revisionId`                | 撤销一条修订                                         |

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

R4-8b（待审阅）：运行环境页管理Python清单/锁、默认环境、镜像与共享缓存；环境状态由python.changed触发读取，不轮询。项目创建environment绑定项目；独立对话详情先存欢迎草稿，首条消息创建时由creation保存工作目录与会议绑定；项目内对话继承。会议工作区菜单可单独改绑定，下一轮生效。列表先冻结数据库快照再统计磁盘，关闭时不回读SQLite。

- **2026-10-16 起本条废止**：界面按 `design/DESIGN_SYSTEM.md` 重做，由 Claude 设计并实现（`reviews/REVIEW_2026-10-16.md` D1、D5）。以下为原文，留作历史：
- （已作废：2026-10-16 起界面按设计系统重做，2026-10-29 旧样式表全部删除。）**原则：界面沿用旧主界面的设计，一比一复刻**（2026-10-05 用户确认）。组件输出与旧界面相同的 DOM 结构和类名，样式直接使用旧界面的样式表：`styles/legacy/` 依次为已批准原型（`prototype.css`，取自 `ScienceScope.html`）和旧桌面的 `chat`、`workspace`、`workbench`、`desktop-behavior`、`refresh`，加载顺序与旧界面相同；`styles/app.css` 只放新界面需要的少量补充。图标路径取自原型的 `iconPaths`。重构的重点在后端，界面不另行设计。
- 入口：`node app/main.js` 输出的 `ui` 地址（`<url>/?token=<口令>`）；口令随后存入会话存储并从地址栏去掉。原生外壳打开同一地址。
- 依赖：`preact`、`htm`、`marked`、`dompurify` 与思源黑体字体，由 `app/server/static.js` 从 `node_modules` 提供，页面用 import map 引用；不打包、不复制到仓库。
- 结构：`api.js`（请求与事件流）→ `state.js`（一个状态对象；`applyEvent` 按 id 合并事件，重放无害；`overlay` 放菜单、对话框、提示与搜索面板）→ `actions.js`（用户操作）→ `components/`。组件只读状态、调用 actions，不互相包裹或覆盖。
- 路由在地址的 hash：`#/`（新对话欢迎页，发出第一条消息才建会议）、`#/new/<projectId>`（项目内新对话）、`#/meeting/<id>`、`#/workbench/<projectId>`、`#/all`（浏览全部），以及 `#/project-new`、`#/plans/<projectId>`、`#/journal/<projectId>`、`#/files/<projectId>`、`#/map/<projectId>`、`#/database/<projectId>`、`#/library`、`#/sources`、`#/settings/<page>`；完整列表见 `app/ui/route.js`。旧的文稿版本、版本说明、版本比较三页已于 2026-10-29 删除，功能在版本树里。
- 文字：组件里写中文，`i18n/en.js` 给出英文；测试检查每个中文字符串都有英文条目。语言存于 `settings.appearance.language`，在"视图"菜单切换。
- 已复原的入口与待复原的 R4 队列：`archive/legacy/UI_RESTORE.md`。
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

- 新界面路由 `#/database/<projectId>`、`#/library`、`#/sources` 对应项目材料、个人资料、外部站点；样式在设计系统的 components.css 和 pages.css（旧样式表 2026-10-29 已删）。文献分页每页50条，段落详情每页20段且可定位搜索命中；知识、模型、主张支持编辑/取代/历史/置顶/归档，memory/inbox/brief与文件预览/附件留在后续任务。
- 来源接口新增 PATCH（title/kind/metadata 合并且索引同步）、POST reparse/open。GET sources支持kind/readStatus/tag/sort/direction；默认返回数组，带page/pageSize返回 `{sources,total,page,pageSize,remaining}`。GET chunks/:id返回段落与来源；条目筛选支持type/subtype/status/pinned，置顶存payload.pinned。
- 导入上传不设单文件长度限制；仅资料导入路径豁免现有通用JSON请求边界。重新解析复用原件及来源id，用户元数据保留。
- 迁移004创建 `rb_vec_docs` 与sqlite-vec `rb_vec`（384维）；同一个core数据库连接，数据库构造允许扩展加载，迁移和向量服务仅在加载sqlite-vec时启用。来源/条目/原件为正本，向量删除后可重建。
- `createApp` 装配一个 `createSemantic` 实例，传入 research、HTTP 和工具。`research_search` 与HTTP均异步共用混合检索：本地向量与关键词加权RRF融合，返回mode。关闭、模型缺失、索引不完整/版本不同或向量阶段300ms超时整次退回关键词；分页排序稳定。
- `settings.semantic.enabled` 默认false；本地模型位于 `<数据根>/models/multilingual-e5-small/`。清单沿用 `models/default-embedding.json` 的固定revision、SHA256与int8模型；用户点击下载，公开模型文件可从官方源/镜像获取，推理只访问本机文件。硬件要求AVX2、8GB内存、5GB可用空间。单工作线程处理query:/passage:前缀、模型512-token窗口、均值池化/L2归一化，不截断资料原文。
- GET `/api/research/semantic/status`，POST download/rebuild。`research.semantic.changed` 为瞬态完整状态，UI直接消费，不每秒请求进度。宿主就绪不等待预热；turn.started/ended暂停恢复批次索引，close终止工作线程再关闭数据库。
- Windows手动设置下载五文件校验、9/9索引、中文路径、重启与真实混合搜索/段落读取通过。自动测试只用假嵌入；付费模型0请求/0token。

### R4-11a 历史版本与项目目录（2026-10-07，待审阅）

- 迁移008新增 resource_snapshots；用户离开导图/计划/日志/纪要编辑时按内容去重，AI轮次结束按资源保存最终修订。历史从第一次编辑结束开始；初始细粒度内容仍在 revisions。恢复前先保存当前内容，删除快照不影响当前文件；纪要恢复沿修订祖先保留覆盖关联。
- GET/POST /api/snapshots、GET/DELETE /api/snapshots/:id、POST /api/snapshots/:id/restore；resource.snapshot.created/deleted 推送列表变化。共享工具 workspace_versions 提供 list/read/restore；workspace_undo 仍用于一轮中纠错，导图界面撤销/重做只限本次编辑。
- 项目文件删除使用系统回收站（trash服务适配，无永久删除回退）。项目切换位置不移动文件，旧会议绑定原目录，新会议绑定新目录；内部目录改名时更新相应会议路径。

### R4-11b 队列、交付物与导图（2026-10-07，待审阅）

- 迁移009 meeting_outbox/state 保存未发草稿，实际发出时才追加正式消息并移除草稿（同事务）。忙碌时POSTmessages返回queued/item/state；GET/POSToutbox、PATCH/DELETEoutbox/:id、DELETEoutbox、POSToutbox/pause|resume。状态事件meeting.outbox.changed含单调version；重启保留队列且等待明确继续。普通停止只中断当前回答，保留待发送队列；关闭应用仍取消所有运行。队列在发出时使用当时会议模型设置。
- 迁移010 message_deliverables 保存展示原件身份、所属消息/发言/调用以及data/deliverables副本；workspace_present为所有角色共用。消息携带deliverables元数据，其他参与者上下文仅路径和说明，不注入文件字节；分支保留同一原件关联。GET/api/deliverables/:id/content提供副本，POST/:id/open默认程序打开。
- 导图既有edges与floating/x/y通过界面接通；编辑撤销/重做仍为会话内，历史快照包含节点与边。Marked公式扩展不解析代码块/代码跨度/货币；源HTML先净化，只有本机KaTeX生成内容保留数学样式。
