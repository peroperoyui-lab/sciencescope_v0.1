# 核心模型（R1 / R2 的依据）

- 起草：Claude，2026-10-05。总纲见 `ARCHITECTURE.md`。本文随实现修订；实现与本文不一致时，以代码和测试为准，并同步本文。

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
| `projects` | id, name, description, folder（外部文件夹，可空）, pinned, archived, created_at, updated_at | 项目；文件资源目录由 id 推出 |
| `participants` | id, kind(`human`/`ai`), name, definition_path（AI）, created_at | 人与 AI 的登记；AI 的详细定义在 `agents/*.md` |
| `meetings` | id, project_id（可空 = 全局）, title, policy_json, parent_meeting_id, fork_message_id, attached_to_meeting_id, work_folder, pinned, archived, temporary, created_at, updated_at | 会议；`policy_json` 是发言规则（§6） |
| `meeting_members` | meeting_id, participant_id, role_note | 谁在场；`role_note` 是在本会议中的说明（如"审核"） |
| `messages` | id, meeting_id, seq, author_id, text, status(`streaming`/`done`/`max_tokens`/`failed`/`cancelled`), turn_id, reply_to, refs_json（标记、附件、引用）, adopted（审核结论是否采纳）, created_at | 会议记录正本；`seq` 在会议内递增 |
| `turns` | id, meeting_id, participant_id, trigger_message_id, status, stop_reason, usage_json, started_at, ended_at | AI 的一次发言 |
| `tool_calls` | id, turn_id, seq, name, args_json, result_json, status, presented（是否展示给用户）, started_at, ended_at | 工具调用，完整保存，不截断 |
| `runtime_sessions` | meeting_id, participant_id, runtime, session_id, last_seq | AI 在某会议中的工作记忆指针；`last_seq` = 它已看到的最后一条消息 |
| `revisions` | id, resource, resource_id, op, before_json, after_json, actor_id, meeting_id, turn_id, undone_by, created_at | 每次修改；撤销 = 写一条反向修订 |
| `events` | seq, type, project_id, meeting_id, actor_id, payload_json, created_at | 变更流，给界面与后台参与者订阅 |

资料库沿用 `rb_*` 表（R4 移植时纳入迁移注册表）；设置不进数据库。

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

## 4. 工作区资源

资源注册表 `app/core/workspace/resources/*.js`：每类资源导出 `{ name, read(ctx, id), list(ctx, query), apply(ctx, op) → { before, after } }`。`apply` 由工作区统一包装：写文件或表 → 记修订 → 发事件。

| 资源 | 存放 | 格式 |
|---|---|---|
| `map` | `projects/<p>/workbench/map.json` | `{ nodes, edges }`（沿用旧格式） |
| `plans` | `projects/<p>/workbench/plans.md`；全局计划在 `plans.md` | Markdown 任务列表 |
| `log` | `projects/<p>/workbench/log.md` | Markdown，每条一个二级标题（日期 + 标题） |
| `versions` | `projects/<p>/workbench/versions/<组>/` | 原件 + `.notes.md` |
| `minutes` | `projects/<p>/minutes/<会议>.md` | Markdown；历史版本在 `revisions` |
| `notes` | `projects/<p>/notes/*.md` | Markdown |
| `agent` | `agents/<id>.md` | YAML 头（name、model、effort、tools、skills）+ 正文（人设） |
| `skill` | `skills/<name>/SKILL.md` | 运行时的技能格式 |
| `project` / `meeting` | 表 | — |

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

后台参与者（纪要、记忆整理）不由发言规则驱动，而是订阅事件并按规则触发（R4）。

## 7. 上下文组装（`app/core/context.js`）

参与者 P 在会议 M 中发言时：

1. **系统部分**：P 的定义正文 + 会议说明（在场者与各自身份、P 自己是谁）+ 工作区简介（项目、可用工具的使用说明）。
2. **历史部分**：
   - 如果 P 在 M 中有可用的运行时会话：只发送 `last_seq` 之后其他参与者的新消息（标明发言人），加上触发消息；
   - 否则重建：M 的最新纪要 + 纪要之后的全部消息原文（标明发言人），作为新会话的种子。
3. **可见性**：
   - 其他参与者看到的是回答的最终文字，以及该回答展示的文件；
   - 看不到工具调用、工具结果和前言；
   - 未采纳的审核结论不进入其他参与者的上下文。
4. **不截断**。超出模型上下文窗口时，先换用更新的纪要；仍然超出，就在开头写明省略了哪些消息，并说明可以用 `workspace_read` 回查。

## 8. 内置工具（R2）

| 工具 | 参数 | 作用 |
|---|---|---|
| `workspace_read` | `resource`, `id?`, `query?` | 读或列出任意资源；包括会议与消息（可跨会议、跨项目） |
| `workspace_edit` | `resource`, `op`, `args` | 修改资源，记修订，返回修订 id |
| `workspace_undo` | `revisionId` | 撤销一条修订 |
| `research_search` / `research_read` / `research_write` | 见资料库 | R4 移植 |

运行时自带的文件、命令、present、技能、MCP 工具原样提供。

## 9. 本地接口（`app/server`）

- REST 风格 JSON：
  - `/api/projects`
  - `/api/meetings`、`/api/meetings/:id/messages`（GET 分页；POST 发消息，按发言规则触发回应）
  - `/api/participants`
  - `/api/resources/:resource`（GET / POST op）
  - `/api/revisions`（GET；POST `:id/undo`）
  - `/api/settings`
- 事件：`/api/events`（SSE）。
- 本地口令：每次启动生成，所有接口校验（沿用旧版做法）。
- 路由文件只做参数解析与调用 core / services，每个领域一个文件。
