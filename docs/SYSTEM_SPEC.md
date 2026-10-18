# ScienceScope 系统功能与技术说明

A2-1（2026-10-18，待审阅）：输入框 PNG/JPEG/WebP/GIF 图片原件保存在 `library/originals/`，迁移 020 的 `input_images` 保存元数据，不登记成资料库来源。`POST /api/research-input/:owner/attachments` 返回草稿；消息 `researchInput.materials[]` 中图片字段为 `type=image`、`id`、`name`、`title`、`mimeType`、`bytes`、`url`、`selectionId`；`GET /api/research-input/images/:id` 按现有认证返回原件。运行时只向模型目录声明支持 image 的模型传图片；不支持时仍生成文字回答，回合记为 failed，`turns.error` 显示可读原因。重启、分支及重新回答保留图片输入。

主专家和专家提示词加入「用户没有提到其他对话时，不查阅本对话以外的会议记录；需要时先说明再查」，工具权限不变。原生「添加 → 截图」调用 Windows Snipping Tool，完成后加入当前草稿；取消不加附件，结束恢复窗口。全局设置 `composer.hideWindowOnScreenshot` 默认 true，经现有 settings workspace read/edit 接口读写并实际生效；用户要求设置开关及消息缩略图由 Claude 接入，本轮未加这两项界面。浏览器保留系统截图后粘贴提示。

P1b（2026-10-17，已合并）：共享宿主工具已恢复 shell、文件读写/精确编辑/搜索与网页读取。会议 `policy.approval` 默认为 `ask`；shell、数据目录外写入和 Python 包安装经批准接口等待，活动保存 `approval` 与 `pending/approved/rejected/cancelled`，拒绝及取消不写 `turns.error`。界面：输入栏执行方式三档（请求批准、常规、自动化），新对话默认请求批准，选择存在会议规则里；批准卡片出现在时间线里它发生的位置，状态行显示「等待你的批准」，处理后收成「已允许 / 已拒绝 / 已取消」一行；秘书和全局助手的回答里同样出现批准卡片。详细接口见 `02_INTERACTION_CONTRACTS.md` 2026-10-16 修订。

P1b 上下文压缩：全局 `context.compactPercent` 默认 80，可设置 50–95。每次模型请求前按实际发送内容的 UTF-8 大小估算上下文；达到比例时，同模型单次请求整理较早消息，最近两轮用户消息及其后工具结果保留原文。成功后原子保存会话、发 `compaction` 活动（`result={beforeTokens,afterTokens}`，均为估算）；阶段为 `compacting`。摘要失败或达到输出上限时保留原文继续；请求日志 `purpose=compaction` 记录用量及失败。秘书纪要与会议原文保持独立。时间线显示「上下文已自动压缩 12 万 → 1.8 万 token」一行，状态行显示「正在压缩上下文」；门槛在「设置 → 模型与服务商」用滑块调整（50–95，松手保存），输入栏的上下文环到这个比例变成提醒色。

> **这份文档记录"现在是怎样"，不规定"必须这样"。**
> 它描述当前代码中每个功能的用途、状态、技术实现和验证证据，供开发者（Codex、Claude 及后来者）
> 快速了解现状，也方便用户查阅。功能的设计以后可以改变；改变时同步更新本文档即可，
> 不应因为本文档写过某种实现就拒绝更好的设计。产品意图与交互规则的依据仍是
> `00_MASTER_FUNCTIONS.md`、`02_INTERACTION_CONTRACTS.md` 与已批准的 `ScienceScope.html`。
>
> - 最近核对：2026-09-24，基线 `main@98e560a`（Claude 对照代码逐项核对）；2.2、2.4、2.5、2.16 于同日随界面刷新、标记与专家讨论修订（分支 `claude/determined-pasteur-jxpzw8`，未合并）更新；2026-09-25 新增 2.17 研究资料库（同一分支）；2026-09-26 新增 2.5b 对话纪要与历史回查，2.5 专家前文改为纪要 + 其后原文（同一分支）。
> - 最近核对补充：2026-09-27，T17 上下文查阅层已接入生产服务（context API `t17.1`、宿主工具清单、秘书跟进游标、全局概览哈希与范围隔离）。`node D:/nodejs/node_modules/npm/bin/npm-cli.js test` 159/159 通过（196.890 秒，日志 `.sciencescope-local/temp/t17-validation/npm-test-final.log`）；20 项既有浏览器/API smoke、新 context UI smoke、四角色真实 DSH 工具清单测试 4/4（Astra 已复核）及 T17 live 评测均通过；T17 UI 生成 8 张截图，代表性画面已人工复核（`.sciencescope-local/temp/t17-validation/context-access-ui/`）。live 评测为 20 轮 Main 后秘书正确回答纪要/编号/待办，全局助手跨项目下钻；28 个 HTTP 200 请求、prompt 298542、completion 2598、无 API 错误。T17 原生客户端未重测；不据此宣称全产品 alpha 或整批原生验收通过。
> - 历史过程与每次验收细节见 `DESKTOP_IMPLEMENTATION.md`（按日期的开发日志）；本文件只写当前结果。
> - 最近核对补充：2026-10-05，T24：Windows最终 `npm test`371/371，既有31项smoke及browser/Tauri原生长输出/继续通过；额外旧policy mock补齐后单跑通过。模型容量、正常max-tokens、长资料/提议/纪要、用户累计token设置已实现；D用户数量限制保持。旧/新各三轮真实24案例：55物理/49有效/6重试、779661已知token及7usage未知。论文完成和整理核心任务覆盖改善，科学限定和提议完整支持未提高；4案例终结基础设施失败与模型/产品失败分列，详见 `T24_LIMITS_REPORT_2026-10-05.md`、`T24_SOURCE_AUDIT_2026-10-05.md`；不是安装包或alpha发布验收。
> - 最近核对补充：2026-09-27，Astra 在 Windows 完成 r4 阶段1与T04（阶段2），最终136/136测试、19项原有smoke和新viewer smoke，原生PDF/标记/公式验收通过。阶段3关键词、本地e5-small和52题真实模型审计已完成，包含质量失败及有界取消样本；详见2.17及实施记录。不代表安装包或全部科研质量验收通过。

**状态标记**

P1a（2026-10-17，已合并）：新核心的模型运行时改为 `app/runtime/pi/`（`@earendil-works/pi-ai` 与 `pi-agent-core` 1.0.0，精确锁版本），不再启动 DSH 子进程；DSH 只留作旧线的开发依赖，安装包里没有。服务商可用内置预设（OpenCode Go、DeepSeek，只填密钥）或自定义；模型容量和思考强度一律来自 pi-ai 的模型目录，自定义模型按 ID 匹配，匹配不到用 131,072 / 32,768 并标明是默认值；接口 `GET /api/providers/presets`、`POST /api/providers/presets/:id`、`POST /api/providers/:id/test`、`GET /api/models`。请求控制：首个事件 90 秒、流中两事件间 120 秒超时；未写出内容时网络错误、超时、429、5xx 最多尝试 3 次（遵守 Retry-After），401/403/404/400 和上下文超长不重试；停止直接中止请求、工具和 uv。每次请求写一行元数据到 `data/logs/model-requests.jsonl`（不含密钥、请求和回答，超过 5 MB 轮换一份）。会话上下文存 `data/runtime/pi/sessions/`。迁移 018 加发言阶段 `turns.phase` 和活动条目类型 `tool_calls.kind`（`tool`、`thinking`、`retry`），019 加失败原因 `turns.error`：部分回答失败时正文保留，原因单独显示。启动各阶段时间点写入 `data/logs/startup.log`。P1b 补回命令、文件和网页工具之前不出安装包。

R6a（2026-10-13，已合并）：原生外壳默认启动新核心，旧宿主需显式设置 `SCIENCESCOPE_APP=legacy`。安装版从相邻 resources 定位 Node 22.22.2、uv 和生产依赖，数据在 `<安装目录>/data`，原生宿主日志在 `data/logs`；开发版仍用 `.sciencescope-local/data`。Python 下载源默认为官方，自定义地址只传给 uv 子进程的 `UV_PYTHON_INSTALL_MIRROR`，软件包镜像独立设置。`npm run package` 生成未签名的 1.0.0-alpha.0 NSIS 包，按当前用户安装、位置可选，附 LICENSE 与自动生成的生产依赖、Node、uv 许可说明；卸载默认保留 data，只有明确勾选“删除应用程序数据”才删除。安装版真实主对话、有序讨论与审核采纳、PDF 检索、内置 Python、两轮自动化、两版稿件导入通过；100% / 125% 七页原生截图已留存，退出进程树与 WAL/SHM 清理通过。覆盖安装数据库不变，默认卸载研究文件哈希不变；本机程序安装与卸载耗时较长。首测包、路径和校验值见 `handoff/PREVIEW_TEST.md`。

R4-3b（2026-10-07，待审阅）：新界面工作/有序讨论菜单保存会议规则，旧 discussion-strip 与 panel-chip 结构提供名册顺序选择及独立审核。真实作者/职责、等待/作答/工具/完成/未完成状态、共用工具卡及流式文字均接到事件；审核采纳和已读锁定使用 3a 接口，说明在 i 提示。工作模式 @ 菜单支持箭头、Enter/Tab 插入、Esc、光标中途插入，组字 Enter/229 不发送；重试/继续只定向原作者。上下文弹层显示主专家及本会议每位专家最新真实测量，未知窗口诚实显示 tokens/未知。名册原八人上限移除，十人保存重载通过。所有新文字补英文。Windows 原生便宜模型两专家→审核→采纳→主专家接答通过，5 次 HTTP200、90,402 服务商报告 tokens；关闭后完整进程树与 WAL/SHM 清理，重开上下文与锁定恢复。独立干净检出重新安装依赖后 Windows npm run check 87/87、无跳过（Edge）；首次 86/87 的既有资料库测试漏监听响应，修复为点击前监听并复查通过；原生中文候选完整提交仍待 M1 验证。无自动化、秘书、技能绑定或自由讨论。


R4-3a（2026-10-07，待审阅）：新核心已实现工作模式 @ 启用专家、有序讨论的独立会话并行与固定输入截止、按选择顺序建回答、全部专家结束后审核。专家首次发言加入会议成员，mode/order/reviewer 随会议持久保存。审核初始不进入后续上下文，未完成不能采纳；已采纳且被任意后续发言实际读取后不可撤回（409），迟采纳的旧审核也补读。停止取消整轮及未开始的审核，重试/继续只运行原作者，最新各参与者 context 可按会议读取。重启恢复未结束发言为取消；退出等待已取消的工作结束后关闭数据库。脚本化服务/API及真实 DSH + 本地模型并发测试验证；发现 Windows 冷启动共享 profile 模块锁超时，DSH 启动握手改为排队，已建立会话仍并行回答；关闭等全部启动尝试结束再释放，测试保留原错误不让清理覆盖。独立干净检出重新 npm install 后，Windows npm run check 84/84、无跳过（含 Edge）。付费请求为 0。界面与原生真实模型验收属 3b。


R4-1b（2026-10-06，待审阅）：新界面复原数据库、我的资料与外部资源入口；资料导入、关键词/混合检索、文献元数据筛选排序分页、重新解析、原件打开、段落引用复制，以及知识/模型/主张条目编辑、取代、历史、置顶、归档。采用旧资料库 CSS 与表格/卡片结构，新增文字有英文。设置的目录与运行时页提供本地混合检索控件，进度通过 `research.semantic.changed` 推送，无轮询。`semantic.enabled` 的真实消费者为共享本地检索服务，API 与 AI 工具共用；迁移 004 把 384 维 sqlite-vec 向量存进同一 SQLite，模型在新数据根 models/。模型为清单固定的 multilingual-e5-small int8，首次下载须点击并校验每个 SHA-256；硬件检测、工作线程、后台预热、对话期间暂停索引，索引缺失/版本变化/向量阶段超过 300ms 整次退回关键词，结果报告 mode。Windows 真下载五文件校验通过，9/9 索引、重启与真实混合搜索读取通过；所有测试注入假嵌入不下载模型。记忆/收件箱/简报及预览/附件未做。付费模型请求与 token 均为 0。

R4-1a（2026-10-06，待审阅）：新核心 `app/services/research/` 已提供 PDF/DOCX/Markdown/LaTeX/文本导入、原件保存、分段、中英文关键词检索、来源/条目 API，以及全角色共享 `research_search` / `research_read`。迁移 003 保存 `rb_sources/chunks/items/revisions/fts`，已有 v2 数据先备份再升级。原件在新数据根的 `library/originals/`，与旧线数据不混用。读取分页报告 total/remaining，不截断全文；PDF 保留页码，DOCX 仅有明确分页时提供页码，否则为 null。引用兼容 `[S3 p.4]`、复合、中文和全角格式，未知写法保留记录。修改保留旧快照；取代保留旧行与链接，默认候选仅 active，私有条目不进入 AI 候选。导入及条目修改提交后发 `research.changed`。功能与接口细节见 `design/CORE_MODEL.md` §11；界面、向量检索、记忆整理属后续任务。验收使用脚本化运行时，零付费请求。

L1 Windows（2026-10-06，待审阅）：`SCIENCESCOPE_APP=new` 使原生外壳启动新 `app/main.js` 并加载首行JSON的 `ui`；默认旧宿主，开发数据默认 `.sciencescope-local/data`，可设 `SCIENCESCOPE_DATA`。新宿主协作关闭后沿用 Job 清理进程树。原生窗口/dialog权限复用，学术站点走系统opener；Explorer使用SystemRoot绝对路径且启动失败回传。中文目录/项目、字体/importmap、窗口控制/真实拖动、目录选择绑定、默认程序打开、中文zip下载、真实模型计划编辑/agent_main修订/撤销/搜索/英文流程通过；真实IME组字Enter不发送，中文候选完整提交仍未完全核实。最终 `npm run check`42/42、Rust2/2及构建通过；全套测试并发2避免外置盘冷启动竞争，产品超时未改。5次真实请求（均HTTP200）、84,822 tokens；另1次本地模型用于活跃DSH原生关闭，全树消失、退出0、WAL/SHM清理。旧新截图发现细小复刻偏差，记录在忽略的 `.sciencescope-local/temp/l1-windows/visual-comparison.md`；不代表安装包/R4验收。

R3 云端（2026-10-05，Claude）：新 `app/ui/` 一比一复刻旧主界面（相同结构与类名，旧版完整样式表 `app/ui/styles/legacy/`），接新核心。已复原的入口与页面见 `design/UI_RESTORE.md`：外壳与菜单、侧栏、欢迎页与学术站点、主工作聊天（工具活动、停止、继续、重试、分支、消息菜单、查找、置顶摘要、上下文环、模型与推理强度）、工作站与计划 / 日志 / 文件夹页、导图编辑窗口、创建项目页、浏览全部、导出，以及设置（常规、快捷键、模型与 API、主专家 / 任务秘书 / 全局助手、专家角色、目录）。需要后端服务的入口（资料库、研究输入、有序讨论、秘书、全局助手、执行策略、文献版本、Python、技能）列为 R4-1…R4-10，做完即按旧版位置显示。Linux 无头 Chromium 下四个浏览器测试（对话、设置、工作站）与 `npm run check` 38 通过、2 项仅 Windows。原生外壳尚未接入（L1）。

R2 Windows 核对（2026-10-05）：新 `app/` 服务商配置支持可选 `headers` 并透传到 DSH；OpenCode Go 可配置 `x-opencode-session`，key 仍经凭据接口写入独立文件。真实便宜模型通过 HTTP 会议流程修改中文项目的 `plans.md`，修订执行者为 `agent_main`；6次真实请求（4 HTTP200、2 HTTP400），65,374已知token，失败请求用量未报告。Windows盘符 `file://` 插件加载、中文工作/临时目录、实际 Ctrl+C 退出0及已捕获 app/DSH 进程清理通过，WAL/SHM消失。闲置释放以交接允许的2秒设置通过真实DSH/本地模型验证，生产默认10分钟未改；未实等10分钟。最终 `npm run check`35/35；证据在 `.sciencescope-local/temp/r2-windows-validation/`，不代表界面或安装包验收。

R1 Windows 核对（2026-10-05）：新 `app/` 核心的项目中文目录、会议/消息和计划CLI已通过。原子写入与项目目录改名对 `EPERM/EBUSY/EACCES` 短暂重试（50/100/200/400 ms），仍失败时返回 `PATH_BUSY`/409，提示关闭占用窗口或检查权限；原文件、项目记录及修订保持，临时写入文件清理。Windows真实无delete-sharing句柄回归通过。`app/main.js` 普通及活跃SSE下Ctrl+C退出0，WAL/SHM清理且重开数据完整；`npm run check`格式/lint/类型及23测试通过。旧线 `desktop/scripts/adapters` 未改，原生外壳接线仍属L1。

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
| `dsh/` | DSH home：运行历史（压缩的 session 日志）、Provider 配置、技能、会话补丁；旧凭据迁至 `secret/credentials.yaml` |
| `assistant-workspaces/<chatId>/` | 秘书与全局助手会话的工作目录 |
| `temp/` | 临时文件、测试夹具、临时提问（quick）工作区 |
| `secret/` | 应用凭据 `credentials.yaml` 与本地测试密钥；受保护、不进 Git |

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
- **状态**：✅ 前端、文件夹校验/绑定、Python 环境后端与原生选择框（T11，Windows 开发客户端验收；非安装包验收）。
  在 `/api/python/*` 出现之前，Python 字段只有"系统 Python"一个选项（即实际使用的解释器），不发送 `pythonEnvId`；
  文件夹选择按钮在 `folderPicker` 开关打开前不显示（见 2.18），不退回浏览器对话框。
- **技术实现**：
  - 前端 `desktop/creation-details.mjs`；选择保存在草稿（`workspaceChoice`、`pythonEnvId`），首条消息随 `/api/chat`、`/api/discussion` 发送。
  - 宿主 `scripts/workspace-folders.mjs` 的 `validateWorkFolder`：必须是已存在的绝对路径文件夹；拒绝磁盘根、系统目录、
    ScienceScope 自己的 `.sciencescope-local`（及包含它的文件夹）；整个用户目录给出警告，需再次确认。
  - `desktop-api.mjs` `ensureMainBinding`：独立对话首条消息时按选择确定运行工作区——新建 → `projects/independent/<chatId>`，
    公共 → `projects/independent`，已有 → 校验后的文件夹；`/api/workbench/bind` 也先校验；新增 `POST /api/folders/check`。
  - T11 后端在首条消息时绑定 `pythonEnvId`，接受后消费初始选择；之后改环境不会被旧草稿覆盖。创建项目先保存目录/环境绑定，再加载工作站，防止默认路径缓存。
- **验证**：`tests/workspace-folders.test.mjs`；`scripts/creation-details-smoke.mjs`（窗口、取消、非法路径原地提示、已有文件夹成为 `startSession` 工作区、
  默认新建文件夹、项目页校验与绑定、项目内对话不弹窗、Python 待接入状态，浅色 / 深色截图）。
- 说明文字在"i"提示中（见 2.16）；窗口里只显示校验错误和警告。
- **最近核对**：2026-09-29（Astra，Windows）：真实原生 picker、取消、辅助窗口拒绝、项目绑定和显示均通过；Go在所选目录真实写入，目录外询问审批拒绝。详见 T11 实施记录。

### 2.2 主对话（主专家）

- **用途与操作**：向主专家发送消息，逐字显示回答（Markdown、代码块复制、表格、数学公式）；运行中发送键变为"停止"，
  已生成的内容保留；运行中可继续输入，并显式加入发送队列；工具调用按本次回复归组，可展开参数和结果；
  模型在工具调用前写的执行性前导语（如"先读取研究稿"）不留在正文，归入对应工具调用，并作为折叠卡片的说明；正文只保留面向用户的回答和工具执行后的结论；
  切换对话不影响后台运行，侧栏显示运行、完成、失败、等待审批等状态；发送失败时原文回到输入框。
- **状态**：✅（单元、界面、DSH、真实模型、原生）。
- **技术实现**：
  - 前端 `desktop/live-chat.mjs`（发送、流式渲染、停止按钮、失败恢复）、`markdown.mjs`（marked + DOMPurify 白名单；公式 `$$…$$`、`\[…\]`、`$…$`、`\(…\)` 在解析前取出，净化后由 KaTeX 0.18.9 渲染（trust 关闭），代码中的 `$` 与 "$5 and $10" 保持原样，错误公式显示为红色原文；KaTeX 的 CSS 与 woff2 字体随 `VENDOR_ASSETS` 复制并走同一白名单；2026-09-27）、
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
  - T24：`max-tokens` 是正常的模型上限终态，保留长文本或空文本与工具回执，主专家/秘书/全局助手的回复显示“已达到模型输出上限”和“继续”。`POST /api/chat/continue`、`/api/assistant/continue` 根据宿主记录校验最新回复，在原 DSH 会话另发继续指令，追加新回复，不覆盖原文或已有草稿；过期回复返回 409。用户提问不会出现继续按钮。自动化独立 projection 也保存空/非空模型上限回复；仍在运行的目标须用户先暂停。容量设置变化仅在下一轮释放空闲进程并恢复同一会话后应用。真实 DSH 的生成结束后仍等待有序本地流交付队列排空，避免细粒度长流误报交付失败。
  - 记录：用户与助手消息写入 `messages`；工具记录写入 `tool_activity`（有界、脱敏的展示投影；完整历史在 DSH）。
- **验证**：`main-interrupt`、`main-outbox-api`、`chat-outbox`、`tool-activity`、`provider-failure-surface`、`reasoning-effort-wire` 单元测试；
  `chat-ui-smoke`、`failed-send-draft-smoke`；真实 OpenCode Go 小请求、停止、5.5 分钟长任务（原生，2026-09-23）。
- **已知限制**：队列只接受纯文本轮次（带材料的输入会留在草稿里，需要再次确认）。
- **从消息分支（T12）**：`POST /api/chats/branch {chatId,messageId,mode:'reply'|'reask'}` 创建“分支：原标题”，保存 `branchedFrom {chatId,messageId,title}`。“从此回复分支”使用该主专家轮次的 `endSeq`；“从此处重新提问”使用上一轮主专家回复，首条问题创建同项目、同设置的空对话。两种方式都把关联问题、附件、标记和上下文引用预填到可编辑、未发送的草稿，文本修改通过 `/api/chats/draft` 持久保存，接受发送时仅清除已发送的同文草稿。来源标题可点击回到精确原消息。
- **运行时与展示边界**：使用 Claude 已接通的 DSH `/turns`、`/fork`（`sessionQuery` 读日志、`agents.create` 以完整轮次前缀创建持久子会话）。应用层复制可见前缀并重建消息身份、工具投影、研究输入回执和讨论元数据；不以展示文字替代模型历史。主专家每轮保存真实 `endSeq` 与完成状态，自动工具循环只给最终文本提供回复分支入口。生成中、失败、停止、源对话忙或有待发送队列时禁止分支。没有可靠序号的旧消息保持 `BRANCH_POINT_UNKNOWN`，本轮不猜测补录。
- **讨论与设置**：专家回复处分支从讨论前最后一个主专家边界 fork，按界面名册顺序复制到该专家的展示记录；专家回复经既有后续发送机制进入主专家上下文。采纳标记保留；只有前缀含后续已完成 Main 轮次时保留 `mainSeen`。复制项目、模型、工作文件夹、人设快照、推理强度、Python 对话绑定和执行模式；自动模式不继承活动目标，仍需明确发送。双方会话独立，工作文件夹按任务设计共用，不创建文件快照。秘书、全局助手和临时聊天不提供入口。
- **最近核对（2026-10-03）**：聚焦 store/API 7/7（含讨论排序、采纳与后续上下文），迁移 3/3，真实 DSH 应用回归 1/1（11 次本地模拟模型请求，付费 0），全量 npm 242/242、既有23项 smoke 最终通过（首轮两个失败及修正见实施记录）。浏览器与实际 Windows Tauri/WebView2 中英深浅色验收通过后开启 `branch`（检测 `forkSession` 与 `sessionTurns`），开启后均再验通过，原生9个owned PID已退出。本轮不代表安装包或 alpha 发布验收。

- **新界面（2026-10-16，P1-UI 第一步，`app/ui/`）**：对话页按设计系统重做（`design/DESIGN_SYSTEM.md`）。44px 页头（标题、成员头像、查找、会议秘书、⋯，项目置顶摘要移进 ⋯）；用户消息是右侧气泡，AI 消息有头像、名字和模型；每次回答的工具调用是一条行动时间线（前导语和"读取 计划""搜索资料库 …"这样的动作行，点开看参数和结果；运行中展开，结束后收成"用时 X 秒 · N 个步骤"）；消息下方一行状态（已发送等待、正在运行某工具、失败原因加重试、你停止了、达到输出上限加继续）；复制、重新回答、⋯ 悬停时出现，分支移进 ⋯。输入框：发送和停止是同一个按钮（运行中输入框为空时是停止，有文字时发送进入队列），Esc 在没有弹层且输入框为空时停止；模型和思考强度合在一个弹层里；执行方式只显示常规、自动化，「请求批准」等 P1b 接通后由 `app/ui/features.js` 打开；聊天正文默认 14px。2026-10-17（P1a）：状态行跟随发言阶段（已发送、正在连接模型、正在思考、正在重试第 n/3 次、运行工具），时间线增加「思考了 X 秒」（点开看思考内容）和重试行；失败时保留已写出的正文，下方写原因，密钥错误多一个「去设置」。
- **模型与服务商设置（2026-10-17，P1-UI 第二步，`app/ui/components/settings-models.js`）**：快速添加 OpenCode Go 订阅和 DeepSeek 官方两个预设，只填密钥；对话框「测试并保存」先保存再发一次很短的请求，失败时对话框留着并写明原因（401/403 写成密钥无效）。已添加的服务商一张卡片：名称、地址或模型数、密钥是否已保存，测试连接后显示「连接正常 · N ms」或失败原因；下方表格列出模型的上下文、最长输出、思考强度和上限来源（目录 / 匹配 / 默认值），全部来自 `GET /api/models`，超过 8 个模型折叠。⋯ 菜单：自定义服务可编辑地址与模型、重新获取模型列表；都可更新密钥、移除服务商（确认框，默认模型属于它时提醒）。默认模型一个下拉（`models.default`），上下文压缩门槛一个滑块（`context.compactPercent`）。「其他兼容服务」表单只填名称、接口格式、地址、密钥、附加请求头和模型 ID，不再手填容量。输入栏模型菜单、秘书和全局助手的模型菜单、上下文环的窗口大小都改读模型目录。密钥从不回显。地址与内置预设相同的手动配置（例如 P1a 之前的 OpenCode Go）卡片上提示「改用内置配置」：`POST /api/providers/:id/adopt-preset` 把密钥移到预设，默认模型、记忆模型、专家定义和会议里的模型选择随之改指预设，预设没有的模型改回继承。画廊里的「无响应时停止」「修改上限」「隐藏模型」没有做（超时是常量，后两项没有存储值）；秘书的模型仍在「任务秘书」页设置。

### 2.3 执行策略与自动化

- **用途与操作**：输入框的"询问 / 完全接管 / 自动化"菜单。
  - 询问：需要授权的操作弹出审批。
  - 完全接管：常规操作不逐次询问，受保护路径的命令始终审批；不限制网络访问。
  - 自动化：主专家按目标连续执行多轮，可暂停、继续、结束；仅主对话提供。
- **状态**：✅（DSH、界面）；自动化在真实模型上的长时间运行验收有限。
- **技术实现**：`desktop/execution.mjs`（菜单、目标面板、审批卡片、自动化输出预览）；`scripts/execution-service.mjs`；
  接口 `GET /api/execution`、`POST /api/execution/goal|approval`；表 `execution_sessions`。
  策略的实际映射：询问 → DSH 审批策略 `ask` + 沙箱 `workspace-write`；完全接管 → `never` + `danger-full-access`；
  自动化 → DSH goal 服务（`/goal`）。T21 受保护路径审批独立于上述通用策略，文件工具直接拒绝；说明见 2.15。
- **验证**：`dsh-approval-smoke`、`dsh-goal-smoke`、`dsh-policy-smoke`。
- **Windows 原生核对（2026-09-27）**：阶段 1/12a FAILED。询问模式下，同样的 `pwsh` danger-full-access 请求，Main 显示审批卡并在批准后成功，@ 专家没有卡且工具 `isError:true`；专家原始错误未出现在结果预览。真实 DSH + 本地模型对照，非付费验收。尚未修改运行时审批路由；详见 DESKTOP_IMPLEMENTATION r3。
- **最近核对（2026-09-27，r4）**：上述 r3 缺陷已修复并通过原生 12a 复验。DSH 普通子代理固定 `never`；只有宿主显式创建的讨论专家在创建窗口内继承本轮用户审批策略，并将请求带专家身份转发至原有审批卡。普通子代理和 Main 行为不变，专家沙箱范围不因角色名称扩大。真实 DSH + 本地模拟模型通过 Main/专家批准、拒绝、等待中取消、两专家相反决策并发；原生窗口通过四个批准/拒绝场景及刷新后工具结果持久化。工具结果预览复用有界脱敏投影。此处不代表付费或完整阶段 1 已通过。
- **r4 最终复验**：真实 DeepSeek V4.1 Flash 专家写测试工作区外的专用文件，先拒绝、再显示审批卡、批准后成功；Full 下一轮同类写入不询问。真实自动化完成原生暂停/继续/结束：5 个启动轮次（2 次取消、3 条完整输出），重启后输出保留且不自动恢复。首轮测试脚本误断言及缺少清理导致的超轮失败单独留档，修正后复验通过；不声称长期无人值守或安装包已验证。

### 2.4 研究输入：附件与标记

- **用途与操作**（2026-09-24 起"引用/批注"统一为"标记"）：
  - 附件：可选择、拖入或粘贴文件，原件存入资料库，输入框显示附件条；点击附件可"预览并标记 / 手动添加文本标记 / 移除附件"。
  - 标记：在聊天消息或右侧**文件预览**中划选文字，弹出贴着选区的小窗，可写备注，Enter"添加标记"（Shift+Enter 换行，Esc 关闭）；
    不弹对话框，可以连续标记多处。消息里的标记进入该对话自己的输入框（主对话 → 主输入框；秘书/全局助手 → 各自输入框）；
    小窗里另有"引用至任务秘书 / 引用至全局助手 / 复制"。
  - "标记 N"按钮：在输入框的附件条中，N>0 时出现；点击展开二级快捷窗口，按顺序列出每个标记的来源（对话发言人或文件名+段落）、原文和备注，
    支持定位（滚动并闪烁到原消息，或打开文件预览并高亮原文）、修改备注、移除、全部清除；Esc 或点外部关闭，不重挂正文和输入框。
  - 发送：正文与当前全部标记、附件一起组成下一轮输入；发送后消息下显示可读回执"标记 N 条 · 材料 M 份"。
  - 文件预览（右侧栏"文件预览与标记"）：T04 将阅读投影与模型附件预算分开；阅读器读取完整文本（文件大小上限 100 MB），模型附件仍共享 64000 字符预算，
    可切换当前项目的资料；已有标记在预览中高亮；数据库材料行有"预览"按钮。
- **状态**：✅（单元、界面、Windows 原生）；2026-09-27 r4 原生连续三处对话标记及一处 Markdown 标记、编辑/定位/移除/回执通过；真实 DeepSeek V4.1 Flash 的回答逐项使用四处标记，持久化为 3 quotes + 1 annotation。
- **技术实现**：
  - 前端 `desktop/research-input.mjs`（草稿、选区小窗、"标记 N"窗口、回执）、`desktop/file-preview.mjs`（真实预览栏，替换原型的演示预览；
    `window.ScienceScopePreview.open(id,{page,highlight})`；原型中按版本打开预览时映射到 `metadata.versionId` 相同的资源）、`desktop/marks.css`。
    后端 `scripts/research-input.mjs`（编译器）、`research-input-store.mjs`（草稿、回执、已消费版本）、
    `chat-attachments.mjs`（读取原件；txt/md/csv/json/tex/log 按 UTF-8 最多提取 64000 字符，其他格式只给路径）。
  - 数据：消息标记存为 `messageQuotes`（来源对话、消息、原文、备注），文件标记存为 `annotations`（资源、原文、位置"第 N 段/行"、备注）；上限沿用 16 / 32 条。
  - 送给模型的格式：在 `[User-provided research material]` 标记内放 `<material>`、`<quote>`、`<annotation>` 标签块，
    正文保持原样，属性转义（2026-09-23 起，原为 JSON 字符串；对照实验见 `scripts/evals/material-format-ab.mjs`）。
  - 接口：`GET/POST /api/research-input/draft`、`POST /api/library/import`、`GET /api/library/preview?id=`；Main、秘书、全局助手共用同一编译器。T04 阅读器新增受同一 Bearer 边界保护的 `GET /api/library/document?id=`（阅读投影和解析状态）、`GET /api/library/content?id=`（PDF/DOCX 原件），旧 preview 契约不变。
  - 表：`research_input_drafts`、`research_input_receipts`、`research_input_consumed`、`resources`。
  - 语义：发送确认后只清除本次捕获的标记版本；发送失败时恢复材料；秘书问答不消耗标记。
- **验证**：`research-input`、`research-input-store`、`research-input-api`、`library-preview` 单元测试；`research-input-ui-smoke`、`marks-ui-smoke`
  （连续标记不弹框不重挂、预览标记、窗口内容、修改、两种定位、Esc/外部关闭、移除、发送携带全部标记、回执、秘书目标、全部清除）。
- **T04 最近核对（2026-09-27，Windows r4）**：PDF.js 阅读/文字层及页码标记、DOCX 正文/只读版式、CodeMirror 只读源码、CSV 前 500 行、KaTeX 公式及语法高亮已接线。新增 viewer smoke 和原有 19 项 smoke 通过；原生 PDF 跳页/高亮/标记和聊天公式通过中英、深浅色 8 张截图验收，10 个 owned PID 关闭后全部消失。API 原件与阅读投影均有鉴权回归，旧附件预算不变。DOCX 版式是 docx-preview 的近似呈现，不是 Word 排版引擎。
- **已知限制**：不做 OCR，不编辑原件；PDF/DOCX 附件不会隐式将整份提取文本塞入 prompt，检索使用 Research Base 解析结果；多份文本附件共享 64000 字符预算；
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
  - T19 增加独立审核类型：`kind: reviewer` 的名册项只能经 `reviewerId` 进入有序讨论的最后审核位，放入 `expertIds` 会返回 typed 400；已有参加专家仍可担任审核。审核时机、输入与用户决定是否采纳的流程不变。
- **状态**：✅（单元、界面 smoke、真实 DSH 和 Windows 原生）。2026-09-27 r4 使用 DeepSeek V4.1 Flash / GLM 5.3 Flash / Qwen 3.8 Flash 实测邀请、并行作答、审核在后、原生采纳及 Main 补读。两次审核耗尽输出预算如实记为失败，不计入成功轮；成功轮证据与失败路径分开记录于 DESKTOP_IMPLEMENTATION。
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
    - `/experts` 在回应前等待所有已排队的专家事件送达宿主，避免 `expert-end` 丢失（2026-10-04 修复，Dot 普查 6/30）。
    - 审核专家在第一次 `runExperts` 全部结束后单独运行，输入为同一前文 + 本轮各专家回答（`<answer speaker=…>`）。
    - `pendingForMain()`：主专家下一轮发送时，把它还没读过的、已采纳的专家回答作为一段"其他参与者的消息"放在用户消息前，发送成功后标记 `main_seen`。
    - `adopt()`：切换审核结论是否进入后续上下文。
  - 接口：`POST /api/discussion`（NDJSON 流；`kind: 'ordered' | 'invited'`，`expertIds`，可选 `reviewerId`；旧值 `independent` 视为 `ordered`）、
    `POST /api/discussion/adopt`、`POST /api/discussion/cancel`（也可由 `/api/chat/stop` 触发）。
    专家回答是普通 assistant 消息，元数据在 `discussion_entries`（新增 `review`、`adopted`、`main_seen` 列），读消息时作为 `message.expert` 返回并按顺序重排；
    专家的工具记录写入 `tool_activity`（以专家消息 id 为键）。
  - T19 技能接线：`POST /api/experts` 校验绑定 id 属于当前已启用且有效的技能；派发前再次检查并读取技能正文，只把显式绑定内容放进对应 child 的 `boundSkills`。当前 DSH 子代理没有按代理设置的原生技能白名单，运行时回退为在子代理人设之后附加独立 system prompt section（`interpolate:false`），关闭 skill 工具目录并在 prepend pre-step hook 过滤未绑定的 slash skill invocation。真实 DSH 2/2 验证了绑定技能注入/过滤和 Main 路径不变。旧式第三专家探针最初失败，原因是测试夹具未注册 `model-legacy`；补登记后恢复三 child + Main 场景，2/2 通过，无 production fix。该约束不构成文件系统隔离，不能宣称阻止已授权文件工具读取其他技能文件。
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

最近核对补充（2026-09-27，r4）：未完成的审核（包括 `max-tokens`）不能加入后续上下文。界面原已隐藏采纳按钮；现在 `/api/discussion/adopt` 同样返回 `REVIEW_NOT_COMPLETED` / 409 且不改变采纳状态，避免直接 API 调用产生“已采纳但未传入”的误导状态。旧代码失败、新代码通过的回归见 `tests/discussion-api.test.mjs`；成功审核的采纳语义不变。

T19 核对补充（2026-09-27）：独立审核支持单独的人设和技能绑定；participant/reviewer 分组上限各 8，派发仍至多 8 位作答者加 1 位审核者。现有 `experts` 通过加列迁移获得 `kind`（默认 `expert`）和 `skills_json`（默认 `[]`），原有提示词与名册不重写。首迁移用独立 marker 插入一个停用的默认独立审核人；用户删除后不复活，id 冲突时保留原用户记录。审核采纳语义保持不变。`expert-roster` + `discussion-api` 定向测试 8/8、绑定技能注入/过滤的真实 DSH 2/2 和限定真实模型格式/控制流检查通过；旧式第三专家探针因夹具未登记 `model-legacy` 最初失败，修复夹具后三 child + Main 场景 2/2 通过，无 production fix。T19 验收报告与剩余原生/安装包范围见 2.6。

### 2.5a 回答中展示的文件（交付物）
- **用途**：模型用 DSH `present` 工具声明的文件显示在该回答下方：图片为缩略图卡片，其他文件为文档卡片；点击用系统默认程序打开。
- **状态**：✅（界面 smoke）；原生客户端未测。
- **技术实现**：前端 `desktop/deliverables.mjs`（从回答的工具记录中取成功完成的 `present` 调用；缩略图经带口令的 `hostBlob` 取回，最多缓存 40 个对象 URL）；
  宿主 `scripts/deliverables.mjs`：`GET /api/chats/deliverable?chatId&path`（只返回图片，≤20 MB）、`POST /api/chats/deliverable/open`。
  只有本对话中某次成功的 `present` 调用声明过的路径才会被读取或打开；相对路径按该对话的运行工作区解析。
- **验证**：`deliverables-smoke`（缩略图为真实图片、文档卡片、重新加载后仍显示、只读过的文件和任意路径被拒、专家前文只含展示的文件）。
- **最近核对**：2026-09-26（Claude，云端）。

- **T24 专家上限与续写（最近核对2026-10-04）**：达到模型输出上限的专家回复保留全部已生成正文，显示上限状态和继续入口；未完成审核不能采纳。`POST /api/discussion/continue {chatId,messageId}` 从宿主绑定恢复原专家子会话、模型/人设/技能/工具范围/审批，保留历史，不推进Main或自动注入结束结果。已继续的旧段入口关闭；完成的审核合并原部分段后仍须用户采纳才加入后续上下文。Python执行环境已变化时明确拒绝恢复，避免把旧会话带入错误环境。专家输入、人设与简报不再有400000/16000/40000字符应用限制；内部RPC资源边界64 MiB且返回显式413，前文24万字符资源概览仍逐条注明省略范围并可回查。上游上下文能力及余量行为见Runtime Port限制表。

### 2.5b 对话纪要与历史回查（2026-09-27，含 T17 查阅层）
- **用途与操作**：任务秘书为每个对话维护一份纪要（研究目标、已定结论与出处编号、被否定的方案、分歧、各方立场、文稿与文件状态、待办），
  纪要由既有服务按规则更新；T17 移除了每轮主对话后的无条件总结。T18 已接入按消息/token/进出项目设置化触发并通过本任务验收。
  对话"…"菜单 → 对话纪要：查看、编辑（保存为新一版，秘书之后在此基础上继续）、让秘书立即更新。主专家、专家、秘书和全局助手共用只读查阅层：`project_memory`（纪要、项目日志、计划、导图、稿件版本、紧凑状态）和 `chat_recall`（按关键词检索或按编号逐字读取对话原文）。
  查找规则写在每位专家的系统提示（人设末尾）和主专家的项目简报一节，不使用 agent.md。
- **状态**：🟡。T17 离线测试、真实 DSH 工具清单、浏览器/API smoke 与 context UI smoke 已通过；T17 原生客户端未重测。
- T18 当前实现分支为 `codex/t18-summary-policy-20260927`，叠加已推送的 T17 `5ea220f`；本任务验收已通过。22 项浏览器/API smoke 均通过；12 张截图已生成，root 已复核设置/提议界面及英文深色纪要窗口。
- **技术实现**：
  - `scripts/chat-minutes.mjs`：表 `chat_minutes(chat_id, revision, text, through_ordinal, author 'secretary'|'user', updated_at)`，每版保留。更新 = 上一版纪要 + 完整新消息（约6万字符的批次目标，单条超过目标仍整条送达，可多步），用秘书角色的模型（未设置时用对话模型），`noTools` 会话，用完释放；T24 移除单条2万字符截断及纪要10万字符拒绝，用户编辑超过64 MiB时明确资源错误且保留旧版。T17 不改变既有纪要内容，也不恢复每轮主对话总结。消息编号为对话序号 +1。
    T18 另存 Markdown 使用 `chat_minutes_markdown_status` 记录导出路径/错误；写入先临时文件再原子改名，数据库纪要仍是唯一来源。用户编辑与秘书生成均触发版本回调，初始纪要生成期间的用户编辑优先。
  - `scripts/secretary-preferences.mjs`、`scripts/context/estimate.mjs`、`scripts/summary-policy.mjs`：`secretary_preferences.summary_json` 采用默认讨论后、20 条消息、30000 估算 token、进入/离开项目和 Markdown 开启，工作站 `map|versions|plans|log` 默认 `off`；消息阈值 4–500、token 阈值 2000–500000。事件策略使用 CJK 每字 1 token、其他字符每 4 字符 1 token 的稳定估算；Main/讨论沿用纪要防抖，项目切换串行处理脏对话，启用离开项目规则时关闭写入 `summary_pending`，启动后 30 秒处理。
  - `scripts/summary-workbench.mjs`：纪要成功后按 `off|propose|apply` 处理工作站建议；`summary_proposals` 等待用户接受，`summary_writes` 记录来源与前后状态，撤销遇到目标已变化返回 409。当前 host 不支持可宣称的原生 JSON Schema constrained-generation，生产通过提示 JSON 格式并由本地 allowlist 严格校验；导图秘书新增节点保留 `origin: 'secretary'`，桌面工作站已显示“秘书添加”。
  - `scripts/context/registry.mjs`、`policy.mjs`、`sources/*.mjs`：context API `t11.2` 的资料源注册表与范围表；`conversation`、`minutes`、`log`、`plans`、`map`、`versions`、`status`、`workspace` 均通过依赖注入读取。`chat_recall` 检索只返回有意界定的摘录，按编号读取才返回完整消息；T24 查询不再截断或限6问法，搜索支持 `limit/offset/next` 分页，单批资源边界10000结果，向量与关键词固定排序避免分页漏项；状态保留完整导图节点与待办，工作区概览仍明确标为概览并可下钻。工具调用、工具结果、前导语、临时/助手私聊和资料库私有条目不进入上下文。
  - `scripts/context/catch-up.mjs`、`scripts/assistant-chat-service.mjs`：秘书每轮发送前生成跟进包，使用 `context_cursors` 游标；只有成功完成且未取消的发送才提交游标。大积压先以最多 60 秒等待纪要刷新，再发送纪要与尾部原文；240000 字符安全边界逐条列出省略编号，不静默截断。
  - 原 `scripts/project-memory.mjs` 已迁入 `scripts/context/`，旧文件删除；既有工具名称与参数保持兼容。主专家/专家/秘书按会话范围读取；全局助手通过 `workspace_overview` 概览后按 `projectId`/`chatId` 下钻。
    `chat_recall` 按编号一次最多 40 条 / 6 万字符并返回 `next`；检索返回最多 12 条带编号片段。
  - 宿主按角色生成工具清单并由 DSH 会话 manifest 注册，经 `/host-call` 转发；工具 schema 不再在 DSH 适配器中复制。规则节由 `contextRules` 生成并带 `t17.1` 版本，角色人设仍与规则分离。
  - 接口：`GET /api/chats/minutes?chatId`（含 `summaryStatus.messagesRemaining/tokensRemaining` 与 `exportStatus.error`）、`POST /api/chats/minutes {chatId,text,expectedRevision}`（版本过期 409）、`POST /api/chats/minutes/refresh`；`GET/POST /api/secretary/preferences` 增加 `summary`，`POST /api/projects/focus` 触发项目切换策略，工作站提议/撤销接口见第 3 节。
  - 前端 `desktop/minutes.mjs`（菜单项、渲染 Markdown、编辑、刷新；"i"提示说明用途）。
- **验证**：既有 `tests/chat-minutes.test.mjs` 与 `tests/research-tools-runtime.test.mjs`；T18 原始聚焦测试 8/8，后续 root/context 回归 11/11；最终 `npm test` 180/180 通过（231911.3596 ms，exit 0，含新增提示回归）；22 项浏览器/API smoke 均通过。12 张截图已生成，root 已复核设置/提议界面及英文深色纪要窗口。真实模型三轮结果：第 1 轮失败（20 请求；prompt/completion/total 164460/6702/171162；无计划提议并超时，夹具矛盾且两个请求触及 1024 token 上限）；第 2 轮失败（18 请求；154032/4348/158380；模型输出空 plans 并超时）；第 3 轮通过其评测断言（18 请求；154105/3460/157565；两版纪要，待办计划提议匹配，实际计划未改动，提议未视为批准）。合计 56 请求、prompt 472597、completion 14510、total 487107。第 3 轮使用明确声明 `propose` 不执行/应用且不代表用户批准的提示。具体结果见 `DESKTOP_IMPLEMENTATION.md`。T18 原生未重测；T17 的 npm 159/159、20 项 smoke、真实 DSH 4/4 与 live 28 请求证据仍见实施记录。
- **已知限制**：检索仍是关键词匹配；纪要质量取决于秘书模型。T18 本任务验收已通过；原生客户端未重测，不作为本任务阻塞项。当前 host 不提供可宣称的原生 JSON Schema constrained-generation，已采用提示 JSON + 本地 allowlist 严格校验，不能把模型输出约束当作安全边界。
- **最近核对**：2026-09-27（Windows；原始聚焦回归 8/8，后续 root/context 11/11，最终 npm 180/180，22 项浏览器/API smoke 通过；12 张截图已生成并复核指定界面；真实模型第 3 轮通过评测断言，第 1、2 轮失败；T18 验收通过，原生未重测）。

### 2.6 专家名册（设置 → 专家角色）

- **用途与操作**：增删、改名、调顺序、启用/停用专家；为每位专家选择模型（或"使用对话所选模型"）、编辑提示词和职责标签；
  所有启用的专家都用同一模型时，页面会给出提示。T19 列表分为参加专家和独立审核两组；每项可绑定一组已启用技能。进入专家页时刷新 skills/providers catalog；目录变化时先收集并保留未保存的专家编辑，再重绘表单。参加专家参与作答且也能审核；独立审核不出现在作答者或 @ 候选中，只能作为最后审核者。
- **状态**：既有名册功能 ✅；T19 扩展 ✅（单元、真实 DSH、限定 live、22-smoke 和最终 npm 均通过；原生客户端及安装包/签名未测）。
- **技术实现**：`desktop/expert-settings.mjs`；`scripts/expert-roster.mjs`；接口 `GET/POST /api/experts` 返回/接收每项 `kind`、`skills`。表 `experts` 迁移增加 `kind TEXT NOT NULL DEFAULT 'expert'`、`skills_json TEXT NOT NULL DEFAULT '[]'`；`expert_roster_state` 增加独立的 `independent-reviewer-seeded` marker。老数据的人设保持不变；首次迁移增补停用的英文人设独立审核人，保留已有同 id 用户项，用户删除默认项后不会复活。参加专家最多 8 位，独立审核最多 8 位；讨论仍最多派发 8 位参加者和 1 位审核者。
- **技能边界**：保存时以启用、有效的 `/api/skills` 清单校验绑定 id；GET 仍保留已绑定但后来被禁用的 skill，POST 和派发拒绝这类绑定。宿主仅向被选中 child 读取并交付绑定技能的 `{name, markdown}`；DSH 不提供子代理原生技能白名单，回退注入独立 system prompt section、隐藏 skill 工具并过滤未绑定的 slash 调用。这不是文件系统隔离；授权文件工具仍可能读取其他技能文件。
- **验证**：`tests/expert-roster.test.mjs` + 扩展的 `tests/discussion-api.test.mjs` 8/8；覆盖 legacy 列迁移、人设保留、独立默认与删除 marker/id 冲突、双组上限、kind/skills 校验、停用参加者的 typed 400、审核技能正文绑定、审核次序与采纳语义。真实 DSH 技能注入/过滤 2/2 通过，Main 路径不变；旧式第三专家探针因 fixture 漏登 `model-legacy` 最初失败，补登后恢复原三 child + Main 场景 2/2 通过，无 production change。真实模型 `deepseek-v4.1-flash` 一轮通过格式与控制流检查：2 HTTP 200 请求均有 usage（prompt 19309、completion 759、total 20068），Analyst 先答、reviewer 后审，输出 `T19_REVIEW`/`Evidence:`/`Verdict:` 格式；两条专家消息持久化，participant 回答可进入后续上下文，reviewer 保持 `adopted=false`，零工具调用与后台错误。root 检查了最终文本和结构，不据此宣称科学结论普遍正确。discussion UI smoke r2 与目录刷新保留未保存编辑回归通过；12 张截图位于 `<工作区>\.sciencescope-local\temp\t19-validation\discussion-ui`，由 Sol 逐张复核并由 root 抽查 settings-en-dark、reviewer-menu-en-light、review-adopted-zh-dark；标签准确、菜单完整、无假 focus 错误。22 项 smoke 全通过；首次 npm 185/186 的唯一失败是并行 `build-desktop` 对 `desktop/discussion.mjs` 的源码/生成 Buffer 比较，与 root 最后的 `data-i18n-skip` 编辑重叠，是测试执行协调问题而非产品构建缺陷，失败日志保留。最终独立 `npm test` 186/186，0 failure/cancel/skip，236688.8466 ms，exit 0（日志 `.sciencescope-local/temp/t19-validation/npm-test-final-frozen.log`）。新增加的 i18n missing count 为 0（整体 baseline 1759）；438 个源码文件及 30 个 evidence 文件 secret/key scan 零命中。T19 原生客户端、安装包与签名未测。
- **最近核对**：2026-09-27（分支 `codex/t19-reviewers-20260927`，叠加 T18 `9fd2455`；名册/API 8/8、DSH 2/2、live 2/2 请求、22 项 smoke、12 图复核、npm 186/186 全通过；原生客户端和安装包/签名未测）。

### 2.7 任务秘书

- **用途与操作**：每个主对话有一位私有秘书（侧栏），历史与主对话分开；可选模型、推理强度、询问/完全接管，可上传附件。
  秘书可以用 `propose_main_draft` 工具起草给主专家的指令，界面出现可编辑的提案卡片，
  由用户确认后才填入主对话草稿，仍需用户自己发送。
- **界面（2026-10-17，Claude）**：秘书和全局助手是右侧面板（`app/ui/components/side-panel.js`），拖动左边缘调宽、双击恢复，宽度存 `appearance.panels`。对话用和主对话相同的消息、活动时间线、批准卡片和状态行（`assistant-surface.js` 复用 `chat-message.js`），消息底部只有复制和重新回答。输入框：添加、执行方式两档（请求批准 / 常规，存会议 `policy.approval`，面板不提供自动化）、模型和思考强度（`model-picker.js` 的覆盖模式：第一项跟随继承的模型，其余写会议 `policy.model`，不改默认模型）、发送 / 停止合一。秘书面板顶部一行写跟进位置；提案是卡片（待审阅 / 已填入草稿 / 已忽略，修改记录可撤销）。
- **状态**：🟡（既有单元、DSH、界面、原生证据；T17 自动跟进层已通过完整测试、smoke 与 UI 截图复核，T17 原生客户端未重测）。
- **技术实现**：前端 `desktop/assistant-chat.mjs`（秘书与全局助手共用）；后端 `scripts/assistant-chat-service.mjs`、`assistant-conversations.mjs`；
  接口 `GET /api/assistant`、`POST /api/assistant/chat|draft|model|approval|stop|proposal/resolve`；
  表 `assistant_conversations`、`assistant_drafts`、`assistant_settings`、`assistant_draft_proposals`、`assistant_attachment_drafts`。
  提案工具由 `session-control.mjs` 在秘书会话中注册（值 schema 使用 DSH 的 DSL）。每个助手会话一个 DSH 进程，空闲时最多保留 2 个。
- T17 自动跟进由 `contextAccess.catchUp({conversationId: assistantChatId, chatId: mainChatId})` 提供；`context_cursors` 记录主对话游标、纪要版本和状态哈希。跟进包成功发送后才提交，失败/停止不推进；秘书只能访问绑定的非删除 Main 对话及所属项目。
- T18 `summary-policy` 监听主回合、讨论结束、项目 focus 和应用启动事件；阈值触发沿用纪要防抖，跟进补齐不受总结开关控制。默认设置为 20 条/30000 token，设置保存于 `summary_json`；自动 Markdown 导出失败只写状态，不改变数据库纪要。T18 验收通过，原生未重测。
- **验证**：`assistant-chat-service`、`assistant-conversations` 单元测试；`assistant-api-smoke`（含 `--native`）。
- **已知限制**：T17 已移除旧的 20 条/3000 字隐式摘录；搜索仍返回有意限定的摘录，完整内容需按消息编号回查。T18 验收通过；T17/T18 原生客户端未重测。

### 2.8 全局助手与悬浮球

- **用途与操作**：左下角全局助手，可在独立窗口与悬浮球之间切换；可隐藏，隐藏时保留草稿、不停止任务；
  启动行为可设为关闭、悬浮球或展开；在助手窗口里点项目或工作站，会让主窗口跳到对应位置（BroadcastChannel `navigate` 消息）。
- **状态**：🟡（原生窗口能力仍为 ✅；T17 跨项目查阅层已通过完整测试、smoke 与 UI 截图复核，T17 原生客户端未重测）。
- **技术实现**：Tauri 命令 `open_secondary_window`、`set_assistant_mode`、`get_assistant_mode`、`show_assistant_menu`、`hide_assistant`（`main.rs`）；
  前端 `native-window.mjs`、`assistant-window-settings.mjs`；窗口尺寸存 `<exe 目录>/data/assistant-window.json`；
  启动偏好存表 `assistant_window_preferences`（接口 `/api/assistant-window/preferences`）；对话复用第 2.7 节的助手服务（scope=`global`）。
- T17 全局助手发送前可取 `contextAccess.overview({conversationId})`；工作区概览以变化哈希去重，包含有界的最近项目、工作文件夹、纪要目标/待办、计划、导图和最近对话，细节通过 `workspace_overview`、`project_memory`、`chat_recall` 下钻。全局目标只能选择非删除、非助手 Main 对话，私有/临时资料排除。
- **验证**：`assistant-window-preferences` 单元测试；`assistant-window-smoke`、`native-windows-smoke`、`native-assistant-geometry-smoke`。
- **已知限制**：截图快捷键和操作系统级全局热键未实现；T17/T18 原生客户端未重测。全局助手的 T18 总结设置与工作站写入已通过本任务验收。

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

- **T05 接线（2026-09-27，已验收）**：生产资料库列表由 `desktop/research-base.mjs/css` 接管，保留侧栏入口、页签、原件打开与 T04 阅读器。文献表按服务端排序、筛选后每页 50 条；知识/模型/主张/记忆卡片提供修订锁编辑、置顶、归档、取代和历史；记忆收件箱支持修改后接受与批量决定；项目简报直接显示后端原文。下列旧 `library.mjs` 描述保留为兼容接口说明，不再代表新版列表。

- **用途与操作**：
  - "当前项目材料"与"我的资料"：列出原件和项目版本，可搜索、打开、查看详情、导入（单个文件 ≤14 MB）。
  - 知识条目：可从材料提出知识候选（研究经验 / 规范知识 / 私有），确认后变为"已采用"，并保留来源。
- **状态**：✅（界面）；"外部资源"页的站点用系统浏览器打开（`/api/open-url`），站点增删仍是原型的本地状态、不持久化（⬜）。
- **技术实现**：`desktop/library.mjs`；`scripts/library-service.mjs`（项目版本会自动登记为资源）；接口 `GET /api/library`、`POST /api/library/import|open`、
  `GET /api/knowledge`、`POST /api/knowledge/propose|accept`；表 `resources`、`knowledge`（命名空间 canonical/heuristic/private，状态 candidate/accepted）。
- **当前接线**：全文索引、检索工具和确认条目的模型简报由 2.17 的 Research Base 提供；旧知识接口仅用于兼容已有数据。

### 2.12 模型与 Provider（设置 → 模型与 API）

- **新核心**：本节描述旧线。新界面的「模型与服务商」页见 2.2 末尾（2026-10-17）。

- **用途与操作**：添加、编辑、删除 Provider（协议、地址、模型列表），填写只写的 API key，可从端点发现模型；
  每个输入框可选模型，推理强度只列模型声明支持的选项。
- **状态**：✅（单元、DSH、真实模型）。
  最近核对补充（2026-10-04，T24）：模型容量保存、重载和下一轮应用已由真实DSH本地provider浏览器验收；完整Windows回归、原生和三轮真实评测结果见实施记录本日T24节，不能把运行时默认称为已验证服务商容量。
- **技术实现**：`desktop/model-settings.mjs`、`provider-draft.mjs`（校验，不按模型名猜协议）、`reasoning.mjs`；
  `adapters/runtime-dsh/web-host.mjs` 在回环地址启动 DSH 完整 Web profile；`provider-service.mjs` 调用其 `settings`、`credentials`、`llm.discoverModels`、`session.modelCatalog` 服务。该进程在后台启动（上限 60 秒），失败经 `onError` 报告并在下一次服务商调用时重试，不会让整次运行都无法配置服务商（2026-10-04 Claude 审阅修复，Dot 普查 2/30）。
  界面创建的 Provider 以 `sciencescope-` 开头，凭据存在 DSH 的文件型凭据库（不是系统钥匙串）。
  T24 保存发现结果的模型名称、`contextWindow` 和 `maxTokens`。模型表单显示每模型最大输出，可修改；留空移除覆盖，未知时明确显示DSH默认32768，而非推断供应商容量。`model-info` 返回容量及configured/runtime-default来源，保留推理能力。发现配置和用户覆盖均由DSH profile保存，不能区分它们的历史来源。上游仍按估计剩余上下文减去4096余量下调请求输出；这是已记录的DSH限制。
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
| 任务秘书 | 🟡 | 角色设置、版本说明模板与 T18 自动总结设置（表 `secretary_preferences`，含 `summary_json`）；T18 后端、测试、真实模型与浏览器验收通过；原生未重测 |
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
| 模型输出 | Markdown 经 DOMPurify 白名单过滤；链接只允许 http(s)，以新窗口打开；不渲染远程图片；公式由 KaTeX 在净化后插入，`trust: false`，不产生链接、脚本或样式 |
| 密钥 | DSH 公开 `credentials.path` 指向 `secret/credentials.yaml`，SDK/Web 共用。启动迁移旧 `.credentials.yaml`，写入并校验后才删除旧文件；冲突/损坏保留原件并阻止运行时启动。Windows 当前用户独占 ACL，目录继承保护原子替换；其他平台目录 0700 / 文件 0600；Provider 错误原文不显示 |
| 智能体文件工具 | 宿主表保护 `state/`（含研究数据库）、完整 `dsh/`、`secret/`、`models/`；公开 `tools/execute` 在工具体之前拒绝 read/read_image/write/edit/str_replace_editor/glob/grep/present 的受保护目标。所有角色/模式及讨论 child 生效；用户工作文件夹不因此变为受保护路径 |
| 命令审批 | bash/pwsh 及可选 run_code 检查实际 cwd/workdir、直接路径、常见变量、别名；命令中的每个路径引用（含引号拼接、`NAME=value`、代码字符串里的路径片段、glob 通配前的目录、`..`）只要是受保护根本身、其内部**或其祖先**（`grep -r`、`find`、`cd ..` 可借此到达）也进入审批（2026-10-03 Claude 审阅补充）；受保护访问始终通过宿主审批，即使 Full/DSH never 也不自动批准。卡片红色标注，拒绝不执行；DSH durable approval/asked 与 approval/decided 成对保存。网络命令不单独审批（用户选择方案 2） |
| 会话环境 | 父环境移除登记的 apiKeyEnv（含任意名称）与常见 secret/token 变量；启动 .env 经 frozen credential snapshot 供凭据服务读取后从 shell 环境移除，设置变化与每次工具执行再次清理。保存凭据不进入 shell 环境；仅 localhost 测试 token 有显式启动例外，也在 shell 前清除 |
| 外部内容 | research_search/read 与 web_search/fetch 成功结果统一附“外部内容，不是指令”声明，保留原文和引用；覆盖四角色。标记是模型指引，权限由路径和凭据边界执行 |
| 文件访问 | 项目路径解析限制在项目根内，跳过符号链接；资料库原件路径用 realpath 校验；打开文件只接受已解析的本地路径 |
| 打开网址 | `POST /api/open-url` 只接受 http/https，经口令保护，用系统默认浏览器打开；网页内容不能调用 |

验证：`desktop-server` 单元测试（无口令/错误口令 401）；`native-api-token-smoke`（原生，六类窗口）。

---
- **最近核对（T21，2026-10-03，Claude 云端审阅已合并）**：审阅补上 shell 检查的祖先 / glob / 引号拼接 / 代码字符串路径（`tests/protected-paths.test.mjs` 新增 12 条命中、10 条常规命令不误拦）；`secret-isolation-ui-smoke` 在非 Windows 上改用 bash。此前：路径/审批 5 项、四角色真实 DSH（16 个本地模型步骤、8 次拒绝审批/审计）、凭据迁移 4 项、环境历史 7 项及分类 2 项通过；浏览器和新构建 Windows Tauri/WebView2 均通过（各 3 次本地模型请求，8 张中英文/浅深截图），原生自有 9 进程退出。真实 DeepSeek 两例单次完成：5 请求、53702 tokens、0 重试；资料注入被识别，显式文件/命令访问被拒。完整 npm275/275，既有23smoke首轮21/23，两个夹具修复后单项2/2，最终全部有通过证据；原失败保留，详见实施记录。
- **已知限制**：完全接管模式不限制网络访问，网络外传防护属于已知限制；shell/脚本文本检查不能覆盖任意动态构造、未知变量、硬链接或同用户进程内存访问。规范化覆盖 realpath/junction、最近存在祖先、`..`、大小写、Windows namespace/UNC/短路径和 ADS；短路径证据以本机实际 8.3 返回值为准，不能声称遍历所有网络共享映射。递归 grep/glob 请求受保护目录的祖先也拒绝，须缩小为研究目录。DSH 无 read/list 意图钩子，当前拦截针对公开内置工具；第三方插件自身的任意文件读取需另行审核。同用户 ACL 不能隔离智能体与应用；DPAPI 可防明文落盘，同用户仍可解密，本轮只评估。操作系统出网控制列为 alpha 后任务。

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
- **状态**：✅（界面外观层的浏览器与 Windows 原生验收）。2026-09-27 r4 完成 64 个页面/语言/主题组合、助手/浮球/秘书栏、加载完成的项目工作站/导图及字体设置检查。缺失的“暂无置顶”“暂无计划”英文词条已补回归；没有以此宣称所有原型文字均已翻译。完整批次验收仍看 DESKTOP_IMPLEMENTATION，不等同于安装包发布验收。
- **技术实现**：`desktop/refresh.css`（最后加载的样式表，令牌定义在 `:root` 与 `:root[data-theme="dark"]`，
  深色令牌已从 `settings.css` 移入这里），`desktop/refresh.mjs`（上述小交互，只附加监听，不替换已有处理函数；
  `projectRow` 仅对置顶行做包装）。二者在 `scripts/build-desktop.mjs` 的资源白名单与页面注入中登记。
- **验证**：`chat-ui-smoke`、`settings-ui-smoke`（断言已更新为新令牌值）及其余界面 smoke；
  `creation-details-smoke` 覆盖"i"提示（点击固定、不选中选项、Esc、菜单项）；
  `scripts/ui-gallery.mjs <输出目录>` 用离线模拟数据生成 17 张截图（主页、对话、讨论、秘书、工作站、导图、数据库、
  设置四页、命令面板、右键菜单、输入框菜单、深色、全局助手窗口、悬浮球），用于前后对比。

### 2.17 研究资料库

- **T24 长内容（最近核对2026-10-04）**：`research_propose` 不再限标题/正文/结构化内容/LaTeX/理由/引文/备注的语义长度；标题仅界面折叠，原文保留。完整记录超过64 MiB时明确资源错误，旧记录与待审提议不改；秘书长提案及编辑草稿亦不再限64000，Main正式发送的用户消息限制仍列为D待用户决定。复合引用不再限32成员或2048字符，异常资源输入字面保留。解析长段按20000字符无损拆分（不拆UTF-16代理对），保原页码/锚点与sourceOrdinal/字符区间，索引可重建，原件和目录独立保留。`research_read` 请求窗口可到64 MiB，整段不裁切；页/范围/来源返回hasMore、nextOrdinal及继续说明。简报短条目明确指向research_read全文。检索问法/查询原文无截断，底层向量接口接受更多问法和较大返回数量，安全范围过滤不放宽。

- **T09 记忆整理（2026-10-04，已实现，待 Claude 审阅）**：应用服务订阅 T17 `chat.idle`，默认空闲10分钟，可在秘书设置关闭或调整1–1440分钟、显式选模型，也可用对话菜单“整理这段对话”。只读取新增消息区间及纪要版本差异；历史纪要纠正另附编号对应原文，不重写整段对话总结。仅 Main 可整理，助手私聊、临时和私有对话排除。游标、运行状态和去重存于同一 SQLite；不常驻会话进程。
- **T24 整理现状（2026-10-05，实现与验收完成，待审阅）**：候选抽取与同类共享有效 item top-5 的 `create/update/supersede/noop` 判断使用独立 `noTools` 会话，输出取所选模型配置；移除8192输出、字符、8候选、40消息与输入预算硬限制。纪要差异及对应完整原文按模型上下文容量无损分批，跨窗比较先独立读取原文页并持久保存逐字引文支持的候选观察，再分页判断；观察仍是未确认模型结果，引文存在不证明推论正确。决策冲突或完整单条观察装不下时明确保留待处理状态，不推进游标；调整容量后可手动接续。`max-tokens` 在原会话继续，旧部分输出、失败请求未提交的流文本均在状态中保留。游标只在批次提议完整提交后推进，`rb_consolidation_pending` 保存来源定位、哈希、进度和模型输出，来源或模型变化后重新规划。解析/证据失败不自动重新整理；DSH暂时性重试保持既有规则，没有自动换模型。
- **用户成本设置**：每次整理累计 `tokenLimit` 默认100000，可修改或留空关闭。输入与输出均计入；请求前按原文、格式、已保留上下文与完整输出预留估算，请求后优先计服务商实际总token，缺失/全零用保守估算并标明。超预算跳过后续批次，已生成内容不截断、未处理游标不推进，下次接续。估算不是账单或严格费用保证；DSH无可靠价格，不能把未知价格0解释为免费。默认依据T09 54阶段已知 P50/P95/最高9969/15641/17084，约最高值5.85倍，可覆盖两次32768输出预留加常见输入；旧样本受原上限约束，并非无上限成本预测。
- 所有非noop候选只调用 `store.propose`，origin保留整理身份、对话、区间和纪要版本，证据必须逐字匹配对应消息。来源由宿主回执、引用、资源、条目及成功的网页工具活动判定；网页/文献标 `payload.originTrust='external'` 并保存来源，删除source/chunk目录后历史回执仍保留external与原定位。收件箱显示外部来源提示、原文定位、接受/修改后接受/拒绝。确认前不进入有效记忆或简报；编辑确认不能降级来源、移出项目或丢掉原文证据；更新/取代修订冲突保持等待确认。精确quote只证明出处，不保证模型候选的事实均受支持。
- **T09 最近核对（2026-10-04，待 Claude 审阅）**：Windows合并基线npm293/293及secret-isolation-ui/discussion-ui/dsh-approval通过。最终实际npm332/332、0fail/cancel/skip/todo（471186.5209ms），既有27项smoke全部PASS，T09 browser/native各PASS16图、下一Main确认记忆简报及自有进程正常退出；均为本地模拟provider，真实DSH本地provider独立2/2。真实deepseek-v4.1-flash两组各3轮30题：不整理严格18/19/18（均18.33/30），整理20/19/22（均20.33/30）；人工核心事实均30/30，全部论断及引用语义支持29/29/28与29/29/30。原分数/失败不覆盖，严格分差主要是格式和字段，短纪要预载导致事实天花板，不能宣称整理效用已提高。基础设施终结失败0，54整理阶段39完成/15输出预算失败；117候选111完整支持，80提议77完整支持、3附加推论，1重复事件，人工确认不可省略。正式614物理/599有效/15重试、7026892已知tokens、15usage未知；预验另36请求169362tokens，合计650请求7196254已知tokens、28usage未知。六组来源哈希和12冻结源码一致，180答案/三组候选独立来源审完成。i18n新增22片段missing0；完整逐题矩阵、发现→原因→修复→验证、截图和限制见实施记录及T09交付报告；安装包/升级/签名未测。
- **T10 补充最近核对（2026-10-04，待 Claude 审阅）**：共享纯解析器支持 `[S3, p.4]`、`[S3 p4]`、`[S3; S5]`、`[S3 p.4–5]`；API additive `citations/raw/parseStatus/unrecognized`，兼容完整单引用的 `citation`。UI 保持回答原文，复合来源菜单、从范围首页打开阅读器；未知/部分未知格式字面保留并有界记录，畸形括号及非法序号候选也进入审计。单来源范围按 maxChars/400段有界读取，返回范围/实际页/截断与续读；多来源须分别读，原权限及项目歧义规则保持。引用/read/report26/26、生产parser路由、浏览器与Windows原生通过；最终npm281/281，既有23smoke及branch/semantic/retryUI通过。首轮npm生成资源清单断言280/281失败经根因修复后复验，首轮日志保留；有效28项验收为派生汇总，详细证据与四种语言主题截图见实施记录顶部。
- **三轮当前状态观察（2026-10-04）**：deepseek-v4.1-flash 固定52题核心完整40/41/42，平均41/52；基础设施失败1/2/1单列，排除后的质量分母51/50/51，平均完整率80.93%。第二轮 EPERM 中断保留原记录，仅独立补六个未尝试题、know04不重发，不能称该原始run无中断完成。预算失败2/3/3、工具偏离1/2/4，额外实质无依据论断18/17/10；全论断有依据且引用完整22/20/23题。664实际转发、630有效步骤、34网络重试，已知9185479tokens、37请求usage未知。提示/工具八项源码冻结，第二轮后只修评测落盘、全部结束后只修答案后提取并追加派生语法回执。旧43/42/39单次记录与旧六题补跑不覆盖、不用于因果结论；逐题原文审计/矩阵见交付报告。
- **T10 传输诊断（2026-10-03）**：旧六题共11请求、零重试、零cap；评测显式 `maxRetries:0` 与首次失败封题使连接故障直接终结，非重试耗尽6请求。正式应用真实DSH默认重试已通过两次502后成功及浏览器无错误验收，未修改生产适配器。计数代理schema2恢复默认重试，按每题6个模型步骤计预算，实际请求/重试另列并有限制，记录上游HTTP/错误码及连接类型/原因码，旧schema1不回写。六题独立补跑22请求、零重试、核心6/6；旧52题39/52原记录不覆盖。额外论断支持2/6、全部实质论断有引用1/6，连接故障本次未出现，旧socket根因因缺日志不可恢复。用量、回归及限制见实施记录顶部。
- **T10 回答改进最近核对（2026-10-03，待 Claude 审阅）**：修改前先审计历史七题并做一次真实七题对照，再冻结代码单次重测同一52题；原题集与预算不变、失败未重试。真实核心答案39/52（第1批43、第3批42），43完成输出另有2 partial/1 wrong/1 gold_conflict；9空答案为3本地6请求上限、6计数代理转发连接失败（未获有效上游响应、用量未知）。工具偏离0；原失败phys02/03、know07、dig07本次full，delphi05/guide05仍预算失败、know05新增预算失败，整体质量未提升。额外论断支持27/43、所有实质论断有引用21/43；范围/复合格式解析失败单列。实际npm最终255/255（首轮一个DSH启动超时保留、隔离及最终复验通过），既有23smoke与branch/semantic共25/25首轮通过；本轮未测原生/安装包。完整逐题、原因、用量、图与限制见实施记录顶部。
- **回答查找规则（最近核对2026-10-04，context API `t11.2`）**：四角色的系统简报与宿主工具清单要求整个文献查找过程使用 `research_search/research_read`；短摘录不构成不存在的证据，优先点读精确命中。证据覆盖问题后作答并逐项引用，新增查找针对具体缺口或矛盾；T24 删除“简短作答/Answer concisely”等模型长度偏好，默认Main仍按需解释基础概念，用户自定义提示词和已绑定快照不改。`nextOrdinal` 是可选续读，保留表格歧义、科学限定和缺失证据。工具结果提示同样规则。这些是模型指引，不是权限控制，不能保证每次回答收敛或正确。
- **读取行为（2026-10-03）**：`research_read({cite:'[S3 p.4]'})` 保留来源与页码，读取指定页；显式 `page` 优先，跨项目同名引用仍拒绝并要求精确 ref。读取 chunk ref 时先保证目标段落进入窗口，前邻段与目标无法一起容纳时跳过前邻段；能容纳时保持原文顺序。目标整段超过 `maxChars` 仍完整返回（沿用整段不截断规则），页与来源续读不变。排序、嵌入、范围过滤与160字搜索摘录未改。

- **Windows收口补充（2026-09-29）**：t10.2修改后的完整npm219/219通过；恢复后的500合成来源、88491条向量全部索引并持久化，索引/写入42.31分钟、RSS峰值1495MiB，零Provider请求。为8篇语料重复负载，不是500不同论文；恢复总时长不包含关机前，不能作为连续首次构建全程。第二台云端对照仍未测，真实答案质量仍按t10.1固定52题42/52报告。下条保留阶段检查记录，最终本机状态以本条和实施记录最新日期节为准。

- **T10 最近核对：2026-09-29，非最终交付（当时阶段记录；之后的本机收口见上方补充）**：本地 e5-small/ONNX worker、SQLite 向量投影、混合检索、每轮有界记忆召回及持久化设置已接线。检查点1125ba5的npm214/214、23项既有smoke与新增语义设置browser/native通过；t10.1真实52题全部终态，核心答案42/52（历史43/52），233转发全部上游200，4本地预算失败、3工具偏离取消。后续t10.2补齐versioned lookup规则，聚焦单元/真实DSH模拟模型通过，完整回归仍待收口。下文第一批“生产只有关键词”是历史状态，不再描述本分支。500来源负载及云端对照未完成，不宣称T10验收通过或答案质量提升。
- 混合接口保留同步 `search()`，增加 `searchHybrid({query, queries, …scope}) → {hits, mode, fallbackReason?}`。问法合并去重后最多 6 个、每个最多 2000 字符；范围在排序前筛选；加权 RRF k=60，向量 1.0、关键词 0.5，同分按引用身份稳定排序。所有问法共用 300ms 向量阶段预算，超时整路丢弃；后台预热不占查询预算。降级为 `keyword`，原因取 `timeout/model-missing/index-incomplete/model-version-mismatch`，工具结果写明“本次为关键词检索”。
- `semantic-service.mjs` 从原始来源、段落、有效条目与获准的 Main 正文生成可重建索引，模型文件只从本机加载；设置显式下载固定 revision 的公共文件并验证清单。默认关闭，开关写入 SQLite；开启后后台预热和逐篇索引，对话执行时暂停。模型或文档版本不匹配时退回关键词并排队重建。私有条目即使存在于本地索引，也不会进入智能体的授权候选集。
- 调用方：Research Search UI/API、四角色 `research_search`、`chat_recall` 的查询路径使用异步混合检索；`chat_recall` 精确编号读取仍返回原文，不走检索。Main 普通发送、自动化初始输入、专家共享输入调用 `recallForTurn()`（排除已在简报中的引用，最多 8 条、1500 字符，回执 `how=recall`）；自动化内部后续轮次没有新增用户查询触发点。常驻简报 `brief()` 与兼容同步 `search()` 保持同步；未把这些路径报告成向量查询。
- 已核对证据：固定 52 题本地关键词 R@1/5/10=3/6/9，单问法向量=10/16/21，双语向量 RRF=12/26/29，加权混合=17/28/34（分母均52、无降级）；混合总查询 P50/P95=70.662/79.013ms。此为段落命中而非答案正确率。原生/浏览器语义设置 smoke 通过，中英深浅色共 8 图；原生自有进程全部正常退出。详细阶段证据见实施记录。

- **T05 最近核对：2026-09-27，验收通过**（npm 192/192、22 既有 smoke、新资料库 browser/native smoke，64 张截图；本次新增界面为模拟宿主，零付费请求）。`desktop/research-base.mjs` 使用既有 Research Base CRUD、提议和简报接口；新增来源排序和分页总数，取代操作也支持 `expectedRevision`。`desktop/research-citations.mjs` 对净化后的助手正文进行引用标签增强，不改变保存的文本，复用 T04 页码阅读器；引用与回执缓存有界。使用回执按条目/记忆及去重来源展示，工具提议保留等待用户确认语义。
- 材料面板不再使用原型内容：用户显式选择文件资源或共享有效条目写入 `contextRefs`。新增 `{itemId}` 与既有 `{resourceId}` 并存；编译器校验会话项目、有效状态、共享性和非专家私属范围，私有条目不会成为模型输入。条目内容经现有 research input 通道发送；确认、失败恢复、草稿去重使用区分资源/条目的身份。Main 将选择记录在使用回执 `how=context`。不新增表或模型调用。
- 兼容旧资料：宿主启动时给没有来源记录的 library resources 登记来源，不重解析历史、不覆盖人工元数据；新 `/api/library/import` 保存原件并自动登记、后台解析。解析状态通过来源接口查询；`research/sync` 的 `wait:true` 与宿主关闭均等待既有解析队列完成。引用标签范围取当前聊天，独立聊天不会继承上一个项目的标签空间。

- **用途**：统一的科研数据后端，存放文献与资料（来源和按页、按章节的段落）、提炼的知识、理论模型/公式/算法、结论与主张、长期记忆和笔记，
  可互相链接（证据、引用、取代等），供人和智能体检索与引用。设计与分工见 `docs/design/RESEARCH_BASE.md`，调研见 `docs/design/RESEARCH_MEMO_2026-09-25.md`。
- **现在能做的**（既有接口加 T05 分类界面，完整验收状态见本节顶部）：
  - 资料解析与索引：txt / csv / 代码、Markdown、LaTeX、PDF（pdfjs-dist legacy）及 DOCX（mammoth）已支持；定向单元/API、浏览器与原生阅读器测试通过。扫描件返回 unsupported，不伪造 OCR 文本。
  - 中英文关键词检索（FTS5 + 中文二元组，两字词可命中）与 T10 混合路径（验收中）、阅读窗口、引用标签解析（`[S3]`、`[S3 p.4]`、`[S3, p.4]`、`[S3 p4]`、`[@a1b2c3d4]`）。不认识的格式保留原样。
  - 条目的新建、修改（修订历史 + `expectedRevision` 防覆盖）、**取代**（旧记录保留并标为失效）、置顶、私有。
  - 智能体工具：主专家与每位专家子代理都有 `research_search`、`research_read`、`research_propose`。
    写入只能以提议形式进入"记忆收件箱"，由用户接受、修改或拒绝；工具的项目和角色由会话决定。
  - **项目简报**（常驻记忆）：从有效的共享条目生成，约 3500 字符预算；主专家每轮发送前如有变化就更新为系统提示中的一个分段，
    有序讨论和 @ 邀请的专家通过共享输入获得同一份简报；私有条目不给任何智能体，专家经验只给对应专家。
  - 使用回执：每轮记录用到了哪些记录（brief / search / read / context / recall）；讨论通过 accepted 事件里的专家回答身份绑定，各专家回执和提议均指向其自己的回答，结束后清理映射。
  - 旧的 `knowledge` 表逐行镜像为条目（`legacy_id`）；原有的 `/api/knowledge` 保留兼容，新资料库页面使用 Research Base 接口。
- **状态**：🟡 后端与智能体工具已实现并测试（单元、真实 DSH、真实模型）；T04 文档解析/阅读器、T05 分类与管理界面已验证（含原生），文献元数据（T06）、
  证据台账界面（T07）、浏览器（T08）未完成；T09自动整理已实现，验收与质量限制见本节顶部；T10 混合检索已接线、仍在验收（默认 multilingual-e5-small，更换入口以后再做），完成状态以本节顶部为准，任务书在 `docs/tasks/`。
- **技术实现**：`scripts/research-base/`
  - `schema.mjs`（表）、`store.mjs`（校验、FTS 维护、提议、修订、回执）、`text-index.mjs`（中文二元组）、`search.mjs`（检索、阅读、引用、简报）、
    `ingest.mjs`（后台解析队列、分段）、`parsers/`（注册表 + text / markdown / latex / pdf / docx）、`index.mjs`（路由与工具入口）。
  - 运行时：`host.mjs` 的 `/host-call`、`setToolHandler`、`configureBrief` 与 T17 宿主工具清单 `scripts/context/tools.mjs`；
    `session-control.mjs` 使用该清单注册工具（专家子代理在 `agent/created` 时注册），规则走版本化 brief 分段，不改用户人设。
  - `desktop-api.mjs`：挂载 `/api/research/*`；`toolContext` 把会话映射为对话、项目和角色（主专家 / 秘书 / 全局 / 专家）；
    发送前调用 `refreshBrief`；讨论的共享输入附上简报。
- **验证**：`research-base`、`research-api` 单元测试；`research-tools-runtime`（真实 DSH + 本地模拟模型：主专家与专家都能调用工具、简报进入系统提示、没有处理器时工具报告不可用）；
  `scripts/evals/research-base-live.mjs`（真实 OpenCode Go，2026-09-25：主专家自行检索、阅读并引用 [S1] / [S2] / [@…]，公式原样引用；提议进入收件箱；被 @ 的专家检索并提议主张）。
- **最近核对**：2026-09-27 r4：阶段 1 真实模型复验 MD/TeX 检索/引用/提议；阶段 2 对 8 篇真实中英文论文解析 101 页、2017 blocks、1412 chunks，页码一致、坐标有效，4 篇中文指定检索均 top1。阶段 3 固定52题，关键词 R@1/5/10 为3/52、6/52、9/52；本地 e5-small 中文10/17/21，英文10/17/19，双语最大余弦12/21/25（分母均52）。1412段嵌入29.514秒，按8篇平均规模推算500篇嵌入30.744分钟（非实测）；查询嵌入中文 P50/P95 3.328/3.904 ms，仅嵌入、不含排序或I/O。记忆关键词正例0/5、负例未误召回3/3，未测记忆向量。真实模型引用评测已完成，见下条；段落命中不代表完整答案正确。所有向量代码仅属离线评测，原件未修改或提交，生产检索仍为关键词，混合检索未实现。
- **真实模型最近核对（2026-09-27，取代上一条待凭据状态）**：应用API→真实DSH→OpenCode Go `deepseek-v4.1-flash`，52道固定论文题各用新会话，最多6请求/题。286次转发（236 Main、50后台纪要，含首次缺header的400）；46个完整回答。核心原文审计43正确有引用、1错、1未作答、6无完整答案、1标准答案措辞冲突单列。6个无答案为1次Main预算截断和5次自有空工作区filesystem工具偏离取消；16次仅后台纪要截断不算Main失败。239个引用返回非空、22个格式不支持，非空不等于引用正确，额外论断也有错。独立审计经Astra复核，gold未修改；单独评测夹具的修复不改变生产检索、纪要或权限行为。用量与逐题失败见DESKTOP_IMPLEMENTATION顶部。
- **已知限制**：PDF 标题/章节是字号和布局启发式，表格与复杂分式不能保证语义重建；部分嵌入字体有替换警告，原页可在阅读器查看；目前只有关键词检索（实测对换说法和跨语言问题几乎无效，见设计文档 §3.1），混合检索待 T10；在完全接管模式下，智能体的 bash 能读到应用数据目录（记录在设计文档 §8，需要单独处理 DSH 沙箱）。

### 2.18 可选功能开关与原型页面（2026-09-25）
- **用途**：界面上不出现"尚未开发 / 即将提供 / 原型 / 示例"一类提示。未完成功能的入口隐藏，完成后由宿主打开开关；原型设计包的页面目录和演示页不可达。
- **状态**：✅（界面 smoke、文案审计）。
- **技术实现**：
  - 宿主 `GET /api/status` 返回 `features`（`scripts/desktop-api.mjs` 的 `capabilities.features`）：
    `pythonEnvs`、`folderPicker`（由原生外壳通过 `SCIENCESCOPE_NATIVE_FEATURES=pickFolder` 声明）、`inAppBrowser`、`branch`、`usage`、`materialsPanel`、`mapHistory`、`changeLog`、`pluginManagement`、`dataRelocation`。T05 的 `materialsPanel` 由真实 Research Base 服务检测开启；T11 的 Python 与文件夹选择已接通；T12 的 `branch` 在浏览器和 Windows 原生验收后检测真实运行时分支方法开启；其余未完成项仍关闭。
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

r4 最终复验（2026-09-27）：英文深浅色 − / □ / × 再次通过，以实际 HWND 的 Win32 状态核验；两次自有进程树均完全退出。“暂无置顶”“暂无计划”词条已修复并回归，后者原生复截图通过。阶段 1 已通过；历史 r3 的停止记录不再是当前阻塞。

### 2.20 Python 运行环境（T11，2026-09-29 已实现并本机验证）

- `scripts/python-env/` 使用 uv 管理应用目录中的 CPython、独立环境及共享缓存；不读写用户 uv/pip 配置。内置清单是 `python/builtin.in`，Windows CPython 3.14.7 的 77 项解析版本保存在 `python/builtin.lock`。安装包携带资源属于后续阶段 B，本节不代表已打包。
- SQLite 保存环境、原始包清单、解析锁、项目/对话绑定、设置与操作日志。解析顺序为对话 → 项目 → 默认 → 系统；选择系统环境不会安装包。新建详情保留原界面；首条消息接受后不再重发初始环境覆盖后续选择。
- 设置 → 运行环境保留路径信息，增加创建、复制、重命名、删除、包清单编辑/导入/导出、缓存清理、默认环境及镜像。删除仍有绑定的环境返回 409。缓存和独占空间分开统计；共享硬链接不重复计入独占空间。
- DSH 仅接收宿主产生的会话环境白名单；原进程与用户/系统环境不变。专家继承 Main 进程环境，秘书/全局助手有自己的选择。环境切换保留同一个 DSH sessionId 和历史；自动化在完成轮持久化和idle后暂停/释放/恢复，用户停止和轮数限制仍有效。
- `python_env_install` 由宿主 manifest `t11.1` 下发，沿用审批通道；卡片显示包、原因及目标。只接受包名和版本约束，不接受 URL/路径/命令参数；询问必须审批，完全接管自动批准默认关闭。不会写用户人设。
- 原生 `pick_folder` 使用官方 `tauri-plugin-dialog` 2.7.3；精确本机 origin 且仅主窗口拥有权限。取消返回 null，不替换为浏览器目录上传。
- 最近核对：npm 237/237、既有23项 smoke 有效证据通过、13项受影响复跑及新增环境 UI 通过；真实 uv 内置22包、硬链接复制、镜像安装通过。真实 DSH/模拟模型证明两轮环境切换和持久化；26次真实Go请求验证解释器、历史、安装批准/拒绝、原生选目录写文件及越界审批拒绝。中英深浅截图、失败及修复详情在 DESKTOP_IMPLEMENTATION；不是安装包、离线资源或签名通过声明。

## 3. 接口索引（`scripts/desktop-api.mjs`）

所有接口需携带口令（2.15）。流式接口返回 NDJSON。

| 分组 | 接口 |
|---|---|
| 状态 | `GET /api/status`（含 `features`，见 2.18）、`POST /api/open-url`、`GET /api/settings/info`、`POST /api/settings/open-folder` |
| 工作区与对话 | `GET/POST /api/workspace`、`GET /api/chats`、`GET /api/chats/:id/messages`、`GET /api/chats/deliverable`、`POST /api/chats/deliverable/open`、`POST /api/chats/update|move|delete|mode|temporary-close` |
| 主对话 | `POST /api/chat`（流）、`POST /api/chat/stop`、`GET/POST /api/chat/outbox`、`GET /api/chat/activity`、`GET /api/chat/search` |
| 消息分支 | `POST /api/chats/branch {chatId,messageId,mode:'reply'|'reask'}`、`POST /api/chats/draft {chatId,text}`；消息分页返回 `branchMode`、`runtimeSeq`、`completionStatus`，对话返回 `branchedFrom`、`reasoningEffort`、`draftText` |
| 执行 | `GET /api/execution`、`POST /api/execution/goal|approval` |
| 研究资料库 | `/api/research/*`：sources（新增 sort/direction 与 total/hasMore）、source、sources/update|remove|ingest、sync、search、read、items、item（含 evidenceCount）、items/update|supersede（expectedRevision）、links、links/remove、proposals、proposals/decide、brief、cite、usage、formats（见 2.17 与设计文档 §6）；research-input contextRefs 增加 itemId |
| 本地语义检索 | `GET /api/research/embedding` 状态/进度；`POST /api/research/embedding {action: enable|disable|download|rebuild}`；search 支持 q 与重复 queries 参数，返回 mode/fallbackReason（T10 验收中） |
| 记忆整理 | `POST /api/research/consolidate {chatId}`；`GET /api/research/consolidate/status?chatId=`；`GET/POST /api/research/consolidate/settings {enabled,idleMinutes,model,tokenLimit}`（T09/T24，null关闭成本预算，所有候选仍通过既有proposals/decide确认） |
| 对话纪要与自动总结 | `GET/POST /api/chats/minutes`、`POST /api/chats/minutes/refresh`、`POST /api/projects/focus`、`GET/POST /api/secretary/preferences`、`GET /api/summary/proposals?chatId`、`POST /api/summary/proposals/decide`、`GET /api/summary/writes?chatId`、`POST /api/summary/writes/undo`（2.5b、T18） |
| 专家讨论与名册 | `GET/POST /api/experts`（每项含 `kind: expert|reviewer`、`skills: string[]`）、`POST /api/discussion`（流；`expertIds` 仅接受参加专家，`reviewerId` 可选参加专家或独立审核）、`POST /api/discussion/adopt`、`POST /api/discussion/cancel` |
| 秘书与全局助手 | `GET /api/assistant`、`POST /api/assistant/chat`（流）、`/assistant/draft|model|approval|stop|proposal/resolve` |
| 上下文查阅（宿主/DSH `/host-call`） | `chat_recall`、`project_memory`、`workspace_overview`、`minutes_refresh`；清单按角色由 context API `t11.1` 生成，T11 同清单新增 `python_env_install`（2.5b、2.7、2.8、2.20） |
| 研究输入与资料 | `GET/POST /api/research-input/draft`、`GET /api/library`、`GET /api/library/preview|document|content`、`POST /api/library/import|open`、`GET /api/knowledge`、`POST /api/knowledge/propose|accept` |
| 工作文件夹 | `POST /api/folders/check`（校验，见 2.1a） |
| Python 环境 | `GET/POST /api/python/envs`、`POST /api/python/envs/packages`、`GET /api/python/resolve`、`POST /api/python/bind`、`GET /api/python/system`、`GET/POST /api/python/settings`、`GET /api/python/logs`、`POST /api/python/cache/prune`、`POST /api/python/export`；宿主工具 `python_env_install`（2.20） |
| 工作站 | `GET /api/workbench`、`GET /api/workbench/files|asset|plans`、`POST /api/workbench/save|bind|import|asset|version|plans|open|organize` |
| 模型与角色 | `GET /api/providers`、`POST /api/providers/save|discover|remove`、`GET /api/model-info`、`GET /api/roles`、`GET /api/roles/history`、`POST /api/roles/save|apply` |
| 设置 | `/api/profile`、`/api/preferences`（+`/reset`）、`/api/fonts`、`/api/shortcuts`（+`/reset`）、`/api/secretary/preferences`（含 `summary`）、`/api/assistant-window/preferences` |
| 技能与插件 | `GET /api/skills`、`GET /api/skills/read`、`POST /api/skills/save|enabled|remove`、`GET /api/plugins/inventory` |
| 宿主控制 | `POST /__host_shutdown`（独立的关闭口令，只由 Tauri 调用） |

## 4. 数据存储索引（SQLite `state/sciencescope.sqlite`）

| 表 | 用途 | 负责模块 |
|---|---|---|
| `schema_migrations`、`workspaces`、`projects`、`profile` | 版本、工作区快照、项目、个人资料 | `application-database.mjs`、`chat-store.mjs` |
| `chats`、`messages`、`runtime_bindings`、`chat_branch_drafts` | 对话、消息（按序号分页）、DSH 会话绑定、分支来源/推理强度、消息轮次边界/完成状态、分支可编辑草稿（新增字段均为兼容性迁移） | `chat-store.mjs` |
| `tool_activity` | 工具调用的展示投影（含工具前导语；专家回答也记录） | `tool-activity.mjs` |
| `chat_outbox`、`chat_outbox_state` | 主对话发送队列（重启后暂停） | `chat-outbox.mjs` |
| `execution_sessions` | 每个对话的执行策略与自动化目标 | `execution-service.mjs` |
| `research_input_drafts`、`research_input_receipts`、`research_input_consumed` | 研究输入草稿、发送回执、已消费版本 | `research-input-store.mjs` |
| `resources`、`knowledge` | 资料原件与项目版本索引；知识条目 | `application-database.mjs`、`library-service.mjs` |
| `assistant_conversations`、`assistant_drafts`、`assistant_settings`、`assistant_draft_proposals`、`assistant_attachment_drafts` | 秘书与全局助手 | `assistant-conversations.mjs`、`chat-attachments.mjs` |
| `role_settings`、`role_bindings`、`role_prompt_receipts` | 角色提示词、会话快照、应用记录 | `role-settings.mjs` |
| `experts`（含 `kind`、`skills_json`）、`expert_roster_state`（含独立审核默认项的一次性迁移 marker） | 参加专家与独立审核名册 | `expert-roster.mjs` |
| `rb_sources`、`rb_chunks`、`rb_items`、`rb_links`、`rb_proposals`、`rb_revisions`、`rb_usage`、`rb_fts`、`rb_meta` | 研究资料库 | `research-base/schema.mjs` |
| `rb_embedding_settings` | 本地语义检索启停设置 | `research-base/semantic-service.mjs` |
| `rb_vec`、`rb_vec_docs` | 可重建向量与引用/文档版本/模型版本映射；不是原件或资料库事实 | `research-base/vector-store.mjs` |
| `chat_minutes`、`chat_minutes_markdown_status` | 对话纪要（每版保留，作者为秘书或用户）及 Markdown 导出路径/错误状态 | `chat-minutes.mjs` |
| `secretary_preferences` | 版本说明模板与自动总结 `summary_json`（旧库迁移保留动态语言默认） | `secretary-preferences.mjs` |
| `summary_pending` | 关闭或待补的项目总结任务 | `summary-policy.mjs` |
| `summary_proposals`、`summary_writes` | 工作站总结的待确认提议、来源版本、前后状态与撤销记录 | `summary-workbench.mjs` |
| `context_cursors` | 秘书跟进游标：会话、目标 Main、已读消息序号、纪要版本、状态哈希 | `context/catch-up.mjs` |
| `context_overview_cursors` | 全局助手按会话保存的工作区概览哈希 | `context/catch-up.mjs` |
| `discussion_rounds`、`discussion_entries` | 讨论轮次与专家回答元数据（含审核、采纳、主专家已读标记） | `discussion-service.mjs` |
| `desktop_preferences`、`shortcut_settings`、`secretary_preferences`、`assistant_window_preferences` | 各类设置 | 同名模块 |
| `python_envs`、`python_env_bindings`、`python_env_settings`、`python_env_logs` | Python 环境/锁定清单、项目与对话选择、默认与镜像/审批偏好、操作日志 | `python-env/environments.mjs` |

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
内置浏览器与浏览器设置（T08）、用量分析（T13）、导图历史 / 版本说明页 / 版本比较 / 修改记录（T14）、
插件安装与更新（T15）、目录迁移（T16）。Python 环境与原生文件夹选择已由 T11 接入，见2.20。
记忆分类与人工管理由 T05 接线，T09自动整理已实现，验收状态见2.17顶部。另有尚无任务书的：通知、截图快捷键、系统全局热键、导图导出、日志"定位到消息"、安装包与数据保留升级（ROADMAP 阶段 B）。

## 7. 如何维护本文档

- 功能行为、接口、数据表或验证状态发生变化时，在同一次提交里更新对应小节和"最近核对"行。
- 只写当前结果；过程、失败尝试和日期细节写进 `DESKTOP_IMPLEMENTATION.md`。
- 本文档描述现状，不构成设计约束：更好的设计可以替换这里写的实现，替换后更新本文档即可。
