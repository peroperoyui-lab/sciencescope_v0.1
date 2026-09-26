# ScienceScope 系统功能与技术说明

> **这份文档记录"现在是怎样"，不规定"必须这样"。**
> 它描述当前代码中每个功能的用途、状态、技术实现和验证证据，供开发者（Codex、Claude 及后来者）
> 快速了解现状，也方便用户查阅。功能的设计以后可以改变；改变时同步更新本文档即可，
> 不应因为本文档写过某种实现就拒绝更好的设计。产品意图与交互规则的依据仍是
> `00_MASTER_FUNCTIONS.md`、`02_INTERACTION_CONTRACTS.md` 与已批准的 `ScienceScope.html`。
>
> - 最近核对：2026-09-24，基线 `main@98e560a`（Claude 对照代码逐项核对）；2.2、2.4、2.5、2.16 于同日随界面刷新、标记与专家讨论修订（分支 `claude/determined-pasteur-jxpzw8`，未合并）更新；2026-09-25 新增 2.17 研究资料库（同一分支）；2026-09-26 新增 2.5b 对话纪要与历史回查，2.5 专家前文改为纪要 + 其后原文（同一分支）。
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

#### 2.1a 新建详情：工作文件夹与 Python 环境（2026-09-25）
- **用途与操作**：新建独立对话（侧栏"新对话"在没有聚焦项目时、右键"独立新对话"、Alt+Ctrl+N、命令面板，全部走 `ScienceScopeCreation.newChat`）
  先弹出应用内"新建独立对话"窗口：工作文件夹三选一（为这个对话新建 / 独立对话公共文件夹 / 使用已有文件夹 + 路径与"选择…"）和 Python 环境；
  取消不创建任何东西，确定后进入原有欢迎页草稿。项目内新对话继承项目，不弹窗；经窗口创建、尚未发送的草稿再次打开时不重复询问。
  "创建研究项目"页的"工作目录"不再预填原型路径，留空=在数据目录下新建；填写后先校验再建项目，并绑定到该文件夹；下方增加 Python 环境字段。
- **状态**：🟡 前端与文件夹校验、绑定 ✅（单元、界面）；Python 环境后端与原生文件夹选择框 ⬜（T11，Astra）。
  在 `/api/python/*` 出现之前，Python 字段只有"系统 Python"一个选项（即实际使用的解释器），不发送 `pythonEnvId`；
  文件夹选择按钮在 `folderPicker` 开关打开前不显示（见 2.18），不退回浏览器对话框。
- **技术实现**：
  - 前端 `desktop/creation-details.mjs`；选择保存在草稿（`workspaceChoice`、`pythonEnvId`），首条消息随 `/api/chat`、`/api/discussion` 发送。
  - 宿主 `scripts/workspace-folders.mjs` 的 `validateWorkFolder`：必须是已存在的绝对路径文件夹；拒绝磁盘根、系统目录、
    ScienceScope 自己的 `.sciencescope-local`（及包含它的文件夹）；整个用户目录给出警告，需再次确认。
  - `desktop-api.mjs` `ensureMainBinding`：独立对话首条消息时按选择确定运行工作区——新建 → `projects/independent/<chatId>`，
    公共 → `projects/independent`，已有 → 校验后的文件夹；`/api/workbench/bind` 也先校验；新增 `POST /api/folders/check`。
  - 后端尚未处理 `pythonEnvId`（T11）。
- **验证**：`tests/workspace-folders.test.mjs`；`scripts/creation-details-smoke.mjs`（窗口、取消、非法路径原地提示、已有文件夹成为 `startSession` 工作区、
  默认新建文件夹、项目页校验与绑定、项目内对话不弹窗、Python 待接入状态，浅色 / 深色截图）。
- 说明文字在"i"提示中（见 2.16）；窗口里只显示校验错误和警告。
- **最近核对**：2026-09-25（Claude，云端，浏览器 smoke；原生窗口未测）。

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
- **Windows 原生核对（2026-09-27）**：阶段 1/12a FAILED。询问模式下，同样的 `pwsh` danger-full-access 请求，Main 显示审批卡并在批准后成功，@ 专家没有卡且工具 `isError:true`；专家原始错误未出现在结果预览。真实 DSH + 本地模型对照，非付费验收。尚未修改运行时审批路由；详见 DESKTOP_IMPLEMENTATION r3。
- **最近核对（2026-09-27，r4）**：上述 r3 缺陷已修复并通过原生 12a 复验。DSH 普通子代理固定 `never`；只有宿主显式创建的讨论专家在创建窗口内继承本轮用户审批策略，并将请求带专家身份转发至原有审批卡。普通子代理和 Main 行为不变，专家沙箱范围不因角色名称扩大。真实 DSH + 本地模拟模型通过 Main/专家批准、拒绝、等待中取消、两专家相反决策并发；原生窗口通过四个批准/拒绝场景及刷新后工具结果持久化。工具结果预览复用有界脱敏投影。此处不代表付费或完整阶段 1 已通过。

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
  - **上下文可见性**：其他参与者（主专家、其他专家、审核专家）看到的是每条回答的最终文字，以及该回答展示给用户的文件（`present` 交付物）；
    工具调用本身（参数、结果、前导语）不进入任何其他参与者的上下文。
  - **身份**：每位专家被告知自己的名称与职责、在场的其他参与者（用户、主专家、其他专家），以及前文中只有标注为自己名字的消息才是自己说的。
  - 每位专家的文字实时出现；工具调用前的执行性前导语归入该回答的工具记录卡片（见 2.2）；"停止"取消整轮（含审核）。
- **状态**：🟡。单元、界面 smoke、真实 DSH（本地模拟模型，含工具前导语）已通过；真实模型端到端见"验证"；尚未在 Windows 原生客户端实测。
- **技术实现**：
  - 运行时：`session-control.mjs` 的 `/experts`。每位专家是 DSH 自带 `dsh-subagent` 服务的一个进程内 `spawn` 子代理，
    挂在当前对话会话下，有自己的人设（persona）和可选的模型/推理强度；同一轮所有专家拿到同一份冻结输入，并行执行。
    文字、工具调用（带参数预览与前导语）和工具结果按顺序以 `expert-delta/expert-tool/expert-tool-result/expert-end` 回传。
  - 应用层 `scripts/discussion-service.mjs`：
    - `transcript()` 把对话前文（用户、主专家、专家的最终文字，未采纳的审核除外）组成带编号的 `<message n=… speaker=… role=…>` 块：
      先放任务秘书的最新纪要，再放纪要覆盖范围之后的全部原文（向前多带 4 条衔接；没有纪要时为全部原文）。不按 token 截断；
      只有 24 万字符的安全边界，触发时写明哪些编号未显示、可用 `chat_recall` 读取（见 2.5b）。
      回答若用 DSH `present` 工具展示了文件（图片、文档等交付物），块末附 `[Files presented with this answer]` 列表（路径与说明）；
      只读取或中途修改过的文件、工具调用、工具结果、前导语都不传（2026-09-26 用户要求；此前传的是所有工具参数里出现过的路径）。
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
  新对话首条消息前看不到模式按钮；临时对话不支持讨论；前文只含文字与展示过的文件路径，文件内容需要专家自己用工具读取；
  长期对话靠纪要与回查保留早期内容（2.5b，设计见 `design/EXPERT_CONTEXT.md`）。
- **上下文显示**：输入框的上下文圆环显示主专家；悬停或点击时弹出层同时列出本对话中每位作答过的专家在其最近一次作答结束时的上下文占用
  （专家每轮都是新子代理，所以这是该轮实际携带的量）。实现：`session-control.mjs` 的 `measureContext()`（与主专家的 `/context-usage` 同一算法）
  在子代理释放前测量，随 `expert-end` 结果返回，存 `discussion_entries.context_json`；`GET /api/execution` 返回 `expertContexts`；
  `desktop/context-meter.mjs` 绘制。验证：`expert-discussion-runtime`（真实 DSH 返回测量值）、`deliverables-smoke`（弹出层数值）。

### 2.5a 回答中展示的文件（交付物）
- **用途**：模型用 DSH `present` 工具声明的文件显示在该回答下方：图片为缩略图卡片，其他文件为文档卡片；点击用系统默认程序打开。
- **状态**：✅（界面 smoke）；原生客户端未测。
- **技术实现**：前端 `desktop/deliverables.mjs`（从回答的工具记录中取成功完成的 `present` 调用；缩略图经带口令的 `hostBlob` 取回，最多缓存 40 个对象 URL）；
  宿主 `scripts/deliverables.mjs`：`GET /api/chats/deliverable?chatId&path`（只返回图片，≤20 MB）、`POST /api/chats/deliverable/open`。
  只有本对话中某次成功的 `present` 调用声明过的路径才会被读取或打开；相对路径按该对话的运行工作区解析。
- **验证**：`deliverables-smoke`（缩略图为真实图片、文档卡片、重新加载后仍显示、只读过的文件和任意路径被拒、专家前文只含展示的文件）。
- **最近核对**：2026-09-26（Claude，云端）。

### 2.5b 对话纪要与历史回查（2026-09-26）
- **用途与操作**：任务秘书为每个对话维护一份纪要（研究目标、已定结论与出处编号、被否定的方案、分歧、各方立场、文稿与文件状态、待办），
  每轮结束后在后台增量更新。对话"…"菜单 → 对话纪要：查看、编辑（保存为新一版，秘书之后在此基础上继续）、让秘书立即更新。
  主专家和所有专家都能随时用只读工具查阅：`project_memory`（纪要、项目日志、计划、导图、稿件版本）和 `chat_recall`（按关键词检索或按编号逐字读取对话原文）。
  查找规则写在每位专家的系统提示（人设末尾）和主专家的项目简报一节，不使用 agent.md。
- **状态**：🟡。单元、界面 smoke、真实 DSH 工具注册、真实便宜模型评测已通过；原生客户端未测。
- **技术实现**：
  - `scripts/chat-minutes.mjs`：表 `chat_minutes(chat_id, revision, text, through_ordinal, author 'secretary'|'user', updated_at)`，每版保留。
    更新 = 上一版纪要 + 新消息（每步 ≤6 万字符，可多步），用秘书角色的模型（未设置时用对话模型），`noTools` 会话，用完释放；
    主对话轮次持久化后与讨论结束后调度（防抖 1.5 秒）。**每轮主对话后更新用量偏高，将由 T18 改为按规则触发（讨论后 / 每 n 条 / 每 n token / 进出项目，设置可调）**；更新期间用户保存了修改则停止，不覆盖。消息编号为对话序号 +1。
  - `scripts/project-memory.mjs`：`MEMORY_GUIDE`（查找规则）与两个工具的实现。对话与项目由会话上下文决定；临时对话与全局助手拒绝。
    `chat_recall` 按编号一次最多 40 条 / 6 万字符并返回 `next`；检索返回最多 12 条带编号片段。
  - `session-control.mjs` 在 `registerResearchTools` 中为主专家和专家注册两个工具，经 `/host-call` 交给宿主；`desktop-api.mjs` 路由并把规则附到简报。
  - 接口：`GET /api/chats/minutes?chatId`、`POST /api/chats/minutes {chatId,text,expectedRevision}`（版本过期 409）、`POST /api/chats/minutes/refresh`。
  - 前端 `desktop/minutes.mjs`（菜单项、渲染 Markdown、编辑、刷新；"i"提示说明用途）。
- **验证**：`tests/chat-minutes.test.mjs`（增量、用户修改优先与 409、回查检索与逐字读取、project_memory、简报与人设带规则、专家输入含纪要与其后原文）；
  `tests/research-tools-runtime.test.mjs`（真实 DSH 向主专家和专家提供两个工具）；`scripts/minutes-smoke.mjs`（菜单、渲染、编辑、秘书在修改上继续）；
  `scripts/evals/minutes-live.mjs`（真实便宜模型，PASS，见 DESKTOP_IMPLEMENTATION 2026-09-26）。
- **已知限制**：检索是关键词匹配（T10 完成后可换混合检索）；纪要质量取决于秘书模型；秘书面板本身不自动读取主对话（2.7 的设计不变，纪要是独立的后台整理）。
- **最近核对**：2026-09-26（Claude，云端）。

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
- **已知限制**：秘书目前不自动跟进主对话，只看用户显式引用的内容；引用整段对话时只取最近 20 条（每条截到 3000 字）。
  2026-09-26 起改为自动跟进（每次作答前附上自上次以来的进展，长期未用时附纪要），设计见 `design/CONTEXT_ACCESS.md`，任务 T17（待执行）。

### 2.8 全局助手与悬浮球

- **用途与操作**：左下角全局助手，可在独立窗口与悬浮球之间切换；可隐藏，隐藏时保留草稿、不停止任务；
  启动行为可设为关闭、悬浮球或展开；在助手窗口里点项目或工作站，会让主窗口跳到对应位置（BroadcastChannel `navigate` 消息）。
- **状态**：✅（原生）。
- **技术实现**：Tauri 命令 `open_secondary_window`、`set_assistant_mode`、`get_assistant_mode`、`show_assistant_menu`、`hide_assistant`（`main.rs`）；
  前端 `native-window.mjs`、`assistant-window-settings.mjs`；窗口尺寸存 `<exe 目录>/data/assistant-window.json`；
  启动偏好存表 `assistant_window_preferences`（接口 `/api/assistant-window/preferences`）；对话复用第 2.7 节的助手服务（scope=`global`）。
- **验证**：`assistant-window-preferences` 单元测试；`assistant-window-smoke`、`native-windows-smoke`、`native-assistant-geometry-smoke`。
- **已知限制**：截图快捷键和操作系统级全局热键未实现。
  全局助手目前不能查阅其他项目的对话、纪要、日志与计划（查阅工具对它关闭）；跨项目查阅见 `design/CONTEXT_ACCESS.md`，任务 T17（待执行）。

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
- **状态**：✅（界面）；"外部资源"页的站点用系统浏览器打开（`/api/open-url`），站点增删仍是原型的本地状态、不持久化（⬜）。
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
| 个人资料与常规 | ✅ | 用户名、简介（只用于界面，不发给模型）；界面语言（2.19）、界面字体、主题（浅色/深色/跟随系统）、密度、正文与代码字号、发送键、减少动画、滚动条、恢复默认。表 `profile`、`desktop_preferences`；接口 `/api/profile`、`/api/preferences`；跨窗口用 BroadcastChannel 同步 |
| 执行策略 | ✅ | 说明页，策略在每个对话的输入框里选 |
| 任务秘书 | ✅ | 角色设置 + 版本说明模板（表 `secretary_preferences`） |
| 全局助手 | ✅ | 角色设置 + 启动行为 |
| 数据库与文件、运行环境 | ✅ | 显示真实路径并可打开文件夹（`/api/settings/info|open-folder`，只接受固定目录 id）；不支持目录迁移 |
| 快捷键 | ✅ | 四项导航快捷键可录制重映射（冲突校验、恢复默认、跨窗口同步），旧键失效；表 `shortcut_settings`；`desktop/shortcuts.mjs` 是唯一派发入口 |
| 插件与技能 | ✅ | 本地 SKILL.md 的添加、编辑、启停、可恢复的移除（`adapters/runtime-dsh/skill-manager.mjs`，技能目录 `dsh/skills`）；DSH 插件清单只读（`/api/plugins/inventory`）。不支持安装插件包 |
| 专家角色 | ✅ | 见 2.6 |
| 内置浏览器、用量分析 | ⬜ | 入口隐藏（功能开关 `inAppBrowser`、`usage`，见 2.18） |

**界面字体**（2026-09-25）：默认使用随客户端安装的思源黑体（Noto Sans SC 可变字体，SIL OFL 1.1，npm `@fontsource-variable/noto-sans-sc` 5.3.0，
101 个按 unicode-range 拆分的 woff2，共约 4.6 MB，用到哪些字才加载哪些）。设置 → 个人资料与常规 → 界面字体可选择本机已安装的任何字体：
- 字体列表 `GET /api/fonts[?refresh=1]`（`scripts/system-fonts.mjs`）：Windows 通过 PowerShell 读取系统字体集合（UTF-8 输出，保留"微软雅黑"等本地化名称，含当前用户安装的字体），
  2026-09-26 原生验收小修：同时读取 `.Name` 与 `GetName(2052)`，避免英文 PowerShell UI culture 丢失中文名称；保留原英文名称，不改变已有偏好。
  失败时读取注册表 HKLM/HKCU 的字体列表；其他系统用 fontconfig。去重、去掉竖排 "@" 字体，名称按原样列出（字体自身名称异常时会显示为乱码，仍可选择）。
- 保存到 `desktop_preferences.ui_font`（`'default'` 或字体名；拒绝可能跳出 CSS 字符串的字符）；点击"保存"后立即应用并同步到其他窗口：
  根元素 `--ss-font` = `"所选字体", var(--ss-font-default)`，默认栈为 思源黑体 → 微软雅黑 → 黑体 → 苹方 → Noto Sans CJK → 系统字体；代码字体不变。
  原型中内联的 Georgia 装饰标题也跟随界面字体。选择前的"研究 ScienceScope…"一行是即时预览，不代表已保存。
- 打包：`scripts/build-desktop.mjs` 的 `VENDOR_ASSETS` 同时决定复制的文件和生产路由的白名单（`scripts/preview-desktop.mjs`），字体许可证随之复制到 `desktop/vendor/noto-sans-sc/LICENSE`。
- 验证：`desktop-preferences`、`system-fonts` 单元测试；`settings-ui-smoke`（默认字体为内置思源黑体且中文子集经生产路由加载、列表显示、预览、保存后全局生效、重启后保持）。
  Windows PowerShell 路径已于 2026-09-27 原生实测：322 个字体名、287 ms，包含中文名称与 HKCU 用户字体；黑体重启保持、英文字体中文回退与恢复默认通过。

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
| 打开网址 | `POST /api/open-url` 只接受 http/https，经口令保护，用系统默认浏览器打开；网页内容不能调用 |

验证：`desktop-server` 单元测试（无口令/错误口令 401）；`native-api-token-smoke`（原生，六类窗口）。

---

### 2.16 界面外观层（界面刷新）

- **用途**：在不改动已批准原型结构和交互的前提下统一视觉：设计令牌（颜色、圆角、阴影、动效时长）、浅色/深色两套主题、
  按钮/输入框/菜单/对话框/表格/卡片/导图节点的统一样式，以及几个小交互：
  - 消息操作（复制、分支…）悬停或聚焦时才显示；复制后按钮就地显示"已复制"1.6 秒。
    2026-09-27 原生小修：反馈监听器改为捕获阶段，避免原有 document 处理器停止冒泡导致反馈不显示；系统剪贴板及原生提示已复验，并加入 chat-ui smoke。
  - 流式回复末尾有闪烁光标；等待首字时显示三点动画。
  - Esc 停止正在运行的回复（菜单、对话框、命令面板打开或输入框有文字时不拦截）。
  - 底部状态栏显示真实运行时状态（`/api/status`，每 30 秒刷新，绿点/灰点），不再是原型文字。
  - 置顶项目只作为快捷入口，保持折叠，不再重复列出它的对话。
  - 秘书与全局助手空白时显示用途说明。
  - 说明性文字统一放在"i"提示后面（2026-09-25，`desktop/info-tip.mjs`，标准见 `02_INTERACTION_CONTRACTS.md`）：
    悬停/聚焦预览，点击固定，Esc、点击别处或滚动关闭；在 `<dialog>` 中挂到对话框内部；在菜单项和选项里点击"i"不会选中该项。
    模块最先加载，使它的捕获监听先于菜单和操作处理。设置行 `row()` 的说明进入提示，路径和版本等数据用 `valueRow()` 直接显示。
    已转换：新建窗口、创建项目页、设置（常规、执行策略、运行环境/数据库、快捷键、个人资料、角色、模型 API）、插件与技能、
    文件预览、资料库、工作站绑定目录、审核结论条、标记弹层与材料文本标记对话框、输入框菜单。
  - 正文/代码字号仍由设置中的 `--chat-font-size`、`--code-font-size` 决定；"减少动画"设置照常生效。
- **状态**：🟡。浏览器界面 smoke 全部通过；深色导图白底已修复。2026-09-27 原生深浅色/中英文页面重新走查，英文关闭已通过；完整阶段 1 在专家审批不一致处停止，不能视为通过。
- **技术实现**：`desktop/refresh.css`（最后加载的样式表，令牌定义在 `:root` 与 `:root[data-theme="dark"]`，
  深色令牌已从 `settings.css` 移入这里），`desktop/refresh.mjs`（上述小交互，只附加监听，不替换已有处理函数；
  `projectRow` 仅对置顶行做包装）。二者在 `scripts/build-desktop.mjs` 的资源白名单与页面注入中登记。
- **验证**：`chat-ui-smoke`、`settings-ui-smoke`（断言已更新为新令牌值）及其余界面 smoke；
  `creation-details-smoke` 覆盖"i"提示（点击固定、不选中选项、Esc、菜单项）；
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
  证据台账界面（T07）、浏览器（T08）、自动整理（T09）、混合检索（T10：本地向量为主、关键词为辅、多问法，另加每轮记忆召回；默认模型为轻量的 multilingual-e5-small，更换入口以后再做）未完成；当前只有关键词检索，按用户决定这只是降级方案，任务书在 `docs/tasks/`。
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

### 2.18 可选功能开关与原型页面（2026-09-25）
- **用途**：界面上不出现"尚未开发 / 即将提供 / 原型 / 示例"一类提示。未完成功能的入口隐藏，完成后由宿主打开开关；原型设计包的页面目录和演示页不可达。
- **状态**：✅（界面 smoke、文案审计）。
- **技术实现**：
  - 宿主 `GET /api/status` 返回 `features`（`scripts/desktop-api.mjs` 的 `capabilities.features`）：
    `pythonEnvs`、`folderPicker`（由原生外壳通过 `SCIENCESCOPE_NATIVE_FEATURES=pickFolder` 声明）、`inAppBrowser`、`branch`、`usage`、`materialsPanel`、`mapHistory`、`changeLog`、`pluginManagement`、`dataRelocation`，目前全部为 false。
  - 前端 `desktop/features.mjs`（在 `info-tip.mjs` 之后最先加载）：按 `FEATURES` 表注入 CSS 隐藏入口（默认隐藏，状态返回后再显示）；
    包装原型的 `menu()` 去掉隐藏功能的菜单项和指向隐藏路由的链接；包装 `go()` 使隐藏路由不可导航；命令面板同样过滤（`preferences.mjs`）。
  - 原型专属、永远不可达：`help`（页面目录）、`page-doc`（逐页开发说明）、`resume`、`run`、`compose`、`free`、`welcome`。
  - 学术站点在 `inAppBrowser` 关闭时用系统浏览器打开（`POST /api/open-url`）。
  - 同时清理了原型页面上的说明文字：创建项目页的说明框、导图编辑器的两段提示（进入"i"）、外部资源卡片的副标题、首页输入框下的提示行；
    "本轮更新说明"改为本轮实际完成的内容；设置"用量分析""内置浏览器"不再显示"此设置尚未开放"页。
- **验证**：`scripts/ui-gallery.mjs` 的文案审计模式（`AUDIT_COPY=<路由,…>`）遍历全部路由与菜单并记录每个菜单项的结果；
  `creation-details-smoke` 断言窗口中没有"即将 / 待接入 / 尚未"并且没有文件夹选择按钮；`features-smoke`（开关、菜单、路由、站点打开）。
- **任务**：开关与任务书对应表见 `docs/tasks/FEATURE_FLAGS.md`。
- **最近核对**：2026-09-25（Claude，云端，浏览器 smoke）。

### 2.19 界面语言（中文 / English，2026-09-26）
- **用途与操作**：设置 → 个人资料与常规 → 界面语言，选"中文"或"English"，保存后立即生效并同步到其他窗口，重启后保持。
  菜单、按钮、设置、"i"提示、提示条（toast）、宿主返回的错误信息、占位文字都会切换；对话内容、渲染后的 Markdown、输入框内容、项目 / 对话 / 专家等用户输入的名称保持原样。
  任务秘书的内置版本说明模板随语言切换（用户保存过自己的模板后不再变化）。角色与专家的内置提示词本来就是英文，面向模型，不随界面语言变化。
- **状态**：✅（单元、界面 smoke）；原生客户端未测。
- **技术实现**：
  - 已批准的原型 HTML 不改，所以翻译在显示层完成：`desktop/i18n.mjs` 在文字节点和界面属性（`placeholder`、`title`、`aria-label`、`data-info-tip`、`alt`）上按词典改写，
    用 MutationObserver 跟随后续渲染；切回中文时逐一恢复原文。跳过区域：消息正文、渲染的 Markdown、文件预览正文、`textarea`（只翻译它的占位文字）、`pre/code`、可编辑区域、`[data-i18n-skip]`。
  - 规则：整句命中 → 模式命中（`EN_PATTERNS`，处理带数字或名称的句子，捕获的名称若不是界面文字则原样保留）→ 已知片段拼接；只要还剩任何不认识的中文，整段保持原样（用户数据不会被翻一半）。
  - 词典 `desktop/i18n-en.mjs`（约 1160 条）；`node scripts/i18n-extract.mjs --missing` 列出桌面模块、宿主消息和原型脚本中尚未翻译的片段（原型演示内容和面向模型的提示词有意不译）。
  - CSS 生成的文字（助手空白页说明、等待模型回复）用 `:root[lang="en"]` 覆盖。
  - 偏好 `desktop_preferences.language`（`zh-CN` / `en`，"恢复默认"不改变语言）；上次的语言同时缓存在本机，启动时先应用，避免闪现中文。
- **验证**：`tests/i18n.test.mjs`（翻译规则、词典格式）；`scripts/i18n-smoke.mjs`（设置切换、重启保持、属性与"i"提示、新建窗口、toast、用户数据不变、内置模板随语言切换、切回中文完全恢复）；
  `scripts/ui-gallery.mjs`（`GALLERY_LANG=en` 生成英文截图；`AUDIT_LANG=en AUDIT_COPY=<路由>` 遍历全部可达页面与菜单，列出仍未翻译的文字——目前只剩用户 / 演示数据）。
- **最近核对**：2026-09-26（Claude，云端）。

界面语言原生核对补充（2026-09-27，Astra）：r2 的英文标题栏失败由 Claude 改为按按钮字形派发；r3 已在真实 Windows 原生窗口分别通过深浅色 − / □ / ×，两次英文关闭后各 11 个已记录进程全部退出。此项已有原生证据，不再仅依赖模拟 Tauri 的 i18n smoke；完整阶段 1 仍因专家审批失败而停止。

## 3. 接口索引（`scripts/desktop-api.mjs`）

所有接口需携带口令（2.15）。流式接口返回 NDJSON。

| 分组 | 接口 |
|---|---|
| 状态 | `GET /api/status`（含 `features`，见 2.18）、`POST /api/open-url`、`GET /api/settings/info`、`POST /api/settings/open-folder` |
| 工作区与对话 | `GET/POST /api/workspace`、`GET /api/chats`、`GET /api/chats/:id/messages`、`GET /api/chats/deliverable`、`POST /api/chats/deliverable/open`、`POST /api/chats/update|move|delete|mode|temporary-close` |
| 主对话 | `POST /api/chat`（流）、`POST /api/chat/stop`、`GET/POST /api/chat/outbox`、`GET /api/chat/activity`、`GET /api/chat/search` |
| 执行 | `GET /api/execution`、`POST /api/execution/goal|approval` |
| 研究资料库 | `/api/research/*`：sources、source、sources/update|remove|ingest、sync、search、read、items、item、items/update|supersede、links、links/remove、proposals、proposals/decide、brief、cite、usage、formats（见 2.17 与设计文档 §6） |
| 对话纪要 | `GET/POST /api/chats/minutes`、`POST /api/chats/minutes/refresh`（2.5b） |
| 专家讨论 | `GET/POST /api/experts`、`POST /api/discussion`（流）、`POST /api/discussion/adopt`、`POST /api/discussion/cancel` |
| 秘书与全局助手 | `GET /api/assistant`、`POST /api/assistant/chat`（流）、`/assistant/draft|model|approval|stop|proposal/resolve` |
| 研究输入与资料 | `GET/POST /api/research-input/draft`、`GET /api/library`、`GET /api/library/preview`、`POST /api/library/import|open`、`GET /api/knowledge`、`POST /api/knowledge/propose|accept` |
| 工作文件夹 | `POST /api/folders/check`（校验，见 2.1a） |
| 工作站 | `GET /api/workbench`、`GET /api/workbench/files|asset|plans`、`POST /api/workbench/save|bind|import|asset|version|plans|open|organize` |
| 模型与角色 | `GET /api/providers`、`POST /api/providers/save|discover|remove`、`GET /api/model-info`、`GET /api/roles`、`GET /api/roles/history`、`POST /api/roles/save|apply` |
| 设置 | `/api/profile`、`/api/preferences`（+`/reset`）、`/api/fonts`、`/api/shortcuts`（+`/reset`）、`/api/secretary/preferences`、`/api/assistant-window/preferences` |
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
| `chat_minutes` | 对话纪要（每版保留，作者为秘书或用户） | `chat-minutes.mjs` |
| `discussion_rounds`、`discussion_entries` | 讨论轮次与专家回答元数据（含审核、采纳、主专家已读标记） | `discussion-service.mjs` |
| `desktop_preferences`、`shortcut_settings`、`secretary_preferences`、`assistant_window_preferences` | 各类设置 | 同名模块 |

DSH 自己的数据（会话历史、Provider 配置、凭据、技能）在 `.sciencescope-local/dsh/`，由 DSH 管理。

## 5. 测试与验收索引

2026-09-27 r3 原生补充：英文 − / □ / × 在深浅色下通过，黑体重启恢复、中文字体/回退/重置、标记、工具卡片及本地 DSH 专家调度已检查；阶段 1 在专家审批与 Main 不一致处 FAILED / 停止，2–3 未开始。模拟请求与真实模型结果分开；真实凭据缺失，付费请求为 0。原生测试进程已全部退出。详细逐项状态见 DESKTOP_IMPLEMENTATION 顶部。

2026-09-27 r3 快速基线核对（Astra，Windows，`56be32d`）：`npm test` 126/126；i18n（含英文标题栏动作回归）、settings-ui、desktop-interaction 三个浏览器 smoke 全部通过。阶段 1 原生重新验收待执行；不以模拟 Tauri 窗口调用代替实机证据。

最近核对补充：2026-09-26（Astra，Windows 第 2 次本地验收，基线 `115f6b7`）。阶段 0 PASS：
重新 `npm ci`、桌面资源构建、`npm test` 126/126；18 个纯浏览器 smoke 和 `assistant-api-smoke --ui` 全部通过。
助手检查使用真实 DSH + 本地模拟模型，12 次本地请求、0 付费请求。`cargo build --offline` 通过，
独立 temp 数据目录中的原生客户端启动成功，生产宿主状态 available=true。阶段 1 随后部分执行，在英文标题栏关闭按钮无效处 FAILED / 停止；阶段 2–3 未开始。
逐项清单及证据见 DESKTOP_IMPLEMENTATION 顶部 r2 小节。

最近核对：2026-09-26（Astra，Windows 11，基线 `b875ac7`，本地验收阶段 0）。
`npm ci`、桌面资源构建和 `npm test` 126/126 通过；chat-ui、discussion-ui、marks-ui、research-input-ui 通过。
settings-ui 首次在重载后的字体值断言失败（`default`，预期 `DejaVu Sans`），原断言复跑通过，尚不能据此确认根因或稳定性。
desktop-interaction 的认证/路由夹具改用生产宿主后，仍在旧选区颜色断言失败：实际为刷新样式的半透明 accent，预期为旧灰色。
未修改生产样式或测试预期。按 LOCAL_VALIDATION 的停止条件，阶段 1–3 未测，不据此升级任何原生验收状态。
详细命令、截图与未执行项见 DESKTOP_IMPLEMENTATION 顶部同日小节。
**同日 Claude 复核**：交互 smoke 的两处断言已对齐当前批准的界面（选区为刷新后的主题色、自由讨论已取消）；设置 smoke 的失败是真实缺陷——其他模块加载完成时的整页重绘会丢掉设置页尚未保存的选择，已修复并加入回归步骤。云端 `npm test` 126/126、全部 23 个浏览器 smoke 通过；Windows 需从阶段 0 重跑。

| 类型 | 运行方式 | 说明 |
|---|---|---|
| 离线单元测试 | `npm test`（并发 2） | 40 个文件、121 项（2026-09-25）；部分启动真实 DSH，配合本地模拟模型。`expert-discussion-runtime` 的并发断言在满负载时偶发失败（单独运行和多次整套运行均通过），待加固 |
| 浏览器 smoke | `SCIENCESCOPE_BROWSER=<chromium 路径> node scripts/<name>-smoke.mjs` | 默认使用 Windows Edge；走生产资源路由。chat-ui、failed-send-draft、research-input-ui、marks-ui、settings-ui、shortcuts-ui、extensions-ui、workbench-ui、workspace-ui、desktop-navigation、discussion-ui、creation-details。`desktop-interaction-smoke`（2026-09-26 改走生产路由并对齐当前界面，通过）；`ui-gallery.mjs` 生成截图集 |
| DSH smoke | `node scripts/dsh-*-smoke.mjs`、`skills-runtime-smoke`、`assistant-api-smoke` | 真实 DSH + 本地模拟模型 |
| 原生 smoke | `native-*-smoke`、`assistant-window-smoke`、`shutdown-smoke` | 仅 Windows，需要已构建的 exe |
| 真实模型（付费，需主动运行） | `real-provider-smoke`、`real-stream-smoke`、`runtime-hardening-live-smoke`、`scripts/evals/*` | key 从环境变量或不进 Git 的 `.sciencescope-local/secret/` 读取 |

## 6. 尚未接入真实功能的部分（⬜）

界面上不再显示"尚未开放"一类提示（2026-09-25 用户要求）。未完成功能的入口由功能开关隐藏（2.18），各有任务书：
内置浏览器与浏览器设置（T08）、从消息分支（T12）、用量分析（T13）、项目材料面板（T05）、导图历史 / 版本说明页 / 版本比较 / 修改记录（T14）、
插件安装与更新（T15）、目录迁移（T16）、Python 运行环境与原生文件夹选择（T11）、PDF/DOCX 解析（T04）。
另有尚无任务书的：记忆管理界面（并入 T05/T09）、通知、截图快捷键、系统全局热键、导图导出、日志"定位到消息"、安装包与数据保留升级（ROADMAP 阶段 B）。

## 7. 如何维护本文档

- 功能行为、接口、数据表或验证状态发生变化时，在同一次提交里更新对应小节和"最近核对"行。
- 只写当前结果；过程、失败尝试和日期细节写进 `DESKTOP_IMPLEMENTATION.md`。
- 本文档描述现状，不构成设计约束：更好的设计可以替换这里写的实现，替换后更新本文档即可。
