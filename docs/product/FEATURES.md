# ScienceScope 现有功能

本文描述新核心 `app/` 今天实际能做什么。它取代 `docs/SYSTEM_SPEC.md`（已归档为 `docs/archive/legacy/SYSTEM_SPEC_2026-10-18.md`），后者的 1–7 节描述的是旧原型。

旧线已在 R5 删除；最后仍包含旧原型的 main 提交为 `1dc18e9a3c8f7539e092dcb4ae2fd681ec4ac513`，历史实现从该提交查阅。原生外壳只启动新核心 `app/main.js`。

核对基线：`4ede4b1`（2026-10-18），逐项对照 `app/` 代码。

---

## 0. 怎么读、怎么维护

- 本文只写"现在是怎样"，不规定"必须这样"。设计依据在 `docs/architecture/`（核心模型、运行时接口、数据与角色）和 `docs/design/`（设计系统、交互约定），方向和任务队列在 `docs/plans/ROADMAP.md`，按日期的过程记录在 `docs/log/IMPLEMENTATION_LOG.md`。
- 行为改变时，在同一个提交里更新对应小节。只改实现、不改用户能看到的行为时不必改本文。
- 第 2 节每个用户可见的功能区一节，每节固定四段：用户能做什么、实现位置、关键数据、已知限制。每节保持简短；细节写进设计文档，这里只放链接。
- 第 3–5 节是索引：接口、数据表和测试。新增路由、迁移或测试类型时顺手补一行。
- 验收数字不写在这里；无法在代码里核实的说法不要写进来。

---

## 1. 总览

### 1.1 进程结构

```
原生外壳 src-tauri（Tauri 2，Windows）
  └─ 启动 Node 宿主：node app/main.js --data <数据目录>
       ├─ 核心 app/core        数据库、事件、工作区资源、项目/会议/消息/发言
       ├─ 服务 app/services    发言调度、上下文组装、工具、秘书、记忆、资料库、Python、文献版本…
       ├─ 运行时 app/runtime   模型与智能体循环（pi-ai + pi-agent-core），只有这里引用模型包
       └─ 本地 HTTP 服务 app/server  只做解析、校验口令、调用核心与服务
  └─ WebView 加载界面 app/ui（Preact + htm，由本地 HTTP 服务提供静态文件）
```

- `app/main.js` 生成一次性的 64 位十六进制口令，监听 `127.0.0.1` 的随机端口，然后向标准输出打印一行 JSON：`{ url, token, ui, dataRoot, shutdownPath, shutdownToken }`。原生外壳读这一行，把 `ui` 地址加载进主窗口。
- `app/app.js` 装配核心、各项服务、运行时和 HTTP 服务。测试用同一个 `createApp`，只把运行时换成 `app/runtime/scripted.js`。
- 所有 `/api/` 请求都要带口令（`Authorization: Bearer` 或 `?token=`），否则返回 401。请求体上限 64 MB，导入资料、文献版本、附件和编辑台块修改不设此上限。
- 界面通过 `GET /api/events`（Server-Sent Events，可用 `since` 或 `Last-Event-ID` 续传）接收核心事件，不轮询。
- 原生外壳（`src-tauri/src/main.rs`、`new_app.rs`）只启动新核心；R5 已删除旧宿主分支。外壳负责窗口、文件夹选择、用系统程序打开文件和网址、全局助手窗口与浮球；在 Windows 上用 Job 对象管理子进程树。

### 1.2 数据目录 `data/`

数据根由 `--data`、环境变量 `SCIENCESCOPE_DATA` 或默认值决定：安装版是 `<安装目录>/data`，开发版是 `.sciencescope-local/data`。所有位置由 `app/core/paths.js` 的 `dataPaths()` 统一给出。

```
data/
  sciencescope.sqlite        唯一的 SQLite 数据库（WAL 模式），表见第 4 节
  settings.json              全部设置，读取时与默认值合并
  agents/<参与者id>.md        AI 参与者定义：YAML 头 + 提示词正文
  plans.md                   全局计划
  minutes/<会议id>.md         不属于项目的会议的纪要
  projects/<名称>-<项目id>/   项目自带文件夹
    workbench/plans.md  map.json  log.md
    notes/<名称>.md
    minutes/<会议id>.md
    versions/<组id>/v<n>-<版本id>/<原文件>  以及同名 .notes.md 版本说明
    desk/<会话id>/<原文件>    DOCX 会话工作副本；.state/ 保留初始包和落盘序号
  workspaces/<随机id>/ 或 shared/   独立对话的工作文件夹
  library/originals/          资料库原件（导入时复制，文件名为随机 id）
  library/project-files/<项目id>/<内容哈希>  项目文件的去重副本，旧内容暂保留
  deliverables/<id>/          回答下方展示的交付文件副本
  models/multilingual-e5-small/  本地语义检索模型（用户点击下载后才有）
  python/                     uv 缓存、解释器、受管环境 envs/
  runtime/pi/sessions/        每位参与者在每个会议里的模型会话
  logs/                       model-requests.jsonl、startup.log、原生宿主日志
  secret/credentials.yaml     API 密钥（按名称引用，不进数据库、不进环境变量）
  backups/                    每次数据库迁移前的自动备份
  temp/                       工具输出过长时保存的完整内容
```

- 用户选择的外部项目文件夹只被引用（`projects.folder`），会议在里面运行命令和读写文件；应用纪要只保存在 ScienceScope 数据目录。
- 工作区文件可以在应用外直接编辑。下次读取时，宿主发现内容哈希与最后一次修订不同，会补记一条 `external` 修订，撤销历史保持真实。
- 原子写入和项目文件夹改名遇到 Windows 的 `EPERM/EBUSY/EACCES` 会短暂重试（50/100/200/400 毫秒），仍失败时返回 `PATH_BUSY`（409），原文件和记录不变。

### 1.3 启动与关闭

- 启动顺序：打开数据库并执行迁移（有旧数据时先备份）→ 补齐默认参与者 → 初始化 Python 与语义检索 → 创建运行时与服务 → 启动后台工作（调度、纪要、记忆、版本说明）→ 开始监听。上一次异常退出留下的未结束发言改记为取消，挂起的批准卡片改记为已取消。
- 各阶段时间点每次启动写一行到 `data/logs/startup.log`，首屏渲染时间由界面调用 `POST /api/startup/rendered` 补上。
- 关闭：原生外壳调用 `POST /api/shutdown`，或进程收到 SIGINT/SIGTERM。宿主停止调度、等后台工作和已取消的发言收尾，再关闭运行时和数据库（WAL/SHM 文件随之清理）。

---

## 2. 功能模块

### 2.1 项目与对话

**用户能做什么**

- 新建项目：填写名称和可选研究目标；工作目录可留空（在数据目录下自动新建），也可选已有文件夹，其中的文件不会被移动或覆盖。
- 新建对话：项目内对话、独立对话（`Ctrl+Alt+N`）。独立对话创建时选工作文件夹（为这个对话新建、独立对话公共文件夹、选择已有文件夹）和 Python 环境。
- 侧栏（2026-10-20 重做）：顶部新对话、知识库（收件箱待确认数）、工作站（右边按钮打开当前项目简报）、搜索；下面置顶（有才显示）、项目、独立对话（有才显示）和「全部对话」（`Ctrl+Shift+K`，按名称或项目搜索全部对话，可取消归档；每行有和侧栏一样的对话菜单（⋯ 或右键），置顶的对话标图钉）；底部用户、全局助手、设置。宽度可拖动并记住，字号跟「侧栏字号」。
- 每个项目默认显示最近 5 个对话（当前打开的总在），其余收进「还有 N 个」。行尾显示状态：运行中转圈（项目收起时转在项目行上）、待批准、失败、排队、暂停，没有状态时显示多久前活动（今天、昨天、N 天/周/个月）。
- 对话菜单：重命名（F2，侧栏行获得焦点或在对话页时按）、置顶、移到项目…（列出其他项目和「移出项目，变成独立对话」）、归档；运行中不能移动或归档。也可把对话拖到项目行上。移动后底部提示可「撤销」。随对话移动的：纪要文件（含附属秘书对话）；工作文件夹原来是默认位置（项目目录或数据目录下的 `workspaces/`）时改到新项目，移出项目时新建一个独立文件夹；用户自选的文件夹不变。没有删除，只有归档（用户 2026-10-20）。
- 从任意一条消息"从这里分支"出新对话；导出当前对话为 Markdown，导出项目快照为 zip（项目文件夹加全部会议记录）。
- 全量导出后端将全部对话、工作站、知识库、专家、技能、设置和 SQLite 副本写成普通文件夹；界面入口由后续界面接入。任务在后台线程执行，支持取消，关闭应用即取消，未完成目录保留标记。外部项目文件夹只记录路径；项目资料副本可通过 `includeProjectCopies` 选择复制。服务商自定义 header 及 MCP 明文 header/env 的值在设置和数据库副本（含历史及事件）中改为 `<已移除>`，保留名称、引用及表行数；原库不修改。
- 项目文件夹页：浏览绑定的工作目录（未绑定时显示项目自带文件夹），新建文件夹、重命名、移到系统回收站、用资源管理器或默认程序打开；更换位置不会移动已有文件，已有会议继续用原工作目录。

**实现位置**：`app/core/projects.js`、`app/core/meetings.js`、`app/services/project-files.js`、`app/services/export.js`、`app/server/routes/projects.js`、`app/server/routes/meetings.js`；界面 `app/ui/components/sidebar.js`、`all-chats.js`、`project-new.js`、`python-choice.js`、`project-folder.js`。

**关键数据**：表 `projects`、`meetings`、`meeting_members`；会议的 `work_folder`、`temporary`、`parent_meeting_id`/`fork_message_id`；设置 `shortcuts`。

**已知限制**

- 项目和对话只能归档或把文件移到回收站，没有从数据库彻底删除的入口。
- 侧栏和对话列表不显示临时会议（版本说明整理用的后台会议）。

### 2.2 主对话与时间线

**用户能做什么**

- 和主专家对话：流式回答，Markdown 和 KaTeX 公式（代码块暂无语法高亮和复制按钮）；回答里引用资料（如 `[S3 p.4]`）可点开预览并高亮原文段落。
- 行动时间线：每次工具调用、思考、自动重试和上下文压缩各占一行，运行中展开、完成后收起。连续的同类工具调用（中间的思考也算在内）合成一行，如"运行了 6 条命令"，点开看每一步；命令的细节显示 `$ 命令`、输出和退出码。"视图 → 简洁执行记录"隐藏工具卡，等待批准的卡片仍显示。
- 状态行显示当前阶段（连接模型、思考、重试、等待批准、压缩上下文）和结束情况（已停止、失败并附原因、达到单次输出上限）。
- 发送与停止是同一个按钮，`Esc` 停止。回答进行中发送的消息进入待发队列，可编辑、取消、暂停和继续，重启后保留。
- 待发队列支持 `POST /api/meetings/:id/outbox/:itemId/steer`：工作模式下将选中消息插入当前发言，记录 `refs: {steered:true,turnId}` 并排在回答之前；回答已结束时普通发送。有序讨论进行中返回可读错误并保留队列。工作模式下恰好一个回答在进行时，队列每条显示「现在插入」；插入的消息上方标「回答进行中插入」。
- 消息菜单：复制、复制消息位置、引用到输入框、重新回答、继续、从这里分支；对话内查找；`Ctrl+K` 搜索项目、对话和消息。
- 输入栏选择模型和思考强度；上下文环显示当前用量，达到压缩门槛时变为提醒色。
- 回答下方的交付物：AI 用 `workspace_present` 展示的文件收成一行"交付了 N 个文件"，点开是带缩略图的清单；单击用默认程序打开，右键预览。回答正文用交付时的同一路径写 Markdown 图片或链接，图片直接显示在正文里，链接点开即打开文件。

**实现位置**：调度 `app/services/conductor.js`；单次发言 `app/services/turn-runner.js`、`turn-activity.js`；上下文 `app/services/context-assembly.js`、`app/core/context.js`；待发队列 `app/core/outbox.js`；交付物 `app/services/deliverables.js`；界面 `app/ui/components/` 下的 `meeting.js`、`chat-message.js`、`timeline.js`、`status-line.js`、`composer.js`。

**关键数据**：表 `messages`（状态 `streaming/done/max_tokens/failed/cancelled`）、`turns`（`phase`、`error`、`usage_json`）、`tool_calls`（`kind`：`tool`、`thinking`、`retry`、`approval`、`compaction`；`preamble`）、`meeting_outbox`、`meeting_outbox_state`、`message_deliverables`；设置 `appearance.transcript`、`appearance.chatFontSize`、`composer.sendKey`。

**已知限制**

- 主对话输入栏的模型菜单选的是**当前对话**的模型（存在会议的 `policy.model`）；第一项「跟随默认模型」表示跟随主专家定义里的模型或设置里的默认模型。欢迎页上先选好的模型随第一条消息存进新对话。全局默认模型只在设置 → 模型与服务商里改（2026-10-19）。
- 网页只能读取已知地址（`web_fetch`），没有网页搜索。

### 2.3 执行方式与批准

**用户能做什么**

- 输入栏的"执行方式"有两档：**请求批准**（新对话默认）和**常规**。选择保存在会议规则里。
- 后端支持「总是允许」：规则存在设置 `approvals.rules`，项目内的对话共用，独立对话只在本对话生效；可按完整命令、命令前缀、文件、含子目录的文件夹、包名或全部包授权，删除规则后重新询问。复合命令不匹配前缀规则。批准卡片的「总是允许」菜单列出这些范围；步骤详情写明「你在 {时间} 总是允许了这类操作」或「按规则自动允许」。设置 → 执行与批准 →「总是允许的操作」按项目或独立对话分组列出规则，可逐条删除。
- 批准请求 `args.scopes` 为 `{kind,value,label,values}` 数组，说明用 `t(label, values)` 显示；接口接受 `decision: 'always', scope`。自动允许记录在工具调用 `result.approvedBy: {ruleId}`，多条包名规则共同覆盖时另有 `ruleIds`，通过 `tool.updated` 和 `tool.ended` 送到界面，执行失败也保留。
- 请求批准时，运行命令（`shell`）、在数据目录之外写入或修改文件（`write_file`、`edit_file`）和安装 Python 包（`python_env_install`）之前，时间线出现批准卡片，状态行显示"等待你的批准"。卡片紧跟在等待它的那一步（或其所在的合组行）下面，那一步行尾写"等待批准"。处理后卡片消失，批准成为那一步的状态：拒绝的行尾写"已拒绝"，谁在何时处理写在细节底部。批准请求记录它所属工具调用的 `callId`。拒绝或停止不记为发言失败。
- 常规模式直接执行，随时可以停止。停止会中止模型请求、正在运行的命令（连同子进程树）和 uv。
- 秘书和全局助手面板的回答里同样出现批准卡片。

**实现位置**：`app/services/approvals.js`（批准挂在宿主工具边界，所有角色和运行时共用）、`app/services/builtin-tools/`、`app/server/routes/approvals.js`；界面 `app/ui/components/execution-mode.js`、`approval.js`。

**关键数据**：会议 `policy_json.approval`（`ask` = 请求批准，`auto` = 常规；旧会议缺省按 `ask`）；`tool_calls` 中 `kind='approval'` 的条目，状态 `pending/approved/rejected/cancelled`。

**已知限制**

- 批准只在进程存活时有效；重启后挂起的批准一律记为已取消，不会重放。
- 自动连续执行已移除。升级时旧自动化会议转为普通对话，历史消息与其他会议规则保留；旧目标文本和目标表删除，不再提供目标工具或接口。

### 2.4 有序讨论与专家

**用户能做什么**

- 输入栏上方的"工作方式"：**工作**（主专家持续处理任务，用 `@专家名` 邀请专家回答；同时提及多位时并行独立作答，按提及顺序展示）和**有序讨论**（所选专家读取同一份前文，并行独立作答，按名册顺序展示）。
- 工作模式多位提及仅本轮按段分配：首个提及之前的共同前提加各自分段，相邻提及共用后文、重复提及合并分段；原文保留，重试与继续复用本轮分段及截止点，后续上下文恢复原文。回答 `refs.discussion={kind:'mention',triggerMessageId,cutoffSeq,input}`，`input` 为该专家分段；停止同时取消本轮所有专家。各专家的回答同时显示各自的状态框。
- 有序讨论可指定一位独立审核人：所有专家结束后才运行，只审核不作答。审核结论默认不进入后续上下文，用户"采纳"后才进入；已被后续发言读取的采纳不能撤回（409）。
- 讨论条显示每位专家的真实状态（等待、作答、工具、完成、未完成）；重试和继续只针对原作者；停止取消整轮及未开始的审核。
- 发言中的专家只占一个固定高度的状态框：当前一步和最后三行（回答、前导语或思考）；还没轮到的写"等前面的专家说完"。说完后换成完整回答；需要批准时卡片显示在框下面。
- 上下文弹层显示主专家和本会议每位专家最近一次的实测用量。
- 设置 → 专家：增删专家、改名称、职责标签、提示词和模型，启用或停用，调整顺序，添加独立审核；改动自动保存，从下一轮生效，每次保存可撤销。名册人数不设上限。

**实现位置**：`app/services/conductor.js`、`conductor-round.js`、`app/core/participants.js`、`app/core/agent-file.js`、`app/core/defaults.js`；界面 `app/ui/components/discussion-strip.js`、`discussion-menu.js`、`discussion-mention.js`、`discussion-message.js`、`discussion-usage.js`、`settings-roles.js`。

**关键数据**：会议 `policy_json`（`mode`：`direct`/`round`，`order`，`reviewer`，`respondent`）；`messages.adopted`；`meeting_members`（专家第一次发言时加入）；参与者定义 `agents/<id>.md` 的 `role`、`panel`（`expert`/`reviewer`）、`enabled`、`position`、`model`。默认名册：方法学家、统计审稿人、魔鬼代言人，独立审核人默认停用。

**已知限制**

- 没有自由讨论（专家之间来回对话）。
- MCP 按 `plans/X_TOOLS_SKILLS_MCP.md` 在阶段 2 接入，插件包在 alpha 之后。

### 2.5 任务秘书与纪要

**用户能做什么**

- 每个主对话有一份纪要：秘书在后台按规则增量整理（研究目标、已定结论及出处、被否定方案、分歧、文稿与文件状态、待办）。用户可在"对话纪要"窗口直接编辑，用户的修改优先，之后秘书在其基础上继续；可查看历史版本、让秘书立即更新。
- 自动总结的触发条件可在设置里开关和调整：有序讨论结束后、每 n 条主对话消息、每 n 个新 token、进入项目时、离开项目时。
- 可选择随总结直接更新工作站的导图、计划、日志和文献版本（每项 关闭 / 直接更新）。
- 打开主对话右侧的秘书面板和秘书单独对话：秘书读取主对话里它还没看过的部分（先等纪要，再补纪要之后的原文），可以修改工作站，也可以为主专家起草下一步指令。草稿以"秘书提案"卡片出现，可编辑、填入主对话输入框、忽略或撤销。
- 秘书面板可单独选模型和执行方式，宽度可拖动并记住。

**实现位置**：`app/services/secretary/`（`minutes.js` 纪要、`policy.js` 触发规则、`publish.js` 更新工作站、`chat.js` 与 `catch-up.js` 秘书对话、`proposals.js` 提案）；界面 `app/ui/components/` 下的 `secretary-panel.js`、`secretary-proposal.js`、`minutes-dialog.js`、`settings-secretary.js`。

**关键数据**：资源 `minutes`（键为会议 id）；表 `minutes_coverage`、`minutes_status`、`minutes_workbench_updates`、`secretary_pending_projects`、`secretary_chats`、`secretary_cursors`、`main_draft_proposals`、`main_draft_proposal_history`；设置 `summary.*`。

**已知限制**

- 纪要只是总结，从不截断会议原文；主专家和专家重建会话时读"纪要 + 纪要之后的原文"，需要时用工具回查。
- 纪要只保存在 ScienceScope 数据目录，生成和编辑均不写入外部项目文件夹；已有外部纪要文件保持原样。旧导出状态列保留但不再读写，状态接口不返回导出字段。

### 2.6 全局助手

**用户能做什么**

- 一场不属于任何项目的全局对话，可以查阅和修改所有项目的数据，帮用户在项目之间整理信息。
- 浏览器里是右侧面板；原生客户端里是独立的助手窗口和桌面浮球，可展开、收起为浮球、隐藏（隐藏不清除历史，也不停止正在运行的任务）。
- 设置 → 全局助手：改提示词；选择启动客户端时不打开助手、只显示浮球、或显示浮球与助手对话（下次启动生效）。
- 面板可单独选模型和执行方式，附件、标记和批准卡片与主对话相同。

**实现位置**：`app/services/assistant/`（`index.js` 确保唯一的助手会议，`overview.js` 跨项目概览）；`src-tauri/src/main.rs`（助手窗口与浮球）；界面 `app/ui/components/assistant-panel.js`、`assistant-surface.js`、`assistant-orb.js`、`assistant-window-settings.js`、`app/ui/assistant-window.js`。

**关键数据**：表 `assistant_state`（唯一的会议 id 与概览哈希）；设置 `assistant.startup`（`closed`/`orb`/`expanded`）、`appearance.panels.assistant`。

**已知限制**

- 跨项目概览只来自正式的研究会议（项目纪要目标、计划、导图），不包括临时会议、秘书对话和助手自己的对话；细节靠工具查阅。

### 2.7 研究输入（附件、标记、截图）

**用户能做什么**

- 输入框的加号：添加文件、从资料库选择资料或条目（右侧"项目材料与引用"面板，不会自动发送）、截图（桌面版调用 Windows 截图工具框选，完成后作为图片附件加入；默认先隐藏 ScienceScope 窗口，设置 → 个人资料与常规可关；浏览器开发环境里提示用系统截图后粘贴）。文件也可拖入或粘贴。
- 附件以标签显示在输入框上方；发送后用户消息上方显示图片缩略图（点开看大图）、文件和标记标签；"本次上下文"显示这条消息实际附带的材料。
- 图片（png、jpg、webp、gif）作为图片内容直接交给支持图片的模型；所选模型不支持图片时照常回答文字，状态行写明「这个模型不能读图片，换一个支持图片的模型再试」。
- 所有参与者可调用 `view_image({path?,sourceId?,page?,region?})` 查看图片、PDF 页或比例坐标区域，PDF 页码从 1 开始；公式、图表提取不全时可看原图。不支持视觉的模型收到「当前模型不能看图，请换支持图片的模型」，工具正常返回。PDF 用 pdfjs-dist 与 canvas 渲染，裁切后输出 PNG，长边最多 1600 像素，不做 OCR。
- 看图工具结果的 `preview` 为 `{path,mimeType,width,height,name,sourceId,page,region,url}`；路径在 `data/deliverables/previews/`，`url` 为需授权的 `/api/preview/content?kind=tool&turnId=…&id=工具callId`。数据库及事件只保存这些元数据，图片内容经运行时交给模型。时间线上该步骤写「查看图片 文件名 · 第 N 页 · 局部」，展开显示看到的图片，点击在预览中打开；模型不能看图时只显示那句提示。
- 在消息、文件预览和资料原文里选中文字可以"添加标记"，附可选备注；也可"引用至任务秘书"或"引用至全局助手"。标记列表可定位、改备注、移除或全部清除。
- 发送后附件和标记随消息保存；发送失败时恢复，且不覆盖之后新加的标记。分支对话保留这些引用。

**实现位置**：`app/services/research-input/`（`index.js` 草稿操作，`compile.js` 把材料和标记编进模型输入）、`images.js` 图片原件与图片内容，`app/core/research-input.js`；运行时 `send()` 的第四个参数是图片（`app/runtime/port.js`）；原生截图 `src-tauri/src/screenshot.rs`；界面 `app/ui/components/research-input.js`、`materials-panel.js`、`mark-selection.js`、`marks-popover.js`、`app/ui/research-input-actions.js`。

**关键数据**：表 `research_input_drafts`（每个输入框一份草稿，带版本号）、`message_research_input`（每条消息发送时的快照）、`meeting_outbox.input_json`。普通附件导入资料库（`rb_sources`，原件在 `library/originals/`）；图片不进资料库，元数据在 `input_images`，原件同样在 `library/originals/`。消息里的图片字段：`researchInput.materials[]` 的 `type=image`、`id`、`name`、`mimeType`、`bytes`、`url`、`selectionId`。设置 `composer.hideWindowOnScreenshot`（默认 true）。

**已知限制**

- 文件内容不直接塞进提示词：模型拿到资料 id 和页数，用 `research_read` 分页读取。
- 不能解析的其他格式保存为"不支持"，模型只看到标题和元数据。
- 每轮会把所选消息里的图片都发给模型，图片多时请求会变大。
- 原生截图只在 Windows 上有。

### 2.8 资料库与检索

**用户能做什么**

- 导入 PDF、DOCX、Markdown（`.md`/`.qmd`/`.rmd`）、LaTeX（`.tex`/`.ltx`）和纯文本；原件按字节保存，解析为带页码（PDF）和章节的段落。解析失败或部分解析会标明，原件仍可打开；可重新解析。
- 知识库页面（KB-9，2026-10-21）：页头是范围菜单（「知识库（所有项目共用）」/「项目数据库：<项目名>」；外部资源也在这个菜单里）和标签，右边新建和导入。知识库是全局的，标签有文献与资料、实体、知识、模型与公式、主张与证据、代码和「记忆 ▾」（记忆、记忆收件箱、项目简报），列出全局导入的资料和各项目里的文献（论文、预印本、学位论文、报告、章节、书）、全部条目和实体；项目里的数据、代码、文稿只在项目数据库里。列表和检索用 `knowledge=1`（`GET /api/research/sources`、`/api/research/search`）。项目没有自己的知识库，只有数据库：标题「数据库」，只有本项目的文献与资料和「记忆 ▾」。侧栏「知识库」打开上次停留的范围（设置 `appearance.knowledgeScope`，`global` 或 `project`），第一次是知识库。
- 工具栏：搜索（回车；实体页按名称和别名找）、漏斗筛选（资料：类型、解析状态、阅读状态、标签；实体：种类、标签、只看 AI 添加的；条目：子类型、状态、置顶）、排序（资料：导入时间、标题、年份、关系数，加升降序；实体：名称、最近修改、关系数），右边是总数和「表格 / 图」切换（只在知识库，项目数据库只有表格；设置 `appearance.knowledgeView` 记住上次的选择）。
- 列表一行一个节点：资料行是作者 · 年份 · 期刊 · 项目内目录、解析状态（已解析、部分解析、解析失败、等待解析、仅索引文件名、只有题录）、关系数和导入日期；条目行是子类型和正文开头；实体行是种类、别名和说明，AI 添加的带 AI 标记。悬停出预览和 ⋯，右键同 ⋯。记忆仍用卡片。
- 单击一行在右侧打开节点详情（宽度可拖动并记住）：属性；相连的节点按关系和方向分组（如「使用」「被使用」），每条带证据页码（点开在预览里高亮原文；消息证据跳回那条消息）和 AI 标记（悬停说明谁在哪次对话里加的，点击跳回）；点相连的节点切到它的详情；人工和整理出的关系可删除，提示里可撤销。实体还能加减标签、编辑、删除（可撤销），底部历史可恢复到某一版。条目在详情里看正文、公式和变量表，编辑、置顶、取代、归档、修订历史在 ⋯。
- 没有原件的资料（笔记、只有题录）预览时显示已解析的段落。
- 条目：知识、模型（理论、公式、算法等）、主张、笔记、记忆。可新建、编辑（保存为新修订）、取代（旧条目保留并链接）、置顶、归档、查看修订历史；可设为"仅自己"，这类条目不进入 AI 候选。
- 统一检索资料段落和条目：默认中英文关键词检索（SQLite FTS5）。开启"本地混合检索"后，加上本机向量检索；每次结果标明本次是关键词还是混合检索。
- 图检索扩展（KB-7，KB-2c 复测）：`knowledge.retrievalExpansion` 默认开启，已有显式关闭设置保留；工具可传 `graph:{depth:1|2}` 单次开启、`false` 单次关闭。前 20 条段落/条目和前 5 个实体作种子，沿可见有效关系找原文；图结果通常最多四分之一，稀疏结果至少允许一条，最多 5 条附 `via`，保留原文引用和 `origin`。同候选池混合排序加至多 10% PPR 加分，经实体找到的最强原文置于该实体之前；图阶段超 300 毫秒、为空或异常回原排序。带本机向量模型的 20 题复测中，一般题前三/前12保持100%/100%，方法题由10%/30%提高到80%/100%，满足默认开启条件；无新增依赖，界面开关与路径显示待接。
- AI 用 `research_search` / `research_read` 检索和分页读取，读取结果报告剩余长度，不截断全文；引用格式兼容 `[S3 p.4]`、复合、中文和全角写法。
- 文件预览：PDF（文字层、翻页、高亮）、DOCX（可读视图与版式视图）、Markdown、LaTeX、CSV、代码（只读）和图片。
- 打开项目文件夹根目录或在应用内新建、改名、添加、回收文件后，扫描分两段：先每500项一个事务建档并写文件名索引，不算哈希、不复制、不解析；随后后台并发2处理内容，每个文件之间让出事件循环。建档期间重复请求合并，内容处理期间重复请求复用建档结果并安排一次跟进。
- 队列保存在资料的 `queued` 状态；重启继续，已完成项不重复解析。单次读原件同时计算哈希和写副本，副本身份和解析投影一起提交；改绑项目文件夹强制重新确认内容，归档暂停、取消归档恢复。持续写入文件自动跟进一轮后仍排队，等下次扫描或启动处理。
- 项目索引POST只等建档并返回原计数加 `queued`；同路径GET给出 `phase/total/done/queued/failed`，临时事件 `research.index.progress` 每项目每秒最多一次且保留最终状态。既有逐资料完成事件不变，界面进度展示待 Claude 接入。规模实测见 [KB-2c审阅报告](../handoff/reports/KB-2c.md)。
- 每个项目文件都有资料记录、相对路径及数据目录内的哈希副本；同内容去重，修改后的旧副本暂保留。无法解析或超过 200 MB 的文件只索引文件名和路径并保留原因，关键词和语义文档均可找到；复制或读取失败标为失败，下次扫描重试。
- 原件打开、重解析、预览和看图优先读项目现文件，路径不存在时读取副本；`research_read` 继续分页读取已索引的段落，项目文件夹移走后仍可查阅。扫描不向用户文件夹写文件，不抽实体或整理卡片。
- 扫描先枚举目录，再按内容哈希识别移动：保留资料 ID、段落和边，只更新路径与文件名；确实消失的文件删除资料。根目录不可访问时保留索引，遇到读取失败时暂缓本轮删除，等下次成功扫描。
- 删除资料共用一个服务：清理资料、段落、全文与向量索引、派生边及该资料产生的 extracted 边；人工关系标 removed 并进入可撤回的知识库版本，实体保留。全局导入原件进系统回收站；撤回关系版本恢复边，不恢复资料原件。
- 项目副本不随删除资料自动清理；接口报告每个项目的总占用与无人引用占用，用户显式清理后释放旧副本。清理与该项目扫描串行，同一哈希仍被其他资料引用时保留。

**实现位置**：`app/services/research/`（`store.js`、`items.js`、`search.js`、`citations.js`、`parsers/`、`semantic/`）、`app/services/preview/`；界面 `app/ui/components/research-*.js`、`knowledge-panel.js`、`knowledge-fields.js`、`file-preview.js`、`settings-semantic.js`、`app/ui/readers/`。

**关键数据**：表 `rb_sources`、`rb_chunks`、`rb_items`、`rb_revisions`、`rb_fts`（可重建）、`rb_vec_docs`、`rb_vec`（384 维 sqlite-vec，可重建）；设置 `semantic.enabled`、`semantic.downloadSource`（默认 `modelscope`；可选 `official`/`modelscope`/`hf-mirror`/`custom`，已保存的选择不变）、`semantic.customDownloadUrl`；模型 `data/models/multilingual-e5-small/`。

**已知限制**

- 本地模型（multilingual-e5-small int8）需用户明确点击下载，每个文件校验 SHA-256，校验失败报错且不换源；"官方"源连接失败时会尝试 HF 镜像。需要 AVX2、8 GB 内存和 5 GB 可用空间，不满足时只用关键词检索。
- 对话进行中暂停建立索引；索引缺失、版本不一致或向量阶段超过 300 毫秒时，整次退回关键词检索。
- 扫描件没有 OCR；没有文献元数据在线查询和 BibTeX 互通。
- 改名或移动先按大小、修改时间做唯一配对，保留旧ID；无法快配时后台按哈希处理。未编辑排队条目合回旧ID，已编辑条目保留两条及各自引用，旧资料成为副本并以 `metadata.originalFileMissing:true`、`missingFolderPath` 标明原路径已不存在；共享副本只由显式清理回收。详见[审阅报告](../handoff/reports/KB-2c.md)。
- 项目扫描跳过隐藏目录、`node_modules`、`__pycache__`、`.venv`、`renv`；项目自带文件夹里 ScienceScope 自己的 `workbench/`、`notes/`、`minutes/`、`versions/` 不算项目文件。
- 新导入或新扫描到的文件（类型为「文件」）解析出参考文献段落或 DOI 时，自动标为论文，参与相似边和论文卡片；用户选过的类型不改。文件名可在首段建档后检索，全部正文可检索仍需等待后台解析。

### 2.8a 知识库存储（表格页和节点详情见 2.8；图视图见 2.8b′）

- 解析完成后按段落哈希增量生成派生关系：参考文献的 DOI 或归一化标题精确匹配库内资料，后导入被引文献会补边；重新解析内容变化时移除该资料端点的旧派生关系再生成。
- 文献类资料使用已有资料级向量生成 `similar-to`，按余弦相似度从高到低连边，两端均计入上限。同一对仅一条，新导入只使用空余名额，不挤掉已有关系；无向量时跳过，建好后补做。`settings.knowledge.similarity` 默认 `{threshold:0.85,maxPerPaper:3}`，上限 0 不建相似边；修改设置排队全量重算，仅处理 `method='similar'`，引用边不动。不调用语言模型、不进修订或历史版本。
- `kb_jobs` 保存派生任务与内容哈希：重启恢复未完成任务，发言时暂停，失败自动尝试至三次后保留错误并支持手动重试。服务汇总各状态数量、全量相似重算状态及失败原文；任务变更发临时 `knowledge.jobs.changed`，关系变更发 `knowledge.changed`。设置页和接口由后续任务接入。
- 实体、带原文/消息证据的关系、标签和项目归属共用知识库存储；实体合并先返回改挂关系数，写入立即生效。删除保留 removed 记录，合并保留 merged 与目标引用。
- 每次事实修改与修订、knowledge.changed/research.changed 事件同事务保存；AI 的参与者、会议、发言和证据可追溯。标签/归属的来源通过修订 origin 与所属版本的会议、发言追溯。
- 一轮 AI 修改归入一个 ai-turn-end 版本，五处现有发言结束位置关闭版本；用户编辑会话可显式开关，空版本丢弃。整组撤回跳过后来改过的记录并返回引用；单条恢复和整组撤回都先存 before-restore，可再次撤回。
- 撤回新建实体/边保留 removed 身份，后续用户改过的边仍能找到端点；派生关系不留修订，节点恢复时清除相关派生缓存。图修改不进入文件工作区 revisions。
- 实体名称、英文名、别名、描述加入 FTS 和现有 384 维向量索引；支持重建，私有实体不进 AI 候选。资料种类新增 link，条目类型新增 code（snippet/function/script）。
- 所有角色共用 `kb_graph`、`kb_write`、`research_write`。图查询按名称/别名或资料检索定位，只返回节点 ref/name/kind/degree 与轻量边；多跳返回路径，按边分页并报告 remaining。项目文件夹边即时生成、不入库。
- `kb_write` 的实体、关系、合并、标签和归属修改归入同一发言版本；每项独立事务，失败返回原因并继续，后续操作可用 `$key` 引用本批新记录。派生层不可直接写；原文依据、保守建边和先查重通过英文工具说明引导。
- `research_read {type:'entity'}` 返回字段、别名、标签和分页相连边，描述默认首行并报告剩余字数，`full:true` 读全文。`research_write` 复用条目创建/修改/取代与资料元数据修改，私有条目不可读写，条目修订保留。
- `workspace_versions {resource:'knowledge'}` 支持列出、读修订与整组撤回，明确列出后来修改而跳过的记录。这些工具不触发「请求批准」。

### 2.8b 论文卡片后台（KB-6a/6b，界面由后续任务接入）

- 文献类 `paper/preprint/thesis/report/chapter/book` 在派生层完成后自动排入同一知识库队列；其他资料可手动整理。设置 `knowledge.cards={enabled:true,model:null}`；关闭只停自动整理。模型依次选择 `knowledge.cards.model`、`memory.model`、秘书定义模型、`models.default`；均未配置时记 `skipped/no-model`，设置模型后继续。前台发言时不启动新任务，已有请求完成后保存；模型并发 2，连续失败三次后由 retry 重排。重启恢复 running 为 queued。
- `services/knowledge/cards.js` 复用无工具后台运行器；按中英文章节优先挑方法、数据、结果、结论，连同元数据约 6000 token，整段保留，不发送 reference 段。每项证据先精确匹配，再容许空白、全半角标点差异；无效项整个丢弃并记录原因，研究问题无有效证据时为 null。
- 卡片是全局 `rb_items` 的 `note/summary`，`payload.card` 含 `question:{text,evidence[]}|null`、methods/datasets/variables/metrics/software/code/findings；证据为 `{chunkId,quote,page}`，`payload.cardSource='source:<id>'`。项目资料给卡片及相关实体记 `kb_memberships`。实体按同种名称/别名归一化对齐，再查询可用实体向量的最近 3 个、真实余弦阈值 0.94；未开启混合检索时只按名称。复用实体只补别名，保留用户名称、说明；新实体说明直接使用核对过的原文。`variantOf` 只接受单个非空名称，形状错误记入 dropped 并丢弃该项，其余卡片继续写入。提示区分本文实际采用的方法和综述介绍的他人指标，不把 Model 1/2 等局部编号当作方法名。
- 固定后台参与者 `actor_card_builder`（不加入讨论专家名册）；卡片、实体及边带后台会议/发言来源，每篇一个标题命名的 `build` 版本。新增实体和边是 `extracted/ai`，记录 `produced_from` 和证据；方法变种、代码实现按原文的显式关系建边。内容哈希变化后，在同一个新 build 中替换旧卡片及本资料的 extracted 结果，保留 curated 和仍被其他边使用的实体。撤回同时恢复卡片、实体、边和归属；用户后来修改的条目通过条目修订号识别并列入 skipped，FTS 同步恢复。
- `kb_jobs` 的 card 行保存内容哈希、后台会议、手动标记和结果；结果含 cardId/versionId、dropped/droppedCount、selection、usage。usage 累计当前内容版本各次尝试的 requests/inputTokens/outputTokens/totalTokens/unknownRequests；没有供应商用量时为 null 并标 unreported，部分报告标 partial。KB-6b 的 10 篇实测校准成本：每篇估算输入 7,000、输出 11,000（含思考），未缓存峰时单价 0.30/1.20 USD/百万 token，不再额外乘 2；无正文扫描件不计入待整理费用。最终 10 篇估算 0.153 USD、已报告用量折算 0.07923540 USD，详情与残留漏合并见设计稿 §4.3、§4.6。

### 2.8b′ 知识库图视图（KB-10，2026-10-21）

- 知识库页切到「图」：标签和筛选收起，工具栏搜索变成「找一个节点设为中心」，右边写「N 个节点 · M 条关系」（排布中的另写）。画布是 Cytoscape.js 3.34.3（MIT，`/vendor/cytoscape.js`，首次切到图时才加载）；没有用 edgehandles、fcose 和 rbush，拖线是自己写的，空间查询是对位置索引线性扫描（5 万个节点一次 4–7 毫秒，整图都在视野里要排序时约 17 毫秒，只在停下后做一次）。
- 按视野加载（KNOWLEDGE_BASE §7a）：打开时取一次 `GET /api/knowledge/layout`，镜头先对准连接最多的节点（80 个以内的小图直接适应窗口，最大不放大到 1 倍以上）。平移、缩放停下 100 毫秒后，视野外扩四分之一范围内的节点按度数取前 1500 个（选中的和中心邻域优先），`POST /api/knowledge/viewport` 取名称和相互之间的边（超过 5000 条按两端度数保留），进 Cytoscape；其余在视野里的节点画在下层画布上，是种类色的小点。节点大小按度数，度数前 30 的标签加粗；缩小到 0.7 倍以下不显示标签。画出的边超过 300 条时，只有中心邻域、选中节点的边和悬停的边显示关系名。拖动画布时用快照（Cytoscape `textureOnViewport`），停下再重画。
- 双击（或搜索）设为中心：左上显示中心名称、相连数和 × ，深度 1 / 2 / 3，邻域用 `GET /api/knowledge/graph?ref&depth&limit=400`，其余节点变淡，镜头框住邻域。邻居过多时只取前 400 条边，卡片上写「还有更多未显示」；设计稿里「只画 15 个、其余收成小圆点」没有做。
- 单击打开右侧节点详情，详情里点相连节点时镜头移过去；Shift 点选可以再选几个实体。选中的节点右侧有手柄，拖到另一个节点松开弹出关系菜单：常用六个（实现、使用、变体自、属于、支持、反驳），搜索能找到其余内置关系，也能直接输入新关系；最后一项切换方向。右键节点：设为中心、从这里拉关系（再点一个节点）、取消钉住（钉住的才有）、把选中的实体合并到这里（先弹对话框写明改挂几条关系）、删除（实体才有）。右键关系：删除这条关系（自动线索不能删）。悬停关系显示两端、谁加的（AI 写的显示专家和对话）和第一条证据。
- 拖动节点立即保存位置并钉住（`PATCH /api/knowledge/positions`）。本页的建关系、删除、合并都进同一个编辑会话：右上撤销 / 重做和 Ctrl+Z / Ctrl+Shift+Z（或 Ctrl+Y）只撤本页的修改，离开页面时会话关闭，成为一个历史版本；每次修改后的提示条也有「撤销」。右上漏斗筛选：种类七组、关系来源（手动添加 / 从原文整理 / 自动线索）、只看 AI 添加的、只看未连接的（只留没有任何关系的节点，方便整理孤立条目），立即生效。左下图例和「i」说明三种线；右下放大、缩小、适应窗口、重新排列（确认后 `POST /api/knowledge/layout/rerun`，钉住的不动）。
- 宿主排好位置（`knowledge.layout.changed`）或知识库有改动时，图在 250 毫秒后重新取位置索引，已画的节点移到新位置，镜头不动。
- 没做：按项目和种类分组、社区着色、文献按被引数定大小和按年份定深浅、按标签筛选、「在对话中引用」、15 个邻居折叠。项目数据库没有图。
- 云端无 GPU 的无头 Chromium，5 万节点 / 50 万边合成数据：位置索引 3.8 MB、0.7–1.3 秒；切到图到出现节点 1.1–2.7 秒；平移帧时间中位数 16.7 毫秒，元素增删的那几帧 p95 100–180 毫秒；整张图缩到最小时中位数 33 毫秒。viewport 一次 1500 个节点 0.1–0.9 秒，缩到最小、全是枢纽时最长 2 秒（异步，不卡画面）。Windows 帧率和高 DPI 待 Sol 验收。

### 2.8c 知识库位置与后台布局（KB-10a，图界面见 2.8b′）

- 迁移 026 的 `kb_positions(ref,x,y,pinned,updated_at)` 存 source/item/entity 的共享坐标；记忆和段落不入图。位置是可重算索引，不写知识修订或历史版本。全局与项目取同一坐标；全局包含无项目资料、项目内 `LITERATURE_KINDS`（paper/preprint/thesis/report/chapter/book）资料，以及全部 active 实体和非记忆条目。项目范围按资料/条目的 project_id 或 kb_memberships 筛选；项目数据、代码和文稿原件只在项目范围出现。位置索引、viewport 和手动重排共用该范围规则。
- `services/knowledge/layout.js` 在 `worker_threads` 中读取、计算和保存；graphology 0.26.0 + graphology-layout-forceatlas2 0.10.1（MIT），开启 Barnes-Hut。首次无位置时全量布局；手动重排只移动所选范围的非 pinned 节点。全量迭代按节点数 ≤1000 / ≤10000 / 更大分别为 100 / 60 / 30 次，局部 10 次，每 5 次让出 worker 并响应前台发言暂停。
- 入库、新建和合并等事件停顿 2 秒后处理未定位节点：以已定位邻居的平均坐标加随机偏移为初值，无邻居则放当前图边缘；局部只移动新节点。删除移除坐标，其他节点不动。用户拖动与取消钉住即时保存，计算期间的拖动以保存时间校验保留；固定节点不回写，避免 Float32 舍入。
- `knowledge.layout.changed` 的局部变化为 `{refs:[...]}`，全图重排仅发一次 `{all:true}`；布局异常为 `{error}`。关闭宿主终止 worker，重启扫描尚未定位的节点；原有坐标继续使用。
- `GET /api/knowledge/layout?projectId=` 返回 `{nodes:[[ref,x,y,kind,degree,pinned],...],pending}`，不带名称、正文和边；kind 为 source、条目类型或实体种类，degree 为 active 边数（两次按端点索引分组统计，自环算 2），pinned 为 0 或 1。`POST /api/knowledge/viewport {refs,projectId?}` 返回范围内 `{ref,name,kind}` 和两端均在所选节点内的 `{id,from,to,relation,layer,origin,aiUntouched}`；refs 不设数量上限。
- `PATCH /api/knowledge/positions {positions:[{ref,x,y,pinned?}]}` 保存坐标，省略 pinned 保留原状态；返回 `{refs}`。`POST /api/knowledge/layout/rerun {projectId?}` 立即返回 `{queued:true}`，后台重排。四个接口沿用启动口令；没有新增界面或模型请求。
- Windows 合成 5 万节点/50 万边验收：全图 10.665 秒；layout 响应 5,023,047 bytes、2.955 秒，超过 1 秒目标 1.955 秒。viewport 1500 节点 141.5 ms，局部新增 100 节点 462.0 ms；布局期间没有超过 100 ms 的主线程延迟。SQL 独立测量 2.877 秒，原因是逐节点统计两向度数；审阅时改成按索引分组统计，云端同规模从 1.5 秒降到 0.3–0.6 秒，Windows 复测 667 毫秒（KB-6b 时）。

### 2.9 工作站（计划、导图、日志、文稿版本、历史版本）

**用户能做什么**

- 工作站页汇总一个项目的研究框架与进展（导图）、计划、日志、文件列表和文献版本；各区域也可单独打开。还有一份全局计划。
- 计划：添加、编辑、删除、切换完成状态。
- 日志：添加条目，查看详情（"文件列表"和"日志详情"两页）。日志详情点一下变成纯文本直接修改，保存后回到渲染显示；条目可带文件链接（资料、文献版本、项目文件），点击打开。
- 导图编辑窗口：树形节点、游离节点、节点间有向连线；Markdown 大纲粘贴或拖入；可编辑 JSON；导出；窗口内撤销/重做（只在本次编辑期间有效）。
- 文献版本：按组导入稿件，按导入顺序编号（删除后编号不复用）；原件和说明保存在数据目录。导入后任务秘书比较完整提取文字并按模板生成版本说明（实际文件变化、秘书解释、待用户决定的建议、相关导图节点与文件）；用户可补充、编辑、重新整理、引用到对话。版本比较有并排和统一两种视图，可跳到下一处变化，可把旧版复制为新版本。
- 版本图后端（D1，尚未接界面）：版本组增加 `sourcePath`、`format`；版本增加 `parentId`、`branch`、`tier`、`label`、`title`、`origin`、`contentHash`、`sessionId`。导入沿上一版接续，另存为以选中的版本为父版本；已有子版本时分出组内最小未用编号的「分支 n」，否则继承分支名。新原件计算 SHA-256，旧库父版本沿用原比较基准，旧哈希保持空。
- 比较基准默认初始化为父版本；手工改基准（包括无基准）只影响比较，不改变父子关系。版本图省略已删除节点，子节点连接最近未删除祖先；标题为空时显示原文件名，说明摘要取前 200 字，修改指令去重后最多 10 条。整条分支可改名，不能与同组另一分支重名。
- 层级设置 `desk.tiers` 默认「草稿、内部审阅、投稿、修回、终稿」；标记版本只接受设置内的名称或空串。改名先在 SQLite 事务中更新版本，再通过原有 `workspace.edit` 保存设置；保存失败恢复此次改过的版本并报错，不做断电恢复。直接删除设置中的层级不改已有标记，仍显示原文字。编辑台生成的版本不自动整理说明，手动整理仍可用；后续导入也不会带动这些版本自动整理。
- DOCX 段内读写服务（D2a，尚未接编辑界面）：制表符、换行和特殊字符前后的文字可改，超链接、smartTag、customXml、普通行内内容控件可改字并保留容器；引文控件、公式、已有修订和未知对象整体保留。内联项暴露 `run`、可选 `wrap` 和原子 `display`；块纯文本使用域缓存和公式线性文字，删除的修订文字不进入投影。格式标记为 `b/i/u/sup/sub`，识别关闭值，只读取直接格式，不展开字符样式；改字继承原格式，改标记只调整对应元素。仅重写改过的段落，其余段落和 ZIP 部件内容保持原字节。
- DOCX 段落与批注服务（D2b，尚未接编辑界面）：`writeDocx(bytes, changes, {inserted, removed, comments})` 返回 `{bytes, inserted}`，其中 inserted 把调用方新块 id 映射到 `p:<paraId>`。支持段首/同层级插段、拆段和删段，继承段落与文字格式；新 paraId 在整个包内唯一。分节符段和表格单元格最后一段禁止删除，整次写回失败；跨段域继续整体只读。删除正文时保留并迁移书签、批注标记；调用方已把它们并进别的段落（退格合并两段）时不再迁移，同一个书签、批注、脚注、图片等对象出现在两个段落时整次写回报 `DOCX_DUPLICATE_ATOM`。批注读取作者/缩写/日期/正文、`range.from/to={blockId,index}`、`parentId` 和 `done`；支持 add/edit/delete，删父批注同时删回复及扩展元数据，回复和解决状态只读。英文期刊、博士论文和带域/公式/修订的受控副本已完成 Word/WPS 验收。
- 编辑台窗口（U1，试用开关 `features.editingDesk` 默认关，在设置→常规打开）：打开后左栏「工作站」下面出现「编辑台」，工作站页头和项目文件预览有「在编辑台打开」，工作站左下角的文献版本管理撤掉、导图向左拉宽。编辑台是单独的窗口（桌面版原生窗口 `secondary-desk`，默认外框约 1440×900、最小内容区 960×600，恢复时按显示器工作区适配；浏览器里是新标签页），所有项目共用一个，再次打开时切到前面并在新标签里打开指定文稿。窗口里有文稿标签（重开窗口时恢复）、功能区（开始、审阅、视图，可收起，Ctrl+F1）、左栏（项目切换、项目文件夹里的 docx/tex/md/pdf 按文件夹展开，加只在应用数据里的版本组；下面是大纲，点击跳到标题）、右侧栏（批注与索引、对话，目前是空状态）和底部信息栏（文件、最新版本、写回状态、字数或页数、版本树按钮）。PDF 可缩放翻页，只读；批注、比较、版本树按钮先停用。
- 编辑台直接编辑（U2）：项目文件夹里的 docx、md、tex 打开时登记成版本组并开一个编辑台会话（同一文稿已有会话时接着用，上次没写回的修改还在）。docx 按页面编辑：正文、标题、列表段落、表格单元格里的字，加粗、斜体、下划线、上标、下标（Ctrl+B/I/U），回车分段、退格合段；标题末尾回车得到普通段落。公式、图片、域和引用、脚注、修订、文本框显示成对象，可以删除但不能改内容；书签和 Word 批注范围不显示，删掉周围的字也会留下；表格不能增删单元格，分节符所在段落和跨段落的域不能删。粘贴只保留文字和五种格式。md、tex 编辑源码（md 默认源码，渲染视图是只读预览，按会话里的内容显示），BOM 和换行符原样保留。停止输入 0.8 秒后同步到会话（窗口失焦或关闭前也会同步），底栏显示「正在同步 / 有修改未写回 / 已写回项目文件」；Ctrl+S 或「保存」写回项目文件。项目文件当前对应别的版本时先确认；在外面被改过时让人选「以外部版本为准重新打开」（自己的修改留作版本）或「保留我的修改另存为分支」。专家同时改了同一段时以专家的为准并提示，改别的段落时两边都保留。关闭标签时有没写回的修改会问写回还是不写回，关闭会话时有改动就留一个版本。历史版本标签仍只读；段落样式、列表、换行（Shift+Enter）、增删表格行列还没有。
- 历史版本：AI 每轮发言结束、用户离开编辑页面、恢复之前，都会为改过的资源留一个历史版本；可只读预览、恢复或删除。工作区每次修改另有逐条修订，可撤销。
- DOCX 编辑会话（D3a，尚未接界面）：`app/services/desk/` 登记项目文件、维护唯一 open 会话、接收逐块修改和撤回/保留；修改通过结构校验后记录 actor、会议、发言和指令，空闲 2 秒集中写工作副本。保存可写回项目文件或生成父子版本，关闭按需留版本再清理工作目录；正常退出先落盘，重启恢复同一会话。沿用迁移 024 的 `desk_sessions`、`desk_changes`；迁移 027 给版本组加 `source_hash`、`source_version_id`，记项目文件上次登记、导入或写回时的哈希和对应版本，外部修改按它判断，连续保存不再误报。

- D4 版本比较后端已接入：`GET /api/versions/:id/diff` 返回两版块、段落配对、段内删增和格式范围；省略 baseline 默认父版本，可跨分支。迁移 028 的 `version_diffs` 缓存版本对；版本生成后由 worker 串行预计算，关闭应用取消未完成工作。DOCX 原子按 XML 哈希识别，tex/md/pdf 复用已有读取；旧比较界面仍用 `/compare`，新界面待 U3。
- D5 专家改文稿后端已接入：所有角色共用 `workspace_read/edit manuscript`，按块读当前或历史内容、替换/插删段、存版本或写回项目，`workspace_undo chg_` 逐处撤回；复用编辑会话与修改记录。原子记号按原顺序保留，替换继承起始字符格式；写回项目在请求批准模式下询问，沿用 C1 始终允许规则。划选改写经绑定会议发送，忙时进入现有队列；`desk_suggest` 持久事件十分钟去重，界面提示由 Claude 接入。
- D6 批注与索引后端：迁移 029 建索引/非 Word 批注表及修改记录的标注快照。统一 annotations 接口增删改查，标注随文字移动、删光时删除，按修改撤回时一起恢复；外部修改后按原文和前后文重新定位，缺失或歧义记 `annotation-lost`；撤回只恢复记录和引用并标 `lost`，正文不变，重开仍保留。PATCH 新范围或再次打开唯一找到原文后恢复 `anchored`，未定位的 Word 批注不写入文件。DOCX 批注写回 Word，索引及 tex/md/pdf 批注只存应用；PDF 正文只读。专家共用 comment/bind/uncomment/unbind，读取带摘要，删除限自己添加的条目；侧栏由 U5 接入。

**实现位置**：`app/core/workspace/`（`workspace.js` 读写与撤销，`snapshots.js` 历史版本，`resources/` 各资源格式）、`app/services/versions/`（`comparison.js` 旧比较、`diffs.js` 新比较队列和缓存、`organizer.js` 版本说明）、`app/services/desk/diff.js`（块与段内比较）、`app/services/journal-files.js`；界面 `app/ui/components/` 下的 `workbench.js`、`map-*.js`、`version*.js`、`resource-history.js`；编辑台窗口 `app/ui/desk-window.js`（打开与转交文稿）和 `app/ui/components/desk*.js`，原生窗口在 `src-tauri/src/main.rs` 的 `open_secondary_window`（`surface: 'desk'`）。

**关键数据**：资源 `plans`、`map`、`log`、`notes`、`versions`；表 `revisions`、`resource_snapshots`、`log_file_references`（日志链接的可重建投影）、`version_groups`、`manuscript_versions`、`version_note_meetings`；`projects.auto_version_notes`；设置 `versionNotes.template`、`summary.workbench.versions`。

**已知限制**

- 版本说明每份仍要十几万到二十几万 token，未达到 10 万的目标；对表格和未改动上下文的解读偶有错误。
- PDF 版本比较的是提取文字，排版和解析差异不一定代表正文修改。D4 的大空档超过 250000 对时整段删增并标 `limited:true`，不检测段落移动和表格结构；不支持或解析失败只开放原件。
- 编辑台按迁移 027 的项目文件哈希判断外部修改；项目文件缺失或被占用时工作副本保留，旧版写回需 `confirm:true`。文本会话只接受 UTF-8；DOCX 的 EMF/WMF/TIFF 图片返回原字节，由界面显示占位。
- 导图节点图片和附件在 alpha 之后（R4-10）。

### 2.10 记忆

**用户能做什么**

- 空闲时（默认 10 分钟），秘书只读取纪要的变化和对应原文，提取并核对候选记忆（偏好、目标、决定、约定、未决问题、经验等）。
- 记忆收件箱：逐条或批量接受、修改后接受、拒绝；可跳回出处；每次修改有历史，可撤销。
- 只有接受的记忆进入"项目简报"，主专家在新开、恢复或重建会话时收到完整简报（置顶且有效的排在前面，不截断）。
- 设置里可关闭空闲整理、改空闲时间、选整理模型（未设置时用秘书模型或对话模型）、设每次累计 token 预算；达到预算时在完整阶段之间停下，下次接着整理。

**实现位置**：`app/services/memory/`、`app/services/secretary/project-brief.js`、`app/server/routes/memory.js`；界面 `app/ui/components/memory-*.js`、`settings-memory.js`。

**关键数据**：记忆是 `rb_items` 中 `type='memory'` 的条目（候选为 `proposed`，接受后 `active`）；表 `memory_cursors`、`memory_checkpoints`、`memory_runs`、`memory_dedup`、`memory_item_history`；设置 `memory.enabled`、`memory.idleMinutes`、`memory.model`、`memory.tokenLimit`（默认 100000，`null` 为不限制）。

**已知限制**

- 只整理正式的研究会议，不整理临时会议。

### 2.11 模型与服务商

**用户能做什么**

- 设置 → 模型与服务商：内置预设 OpenCode Go 和 DeepSeek，只填密钥即可"测试并保存"；也可添加其他兼容服务（接口地址、API 格式、模型 ID、可选请求头），可从服务商拉取模型列表。
- 服务商卡片：测试连接，编辑地址与模型，重新获取模型列表，更新密钥，移除（确认后）。地址与预设一致的旧手动配置会提示"改用内置配置"，密钥和各处模型选择随之迁移。
- 模型表列出上下文、最长输出、支持的思考强度和上限来源（目录 / 匹配 / 默认值）。选默认模型；用滑块调上下文压缩门槛（50–95%，默认 80%）。
- 达到门槛时，同一模型把较早的对话整理成摘要，最近两轮用户消息及其后的工具结果保留原文；时间线显示"上下文已自动压缩"一行。摘要失败时保留原文继续。

**实现位置**：运行时 `app/runtime/pi/`（`runtime.js`、`catalog.js` 模型目录、`requests.js` 超时与重试、`compaction.js`、`request-log.js`），接口 `app/runtime/port.js`；`app/services/providers.js`；界面 `app/ui/components/settings-models.js`、`model-picker.js`。

**关键数据**：设置 `providers`（`id`、`preset`、`baseUrl`、`api`：`openai-completions`/`openai-responses`/`anthropic-messages`、`keyRef`、`headers`、`models`）、`models.default`、`context.compactPercent`；密钥在 `data/secret/credentials.yaml`；会话在 `data/runtime/pi/sessions/`；表 `runtime_sessions`；每次请求一行元数据写入 `data/logs/model-requests.jsonl`（不含密钥、请求和回答，超过 5 MB 轮换一份）。

服务商 `headers` 保存为 `{ 名称: { keyRef: "provider.<id>.headers.<名称>" } }`，值只写凭据文件；请求与模型发现时读取最新值。删除 header 或服务商会删除对应凭据，缺失时提示重新填写。旧文本框仍能提交明文，返回设置只含引用。工作区编辑、撤回、历史版本恢复与外部设置修改共用该处理。

启动迁移先备份数据库，再在同一事务清理 `revisions`、`resource_snapshots`、`tool_calls` 和 `events` 中明确的服务商 header 字段，保留行数、其余字段并重算相关哈希。旧运行时会话的工具参数及按 `toolCallId` 匹配的设置修改结果另行原样备份后原子替换，重复运行跳过已清理文件；备份位于 `data/backups/`，保留迁移前内容供恢复。结果中的 JSON 文本先解析，不能解析的保留原样并记录相对文件名和调用 id。

**已知限制**

- 模型容量和思考强度只来自 pi-ai 的模型目录；查不到的自定义模型按 131,072 上下文、32,768 输出计算并标明"默认值"，不能手动覆盖。
- 请求控制：首个事件 90 秒、流中两个事件之间 120 秒超时；尚未写出内容时，网络错误、超时、429 和 5xx 最多尝试 3 次（遵守 Retry-After），401/403/404/400 和上下文超长不重试。无响应超时不能在界面设置。

### 2.12 Python 环境

**用户能做什么**

- 内置"科学分析"环境（固定 Python 版本和锁定的包清单，首次使用时下载安装）、系统 Python（只读使用，从不修改）和用户新建的受管环境。
- 设置 → Python 环境：新建空环境、复制已有环境、导入/导出清单、按清单同步、查找已安装的包、重命名、删除（绑定的项目或对话改为跟随默认）、设新任务默认环境、清理未引用的缓存；显示独占空间和共享缓存大小。
- Python 下载源（官方或自己添加的源，只用于 uv 下载解释器）和软件包镜像源（官方、清华、阿里云、自己添加的源）分开设置。
- 项目和独立对话可选环境；更换在下一轮生效，保留会话历史。AI 用 `python_env_install` 安装包（请求批准模式下先问），命令行里的 Python 使用会议的环境。

**实现位置**：`app/services/python/`（`index.js`、`uv.js`、`installer.js`、`files.js`）、`python/`（内置环境清单 `builtin.json`、`builtin.in`、`builtin.lock`）、`app/server/routes/python.js`；界面 `app/ui/components/settings-python.js`、`python-choice.js`。

**关键数据**：表 `python_environments`、`python_bindings`（作用域 project/meeting）、`python_operations`（谁、为什么、结果）；设置 `python.defaultEnvironment`、`python.indexUrl`（传给 `UV_INDEX_URL`）、`python.installMirror`（传给 `UV_PYTHON_INSTALL_MIRROR`）；文件 `data/python/{cache,interpreters,envs}`；uv 路径来自 `SCIENCESCOPE_UV`。

**已知限制**

- 受管环境之间通过 uv 共享缓存（硬链接复用），未引用的缓存要在设置里手动清理。
- 内置环境清单只针对 `win32-x64`。

### 2.13 设置与外观

**用户能做什么**

- 设置是一个居中的弹窗，盖在原来的页面上（地址仍是 `#/settings/<页>`，Esc 或右上角关闭后回到原页）。所有改动立即生效，没有保存按钮；文字框停止输入一秒或离开时保存（2026-10-24 按设计稿重做）。
- 导航四组：个人（通用、外观、快捷键）、研究协作（模型与服务商、专家、任务秘书、全局助手、执行与批准）、工具（工具、技能、MCP 服务器）、资料与环境（知识库与检索、编辑台〔试用开关打开后才有〕、Python 环境、数据与备份），最后是关于（带版本号）。旧地址 `persona`、`secretary-settings`、`assistant-settings`、`library-settings`、`environment` 自动转到新页。
- 通用：显示名称、一句话介绍、界面语言、发送键、截图时隐藏窗口、试用功能（编辑台）。外观：主题、界面字体（「读取本机字体」时才请求权限）、界面密度、对话/侧栏/代码字号、对话行距（紧凑 1.45 / 标准 1.6 / 宽松 1.75）、预览、减少过渡动画、滚动条。快捷键：点一下录制，不能占用固定按键或重复。
- 专家：主专家、参加讨论的专家（启用开关、上移下移、复制、删除）、独立审核；几位专家用同一个模型时提示。点开一位进详情页：名称、职责标签、模型（跟随对话或某个服务商的模型）、默认思考强度（只列模型支持的档位）、提示词、绑定的技能、修改记录（可撤销）。主专家、任务秘书、全局助手用同一个详情页。
- 任务秘书：什么时候整理纪要、整理时顺便更新什么、记忆整理（空闲时间、模型、每次上限）、稿件版本说明模板（可恢复默认）。全局助手：启动时打开方式，桌面版可立即显示或隐藏。执行与批准：新对话默认执行方式（`approvals.defaultApproval`，ask/auto）和总是允许的规则。
- 知识库与检索：本地混合检索状态（结果和下一步）、语义检索开关、模型下载源和自定义地址、下载修复模型、重建索引；沿关系扩展；论文卡片开关和模型。编辑台：TeX 是否找到、编译引擎、稿件分级改名。
- Python 环境：默认环境、环境列表（状态、管理、重命名/导出清单/删除）、内置环境「现在准备」；软件包镜像和 Python 下载源都可添加、修改、删除自己的源，保存前先试连（`POST /api/python/probe`，连不上可仍然保存，存在 `python.customIndexes`、`python.customInstallMirrors`）；共享缓存清理、系统 Python。点「管理」进环境详情：重命名、已安装的包（可查找）、安装/移除/按清单同步、导入导出清单。
- 数据与备份：导出全部数据（桌面版选文件夹，可同时复制项目文件，显示进度、可取消，完成后打开文件夹 `POST /api/export/all/:jobId/open`）、各数据文件夹路径并可打开、运行时版本。关于：标志、版本、更新（自动检查开关、上次检查、立即检查、有新版本时下载安装）、发布者、参与开发、许可证、第三方声明。
- 桌面版发现新版本时右下角弹出更新提示：现在更新（显示下载进度）、稍后；安装失败显示原因。
- 固定按键：对话页 `Ctrl+F` 查找（别的页面「编辑 → 查找当前对话」置灰）、`Alt+S` 项目置顶摘要（对话页头部也有按钮，Esc 或点外面关闭）、`F2` 重命名。客户端窗口里屏蔽浏览器自带的按键（F5、Ctrl+R 刷新，F12 等开发者工具，Ctrl+P/U/S/O/J，Alt+←/→ 前进后退）、浏览器右键菜单（输入框里保留剪切、复制、粘贴菜单），文件拖到不接收的地方不会让页面跳走（`app/ui/desktop-guard.js`）。
- 窗口置顶：标题栏右上图钉或「视图 → 窗口置顶」，让主窗口保持在最前；设置 `appearance.alwaysOnTop` 记住。
- 输入框里没发出去的文字跟着对话（新对话页按项目），切换对话不丢；关闭应用后不保留。
- 欢迎页的常用学术站点可增删、编辑和排序，用系统浏览器打开。
- 菜单「帮助 → 关于 ScienceScope」打开设置的关于页。版本读安装目录的 `package.json`；「第三方声明」只在安装版有 `THIRD_PARTY_NOTICES` 时显示，用默认程序打开（`GET /api/system` 的 `version`、`files`，`POST /api/system/open-file`）。
- 欢迎页顶部是线描插画（`app/ui/illustrations.js`，颜色来自令牌，跟随深浅主题），取代原来半透明的位图标志。

**实现位置**：`app/core/workspace/resources/settings.js`（默认值与合并）、`app/services/system.js`；界面 `app/ui/components/settings.js`（弹窗、导航、通用/外观/快捷键）、`settings-kit.js`（行、开关、分段、下拉）、`settings-*.js` 各页、`update-prompt.js` 与 `app/ui/update-state.js`、`home.js`、`shell.js`、`app/ui/appearance.js`；样式令牌 `app/ui/styles/tokens.css` 与组件样式 `components.css`。

**关键数据**：`data/settings.json`（`profile`、`appearance`、`shortcuts`、`composer`、`sites` 等）；设置本身也是工作区资源，修改留修订，AI 可读可改。

**已知限制**

- 不能更改数据目录。
- 稿件分级只能改名，还不能拖动排序。

### 2.14 语言

**用户能做什么**

- 界面在中文和 English 之间切换，立即生效。对话内容、资料和用户输入的名称保持原样，模型回答的语言不受界面语言影响。
- 时间格式跟随界面语言。

**实现位置**：`app/ui/i18n/index.js`（`t()`，组件里直接写中文字符串）、`app/ui/i18n/en.js`（中文到英文的对照表）。

**关键数据**：设置 `appearance.language`（`zh`/`en`）。

**已知限制**

- 服务端返回的错误信息多为中文，界面直接显示，英文界面下不翻译。
- 原生客户端里中文输入法的完整候选提交尚未验证（组字时按 Enter 不会发送，这一点已验证）。

### 2.15 预览安装包

**用户能做什么**

- `npm run package` 在 Windows 上生成带 updater 签名的 NSIS 安装包（当前版本 `1.0.0-alpha.0`），按当前用户安装，位置可选；Authenticode 代码签名待用户证书。
- 安装包自带 Node 22.22.2、uv 0.12.19、`app/`、生产依赖、Python 与模型清单、`LICENSE` 和自动生成的 `THIRD_PARTY_NOTICES`。打包时用现有 esbuild 合并纯 JS 依赖，应用与 worker 保留相对路径；原生模块、文档资源、字体和各包许可保留为文件。
- 覆盖安装按 `program-files.txt` 只删除旧版有、新版没有的程序文件，再覆盖写入；旧包没有清单时只枚举既有程序目录。`data\` 不动，卸载默认保留数据，只有勾选"删除应用程序数据"才删除 `<安装目录>\data`。
- Windows shell Job 守护程序随包预编译为 `runtime/windows-shell-job.exe`；运行时优先使用，缺失时保留现场编译。无 Job 后备使用 Windows 内置 PS5，固定并核验本次进程身份，先停止根进程，再核查清理后代；身份无法确认时返回 `SHELL_STOP_FAILED`，不把未核实的清理报成成功。
- PowerShell 5 的 stdout/stderr 直接追加到工具输出文件，主 shell 退出即可返回，后台进程继续运行和写输出；无 Job 时也走文件输出。运行中的取消和超时仍结束整个进程树，默认超时保持 600 秒。PowerShell 7 与 Linux 保留现有管道路径；测试通过内部 `shellExecutable` 参数显式覆盖 PS5/PS7，安装 PS7 不会跳过 PS5 回归。
- 原生宿主保留上一次启动的日志（`desktop-host.previous.log`）。

**实现位置**：`tools/package/`（`windows.js`、`build-options.js`、`prune.js` 打包裁剪、`notices.js`、`installer-hooks.nsh`、`build-native.ps1`）、`src-tauri/`；首测指南 `docs/handoff/PREVIEW_TEST.md`。

**品牌素材**：原生应用和安装程序使用 `tools/package/brand/` 的纸色底板墨色标志图标（2026-10-20 由绿底换回，绿底稿 `tools/brand/icon-green*.svg` 留在画廊）、欢迎页侧图和步骤页头图，由 `tools/brand/render.mjs` 从同目录源稿生成。

**关键数据**：安装目录下的 `runtime/node.exe`、`runtime/uv.exe`、`app/`、`node_modules/`、`data/`。

**已知限制**

- 更新提示、按钮和进度界面尚未接入；没有 Authenticode 代码签名。
- 只打 Windows x64 包；Node 和 uv 下载时校验校验和，不换源。

### 2.16 更新通道与最低配置

**用户能做什么**

- 原生主窗口提供检查和明确调用安装的接口；后台自动检查默认开启，同一安装的数据目录中每 24 小时最多自动尝试一次，成功或失败都记录尝试时间。手动检查不受间隔限制，也不改变自动检查时间。
- 更新包先下载、验签，再等待 Node 宿主和数据库关闭，NSIS 在原安装目录以被动模式覆盖程序并自动重开，`data/` 保留。正式清单指向 GitHub Releases 的 `latest.json`；演练可用进程环境变量改成本机 `127.0.0.1` 地址。
- 安装要求 Windows build 19045 及更新的 x64 系统；AVX2、8 GiB 内存、5 GiB 安装盘空间不足会显示影响并允许继续或取消。静默和更新安装只记日志，系统/架构硬要求仍生效。模拟参数只编译进测试产品。
- 打包前检查 npm/Cargo/Tauri 版本一致，`--version` 同步三处及锁文件根版本；本地脚本生成签名更新清单和发布说明草稿。[发布步骤](../handoff/RELEASE.md)说明密钥保管、签名、上传与验证流程。

**实现位置**：`src-tauri/src/updates.rs`、`src-tauri/installer-hooks.nsh`、`app/ui/native-update.js`、`tools/package/version.js`、`release.js`；复用官方 `tauri-plugin-updater =2.10.1`（Apache-2.0 OR MIT）。

**关键数据**：设置 `updates.autoCheck`、`updates.lastCheckedAt`；Tauri 公钥、`latest.json` 及安装包 `.sig`；私钥和密码在仓库外，不写入产品数据。

**已知限制**

- 本轮提供原生能力，不含更新界面；尚未发布 Release。升级演练结果单独记录，不以本节替代验收。
- 仅支持 HTTPS 或 `http://127.0.0.1` 更新地址；Windows SmartScreen 可能因未做 Authenticode 代码签名显示未知发布者提示。
- updater 2.10.1 的 Windows 安装调用未检查 `ShellExecuteW` 返回值；系统策略阻止安装程序启动时需手动重开当前版本后重试，下载、验签及清单获取失败仍在关闭宿主前返回。

---

## 3. 接口索引

所有接口在 `app/server/routes/`，由 `app/server/server.js` 注册，都需要口令。

**系统与事件**

- `GET /api/system` 数据文件夹路径与运行时信息。
- `POST /api/system/open` 用资源管理器打开某个数据文件夹。
- `GET /api/events/head` 当前事件序号。
- `GET /api/events` 事件流（SSE），`since` 续传。
- `POST /api/startup/rendered` 记录首屏渲染时间。
- `POST /api/shutdown` 请求宿主关闭。

**项目**

- `GET /api/projects` 列出项目（`archived=1` 含归档）。
- `POST /api/projects` 新建项目。
- `GET /api/projects/:id` 读取项目。
- `PATCH /api/projects/:id` 改名、描述、文件夹、置顶、归档。
- `GET /api/projects/:id/files` 列出项目文件夹内容；根目录请求触发后台扫描，文件条目带 `index:{status,sourceId,error}`，状态为 `parsed/parsing/name-only/failed/unindexed`。
- `POST /api/projects/:id/index` 等待扫描，返回 `{added,updated,unchanged,nameOnly,failed,moved,deleted}`；`nameOnly` 是扫描到的仅文件名记录数，`failed` 是本次读取/复制等错误数。
- `GET /api/projects/storage/copies` 返回 `{projects:[{projectId,totalBytes,unreferencedBytes,totalFiles,unreferencedFiles}]}`。
- `POST /api/projects/:id/copies/cleanup` 返回 `{projectId,releasedBytes,removedFiles}`，只删除没有资料引用的项目副本。
- `DELETE /api/research/sources/:id` 删除资料及投影，返回 `{deleted,vectors,versionId}`；`versionId` 对应人工关系的撤回版本（没有关系修改时为 null）。
- `POST /api/projects/:id/files` 新建文件夹、重命名、移到回收站、打开。
- `GET /api/projects/:id/export` 项目快照 zip。
- `POST /api/export/all {target,includeProjectCopies?}` 返回 `{jobId,folder}`；同一时间只运行一个任务。`GET /api/export/all/:jobId` 返回 `{phase,done,total,bytes,folder,error?}`，`DELETE` 取消。阶段为 `snapshot/exporting/finished/cancelled/failed`。`export.progress` 每秒最多一次，`export.finished` 带 `{jobId,folder,files,bytes,skipped,cancelled,error?}`；实现位于 `app/services/export/`、`app/server/routes/export.js`。
- `POST /api/projects/:id/log-file/open` 打开日志条目里链接的文件。
- `POST /api/projects/:id/focus` 进入或离开项目（触发纪要规则）。

**参与者**

- `GET/POST /api/participants` 列出、新建。
- `GET/PATCH /api/participants/:id` 读取、修改（含定义）。

**会议与消息**

- `GET /api/meetings` 列出会议（按项目、全局、附属、归档筛选）。
- `POST /api/meetings` 新建会议（独立对话可带工作文件夹和环境）。
- `GET/PATCH /api/meetings/:id` 读取、修改（标题、规则、置顶、归档、成员、工作文件夹）。
- `POST /api/meetings/:id/fork` 从某条消息分支。
- `POST /api/meetings/:id/move` 把对话移到另一个项目或移出项目（`projectId` 为空），纪要和默认工作文件夹随之移动；附属对话不能单独移动，运行中返回 409。
- `GET /api/meetings/:id/contexts` 各参与者最近一次上下文用量。
- `GET /api/meetings/:id/messages` 分页读取消息。
- `POST /api/meetings/:id/messages` 发送消息（调度器随后开始回答）。
- `POST /api/meetings/:id/interrupt` 停止。
- `GET /api/meetings/:id/export` 导出 Markdown。
- `POST /api/messages/:id/retry`、`POST /api/messages/:id/continue` 重新回答、继续。
- `PATCH /api/messages/:id` 采纳或取消采纳审核。
- `GET /api/messages/:id/citations` 回答中的资料引用。
- `GET /api/turns/:id` 发言及其活动条目。
- `POST /api/turns/:turnId/approvals/:activityId` 允许、拒绝或 `always` 加 `scope` 保存允许范围。
- `GET /api/search` 搜索消息。
- `GET /api/activity` 返回正在回答的发言和待发队列（`running`、`outboxes`）。

**待发队列**

- `GET/POST /api/meetings/:id/outbox` 列出、加入。
- `PATCH/DELETE /api/meetings/:id/outbox/:itemId` 编辑、取消一条。
- `DELETE /api/meetings/:id/outbox` 全部取消。
- `POST /api/meetings/:id/outbox/pause`、`POST /api/meetings/:id/outbox/resume` 暂停、继续。

**研究输入与交付物**

- `GET/PATCH /api/research-input/:owner` 读取、修改输入框草稿（附件与标记）。
- `POST /api/research-input/:owner/attachments` 上传附件（图片存为图片附件，其他文件导入资料库），返回草稿。
- `GET /api/research-input/images/:id` 读取图片原件。
- `GET /api/deliverables/:id/content` 交付文件内容。
- `POST /api/deliverables/:id/open` 用默认程序打开交付文件。

**纪要、秘书与记忆**

- `GET/POST /api/meetings/:id/minutes` 读取纪要状态、保存用户编辑。
- `POST /api/meetings/:id/minutes/refresh` 让秘书立即更新。
- `GET/POST /api/meetings/:id/secretary` 读取、确保秘书对话。
- `GET /api/meetings/:id/secretary/proposals` 秘书提案列表。
- `PATCH /api/secretary/proposals/:id` 编辑、填入、忽略提案。
- `GET /api/secretary/proposals/:id/history`、`POST /api/secretary/proposal-revisions/:id/undo` 提案历史、撤销。
- `GET /api/memory/inbox` 记忆收件箱。
- `GET /api/memory/brief` 项目简报。
- `PATCH /api/memory/items/:id` 修改记忆。
- `POST /api/memory/decisions` 接受或拒绝（可批量）。
- `GET /api/memory/history`、`GET /api/memory/items/:id/history` 记忆历史。
- `POST /api/memory/revisions/:id/undo` 撤销记忆修改。
- `GET /api/meetings/:id/memory/status`、`POST /api/meetings/:id/memory` 整理状态、立即整理。

**全局助手**

- `GET/POST /api/assistant` 确保并返回助手会议。

**工作区、历史版本与设置**

- `GET /api/resources` 资源类型列表。
- `GET /api/resources/:resource` 读取资源（`key`）。
- `GET /api/resources/:resource/keys` 列出键（`scope`）。
- `POST /api/resources/:resource` 修改资源（操作与参数）。
- `GET /api/revisions`、`GET /api/revisions/:id` 修订列表、单条修订。
- `POST /api/revisions/:id/undo` 撤销修订。
- `GET/POST /api/snapshots` 历史版本列表、留一个历史版本。
- `GET/DELETE /api/snapshots/:id` 读取、删除历史版本。
- `POST /api/snapshots/:id/restore` 恢复历史版本。
- `GET/PATCH /api/settings` 读取、合并修改设置。

**资料库与预览**

- `GET/POST /api/research/sources` 资料列表（分页；筛选 `kind/contentStatus/readStatus/tag`；`sort` 可取 `relations`；每项 `relations` 为含派生层的 active 边数）、导入资料。
- `GET/PATCH /api/research/sources/:id` 读取（含段落）、修改元数据。
- `POST /api/research/sources/:id/reparse` 重新解析。
- `POST /api/research/sources/:id/open` 用默认程序打开原件。
- `GET /api/research/chunks/:id` 读取段落。
- `GET /api/research/search` 检索资料与条目。
- `GET/POST /api/research/items` 条目列表（每项带 `relations`）、新建或取代。
- `PATCH /api/research/items` 修改条目（id 在请求体里）。
- `GET/PATCH /api/research/items/:id` 读取（含修订）、修改。
- `GET /api/research/semantic/status` 本地混合检索状态。
- `POST /api/research/semantic/download`、`POST /api/research/semantic/rebuild` 下载模型、重建索引。
- `GET /api/preview/document`、`GET /api/preview/content` 文件预览的结构与原始字节（资料、文献版本、项目文件、交付物）。

**知识库接口与编辑会话（KB-5）**

- `GET /api/knowledge/entities` 按 `projectId/kind/q/label/origin` 筛选，`sort` 可取 `name/updated/degree`（不传按 id）；`offset/limit` 分页，返回 `{rows,total,remaining,offset,limit}`，每项含 `degree/updatedAt`。
- `POST /api/knowledge/entities`；`GET/PATCH/DELETE /api/knowledge/entities/:id` 新建、读取、修改、删除。详情返回 `{entity,labels,memberships,edges}`；`edgesOffset/edgesLimit` 对全部相连边分页，`edges.groups` 将本页按 relation 分组，每条带 `peer:{ref,name,kind}`、layer、origin、evidence。
- `GET /api/knowledge/entities/merge-preview?into=&from=`（from 可逗号分隔或重复）；`POST /api/knowledge/entities/merge {into,from[]}` 预览改挂数并合并。
- `GET /api/knowledge/edges?ref=` 任意节点（资料、条目、实体）的相连边，带 peer、来源说明和解析后的证据，`offset/limit` 分页并按 relation 分组（KB-9 加）。
- `POST /api/knowledge/edges`；`PATCH/DELETE /api/knowledge/edges/:id` 新建、修改、删除关系；`POST /api/knowledge/labels {ref,add?,remove?}`（标签可单值或数组）、`POST /api/knowledge/memberships {projectId,ref,remove?}` 修改标签和项目归属。
- `GET /api/knowledge/graph` 与工具 kb_graph 共用实现与轻量结果，支持 ref/query、depth、relations、layers、projectId 和分页。
- `POST /api/knowledge/session {projectId?}` 返回 `{id}`；修改请求的 `sessionId` 对应该 leave-page 版本。`POST /api/knowledge/session/:id/close` 关闭（未编辑返回 null），`/undo`、`/redo` 撤销/重做一次接口操作并返回 `{refs,skipped,canUndo,canRedo}`。后来被其他操作修改的记录跳过；新修改清空重做；启动关闭遗留会话，内存撤销栈不跨重启。
- `GET /api/knowledge/versions` 支持 projectId/meetingId/turnId 与分页；`GET /api/knowledge/versions/:id` 返回 `{version,changes}`（含 ref/name/kind/op/before/after）；`POST /api/knowledge/versions/:id/restore` 整组撤回，保留 skipped。
- `GET /api/knowledge/history?ref=` 分页查修订；`POST /api/knowledge/revisions/:id/restore` 恢复单条。版本摘要按每条记录净变化计数，建后撤销不计，重复修改计一次；派生边继续不进入修订。
- `GET /api/knowledge/jobs` 保留派生层 counts/failed/similarity，增加 `cards:{counts,jobs}`；jobs 含 sourceId/state/error/attempts/contentVersion/result。`POST /api/knowledge/jobs {action:'retry'}` 同时重试派生层和卡片层失败项。
- `POST /api/knowledge/cards {sourceIds}` 手动整理或重做（不受 enabled 限制），返回队列汇总；`GET /api/knowledge/cards/estimate?projectId=` 返回 `{count,currency:'USD',upperCost,assumptions,estimated:true}`，省略 projectId 统计全库。估算按每篇 7000 输入/11000 输出（含思考）、每百万输入 $0.30/输出 $1.20，额外系数 1；无可用正文的扫描件不计入估算，所有接口沿用启动口令。
- AI 实体与边详情的 `createdBy` 含 participantId/name/meetingId/meetingTitle/turnId/messageId；已删除对象只保留 ID。证据 chunk 引用解析为 sourceId/title/page/quote，message 引用解析为 meetingId/meetingTitle/messageId/excerpt；原文缺失返回 missing:true。HTTP 写入或恢复历史中的单个证据对象读取时按数组返回，空证据返回空数组，无法解析的条目标 missing:true。全部接口沿用宿主口令认证，用户写入身份为 person_user。

**文献版本**

- `GET /api/versions` 项目的版本组与版本。
- `POST /api/versions/import` 导入版本。
- `PATCH /api/version-groups/:id` 重命名版本组。
- `GET /api/version-groups/:id/graph` 返回 `{group,nodes}`；节点字段为 `id,number,parentId,branch,tier,label,title,displayTitle,origin,createdAt,notesExcerpt,instructions`。
- `PATCH /api/versions/:id` 接受 `{title?,tier?,label?,branch?}`；前三项改单个版本，分支名改同组整条泳道；返回更新后的版本并发 `versions.changed`。
- `POST /api/version-tiers/rename {from,to}` 同步改层级设置和已标版本，返回 `{tiers,updated}`（更新后的层级列表、修改版本数）；设置保存失败返回 `TIER_RENAME_FAILED` 并恢复版本层级。
- `GET/DELETE /api/versions/:id` 读取（分页文字）、移到回收站。
- `POST /api/versions/:id/open`、`POST /api/versions/:id/open-notes` 打开原件、打开说明文件。
- `PATCH /api/versions/:id/notes` 编辑版本说明。
- `GET /api/versions/:id/compare` 与基线比较。
- `PATCH /api/versions/:id/baseline` 更换比较基线。
- `POST /api/versions/:id/save-as-new` 旧版另存为新版本。
- `POST /api/versions/:id/organize` 重新整理说明。

**编辑台会话与专家改写（D3a/D3b/D5；块提交、全文提交、保存与关闭已由 U2 界面使用）**

- D7 TeX 编译后端：`GET /api/desk/tex/engines[?refresh=1]` 检测本机 MiKTeX/TeX Live 与参考文献工具，`desk.tex.engine` 支持 auto/xelatex/lualatex/pdflatex；设置、首部魔法注释和宏包共同决定引擎。主文件支持请求指定、root 注释、自身 documentclass 或唯一直接引用者；不明确时返回 `DESK_TEX_ROOT` 和候选列表。
- `POST /api/desk/sessions/:id/compile {root?}` 只编译已保存的项目文件，返回 status/root/engine/durationMs/pdf/errors/warnings/unsaved/logTail，广播 `desk.compiled {sessionId,status}`；同会话并发返回 `DESK_TEX_BUSY`，无引擎返回 `DESK_TEX_MISSING`。latexmk 或引擎加 bibtex/biber 的多轮流程均把产物放入 `data/temp/desk-build/`，120 秒超时清理进程树；MiKTeX 禁止自动安装，缺宏包返回错误。`GET …/pdf` 提供最近成功 PDF（no-store），失败保留，关闭会话删除；启动清理遗留的已关闭会话目录。界面本轮仅登记事件，编译按钮由 U6 接入。
- D3c `POST /api/desk/enter {projectId,meetingId?,mode,atMessageId?}` 接续或分支，返回会议摘要、是否新建及改绑的 sessionIds；省略会议选最近活动的未归档项目会议，没有则按项目默认新建。历史修改归属不变，后续用户修改归绑定会议，已有会话打开时也可改绑；发 `desk.entered`，不启动回答。
- D3c `POST /api/desk/focus {reference}` 将 project-file/version 的块与原文引用定位到当前工作副本，无会话自动打开；返回并广播 `desk.focus` 的项目、路径、组、会话、所引版本、exact/moved/missing 及可选范围。重复原文按前后文选择，缺失不返回范围；UI 事件目录已加两项，进入横条/滚动高亮仍由 U4/U8 接入。
- D8 原生编辑台通过 `desk-window.json` 记住正常外框、显示器缩放和最大化，移动/缩放合并写入；重开恢复，越界回主屏工作区。重复打开可从主窗口/助手窗口恢复最小化并置前，主窗口仍可操作；没有新增 window-state 插件，助手和主窗口尺寸记忆不变。
- `POST /api/desk/documents` 登记项目内 DOCX、TeX、MD/Markdown，同一路径返回已有组。
- `GET /api/desk/documents?projectId=` 只读列出项目文稿、已登记的最新版本和只在应用里的组；达到 2000 个文稿返回 `truncated`。跳过隐藏目录、node_modules，自带项目根另跳过应用自有目录。
- `POST /api/desk/sessions`、`GET /api/desk/sessions/:id` 打开/重连，返回 `{session,blocks,changes}`。
- `PATCH /api/desk/sessions/:id/blocks` 按块修改、插入和删除，旧 seq 仅在同一块被改过时冲突，返回 `{seq,inserted}`。
- `PUT /api/desk/sessions/:id/text` 提交 tex/md 全文，要求当前 seq，不变时不记修改；空行切块并保留围栏、BOM、原换行和分隔空白。文本会话响应额外带全文 `text`，重启恢复块标识、逐处撤回与保存共用原有流程。
- `GET /api/desk/sessions/:id/media/:ref` 返回 DOCX 图片原字节及 MIME；可用图片原子带 `media:true`，不存在返回 404。
- `POST /api/desk/changes/:id/undo`、`POST /api/desk/sessions/:id/settle` 逐处撤回或保留。
- D5 `POST /api/desk/sessions/:id/rewrite {blockId,quote,instruction}` 发出带版本引用的用户消息；未绑定会议返回 `DESK_MEETING_REQUIRED`，空闲返回 `{messageId,turnId}`，忙时返回 `{messageId:null,turnId:null,queued:true,itemId}`，发出后沿用事件通知。引用含基础版本、从 1 开始的 paragraph、blockId 和 quote。
- D6 `GET/POST /api/desk/sessions/:id/annotations`、`PATCH/DELETE /api/desk/annotations/:id` 提供统一批注/索引，DOCX id 为 `docx:<版本组 id>:<Word 编号>`；范围使用显示文字的 UTF-16 偏移，列表共同返回 `status: anchored|lost`；lost 条目可 PATCH `blockId/from/to` 重新定位。事件 `desk.annotations.changed`；文字修改返回和 `desk.changed` 带 `removedAnnotations`。Word 重编号后返回新 id，仍保留匹配到的作者身份。
- `POST /api/desk/sessions/:id/save` 写回项目文件或存新版本；`POST /api/desk/sessions/:id/close` 按需留版本后删除工作副本。事件 `desk.changed`、`desk.session`；409 错误的 `details` 提供冲突块或外部版本。
- `GET/PATCH /api/version-preferences/:projectId` 读取、开关项目的自动整理说明。

**模型与服务商**

- `GET /api/providers/keys` 已保存密钥的名称（不返回密钥）。
- `POST /api/providers/keys/:keyRef` 保存密钥。
- `POST /api/providers/discover` 向服务商查询模型列表。
- `GET /api/providers/presets` 内置预设。
- `POST /api/providers/presets/:presetId` 用预设快速添加。
- `POST /api/providers/:providerId/adopt-preset` 旧配置改用内置预设。
- `POST /api/providers/:providerId/test` 测试连接。
- `GET /api/models` 模型目录（容量、思考强度、上限来源）。

**Python**

- `GET /api/python` 环境列表与空间。
- `GET /api/python/system` 检测系统 Python。
- `POST /api/python` 环境操作（新建、复制、同步、重命名、删除、设默认等）。
- `POST /api/python/cache/prune` 清理缓存。
- `GET /api/python/operations` 操作记录。
- `GET/POST /api/python/binding/:scope/:id` 读取、设置项目或会议的环境。
- `POST /api/python/:id/packages` 安装包。
- `GET/POST /api/python/:id/manifest` 读取、写入清单。

---

## 4. 数据存储索引

### 4.1 SQLite 表（`data/sciencescope.sqlite`）

迁移在 `app/core/db/migrations/`，编号即 `PRAGMA user_version`；有旧数据时迁移前先备份到 `data/backups/`。

| 迁移 | 表或改动                                                                                                                                     | 用途                                                                                     |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 001  | `projects`                                                                                                                                   | 项目：名称、目录名、外部文件夹、置顶、归档                                               |
| 001  | `participants`                                                                                                                               | 人和 AI；AI 的定义在 `agents/<id>.md`                                                    |
| 001  | `meetings`                                                                                                                                   | 会议：所属项目、规则 `policy_json`、分支来源、附属会议、工作文件夹、临时标记             |
| 001  | `meeting_members`                                                                                                                            | 会议成员与顺序                                                                           |
| 001  | `messages`                                                                                                                                   | 消息：作者、正文、状态、所属发言、引用、采纳                                             |
| 001  | `turns`                                                                                                                                      | 发言：参与者、触发消息、状态、停止原因、用量                                             |
| 001  | `tool_calls`                                                                                                                                 | 发言里的活动条目（工具、思考、重试、批准、压缩）                                         |
| 001  | `runtime_sessions`                                                                                                                           | 每位参与者在每个会议的运行时会话                                                         |
| 001  | `revisions`                                                                                                                                  | 工作区资源的逐条修订（前后全文、执行者、撤销）                                           |
| 001  | `events`                                                                                                                                     | 事件日志，界面事件流的来源                                                               |
| 002  | `tool_calls.preamble`、`call_id`                                                                                                             | 工具调用前的说明文字、调用 id                                                            |
| 003  | `rb_sources`                                                                                                                                 | 资料：编号、类型、元数据、原件路径、解析状态、页数                                       |
| 003  | `rb_chunks`                                                                                                                                  | 解析段落（页码、章节、字符范围），可重建                                                 |
| 003  | `rb_items`                                                                                                                                   | 条目：知识、模型、记忆、主张、笔记；状态、可见性、取代关系                               |
| 003  | `rb_revisions`                                                                                                                               | 条目每次修改前的快照                                                                     |
| 003  | `rb_fts`                                                                                                                                     | FTS5 全文索引，可重建                                                                    |
| 004  | `rb_vec_docs`、`rb_vec`                                                                                                                      | 向量检索文档表与 384 维向量（sqlite-vec），可重建                                        |
| 005  | `minutes_coverage`                                                                                                                           | 每版纪要覆盖到哪条消息                                                                   |
| 005  | `minutes_status`                                                                                                                             | 纪要错误、未完成输出、工作站更新错误；旧导出列不再使用                                   |
| 005  | `minutes_workbench_updates`                                                                                                                  | 随纪要更新工作站产生的修订                                                               |
| 005  | `secretary_pending_projects`                                                                                                                 | 待处理的进入/离开项目总结                                                                |
| 006  | `secretary_chats`                                                                                                                            | 主对话与其秘书对话的对应                                                                 |
| 006  | `secretary_cursors`                                                                                                                          | 秘书已读到主对话的位置                                                                   |
| 006  | `main_draft_proposals`、`main_draft_proposal_history`                                                                                        | 秘书提案及其可撤销历史                                                                   |
| 007  | `memory_cursors`、`memory_checkpoints`、`memory_runs`                                                                                        | 记忆整理的游标、断点和运行状态                                                           |
| 007  | `memory_dedup`                                                                                                                               | 候选记忆去重                                                                             |
| 007  | `memory_item_history`                                                                                                                        | 记忆修改的可撤销历史                                                                     |
| 008  | `resource_snapshots`；`revisions.restored_from_revision_id`                                                                                  | 历史版本；恢复来源                                                                       |
| 009  | `meeting_outbox_state`、`meeting_outbox`                                                                                                     | 待发队列及其暂停状态                                                                     |
| 010  | `message_deliverables`                                                                                                                       | 回答下方展示的交付文件                                                                   |
| 011  | `assistant_state`                                                                                                                            | 唯一的全局助手会议与概览哈希                                                             |
| 012  | `research_input_drafts`、`message_research_input`；`meeting_outbox.input_json`                                                               | 输入框草稿、消息发送时的附件与标记快照                                                   |
| 013  | `python_environments`、`python_bindings`、`python_operations`                                                                                | Python 环境、绑定和操作记录                                                              |
| 015  | `version_groups`、`manuscript_versions`                                                                                                      | 文献版本组与版本                                                                         |
| 016  | `projects.auto_version_notes`、`manuscript_versions.notes_*`、`version_note_meetings`                                                        | 自动说明开关、说明引用、后台说明会议                                                     |
| 017  | `log_file_references`                                                                                                                        | 日志条目里文件链接的可重建投影                                                           |
| 018  | `turns.phase`、`tool_calls.kind`                                                                                                             | 发言阶段、活动条目类型                                                                   |
| 019  | `turns.error`                                                                                                                                | 发言失败原因（与部分回答分开保存）                                                       |
| 020  | `input_images`                                                                                                                               | 输入框图片附件的元数据（原件在 `library/originals/`）                                    |
| 021  | 移除 `meeting_goals`                                                                                                                         | 旧自动化会议改为 `direct`，移除 `policy.goal`，保留消息及其他规则                        |
| 022  | `kb_entities`、`kb_edges`、`kb_labels`、`kb_memberships`、`kb_versions`、`kb_revisions`、`kb_jobs`；`rb_sources.folder_path`                 | 知识库实体、关系、标签、项目归属、修订与历史版本、后台任务（模型工具；表格页和节点详情） |
| 023  | `rb_sources.file_size`、`file_mtime_ms`、`content_hash`                                                                                      | 项目文件的大小、修改时间和内容哈希，扫描时判断是否变化                                   |
| 024  | `version_groups.source_path/format`；`manuscript_versions` 父版本、分支、层级、标签、标题、来源、哈希、会话；`desk_sessions`、`desk_changes` | 版本图与元数据；DOCX 编辑会话、逐块修改及撤回、保留、版本归档                            |
| 025  | `kb_entities.produced_from/evidence_json`；`kb_jobs.result_json/meeting_id/manual`                                                           | 论文卡片来源、证据和持久任务结果；卡片条目加入知识库版本快照与恢复                       |
| 026  | `kb_positions(ref,x,y,pinned,updated_at)`                                                                                                    | 跨项目共享的图位置投影、用户钉住状态；可重算，不进历史版本                               |
| 027  | `version_groups.source_hash`、`source_version_id`                                                                                            | 编辑台判断项目文件是否在外部被改过；写回项目文件不生成版本                               |
| 028  | `version_diffs`                                                                                                                              | 父子版本及任意版本对的差异缓存，可重新计算                                               |
| 029  | `manuscript_bindings`、`manuscript_comments`；`desk_changes.annotations_json`                                                                | 索引、非 Word 批注及同次修改的标注快照；DOCX 批注仍由文件和修改记录保存                  |

### 4.2 文件资源

工作区资源通过 `core.workspace` 的 `read` / `edit` / `undo` 统一读写，界面、AI 工具（`workspace_read`、`workspace_edit`、`workspace_undo`、`workspace_versions`）和外部编辑器共用同一套修订记录。

| 资源       | 键                  | 文件                                                       |
| ---------- | ------------------- | ---------------------------------------------------------- |
| `plans`    | `global` 或项目 id  | `plans.md` 或 `projects/<目录>/workbench/plans.md`         |
| `map`      | 项目 id             | `projects/<目录>/workbench/map.json`（`{ nodes, edges }`） |
| `log`      | 项目 id             | `projects/<目录>/workbench/log.md`                         |
| `minutes`  | 会议 id             | 项目会议在 `projects/<目录>/minutes/`，其余在 `minutes/`   |
| `notes`    | `<项目id>/<名称>`   | `projects/<目录>/notes/<名称>.md`                          |
| `versions` | `<项目id>/<版本id>` | 版本原件旁的 `.notes.md`                                   |
| `agent`    | 参与者 id           | `agents/<id>.md`                                           |
| `settings` | `app`               | `settings.json`                                            |

其他文件：`library/originals/`（资料原件）、`deliverables/`、`workspaces/`、`models/`、`python/`、`runtime/pi/sessions/`、`logs/`、`secret/credentials.yaml`、`backups/`、`temp/`，见 1.2 节。

---

## 技能与工具目录（X1，2026-10-19）

- `services/skills/` 读取 `data/skills/<name>/` 和随包的 `app/resources/skills/<name>/`；同名用户技能优先。SKILL.md 保留 YAML 元数据和原始 Markdown 正文；文件夹或 ZIP 导入不覆盖已有用户技能，内置只能复制或停用，删除用户副本后恢复内置。手工损坏的技能在列表显示 error，不进入模型目录。
- 主专家、专家、秘书聊天、全局助手每轮系统提示词列出启用技能；`use_skill {name}` 返回 `{name,body,directory}`（绝对路径），不存在或停用返回 `{message}`，不申请批准。绑定的启用技能正文预载到角色提示词，失效绑定跳过。后台纪要/记忆只预载绑定正文并保持无工具；已有工具的后台版本说明也收到目录（用户2026-10-19确认）。
- `GET /api/skills` 返回数组，每项 `{name,title,description,metadata,source:'builtin'|'user',overrides,directory,enabled,boundRoles:[{id,name}],error?}`（`title` 取 SKILL.md 的 `metadata.title`，没有为 null；`overrides` 表示这是用户对同名内置技能的副本）；`GET /api/skills/:name` 返回同一技能及 `body`（无 boundRoles）；`POST /api/skills/import` 接受 `{path}`（文件夹/ZIP）或 `{dataBase64}`（ZIP）；`POST /api/skills/:name/copy` 复制内置；`DELETE /api/skills/:name` 删除用户技能；`POST /api/skills/:name/open` 在文件管理器里打开技能文件夹。
- 启停使用 `PATCH /api/settings {skills:{disabled:[名称]}}`，默认空数组。角色绑定沿用 `PATCH /api/participants/:id {skills:[名称]}`。文件和设置是正本，无新增数据库迁移。
- `GET /api/tools` 返回数组 `{name,source:'builtin'|'sciencescope'|'skill'|'mcp',server?,description,needsApproval,enabled}`；本步前三类，技能每个一项。needsApproval 表示该工具在请求批准模式下可能需要询问，实际仍依照项目位置及已保存批准规则判断。设置页和时间线见下方「设置里的工具、技能、MCP 服务器」；包内有四个内置基础技能（带 `metadata.title` 中文名）（X0，Claude 2026-10-20）：`cite-sources` 查资料并引用原文、`edit-workspace` 修改工作区并留版本、`deliver-files` 交付文件、`python-analysis` 用 Python 分析数据，讲几样工具怎么配合用。

## MCP 服务器与工具（X2，2026-10-19）

- `services/mcp/` 用官方 `@modelcontextprotocol/sdk@1.32.1`（MIT）连接 stdio / Streamable HTTP；HTTP 初始化返回 400/404/405 时兼容旧 SSE。启动异步连接，新增/修改立即连接；单台失败返回原因，断线后的下一次工具调用先重连一次，已发送的调用不重放。退出关闭 Windows 子进程树。
- `GET /api/mcp/servers` 返回数组；`POST /api/mcp/servers` 添加，`PATCH /api/mcp/servers/:id` 修改，`DELETE /api/mcp/servers/:id` 删除，`POST /api/mcp/servers/:id/reconnect` 重连。列表、添加、修改、重连均返回配置及 `{status:'connected'|'failed'|'disabled',toolCount,error?}`；配置为 `{id,name,transport:'stdio'|'http',command?,args?,url?,env?,headers?,enabled,disabledTools:[]}`。toolCount 是服务器发现的全部工具数。
- `POST /api/mcp/import` 接受配置对象或 `{config:对象或JSON字符串}`；支持 `{mcpServers:{名称:{command,args,env}|{url,headers}}}`、内部名称映射和单个服务器对象，返回添加结果数组。`env` / `headers` 输入字符串保存至 `secret/credentials.yaml`，配置和响应只含 `{keyRef}`；编辑可原样回传引用，其他设置写入路径也要求引用。配置存 `settings.mcp.servers`，无数据库迁移。
- Node/npx/npm/uv/uvx 使用随包 Node、npm（11.6.2，Artistic-2.0）和 uv；子进程 PATH 优先随包目录。`mcp.npmRegistry`（默认 null = npmmirror）控制 npx，pip 复用 `python.indexUrl`，解释器复用 `python.installMirror`；缓存位于 `data/mcp/`。开发验收走 npmmirror / 阿里云。
- 所有原本具备工具的角色收到 `mcp__<服务器id>__<工具名>`（服务器 id 为 `s` 加 8 位；工具名里 `[A-Za-z0-9_-]` 以外的字符换成 `_`，超过 64 字符截断，以符合模型接口的工具名限制），原样传递 description 与 JSON Schema；文字及图片返回 `{text,images?:[{data,mimeType}],isError?}`。不接资源、提示词和采样。停用服务器从工具表移除；停用单个工具在 `/api/tools` 保留 `enabled:false`，模型工具表排除它。
- `/api/tools` 的 MCP 项为 `{name,source:'mcp',server:服务器id,serverName,tool:原工具名,description,needsApproval:true,enabled}`。修改服务器保持它在列表里的位置；只改名称或停用工具不重连，改连接方式、命令、网址、开关或密钥才重连。「请求批准」摘要为「服务器 · 工具」及参数，范围候选 `{kind:'server',value:服务器id,label:'这个服务器的所有工具',values:{}}`；按项目记住，同服务器其他工具共用，独立对话按会议记住。「常规」不问。

## 设置里的工具、技能、MCP 服务器（X-UI，2026-10-20）

- 设置 → 工具与环境 下新增「工具」「技能」「MCP 服务器」三页（`settings-tools.js`、`settings-skills.js`、`settings-mcp.js`，设计稿见画廊 PageSettingsTools / Skills / Mcp）。
- **工具**：按来源分组列出所有角色共用的工具（内置、ScienceScope、技能 `use_skill`、每个启用的 MCP 服务器），内置工具显示中文一句话说明（发给模型的英文说明不变），会询问的标「会先问」；可搜索，按全部 / 会先问 / 已停用筛选。只有 MCP 工具有开关，写服务器的 `disabledTools`；连接失败的服务器显示原因和「管理服务器」。
- **技能**：「你导入的」和「内置」两组，显示中文名、英文名和说明，绑定的角色作为标签。开关写 `skills.disabled`；点名称看正文；「⋯」里内置技能可复制一份来改，副本标「用的是你的副本」，可打开或删除副本恢复内置；导入技能从文件夹（桌面版用系统选择框，浏览器里填路径）或 ZIP；损坏的技能显示原因和「打开文件夹」。删除需确认。
- **MCP 服务器**：每个服务器一张卡片，写明已连接几个工具、连接失败原因（卡片下方一行）或已停用；开关、编辑、重新连接、查看工具、删除（需确认）。「添加服务器」表单填名称、本地命令或网址、环境变量或请求头；值只存密钥文件，编辑时已存的值显示「已保存在密钥文件 · 更换」。「粘贴配置」接受 `mcpServers` JSON，先显示识别到几个服务器。「npx 下载源」可选 npmmirror（默认）、npm 官方或自定义网址，写 `mcp.npmRegistry`。
- **绑定技能**：主专家、秘书、全局助手和每位专家的设置里有「绑定的技能」，标签加勾选列表，保存写参与者的 `skills`。
- **对话里**：`use_skill` 步骤显示「使用技能 名称」；MCP 工具显示「调用 服务器名 · 工具名」。批准卡片右上角显示「服务器名 · 工具名」、正文是参数；「总是允许」给出「这个服务器的所有工具」，规则在 设置 → 运行环境 → 总是允许的操作 里显示服务器名。
- 测试：`app/ui/extensions.browser.test.js`（技能开关、复制、看正文、导入 ZIP、绑定专家；表单添加 MCP 服务器、停用工具、对话里批准并在时间线显示）。

## 5. 测试索引

- **入口**：`npm run check` = Prettier 格式检查 + ESLint + TypeScript 类型检查（`tsc -p app`）+ `node --test --test-concurrency=2 "app/**/*.test.js" "tools/package/*.test.js"`。只跑测试用 `npm run test:app`。R5 已删除旧原型的 `npm test` 脚本。
- **组织**：测试文件与被测代码放在一起，命名 `*.test.js`（基线时 99 个），按用户路径写功能测试；多数迁移有测试检查旧数据升级。
- **脚本化模型**：服务和接口测试用 `app/runtime/scripted.js` 代替真实模型；临时目录由 `app/testing.js` 建在 `.sciencescope-local/temp` 下。`app/ui/i18n/en.test.js` 检查每个界面中文字符串都有英文对照。
- **运行时测试**：`*.runtime.test.js`（`app/app.runtime.test.js`、`app/main.runtime.test.js`、`app/runtime/pi/http.runtime.test.js`）启动真实宿主或本地 HTTP 假服务商，检查启动输出、关闭、超时和重试。
- **浏览器测试**：`*.browser.test.js`（33 个）用 `playwright-core` 驱动真实宿主加脚本化模型，覆盖对话、讨论、秘书、面板、批准、知识库、预览、标记、工作站、导图、文献版本、Python、设置等页面。浏览器按顺序找 `SCIENCESCOPE_CHROMIUM`、`/opt/pw-browsers/chromium`、Windows 上的 Edge；都找不到时跳过。设置 `SCIENCESCOPE_SCREENSHOTS=<文件夹>` 保存截图。辅助代码在 `app/ui/browser-testing.js`。
- **仅 Windows**：两个测试在非 Windows 上跳过，都用真实的无删除共享文件句柄检查占用时的重试与恢复：`app/core/workspace/workspace.test.js`（计划文件被占用）和 `app/core/projects.test.js`（项目文件夹改名被占用）。原生窗口和助手窗口的浏览器测试（`native-window.browser.test.js`、`assistant-window.browser.test.js`）在没有浏览器时跳过。
- **打包**：`tools/package/*.test.js`（裁剪、许可说明、NSIS 钩子）纳入 `npm run check` 的格式、ESLint 和测试检查；Windows 专用测试按平台和编译器可用性运行。
- **原生**：Rust 启动测试在 `src-tauri/src/new_app.rs`，用 `cargo test` 运行。
- **编辑台**：`services/desk/sessions.test.js` 覆盖完整接口流程、逐块冲突和撤回顺序、失败原子性、空闲批写、外部修改、正常退出及落盘前中断的恢复；`services/desk/docx/*.test.js` 保留读写结构测试。界面：`ui/desk-blocks.test.js`（段落与表格转换、提交内容、合并）、`ui/desk-session.test.js`（防抖同步、冲突、外部写入、写回确认、文本合并），`ui/desk.browser.test.js` 在浏览器里改 docx（分段、加粗、撤销、外部修改两种选择）、表格和书签、md 的 BOM 与 CRLF、关闭标签。
- **真实模型与安装包验收**：不属于自动测试。按 `AGENTS.md` 和 `docs/process/ACCEPTANCE.md`，涉及 AI 路径的改动用便宜的付费模型跑一次并报告请求数和 token；安装包从全新安装开始验收。已知不稳定：`app/ui/map.browser.test.js` 的导图历史测试偶发失败，留待导图重做。
