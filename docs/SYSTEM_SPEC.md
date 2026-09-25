# ScienceScope 系统功能与技术说明

> **这份文档记录"现在是怎样"，不规定"必须这样"。**
> 它描述当前代码中每个功能的用途、状态、技术实现和验证证据，供开发者（Codex、Claude 及后来者）
> 快速了解现状，也方便用户查阅。功能的设计以后可以改变；改变时同步更新本文档即可，
> 不应因为本文档写过某种实现就拒绝更好的设计。产品意图与交互规则的依据仍是
> `00_MASTER_FUNCTIONS.md`、`02_INTERACTION_CONTRACTS.md` 与已批准的 `ScienceScope.html`。
>
> - 最近核对：2026-09-24，基线 `main@98e560a`（Claude 对照代码逐项核对）；2.2、2.4、2.5、2.16 于同日随界面刷新、标记与专家讨论修订（分支 `claude/determined-pasteur-jxpzw8`，未合并）更新；2026-09-25 新增 2.17 研究资料库（同一分支）。
> - 历史过程与每次验收细节见 `DESKTOP_IMPLEMENTATION.md`（按日期的开发日志）；本文件只写当前结果。

**状态标记**

| 标记 | 含义 |
|---|---|
| ✅ | 已实现，并有自动测试或真实验收证据（证据类型写在"验证"一栏） |
| 🟡 | 已实现，但缺少某类关键验收（例如尚未在 Windows 原生客户端实测） |
| ⬜ | 仅原型展示或尚未实现；界面入口可能存在，但没有接真实数据或服务 |

证据类型缩写：**单元** = `npm test` 离线测试；**界面** = Playwright 浏览器 smoke（生产资源路由）；
**DSH** = 真实 DSH 运行时 + 本地模拟模型；**真实模型** = 付费 Provider 实测；**原生** = Windows Tauri 客户端实测。

---

## 1. 系统总览

### 1.1 四层结构

```
┌──────────────────────────────────────────────────────────────┐
│ 外观：已批准的 ScienceScope.html（src/original-base.html +      │
│       interaction-v2.*）→ build 生成桌面入口；desktop/*.mjs      │
│       以"覆盖原型全局函数"的方式接入真实功能，不改视觉             │
├──────────────────────────────────────────────────────────────┤
│ 桌面外壳：src-tauri（Rust / Tauri 2）                           │
│   主窗口、全局助手窗口与悬浮球、辅助窗口；启动并拥有本地宿主进程  │
├──────────────────────────────────────────────────────────────┤
│ 本地宿主：scripts/preview-desktop.mjs → desktop-api.mjs（Node）  │
│   HTTP 接口 /api/*、SQLite 应用数据库、文件存储、业务编排        │
├──────────────────────────────────────────────────────────────┤
│ AI 引擎：DeepSeek Harness (DSH) 0.1.6-alpha.1                  │
│   adapters/runtime-dsh/*：每个会话一个 SDK 子进程 + 两个自有插件 │
│   （session-control、assistant-stream-bridge）；Web 宿主用于     │
│   Provider 设置、凭据和插件清单                                  │
└──────────────────────────────────────────────────────────────┘
```

原则（来自 AGENTS.md，记录于此便于理解代码）：模型调用、工具执行、会话历史由 DSH 负责；
ScienceScope 只做应用编排和展示记录，不另造 agent 框架或 Provider 传输层。

### 1.2 启动与关闭

| 步骤 | 实现 |
|---|---|
| 用户双击 `Start-ScienceScope.cmd` | 隐藏窗口的 PowerShell 执行 `scripts/windows/launch-client.ps1`：定位 debug 版 exe 与 Node，已有实例则激活 |
| exe 启动（`src-tauri/src/main.rs`） | GUI 子系统（无命令行窗口）；以 `CREATE_NO_WINDOW` 启动 Node 宿主 `preview-desktop.mjs --desktop`，stderr 写入 `<exe 目录>/data/logs/desktop-host.log`；Windows Job Object 管住整个子进程树 |
| 宿主就绪 | 标准输出一行 JSON：`url`、`shutdownPath`、`shutdownToken`、`apiToken`（每次启动随机） |
| 建窗 | 运行时为宿主的精确 origin 添加 Tauri capability；`initialization_script` 仅向该 origin 注入只读的 `window.__SCIENCESCOPE_API_TOKEN__` |
| 关闭主窗口 | 关闭辅助窗口 → 带口令请求 `/__host_shutdown` → 限时等待 → Job Object 结束残留进程；关闭即退出，不驻留托盘 |

状态：🟡。关闭流程和口令注入已在 Windows 原生验证（Codex，2026-09-20/23）；"无命令行窗口"尚待原生验证（`docs/tasks/T03`）。

### 1.3 数据目录（均在仓库根的 `.sciencescope-local/` 下，不进 Git）

| 位置 | 内容 |
|---|---|
| `state/sciencescope.sqlite` | 应用数据库（对话、消息、设置、名册等，见第 4 节） |
| `state/plans.json`、`state/workbench-bindings.json` | 全局计划；项目与外部文件夹的绑定 |
| `projects/project-<id>/` | 默认项目文件夹：`workbench.json`、`mind_map/`、`paper_versions/` |
| `library/originals/<id>/` | 资料库原件（导入的附件、材料） |
| `dsh/` | DSH home：运行历史（压缩的 session 日志）、Provider 配置、凭据存储、技能、会话补丁 |
| `assistant-workspaces/<chatId>/` | 秘书与全局助手会话的工作目录 |
| `temp/` | 临时文件、测试夹具、临时提问（quick）工作区 |
| `secret/` | 本地测试用密钥（仅云端/开发机，不进 Git） |

---

## 2. 功能模块

每节依次说明：**用途与操作**、**状态**、**技术实现**、**验证**、**已知限制**。

### 2.1 项目与对话管理（侧栏）

- **用途与操作**：创建项目；项目下的对话树可展开/折叠；手动置顶项目或对话；重命名、归档、删除（确认后软删除）；
  拖动对话到其他项目；"浏览全部"固定在侧栏底部；新对话在首条消息被接收前只是草稿，不会创建记录；
  Ctrl+N 新建项目内对话，Alt+Ctrl+N 新建独立对话；右键"新对话"可开临时提问窗口。
- **状态**：✅（单元、界面）。
- **技术实现**：
  - 前端 `desktop/workspace.mjs`：用真实数据替换原型的 `S.projects/S.threads/S.pins`；草稿对话 `state.drafts`；
    消息分页（最近 60 条，双向每批 30 条）；三点菜单与右键共用同一菜单；拖放移动。
  - 接口：`GET/POST /api/workspace`（项目、置顶、展开状态）、`GET /api/chats`、`GET /api/chats/:id/messages`（`before/after/around` 分页）、
    `POST /api/chats/update|move|delete`、`POST /api/chats/temporary-close`。
  - 存储：`chat-store.mjs` → 表 `workspaces`、`projects`、`chats`、`messages`、`runtime_bindings`。
    移动已绑定运行时的对话时，会先释放其 DSH 会话再移动。
- **验证**：`chat-store`、`application-database` 单元测试；`workspace-ui-smoke`、`desktop-navigation-smoke`。
- **已知限制**：删除为软删除，没有"回收站"界面。

### 2.2 主对话（主专家）

- **用途与操作**：向主专家发送消息，逐字显示回答（Markdown、代码块复制、表格）；运行中发送键变为"停止"，
  已生成的内容保留；运行中可继续输入，并显式加入发送队列；工具调用按本次回复归组，可展开参数和结果；
  模型在工具调用前写的执行性前导语（如"先读取研究稿"）不留在正文，归入对应工具调用，并作为折叠卡片的说明；正文只保留面向用户的回答和工具执行后的结论；
  切换对话不影响后台运行，侧栏显示运行、完成、失败、等待审批等状态；发送失败时原文回到输入框。
- **状态**：✅（单元、界面、DSH、真实模型、原生）。
- **技术实现**：
  - 前端 `desktop/live-chat.mjs`（发送、流式渲染、停止按钮、失败恢复）、`markdown.mjs`（marked + DOMPurify 白名单）、
    `turn-activity.mjs`（工具记录）、`main-outbox.mjs`（队列）、`background-activity.mjs`（侧栏状态）、`host-client.mjs`（带口令的请求与 NDJSON 流）。
  - 接口：`POST /api/chat`（NDJSON 流：`accepted` → `text-delta`/`tool-call`/`tool-result` → `completed`/`cancelled`/`failed`）、
    `POST /api/chat/stop`、`GET/POST /api/chat/outbox`、`GET /api/chat/activity`。
  - 会话：`desktop-api.mjs` 的 `ensureMainBinding` 为每个对话启动或恢复一个 DSH 会话（`host.startSession`），
    会话 id 存在 `runtime_bindings`；空闲会话按 LRU 最多保留 3 个。对话一旦绑定模型就不能换（避免隐式丢历史），
    推理强度可以改。
  - 运行时（`adapters/runtime-dsh/host.mjs`）：每个会话一个 `DeepSeekHarness` SDK 子进程，加载两个自有插件：
    `session-control.mjs`（本地 HTTP 控制端点：`/prompt`、`/interrupt`、`/policy`、`/reasoning`、`/model`、`/persona`、`/goal`、`/approval/reply`、`/context-usage`、`/experts`）
    与 `assistant-stream-bridge.mjs`（把 DSH 的文字流和工具事件推回宿主）。`/prompt` 没有空闲超时，一轮可以持续任意长，由"停止"或子进程退出结束。
  - 前导语：`host.mjs` 在收到 `tool-call` 时，把本次尝试中上一个工具边界之后写出的文字从可见回答中移出（发 `text-replace`），
    作为该调用的 `preamble` 字段；`tool_activity` 新增 `preamble` 列；DSH 自身的会话历史保持完整。
  - Provider 错误被归类为固定中文提示（认证、限流、网络、找不到模型、超出上下文），原始 Provider 文本不进界面。
  - 记录：用户与助手消息写入 `messages`；工具记录写入 `tool_activity`（有界、脱敏的展示投影；完整历史在 DSH）。
- **验证**：`main-interrupt`、`main-outbox-api`、`chat-outbox`、`tool-activity`、`provider-failure-surface`、`reasoning-effort-wire` 单元测试；
  `chat-ui-smoke`、`failed-send-draft-smoke`；真实 OpenCode Go 小请求、停止、5.5 分钟长任务（原生，2026-09-23）。
- **已知限制**：队列只接受纯文本轮次（带材料的输入会留在草稿里，需要再次确认）；从某条消息"分支"只做了界面层，没有 DSH 运行时分叉。

### 2.3 执行策略与自动化

- **用途与操作**：输入框的"询问 / 完全接管 / 自动化"菜单。
  - 询问：需要授权的操作弹出审批。
  - 完全接管：不逐次询问。
  - 自动化：主专家按目标连续执行多轮，可暂停、继续、结束；仅主对话提供。
- **状态**：✅（DSH、界面）；自动化在真实模型上的长时间运行验收有限。
- **技术实现**：`desktop/execution.mjs`（菜单、目标面板、审批卡片、自动化输出预览）；`scripts/execution-service.mjs`；
  接口 `GET /api/execution`、`POST /api/execution/goal|approval`；表 `execution_sessions`。
  策略的实际映射：询问 → DSH 审批策略 `ask` + 沙箱 `workspace-write`；完全接管 → `never` + `danger-full-access`；
  自动化 → DSH goal 服务（`/goal`）。
- **验证**：`dsh-approval-smoke`、`dsh-goal-smoke`、`dsh-policy-smoke`。

### 2.4 研究输入：附件与标记

- **用途与操作**（2026-09-24 起"引用/批注"统一为"标记"）：
  - 附件：可选择、拖入或粘贴文件，原件存入资料库，输入框显示附件条；点击附件可"预览并标记 / 手动添加文本标记 / 移除附件"。
  - 标记：在聊天消息或右侧**文件预览**中划选文字，弹出贴着选区的小窗，可写备注，Enter"添加标记"（Shift+Enter 换行，Esc 关闭）；
    不弹对话框，可以连续标记多处。消息里的标记进入该对话自己的输入框（主对话 → 主输入框；秘书/全局助手 → 各自输入框）；
    小窗里另有"引用至任务秘书 / 引用至全局助手 / 复制"。
  - "标记 N"按钮：在输入框的附件条中，N>0 时出现；点击展开二级快捷窗口，按顺序列出每个标记的来源（对话发言人或文件名+段落）、原文和备注，
    支持定位（滚动并闪烁到原消息，或打开文件预览并高亮原文）、修改备注、移除、全部清除；Esc 或点外部关闭，不重挂正文和输入框。
  - 发送：正文与当前全部标记、附件一起组成下一轮输入；发送后消息下显示可读回执"标记 N 条 · 材料 M 份"。
  - 文件预览（右侧栏"文件预览与标记"）：显示资料库资源经同一提取路径得到的文本（与发送给模型的一致，最多 64000 字），
    可切换当前项目的资料；已有标记在预览中高亮；数据库材料行有"预览"按钮。
- **状态**：✅（单元、界面）；原生客户端未实测。
- **技术实现**：
  - 前端 `desktop/research-input.mjs`（草稿、选区小窗、"标记 N"窗口、回执）、`desktop/file-preview.mjs`（真实预览栏，替换原型的演示预览；
    `window.ScienceScopePreview.open(id,{highlight})`；原型中按版本打开预览时映射到 `metadata.versionId` 相同的资源）、`desktop/marks.css`。
    后端 `scripts/research-input.mjs`（编译器）、`research-input-store.mjs`（草稿、回执、已消费版本）、
    `chat-attachments.mjs`（读取原件；txt/md/csv/json/tex/log 按 UTF-8 最多提取 64000 字符，其他格式只给路径）。
  - 数据：消息标记存为 `messageQuotes`（来源对话、消息、原文、备注），文件标记存为 `annotations`（资源、原文、位置"第 N 段/行"、备注）；上限沿用 16 / 32 条。
  - 送给模型的格式：在 `[User-provided research material]` 标记内放 `<material>`、`<quote>`、`<annotation>` 标签块，
    正文保持原样，属性转义（2026-09-23 起，原为 JSON 字符串；对照实验见 `scripts/evals/material-format-ab.mjs`）。
  - 接口：`GET/POST /api/research-input/draft`、`POST /api/library/import`、`GET /api/library/preview?id=`；Main、秘书、全局助手共用同一编译器。
  - 表：`research_input_drafts`、`research_input_receipts`、`research_input_consumed`、`resources`。
  - 语义：发送确认后只清除本次捕获的标记版本；发送失败时恢复材料；秘书问答不消耗标记。
- **验证**：`research-input`、`research-input-store`、`research-input-api`、`library-preview` 单元测试；`research-input-ui-smoke`、`marks-ui-smoke`
  （连续标记不弹框不重挂、预览标记、窗口内容、修改、两种定位、Esc/外部关闭、移除、发送携带全部标记、回执、秘书目标、全部清除）。
- **已知限制**：**不解析 PDF、DOCX、图片**（预览显示"未提取"，可打开原件或手动添加文本标记）；多份附件共享 64000 字符预算；
  只处理鼠标选区（键盘选区未接）；从独立全局助手窗口标记、数据库"预览"按钮、原型按版本预览的映射未被自动测试覆盖。

### 2.5 专家讨论（多模型）

- **用途与操作**（2026-09-24 语义修订；"自由讨论"与"互相质询"已取消，历史记录仍可阅读）：
  - **工作模式中 @专家**：在普通"工作"模式里输入 `@` 弹出启用专家的候选菜单（↑↓ 选择，Enter/Tab 插入 `@名称 `，Esc 关闭；选择不会发送）。
    消息里出现名册中专家的完整名称或标识时，这条消息由被 @ 的专家回答，主专家本轮不回答；没有 @ 时照常交给主专家。不做模糊猜测。
  - **有序讨论**：输入框上方的讨论条列出发言顺序，可点选本轮参加的专家，并可选一位**审核专家**（审核专家本轮不单独作答）。
    发送后，所选专家读取同一份前文与项目上下文，然后并行独立工作，本轮看不到彼此的回答；界面按顺序显示每位专家的状态
    （等待中 / 作答中 / 使用工具 / 已完成 / 未完成）和回答。若设了审核专家，它在其他专家全部完成后核查各回复的事实、依据、方法和结论并总结。
    审核结论默认**不进入**后续上下文；用户点击"加入后续上下文"后才会提供给之后的主专家轮次和专家；主专家已读取后不能撤回。
  - **上下文可见性**：其他参与者（主专家、其他专家、审核专家）看到的是每条回答的最终文字，以及该回答的工具读写过的文件路径；
    工具调用本身（参数、结果、前导语）不进入任何其他参与者的上下文。
  - **身份**：每位专家被告知自己的名称与职责、在场的其他参与者（用户、主专家、其他专家），以及前文中只有标注为自己名字的消息才是自己说的。
  - 每位专家的文字实时出现；工具调用前的执行性前导语归入该回答的工具记录卡片（见 2.2）；"停止"取消整轮（含审核）。
- **状态**：🟡。单元、界面 smoke、真实 DSH（本地模拟模型，含工具前导语）已通过；真实模型端到端见"验证"；尚未在 Windows 原生客户端实测。
- **技术实现**：
  - 运行时：`session-control.mjs` 的 `/experts`。每位专家是 DSH 自带 `dsh-subagent` 服务的一个进程内 `spawn` 子代理，
    挂在当前对话会话下，有自己的人设（persona）和可选的模型/推理强度；同一轮所有专家拿到同一份冻结输入，并行执行。
    文字、工具调用（带参数预览与前导语）和工具结果按顺序以 `expert-delta/expert-tool/expert-tool-result/expert-end` 回传。
  - 应用层 `scripts/discussion-service.mjs`：
    - `transcript()` 把对话前文（用户、主专家、专家的最终文字，未采纳的审核除外；每条附 `files="…"`，取自该回答的 `tool_activity` 参数中的路径）
      组成 `<message speaker=… role=… files=…>` 块，最多 48k 字符，从最新往前取。
    - `identityPrompt()` 生成每位专家的身份与本轮任务说明（有序 / 被邀请 / 审核）。
    - 审核专家在第一次 `runExperts` 全部结束后单独运行，输入为同一前文 + 本轮各专家回答（`<answer speaker=…>`）。
    - `pendingForMain()`：主专家下一轮发送时，把它还没读过的、已采纳的专家回答作为一段"其他参与者的消息"放在用户消息前，发送成功后标记 `main_seen`。
    - `adopt()`：切换审核结论是否进入后续上下文。
  - 接口：`POST /api/discussion`（NDJSON 流；`kind: 'ordered' | 'invited'`，`expertIds`，可选 `reviewerId`；旧值 `independent` 视为 `ordered`）、
    `POST /api/discussion/adopt`、`POST /api/discussion/cancel`（也可由 `/api/chat/stop` 触发）。
    专家回答是普通 assistant 消息，元数据在 `discussion_entries`（新增 `review`、`adopted`、`main_seen` 列），读消息时作为 `message.expert` 返回并按顺序重排；
    专家的工具记录写入 `tool_activity`（以专家消息 id 为键）。
  - 前端：`desktop/discussion.mjs`（@ 邀请、有序讨论条：参加者开关与审核选择（按对话存本机偏好）、状态标签、审核结论采纳按钮、专家工具卡片）、
    `work-mode.mjs`（"工作 / 有序讨论"两项）、`workspace.mjs` 的 `authorOf`（显示真实作者）。
- **验证**：`discussion-api` 单元测试（前文共享、顺序、审核在后、工具不外泄、采纳、@ 邀请、主专家补读且不重复）、
  `tool-preamble-runtime`（真实 DSH + 本地模拟模型：主专家与专家的前导语都进入工具调用、不留在回答里）、`expert-discussion-runtime`；
  `discussion-ui-smoke`（无自由讨论、审核选择、等待状态、前导语进卡片、采纳按钮、@ 菜单与邀请、无 @ 走主专家）；
  `scripts/evals/discussion-api-live.mjs`（真实 OpenCode Go 小模型，见 DESKTOP_IMPLEMENTATION 2026-09-24）。
- **已知限制**：工作模式和有序讨论的参加者/审核选择不随对话保存到应用数据库（模式重启回到"工作"，参加者选择存在本机浏览器存储）；
  新对话首条消息前看不到模式按钮；临时对话不支持讨论；前文只含文字与文件路径，附件原文需要专家自己用工具读取。

### 2.6 专家名册（设置 → 专家角色）

- **用途与操作**：增删、改名、调顺序、启用/停用专家；为每位专家选择模型（或"使用对话所选模型"）、编辑提示词和职责标签；
  所有启用的专家都用同一模型时，页面会给出提示。
- **状态**：✅（单元、界面）。
- **技术实现**：`desktop/expert-settings.mjs`；`scripts/expert-roster.mjs`；接口 `GET/POST /api/experts`；表 `experts`、`expert_roster_state`。
  稳定 id 是执行身份，名称只用于显示；默认名册只在首次启动时写入一次（方法学家、统计审稿人、魔鬼代言人）。
- **验证**：`discussion-api` 单元测试；`discussion-ui-smoke`（编辑、添加、移动、保存）。

### 2.7 任务秘书

- **用途与操作**：每个主对话有一位私有秘书（侧栏），历史与主对话分开；可选模型、推理强度、询问/完全接管，可上传附件。
  秘书可以用 `propose_main_draft` 工具起草给主专家的指令，界面出现可编辑的提案卡片，
  由用户确认后才填入主对话草稿，仍需用户自己发送。
- **状态**：✅（单元、DSH、界面、原生）。
- **技术实现**：前端 `desktop/assistant-chat.mjs`（秘书与全局助手共用）；后端 `scripts/assistant-chat-service.mjs`、`assistant-conversations.mjs`；
  接口 `GET /api/assistant`、`POST /api/assistant/chat|draft|model|approval|stop|proposal/resolve`；
  表 `assistant_conversations`、`assistant_drafts`、`assistant_settings`、`assistant_draft_proposals`、`assistant_attachment_drafts`。
  提案工具由 `session-control.mjs` 在秘书会话中注册（值 schema 使用 DSH 的 DSL）。每个助手会话一个 DSH 进程，空闲时最多保留 2 个。
- **验证**：`assistant-chat-service`、`assistant-conversations` 单元测试；`assistant-api-smoke`（含 `--native`）。
- **已知限制**：秘书没有自动读取主对话的能力，只看用户显式引用的内容（这是设计选择）。

### 2.8 全局助手与悬浮球

- **用途与操作**：左下角全局助手，可在独立窗口与悬浮球之间切换；可隐藏，隐藏时保留草稿、不停止任务；
  启动行为可设为关闭、悬浮球或展开；在助手窗口里点项目或工作站，会让主窗口跳到对应位置（BroadcastChannel `navigate` 消息）。
- **状态**：✅（原生）。
- **技术实现**：Tauri 命令 `open_secondary_window`、`set_assistant_mode`、`get_assistant_mode`、`show_assistant_menu`、`hide_assistant`（`main.rs`）；
  前端 `native-window.mjs`、`assistant-window-settings.mjs`；窗口尺寸存 `<exe 目录>/data/assistant-window.json`；
  启动偏好存表 `assistant_window_preferences`（接口 `/api/assistant-window/preferences`）；对话复用第 2.7 节的助手服务（scope=`global`）。
- **验证**：`assistant-window-preferences` 单元测试；`assistant-window-smoke`、`native-windows-smoke`、`native-assistant-geometry-smoke`。
- **已知限制**：截图快捷键和操作系统级全局热键未实现。

### 2.9 搜索

- **用途与操作**：Ctrl+K 命令面板：空输入时列出设置；输入后先显示匹配的设置和应用操作，再显示对话正文命中（最多 40 条，可定位到消息）；
  Ctrl+F 在当前对话中查找；"浏览全部"按名称、已加载消息和状态筛选。
- **状态**：✅（单元、界面）。
- **技术实现**：`desktop/preferences.mjs`（命令面板）；`scripts/chat-search.mjs`（SQLite 查询，排除已删除、已归档和助手私聊）；
  接口 `GET /api/chat/search`、`GET /api/chats/:id/messages?around=`。
- **已知限制**：不做语义搜索；不搜索附件正文。

### 2.10 工作站

| 子功能 | 用途与操作 | 状态 | 技术实现 |
|---|---|---|---|
| 全局计划 | 简洁事项的增删改、完成、附件 | ✅ 单元/界面 | `workbench.mjs`；`/api/workbench/plans`；`state/plans.json` |
| 项目日志 | 按项目显示关键节点，可新建、编辑、删除、撤销 | 🟡 | 存于项目 `workbench.json` 的 `logs`；"定位到消息"仍是原型行为，未与真实消息 id 核对 |
| 文献版本 | 拖入或选择文件形成版本组（自动编号），可打开原件、查看说明 MD、在资源管理器定位 | ✅ 单元/界面 | `/api/workbench/import|version|open`；原件放在 `paper_versions/<id>/` |
| 秘书整理版本说明 | 导入后（或手动"整理说明"）由秘书对比上一版，按设置里的模板写出 `.notes.md` | ✅ 单元（DSH 本地模拟） | `scripts/version-organizer.mjs`：独立的无工具 DSH 会话，只支持 md/txt/csv/tex/json，最多 40000 字符；每个项目可开关自动整理（`autoOrganize`）；接口 `/api/workbench/organize` |
| 研究导图 | 纵向主干与花括号分支；缩放、平移、选中、展开；编辑器支持连线、游离节点、插图、撤销/重做（50 步）、Ctrl+S 保存 | ✅ 单元/界面 | `workbench.mjs`；`/api/workbench/save`（按 revision 做乐观锁）、`/api/workbench/asset`；`mind_map/research.json` 与 `mind_map/assets/` |
| 项目文件夹 | 简易资源管理器：浏览、上一级、刷新、用默认程序打开、在资源管理器定位；可绑定外部文件夹 | ✅ 单元/界面 | `/api/workbench/files|bind|open`；`workbench-store.mjs` 解析路径时跳过符号链接并限制在项目根内；绑定关系存 `workbench-bindings.json` |

- **验证**：`workbench-store`、`version-organizer` 单元测试；`workbench-ui-smoke`。
- **已知限制**：导图导出、日志"定位到消息"尚未接入真实数据；DOCX/PDF 版本无法由秘书整理。

### 2.11 数据库、资料库与知识

- **用途与操作**：
  - "当前项目材料"与"我的资料"：列出原件和项目版本，可搜索、打开、查看详情、导入（单个文件 ≤14 MB）。
  - 知识条目：可从材料提出知识候选（研究经验 / 规范知识 / 私有），确认后变为"已采用"，并保留来源。
- **状态**：✅（界面）；"外部资源"页为 ⬜ 原型。
- **技术实现**：`desktop/library.mjs`；`scripts/library-service.mjs`（项目版本会自动登记为资源）；接口 `GET /api/library`、`POST /api/library/import|open`、
  `GET /api/knowledge`、`POST /api/knowledge/propose|accept`；表 `resources`、`knowledge`（命名空间 canonical/heuristic/private，状态 candidate/accepted）。
- **已知限制**：没有全文索引或检索工具；知识条目目前不会自动提供给模型。

### 2.12 模型与 Provider（设置 → 模型与 API）

- **用途与操作**：添加、编辑、删除 Provider（协议、地址、模型列表），填写只写的 API key，可从端点发现模型；
  每个输入框可选模型，推理强度只列模型声明支持的选项。
- **状态**：✅（单元、DSH、真实模型）。
- **技术实现**：`desktop/model-settings.mjs`、`provider-draft.mjs`（校验，不按模型名猜协议）、`reasoning.mjs`；
  `adapters/runtime-dsh/web-host.mjs` 在回环地址启动 DSH 完整 Web profile；`provider-service.mjs` 调用其 `settings`、`credentials`、`llm.discoverModels`、`session.modelCatalog` 服务。
  界面创建的 Provider 以 `sciencescope-` 开头，凭据存在 DSH 的文件型凭据库（不是系统钥匙串）。
  部分 Provider 需要会话亲和头：`state/runtime-client.json` 的 `sessionHeaders`，由 `host.mjs` 以启动补丁注入。
  接口：`GET /api/providers`、`POST /api/providers/save|discover|remove`、`GET /api/model-info`。
- **验证**：`model-settings`、`provider-draft` 单元测试；`real-provider-smoke`、`runtime-hardening-live-smoke`。

### 2.13 角色设置（人格与记忆 / 任务秘书 / 全局助手）

- **用途与操作**：编辑主专家、秘书、全局助手的 system prompt，设置新对话默认模型和推理强度；
  保存只影响新对话，已有对话要在空闲时点"应用已保存提示词"才会更新（历史保留），并有应用记录。
- **状态**：✅（单元、DSH、界面）。
- **技术实现**：`desktop/role-settings.mjs`；`scripts/role-settings.mjs`；接口 `/api/roles`、`/api/roles/save|apply|history`；
  表 `role_settings`、`role_bindings`（每个会话绑定的提示词快照）、`role_prompt_receipts`；
  运行时通过 DSH system-prompt section 替换 persona（`session-control` 的 `/persona`）。
  研究会话的指令发现以工作区为根，并替换掉 SDK 默认的编码助手人设（`research-context.mjs`）。
- **已知限制**："人格与记忆"页中的记忆管理未实现（目前与主专家提示词共用一页）。

### 2.14 其他设置页

| 设置页 | 状态 | 说明 |
|---|---|---|
| 个人资料与常规 | ✅ | 用户名、简介（只用于界面，不发给模型）；主题（浅色/深色/跟随系统）、密度、正文与代码字号、发送键、减少动画、滚动条、恢复默认。表 `profile`、`desktop_preferences`；接口 `/api/profile`、`/api/preferences`；跨窗口用 BroadcastChannel 同步 |
| 执行策略 | ✅ | 说明页，策略在每个对话的输入框里选 |
| 任务秘书 | ✅ | 角色设置 + 版本说明模板（表 `secretary_preferences`） |
| 全局助手 | ✅ | 角色设置 + 启动行为 |
| 数据库与文件、运行环境 | ✅ | 显示真实路径并可打开文件夹（`/api/settings/info|open-folder`，只接受固定目录 id）；不支持目录迁移 |
| 快捷键 | ✅ | 四项导航快捷键可录制重映射（冲突校验、恢复默认、跨窗口同步），旧键失效；表 `shortcut_settings`；`desktop/shortcuts.mjs` 是唯一派发入口 |
| 插件与技能 | ✅ | 本地 SKILL.md 的添加、编辑、启停、可恢复的移除（`adapters/runtime-dsh/skill-manager.mjs`，技能目录 `dsh/skills`）；DSH 插件清单只读（`/api/plugins/inventory`）。不支持安装插件包 |
| 专家角色 | ✅ | 见 2.6 |
| 内置浏览器、用量分析 | ⬜ | 显示"此设置尚未开放"，不提供假开关 |

验证：`desktop-preferences`、`profile-store`、`shortcut-settings`、`secretary-preferences`、`skill-manager` 单元测试；
`settings-ui-smoke`、`shortcuts-ui-smoke`、`extensions-ui-smoke`、`skills-runtime-smoke`。

### 2.15 安全边界

| 措施 | 实现 |
|---|---|
| 本地 API 口令 | 每次启动生成 32 字节 `apiToken`；所有 `/api/*`（包括 `/api/status`）要求 `Authorization: Bearer`，用常量时间比较 |
| 来源校验 | Host 必须是 `127.0.0.1:<端口>`，Origin（如果有）必须同源，防 DNS rebinding 和网页跨站调用 |
| 窗口权限 | Tauri capability 在运行时只授予宿主精确 origin；DevTools 关闭；辅助窗口的 URL 来自宿主状态，而不是主窗口当前地址 |
| 模型输出 | Markdown 经 DOMPurify 白名单过滤；链接只允许 http(s)，以新窗口打开；不渲染远程图片 |
| 密钥 | 只进 DSH 凭据库；补丁文件只含 `apiKeyEnv` 引用；Provider 错误原文不显示 |
| 文件访问 | 项目路径解析限制在项目根内，跳过符号链接；资料库原件路径用 realpath 校验；打开文件只接受已解析的本地路径 |

验证：`desktop-server` 单元测试（无口令/错误口令 401）；`native-api-token-smoke`（原生，六类窗口）。

---

### 2.16 界面外观层（界面刷新）

- **用途**：在不改动已批准原型结构和交互的前提下统一视觉：设计令牌（颜色、圆角、阴影、动效时长）、浅色/深色两套主题、
  按钮/输入框/菜单/对话框/表格/卡片/导图节点的统一样式，以及几个小交互：
  - 消息操作（复制、分支…）悬停或聚焦时才显示；复制后按钮就地显示"已复制"1.6 秒。
  - 流式回复末尾有闪烁光标；等待首字时显示三点动画。
  - Esc 停止正在运行的回复（菜单、对话框、命令面板打开或输入框有文字时不拦截）。
  - 底部状态栏显示真实运行时状态（`/api/status`，每 30 秒刷新，绿点/灰点），不再是原型文字。
  - 置顶项目只作为快捷入口，保持折叠，不再重复列出它的对话。
  - 秘书与全局助手空白时显示用途说明。
  - 正文/代码字号仍由设置中的 `--chat-font-size`、`--code-font-size` 决定；"减少动画"设置照常生效。
- **状态**：🟡。浏览器界面 smoke 全部通过、截图走查完成；尚未在 Windows 原生客户端目视验收。
- **技术实现**：`desktop/refresh.css`（最后加载的样式表，令牌定义在 `:root` 与 `:root[data-theme="dark"]`，
  深色令牌已从 `settings.css` 移入这里），`desktop/refresh.mjs`（上述小交互，只附加监听，不替换已有处理函数；
  `projectRow` 仅对置顶行做包装）。二者在 `scripts/build-desktop.mjs` 的资源白名单与页面注入中登记。
- **验证**：`chat-ui-smoke`、`settings-ui-smoke`（断言已更新为新令牌值）及其余界面 smoke；
  `scripts/ui-gallery.mjs <输出目录>` 用离线模拟数据生成 17 张截图（主页、对话、讨论、秘书、工作站、导图、数据库、
  设置四页、命令面板、右键菜单、输入框菜单、深色、全局助手窗口、悬浮球），用于前后对比。

### 2.17 研究资料库（后端框架，界面待 T05）

- **用途**：统一的科研数据后端，存放文献与资料（来源和按页、按章节的段落）、提炼的知识、理论模型/公式/算法、结论与主张、长期记忆和笔记，
  可互相链接（证据、引用、取代等），供人和智能体检索与引用。设计与分工见 `docs/design/RESEARCH_BASE.md`，调研见 `docs/design/RESEARCH_MEMO_2026-09-25.md`。
- **现在能做的**（均通过接口，**尚无专门界面**）：
  - 资料解析与索引：txt / csv / 代码、Markdown、LaTeX 已支持；PDF、DOCX 标为"不支持"，待 T04。
  - 中英文检索（FTS5 + 中文二元组，两字词可命中）、阅读窗口、引用标签解析（`[S3]`、`[S3 p.4]`、`[@a1b2c3d4]`）。
  - 条目的新建、修改（修订历史 + `expectedRevision` 防覆盖）、**取代**（旧记录保留并标为失效）、置顶、私有。
  - 智能体工具：主专家与每位专家子代理都有 `research_search`、`research_read`、`research_propose`。
    写入只能以提议形式进入"记忆收件箱"，由用户接受、修改或拒绝；工具的项目和角色由会话决定。
  - **项目简报**（常驻记忆）：从有效的共享条目生成，约 3500 字符预算；主专家每轮发送前如有变化就更新为系统提示中的一个分段，
    有序讨论和 @ 邀请的专家通过共享输入获得同一份简报；私有条目不给任何智能体，专家经验只给对应专家。
  - 使用回执：每轮记录用到了哪些记录（brief / search / read）。
  - 旧的 `knowledge` 表逐行镜像为条目（`legacy_id`）；原有的 `/api/knowledge` 和资料库页面暂时不变。
- **状态**：🟡 后端与智能体工具已实现并测试（单元、真实 DSH、真实模型）；界面（T05）、PDF/DOCX 解析与阅读器（T04）、文献元数据（T06）、
  证据台账界面（T07）、浏览器（T08）、自动整理（T09）、混合检索（T10：本地向量为主、关键词为辅、多问法，另加每轮记忆召回）未完成；当前只有关键词检索，按用户决定这只是降级方案，任务书在 `docs/tasks/`。
- **技术实现**：`scripts/research-base/`
  - `schema.mjs`（表）、`store.mjs`（校验、FTS 维护、提议、修订、回执）、`text-index.mjs`（中文二元组）、`search.mjs`（检索、阅读、引用、简报）、
    `ingest.mjs`（后台解析队列、分段）、`parsers/`（注册表 + text / markdown / latex）、`index.mjs`（路由与工具入口）。
  - 运行时：`host.mjs` 新增 `/host-call`（DSH 子进程回调宿主）、`setToolHandler`、`configureBrief`；
    `session-control.mjs` 注册三个工具（专家子代理在 `agent/created` 时注册），增加 `/brief` 系统提示分段。
  - `desktop-api.mjs`：挂载 `/api/research/*`；`toolContext` 把会话映射为对话、项目和角色（主专家 / 秘书 / 全局 / 专家）；
    发送前调用 `refreshBrief`；讨论的共享输入附上简报。
- **验证**：`research-base`、`research-api` 单元测试；`research-tools-runtime`（真实 DSH + 本地模拟模型：主专家与专家都能调用工具、简报进入系统提示、没有处理器时工具报告不可用）；
  `scripts/evals/research-base-live.mjs`（真实 OpenCode Go，2026-09-25：主专家自行检索、阅读并引用 [S1] / [S2] / [@…]，公式原样引用；提议进入收件箱；被 @ 的专家检索并提议主张）。
- **已知限制**：不支持 PDF / DOCX；没有界面；目前只有关键词检索（实测对换说法和跨语言问题几乎无效，见设计文档 §3.1），混合检索待 T10；在完全接管模式下，智能体的 bash 能读到应用数据目录（记录在设计文档 §8，需要单独处理 DSH 沙箱）；
  会话 ↔ 使用回执只覆盖主专家轮次（专家的回执待补）。

## 3. 接口索引（`scripts/desktop-api.mjs`）

所有接口需携带口令（2.15）。流式接口返回 NDJSON。

| 分组 | 接口 |
|---|---|
| 状态 | `GET /api/status`、`GET /api/settings/info`、`POST /api/settings/open-folder` |
| 工作区与对话 | `GET/POST /api/workspace`、`GET /api/chats`、`GET /api/chats/:id/messages`、`POST /api/chats/update|move|delete|mode|temporary-close` |
| 主对话 | `POST /api/chat`（流）、`POST /api/chat/stop`、`GET/POST /api/chat/outbox`、`GET /api/chat/activity`、`GET /api/chat/search` |
| 执行 | `GET /api/execution`、`POST /api/execution/goal|approval` |
| 研究资料库 | `/api/research/*`：sources、source、sources/update|remove|ingest、sync、search、read、items、item、items/update|supersede、links、links/remove、proposals、proposals/decide、brief、cite、usage、formats（见 2.17 与设计文档 §6） |
| 专家讨论 | `GET/POST /api/experts`、`POST /api/discussion`（流）、`POST /api/discussion/adopt`、`POST /api/discussion/cancel` |
| 秘书与全局助手 | `GET /api/assistant`、`POST /api/assistant/chat`（流）、`/assistant/draft|model|approval|stop|proposal/resolve` |
| 研究输入与资料 | `GET/POST /api/research-input/draft`、`GET /api/library`、`GET /api/library/preview`、`POST /api/library/import|open`、`GET /api/knowledge`、`POST /api/knowledge/propose|accept` |
| 工作站 | `GET /api/workbench`、`GET /api/workbench/files|asset|plans`、`POST /api/workbench/save|bind|import|asset|version|plans|open|organize` |
| 模型与角色 | `GET /api/providers`、`POST /api/providers/save|discover|remove`、`GET /api/model-info`、`GET /api/roles`、`GET /api/roles/history`、`POST /api/roles/save|apply` |
| 设置 | `/api/profile`、`/api/preferences`（+`/reset`）、`/api/shortcuts`（+`/reset`）、`/api/secretary/preferences`、`/api/assistant-window/preferences` |
| 技能与插件 | `GET /api/skills`、`GET /api/skills/read`、`POST /api/skills/save|enabled|remove`、`GET /api/plugins/inventory` |
| 宿主控制 | `POST /__host_shutdown`（独立的关闭口令，只由 Tauri 调用） |

## 4. 数据存储索引（SQLite `state/sciencescope.sqlite`）

| 表 | 用途 | 负责模块 |
|---|---|---|
| `schema_migrations`、`workspaces`、`projects`、`profile` | 版本、工作区快照、项目、个人资料 | `application-database.mjs`、`chat-store.mjs` |
| `chats`、`messages`、`runtime_bindings` | 对话、消息（按序号分页）、对话与 DSH 会话的绑定 | `chat-store.mjs` |
| `tool_activity` | 工具调用的展示投影（含工具前导语；专家回答也记录） | `tool-activity.mjs` |
| `chat_outbox`、`chat_outbox_state` | 主对话发送队列（重启后暂停） | `chat-outbox.mjs` |
| `execution_sessions` | 每个对话的执行策略与自动化目标 | `execution-service.mjs` |
| `research_input_drafts`、`research_input_receipts`、`research_input_consumed` | 研究输入草稿、发送回执、已消费版本 | `research-input-store.mjs` |
| `resources`、`knowledge` | 资料原件与项目版本索引；知识条目 | `application-database.mjs`、`library-service.mjs` |
| `assistant_conversations`、`assistant_drafts`、`assistant_settings`、`assistant_draft_proposals`、`assistant_attachment_drafts` | 秘书与全局助手 | `assistant-conversations.mjs`、`chat-attachments.mjs` |
| `role_settings`、`role_bindings`、`role_prompt_receipts` | 角色提示词、会话快照、应用记录 | `role-settings.mjs` |
| `experts`、`expert_roster_state` | 专家名册 | `expert-roster.mjs` |
| `rb_sources`、`rb_chunks`、`rb_items`、`rb_links`、`rb_proposals`、`rb_revisions`、`rb_usage`、`rb_fts`、`rb_meta` | 研究资料库 | `research-base/schema.mjs` |
| `discussion_rounds`、`discussion_entries` | 讨论轮次与专家回答元数据（含审核、采纳、主专家已读标记） | `discussion-service.mjs` |
| `desktop_preferences`、`shortcut_settings`、`secretary_preferences`、`assistant_window_preferences` | 各类设置 | 同名模块 |

DSH 自己的数据（会话历史、Provider 配置、凭据、技能）在 `.sciencescope-local/dsh/`，由 DSH 管理。

## 5. 测试与验收索引

| 类型 | 运行方式 | 说明 |
|---|---|---|
| 离线单元测试 | `npm test`（并发 2） | 39 个文件、120 项（2026-09-25）；部分启动真实 DSH，配合本地模拟模型。`expert-discussion-runtime` 的并发断言在满负载时偶发失败（单独运行和多次整套运行均通过），待加固 |
| 浏览器 smoke | `SCIENCESCOPE_BROWSER=<chromium 路径> node scripts/<name>-smoke.mjs` | 默认使用 Windows Edge；走生产资源路由。chat-ui、failed-send-draft、research-input-ui、marks-ui、settings-ui、shortcuts-ui、extensions-ui、workbench-ui、workspace-ui、desktop-navigation、discussion-ui。`desktop-interaction-smoke` 在 main 上同样失败（未走 API 令牌，待修）；`ui-gallery.mjs` 生成截图集 |
| DSH smoke | `node scripts/dsh-*-smoke.mjs`、`skills-runtime-smoke`、`assistant-api-smoke` | 真实 DSH + 本地模拟模型 |
| 原生 smoke | `native-*-smoke`、`assistant-window-smoke`、`shutdown-smoke` | 仅 Windows，需要已构建的 exe |
| 真实模型（付费，需主动运行） | `real-provider-smoke`、`real-stream-smoke`、`runtime-hardening-live-smoke`、`scripts/evals/*` | key 从环境变量或不进 Git 的 `.sciencescope-local/secret/` 读取 |

## 6. 原型中尚未接入真实功能的部分（⬜）

内置浏览器与浏览器设置、外部资源页、用量分析、记忆管理、通知、语言切换、目录迁移、截图快捷键、系统全局热键、
插件包安装与更新、导图导出、日志"定位到消息"、从消息分支的运行时分叉、PDF/DOCX 解析、资料全文检索、
安装包与数据保留升级。这些入口多数保留在界面上，并按规范显示"尚未开放"，而不是假装成功。

## 7. 如何维护本文档

- 功能行为、接口、数据表或验证状态发生变化时，在同一次提交里更新对应小节和"最近核对"行。
- 只写当前结果；过程、失败尝试和日期细节写进 `DESKTOP_IMPLEMENTATION.md`。
- 本文档描述现状，不构成设计约束：更好的设计可以替换这里写的实现，替换后更新本文档即可。
