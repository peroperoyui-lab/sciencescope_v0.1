# T18 · 总结规则与设置：按时机更新纪要，可选择随总结更新工作站

- 下达：Claude，2026-09-26。执行：Astra（后端，以及本任务书写明规格的界面）；Claude 审阅界面与交互。
- 设计：`docs/design/CONTEXT_ACCESS.md` §7（先读完），纪要现状见 `SYSTEM_SPEC.md` 2.5b。
- 依赖：T17 的事件总线（`scripts/host-events.mjs`）。可以和 T17 在同一分支连续完成：先 T17 §1，再本任务。
- 基线同 T17。交付：`codex/t18-summary-policy-YYYYMMDD`（或与 T17 合并为一个分支，报告里写明）。**不开 PR、不合并。**
- 通用约定同 `RB_COMMON.md`。
- 允许修改：
  - `scripts/chat-minutes.mjs`、`scripts/secretary-preferences.mjs`、`scripts/workbench-store.mjs`（只加带来源记录的写入函数）、`scripts/desktop-api.mjs`（接线）；
  - `desktop/secretary-settings.mjs`、`desktop/minutes.mjs`、`desktop/assistant-chat.mjs`（只加提议卡片）、`desktop/i18n-en.mjs`、相关 CSS。

## 背景（用户 2026-09-26）

现在每轮主对话结束都会更新纪要，太占用量。用户的要求：
- 有序讨论结束后总结可以；
- 主对话的自动总结要有规则，并在设置里开放：进入项目时、每 n 条主对话、每 n 个 token、退出项目时；
- 总结不只是形成纪要文档（项目进度、该对话的信息），也可以更新导图、稿件版本、计划、日志。但这些要有单独的开关，并提示"非必要不更新"，因为这部分内容有大量用户参与。

## 1. 设置与存储

- `secretary_preferences` 增加一列 `summary_json`，用迁移加列，老数据保留、取默认值。结构与默认值：

  ```json
  {
    "afterDiscussion": true,
    "everyMessages": {"enabled": true, "n": 20},
    "everyTokens":   {"enabled": true, "n": 30000},
    "onEnterProject": true,
    "onLeaveProject": true,
    "saveMarkdown": true,
    "workbench": {"map": "off", "versions": "off", "plans": "off", "log": "off"}
  }
  ```

  - 取值范围：`n` 条消息 4–500；token 2000–500000；`workbench.*` ∈ `off | propose | apply`。
- 接口：扩展现有 `GET/POST /api/secretary/preferences`，增加字段 `summary`。整体校验，非法值返回 400 和可读的中文错误，并有英文词条。
- 生效时机：保存后下一次判断时生效，不追溯。"恢复默认"（若该页有）恢复为上面的默认值。

## 2. 触发引擎（订阅事件，不在 desktop-api 里直接调用）

- 新模块 `scripts/summary-policy.mjs`，订阅：
  - `chat.turn.persisted`：计数规则；
  - `discussion.finished`：讨论后规则；
  - `project.entered`、`project.left`：进出项目规则；
  - `app.started`：执行待补项。
- **删除现有"每轮主对话后 `minutes.schedule`"的调用**。讨论结束的调用改为经 `afterDiscussion` 判断。
- 计数规则：
  - 从纪要覆盖到的位置（`through_ordinal`）起，统计新消息条数和估算 token；
  - 任一启用的阈值到达，就调度一次纪要更新（沿用 `minutes.schedule` 的防抖与"一次只跑一个"）。
- token 估算：新建 `scripts/context/estimate.mjs`：
  - 中日韩字符每字按 1 token，其他字符每 4 个按 1 token；
  - T17 的跟进包和专家前文也用这个函数，不要各写一份。
- 进出项目：
  - 前端在当前项目变化时调用新接口 `POST /api/projects/focus {projectId|null}`，宿主据此发出 `project.left`（旧项目）和 `project.entered`（新项目）。独立对话视为 `projectId=null`，不触发这两条规则。
  - 触发时，对该项目中纪要落后的对话**依次**更新（并发 1）；没有新消息的对话跳过，不调用模型。
- 关闭应用：
  - `project.left` 只把该项目记为"待补"，写入新表 `summary_pending(project_id, reason, created_at)`，不等待模型；
  - `app.started` 后 30 秒开始处理待补项。
- 秘书被提问且积压超过 6 万字符时的补齐（T17 §4），不受这些开关控制。
- 手动"让秘书更新"始终可用。
- 所有触发都**只在有新内容时**调用模型，并在日志（宿主 `onError` 以外的普通诊断输出）记录原因：讨论 / 条数 / token / 进入 / 离开 / 待补 / 手动 / 跟进。

## 3. 纪要另存为 Markdown

- `saveMarkdown` 开启且对话有工作文件夹（项目文件夹，或独立对话创建时选的文件夹）时：
  - 每一版纪要写入 `<工作文件夹>/minutes/<对话标题>-<chatId 前 8 位>.md`，原子写入，标题中的非法文件名字符替换为 `_`；
  - 文件开头注明版本号、覆盖范围和"在 ScienceScope 的对话纪要窗口中编辑"。
- 数据库是唯一来源，文件改动不读回。写文件失败不影响纪要本身，只在纪要窗口的状态行显示错误。

## 4. 随总结更新工作站（默认全部关闭）

- 任一 `workbench.*` 不为 `off` 时，纪要更新成功后追加一步。
  - 输入：本次纪要的新旧两版，加上项目当前状态（导图节点 id / 文字 / 状态、计划及完成情况、最近 10 条日志、还没有说明的版本）；
  - 用秘书模型，结构化输出（JSON Schema），只包含已开启的项。
- 允许的操作（其他一律丢弃）：
  - `log`：追加 `{title, note}`，不改、不删已有日志；
  - `plans`：新增 `{title}`，或把已有计划标记完成 `{planId}`；
  - `map`：改节点状态标记 `{nodeId, status}`，或在已有节点下新增子节点 `{parentId, text}`（带 `origin: 'secretary'`，界面显示"秘书添加"）。不改写、不删除任何节点的文字；
  - `versions`：为还没有说明的版本调用现有版本整理（`workbench organize`），不重写已有说明。
- 两种模式：
  - `propose`：写入新表 `summary_proposals(id, chat_id, project_id, minutes_revision, target, op_json, status 'pending'|'accepted'|'dismissed', created_at, decided_at)`，等用户确认；
  - `apply`：直接写入，同时写 `summary_writes(id, chat_id, project_id, minutes_revision, target, op_json, before_json, after_json, undone_at)`。
- 撤销：只在目标自写入后没有被改过时执行，否则返回 409"该内容已被修改，无法自动撤销"。
- 写入经 `workbench-store.mjs` 的带版本号接口（冲突时重读重试一次，再冲突则放弃并记录），完成后发 `workbench.changed`。
- 解析失败或输出越界时丢弃并记录，不重试刷费用。
- 接口：
  - `GET /api/summary/proposals?chatId`、`POST /api/summary/proposals/decide {id, accept}`；
  - `GET /api/summary/writes?chatId`、`POST /api/summary/writes/undo {id}`。

## 5. 界面（按此规格实现，Claude 审阅；文字全部加英文词条）

- **设置 → 任务秘书**，在"文献版本整理"之前新增一节 **自动总结**：
  - 标题旁"i"：任务秘书在下列时机更新对话纪要。总结越少，专家和秘书收到的"纪要之后的原文"越长；"每 n 个新 token"同时是这段原文的上限。
  - 复选框行：
    - 有序讨论结束后；
    - 每 [20] 条主对话消息（数字输入框）；
    - 每 [30000] 个新 token（数字输入框）；
    - 进入项目时；
    - 离开项目时；
    - 同时保存为工作文件夹中的 Markdown 文件（"i"：保存在工作文件夹的 minutes/ 下；在文件里的修改不会读回，请在"对话纪要"窗口中编辑）。
  - 小标题 **随总结更新工作站**，旁边"i"：导图、稿件版本、计划、日志有大量你的参与，非必要不开启。"提议"需要你逐条确认后才写入；"直接更新"只追加或标记，不改写你的内容，可撤销。
  - 四行：导图 / 稿件版本说明 / 计划 / 日志，每行一个与现有设置页一致的下拉选择（关闭 / 提议 / 直接更新）。
  - 改动即保存，状态行显示"自动总结设置已保存。"或错误。不使用通用成功提示，不写入原型 `S.settings`。
- **秘书面板**：有待确认的提议时，在输入框上方显示与现有"主专家草稿提案"同样样式的卡片"待确认的工作站更新（n）"，逐条显示目标与内容，按钮为"接受"和"忽略"。
- **对话纪要窗口**：
  - 状态行增加"下次自动总结：再 x 条消息或约 y token"（只显示已启用的规则）；
  - 有直接写入记录时，底部列出"最近的工作站更新"，每条带"撤销"。
- 验收截图：浅色与深色、中文与英文，路径写进报告。

## 6. 验收

- **单元测试**（假宿主，计模型调用次数）：
  - 默认设置下，主对话 19 条消息不触发、第 20 条触发；
  - token 阈值先到时触发；
  - 关闭全部规则后主对话不触发；
  - 讨论结束触发；
  - 进入 / 离开项目只更新落后的对话，没有新内容时零调用；
  - 关闭应用记为待补，启动后执行；
  - 设置校验与迁移（老库加列取默认值）；
  - Markdown 文件内容与路径；
  - 工作站：`off` 时不追加步骤、`propose` 只写提议、`apply` 的边界（越界操作被丢弃、不改写节点文字）、撤销与 409。
- **浏览器 smoke**：设置页各控件保存后重启仍在；提议卡片的接受与忽略；纪要窗口的撤销；英文模式。
- **真实便宜模型**，扩展 `scripts/evals/minutes-live.mjs` 或新建：
  - 主对话 25 条消息 + 1 次讨论，默认设置下纪要更新次数 ≤ 3；
  - 开启 `plans: propose` 时，产出的计划提议与对话中的待办一致。
  - 用量与次数写进 DESKTOP_IMPLEMENTATION。
- `npm test` 与现有 smoke（minutes、discussion-ui、settings-ui、assistant-api-smoke、i18n）全部通过；`node scripts/i18n-extract.mjs --missing` 不新增本任务的缺失词条。
- 文档：
  - SYSTEM_SPEC 2.5b（触发规则、设置、工作站更新）、2.7、2.14 设置页、接口与数据表索引；
  - `design/CONTEXT_ACCESS.md` §7 改为已实现；
  - ROADMAP 行。
