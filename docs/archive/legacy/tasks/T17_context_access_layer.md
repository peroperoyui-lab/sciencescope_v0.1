# T17 · 上下文访问层：秘书自动跟进、全局助手跨项目查阅、事件总线与工具清单

- 下达：Claude，2026-09-26。执行：Astra（后端，以及 §7 写明规格的界面）；Claude 审阅界面与交互。
- 后续任务：T18（总结规则与设置），依赖本任务 §1 的事件总线，建议在同一轮连续完成。
- 设计：`docs/design/CONTEXT_ACCESS.md`（先读完）。前置实现：`docs/design/EXPERT_CONTEXT.md`、`SYSTEM_SPEC.md` 2.5、2.5b、2.7、2.8。
- 基线：`claude/determined-pasteur-jxpzw8`（已合并进 main 则以 main 为基线）。交付：`codex/t17-context-access-YYYYMMDD`，报告分支与 SHA。**不开 PR、不合并。**
- 通用工程约定同 `RB_COMMON.md`（测试目录、许可、截图、文档更新）。
- **本任务允许修改的框架文件**：
  - `adapters/runtime-dsh/session-control.mjs`：只改工具注册部分，其余不动；
  - `scripts/assistant-chat-service.mjs`、`scripts/desktop-api.mjs`（只做接线）；
  - `scripts/chat-minutes.mjs`、`scripts/project-memory.mjs`（可以迁入 `scripts/context/`）。
  - 其他框架文件需要改时先停下说明原因。

## 目标

同一套只读查阅机制服务主专家、专家、任务秘书、全局助手，角色之间只有"范围"和"每轮自动推送什么"不同。
任务秘书在长任务里即使从没被用过，被直接提问时也知道主对话进展到哪里；全局助手能查看所有项目的回答、纪要、日志、计划、导图、版本和进度。
以后新增资料种类、后台工作或修改工具说明，不需要改核心文件或 DSH 适配器。

## 1. 事件总线 `scripts/host-events.mjs`（新）

- 进程内的简单发布 / 订阅：`emit(type, payload)`、`on(type, handler) → off`。处理函数出错时只记录，不影响发出方；`close()` 等待进行中的处理函数完成。
- 事件：`chat.turn.persisted {chatId}`、`discussion.finished {chatId}`、`workbench.changed {projectId}`、`version.stored {projectId, versionId}`、`assistant.opened {scope, ownerId}`，
  `project.entered {projectId}`、`project.left {projectId}`、`app.started`（由 T18 使用），
  以及 `chat.idle {chatId}`（给 T09 用，本任务只实现发出，空闲时长默认 10 分钟）。
- 把现有直接调用改为订阅：版本自动整理（`autoOrganize`）、纪要更新。`desktop-api.mjs` 只负责 `emit`。
  **注意**："每轮主对话后更新纪要"是要废除的旧行为（用户 2026-09-26：太耗用量），纪要何时更新由 T18 的规则决定；
  只做 T17 时，暂时保留讨论结束后的更新，去掉每轮主对话后的更新。

## 2. 资料源注册表与范围表 `scripts/context/`（新）

- `sources/*.mjs`：每个资料源一个文件，导出 `{id, sections?, describe(role), read(scope, args)}`。首批：
  - `conversation`（原 `chat_recall`）；
  - `minutes`；
  - `log`、`plans`、`map`、`versions`；
  - **`status`**（新）：导图节点与 `status` 标记、未完成计划、最近 5 条日志、最新稿件版本及说明状态、纪要的"待办"栏；
  - **`workspace`**（新，仅全局助手）。
- `policy.mjs`：设计 §2 的范围表写成数据：
  - 角色 → 可读资料源；
  - 目标由会话决定，还是允许参数指定（只有 `global` 允许 `projectId` / `chatId`）；
  - 自动推送哪一种上下文包。
  - 所有角色都读不到：临时对话、`assistant_conversations` 中的对话、研究资料库私有条目、工具调用与结果。
  - 全局助手指定的 `chatId` 必须是某个项目或独立对话的主对话，否则报错。
- `tools.mjs`：从注册表和范围表生成**工具清单**（名称、描述、DSH 值 schema DSL，含 `additionalProperties` 与逐字段 `required`）和**查找规则文字**（取代 `MEMORY_GUIDE` 常量，按角色生成）。
  - 工具名 `chat_recall`、`project_memory` 保持不变，只增参数：`project_memory.section` 增加 `status`；全局助手版本增加 `projectId`、`chatId`。
  - 新增 `workspace_overview({query?})`，仅全局助手可用。
  - `contextApi` 版本号写进规则文字。
- 现有 `research_*` 工具也改由清单下发（schema 从 `session-control.mjs` 原样搬到宿主）。

## 3. 工具清单由宿主下发（适配器不再写死工具）

- `session-control.mjs` 启动时经 `/host-call` 请求 `{name:'__manifest'}`（或等价方式），按返回的清单逐个 `defineTool` 并转发执行。
  清单取不到时不注册研究工具，并通过控制事件报告，不静默降级。
- 专家子代理用同一份清单（现有 `expertChildren` 的注册逻辑改为用清单）。
- 宿主按会话的角色返回清单（全局助手的 `project_memory` 带 `projectId` 参数，其他角色不带）。
- 验收必须用真实 DSH：`tests/research-tools-runtime.test.mjs` 扩展到秘书和全局助手会话，断言各自拿到的工具与参数。

## 4. 任务秘书：跟进包

- 新表 `context_cursors(conversation_id, target_chat_id, seen_ordinal, minutes_revision, status_hash, updated_at)`，放在新模块里，`CREATE TABLE IF NOT EXISTS`。
- 秘书每次发送前（`assistant-chat-service.mjs` 的 `send`），调用 `context.catchUp({conversationId, chatId})` 生成跟进包，放在用户消息前：
  - 游标之后的新消息 ≤ 6 万字符时，逐字附上（格式与专家前文相同：`<message n= speaker= role=>`，只含最终回答与展示的文件）；
  - 超过时，先让纪要补齐（`minutes.refresh`，最多等 60 秒，超时则用现有版本并注明）。然后附最新纪要，加上纪要覆盖之后的原文，并写明"#a–#b 可用 chat_recall 读取"；
  - 状态（`status` 资料源）的哈希变化时附一段工作站状态；
  - 没有任何变化时不附任何内容。
  - 跟进包第一行写明对话进度："主对话共 N 条；纪要第 r 版覆盖到 #T；你上次读到 #S"。用户问"进行到哪了"时，秘书据此回答，缺的部分用 `chat_recall` 读，不凭印象回答（用户说的"table 的进度"指的就是这个）。
- **发送被接受（`accepted`）后**才推进游标；发送失败或被停止时不推进。
- 删除 `contextFor` 的 20 条截断摘录。`contextChatId` 对秘书不再使用；对全局助手改为"以此对话为准"的提示：只附对话标识与标题，由助手自己用工具读。
- 秘书的规则节：纪要是它维护的记录，用户修改的版本优先；可以回查；可以请求更新纪要（新增工具 `minutes_refresh`，只对秘书开放，返回新版本号）。
- 人设默认文字中"只用明确提供的上下文"改为与本设计一致的说法（只改内置默认值；用户编辑过的人设不动）。

## 5. 全局助手：工作区概览

- 每次发送前生成概览（设计 §4）。与上次推送的哈希相同时不附；不同时附完整概览（它很小，不做差异计算）。
- 下钻用 `project_memory({projectId, section})`、`chat_recall({chatId, …})`、`workspace_overview({query})`、`research_search`（全局助手范围：所有项目，私有条目仍排除）。
- 规则节与秘书相同，由生成器产生，经 `configureBrief` 下发。

## 6. 规则节与人设分开

- 主专家、秘书、全局助手的查找规则都通过 `host.configureBrief`（按会话、按规则版本）在每轮前按需刷新；专家的规则仍附在子代理人设末尾，由生成器产生。
- 应用升级（规则版本变化）后，已有会话下一轮用上新规则；不写入 `role_prompt_receipts`，不改用户编辑过的人设。
- `configureBrief`（`/brief` 控制端点）对每个 DSH 会话通用，秘书与全局助手会话可直接使用；只在会话空闲时可改，所以放在发送前调用。

## 7. 界面（按此规格实现，Claude 审阅；新文字都加英文词条）

- 秘书面板显示一条状态：已跟进到主对话第 n 条 · 纪要第 r 版；有"i"说明。
- 去掉秘书的"引用对话"菜单；全局助手的菜单改名为"以此对话为准"。
- 全局助手提问示例进入首页提示。
- 为此需要的接口：`GET /api/assistant` 的快照增加 `followUp: {seenOrdinal, minutesRevision, latestOrdinal}`（秘书）。

## 8. 验收

- **单元测试**（假宿主）：
  - 事件总线（出错隔离、`close` 等待）；
  - 纪要改为订阅后行为不变（现有 `chat-minutes` 测试通过）；
  - 跟进包的三种情况：少量新消息逐字、大量时用纪要加其后原文、无变化不附；
  - 失败不推进游标；
  - 范围表：秘书读不到其他项目，全局助手读得到；两者都读不到临时对话、助手私聊、私有条目；
  - 全局助手用非法 `chatId` 报错；
  - `status` 资料源内容正确。
- **真实 DSH**：四种角色拿到的工具清单与参数正确，工具调用经 `/host-call` 返回正确范围的数据。
- **真实便宜模型评测** `scripts/evals/context-access-live.mjs`：
  - 主对话约 20 轮，其间不使用秘书，并在工作站里改导图状态、加计划；
  - 然后直接问秘书："对话现在进行到哪一步了？第 3 轮定的主要终点是什么？现在导图哪些节点还没完成？"
  - 再在另一个项目里问全局助手第一个项目的待办；
  - 规则判断，结果写进 DESKTOP_IMPLEMENTATION。
- `npm test` 与现有 smoke 全部通过（chat-ui、discussion-ui、minutes、assistant-api-smoke、research-input-ui）。
- 文档：
  - SYSTEM_SPEC 2.5b、2.7、2.8、接口与数据表索引；
  - `design/CONTEXT_ACCESS.md` 状态改为已实现；
  - ROADMAP 行；
  - AGENTS.md 若有规则变化则更新。
