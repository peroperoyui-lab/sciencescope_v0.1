# P4b：Windows 长程体检

日期：2026-10-29；基线 `main@4cf4bfe`。按性能、结构、真实场景与统一检查的顺序完成，所有结论只用于选择下一轮任务；没有优化、重构或修改应用与既有测试。

## 一、性能复测与后台用量

### 方法与数据

- Windows 11、Core Ultra 9 275HX、约 32 GB 内存；同一 USB 机械盘上的独立 Install Test 产品，Node 22.22.2。用户预览及备份未触及；原生、安装器与更新通道源码未变。
- 同一 P4a 种子生成 100 PDF、100 DOCX、100 Markdown，实际 5,060 块；12 个对话共 1,000 消息，最长 180 条；稿件 50,213 个中文字符，含表格、图片、公式。新增 30 个真实版本及合成说明、200 节点导图、12 计划、20 日志和一条带实际本地读写记录的回答。生成无模型调用，重复使用校验已通过。
- 全局图从 P4a 的 100 论文、0 边变为 100 论文加 1 实体及 1 边；本轮索引 101 节点，视野实际画出 96 个。版本树从 2 版扩到 30 版，比较页也已替换；这些行作为体验对照，不作同负载优化结论。
- 三次热启动前有一次不计时启动；三次冷启动均先用微软签名 RAMMap 清文件缓存和 standby list，有成功回执。正式计时没有并行构建、模型测试或全检。先做的一次原生 smoke 和单独 Node CPU 诊断不进入中位数。
- 所有 19 项页面操作各 3/3 成功。每轮 DOCX 打开区间恰有 1 次新会话 POST、前置空闲段为 0 次；树节点严格为 30。结束核对 300 个文件哈希、5,060 块、1,000 消息、30 版本不变；文稿字节、导图和日志正文均还原，所有原生退出正常。
- 操作是连续使用路径，截图在各计时区间外。`workbench-open` 包含卡片、打开树和读取 v1 说明；前一图视图的 settings 请求在进入工作站时仍分别剩 411／910／822 ms。因此工作站数字包含正常顺序操作中的请求重叠。

### 1. 操作基线表

单位 ms，三次正式样本取中位数；P4a 列取其修后结果。没有 P4a 对应项的写“—”。

| 操作 | P4b 中位数 | P4a 修后 | P4b 三次样本 |
| --- | --- | --- | --- |
| 冷启动：能输入 | 14136.61 | 16013.91 | 15813.31 / 14098.22 / 14136.61 |
| 冷启动：首页数据就绪 | 14164.16 | 16046.59 | 15850.78 / 14143.92 / 14164.16 |
| 热启动：能输入 | 6520.89 | 6859.73 | 6684.22 / 6520.89 / 6164.32 |
| 热启动：首页数据就绪 | 6579.80 | 6880.46 | 6754.10 / 6579.80 / 6202.70 |
| 切换最长对话 | 481.52 | 428.22 | 682.08 / 444.59 / 481.52 |
| 向上加载更早消息 | 527.84 | 423.66 | 527.84 / 556.49 / 513.76 |
| 打开资料库 | 61.03 | 65.42 | 65.86 / 61.03 / 58.06 |
| 资料库搜索 | 269.98 | 251.61 | 250.46 / 306.42 / 269.98 |
| 知识图：101 个索引节点，视野内 96 个 | 545.02 | 392.38 | 671.27 / 513.62 / 545.02 |
| 工作站卡片、30 版树及一份说明 | 1738.15 | — | 1685.88 / 1889.92 / 1738.15 |
| 工作站：两版比较 | 1119.01 | — | 1119.01 / 1226.75 / 1042.39 |
| 导图页：200 节点 | 345.60 | — | 345.60 / 239.09 / 584.30 |
| 拖动导图节点至保存 | 503.99 | — | 503.99 / 433.01 / 526.86 |
| 日志页：20 条 | 34.70 | — | 34.70 / 40.97 / 32.15 |
| 编辑一条日志至保存 | 302.00 | — | 302.00 / 309.23 / 205.87 |
| 项目资料：展开 300 文件树 | 163.58 | — | 163.58 / 237.65 / 160.86 |
| 选择文件至属性、正文出现 | 87.95 | — | 87.95 / 83.01 / 142.70 |
| 回答下资料与知识修改两块展开 | 728.44 | — | 821.14 / 676.87 / 728.44 |
| 设置页编辑至自动保存 | 84.40 | — | 84.40 / 78.93 / 87.50 |
| 打开五万字 DOCX | 890.53 | 846.75 | 890.53 / 898.17 / 873.15 |
| 编辑台：打开 30 版树 | 206.80 | 116.81 | 215.85 / 206.80 / 177.42 |
| 文稿输入一句至写回 | 406.18 | 369.12 | 406.18 / 476.10 / 374.03 |
| 编辑台：两版比较 | 554.76 | 321.28 | 554.76 / 543.72 / 558.46 |

热启动可输入从 6.86 秒到 6.52 秒，冷启动从 16.01 秒到 14.14 秒。前端、数据扩展和两次测量环境都有变化，本次只记录对照。

同一 60 个启动／操作窗口内，服务端记录 1,695 个请求、43 类路径；最慢十类如下（按 p95 排序，SSE／静态资源排除）：

- `GET /api/settings`：13 次，p50 12.17 ms，p95 1292.23 ms。
- `GET /api/version-groups/:id/graph`：9 次，p50 24.86 ms，p95 1264.56 ms。
- `PATCH /api/settings`：9 次，p50 183.60 ms，p95 1159.91 ms。
- `POST /api/:id/:id`：6 次，p50 69.44 ms，p95 412.74 ms。
- `GET /api/versions/:id/diff`：6 次，p50 151.37 ms，p95 240.97 ms。
- `POST /api/:id`：34 次，p50 47.89 ms，p95 240.95 ms。
- `POST /api/desk/sessions/:id/save`：3 次，p50 158.65 ms，p95 182.42 ms。
- `GET /api/:id/:id`：40 次，p50 2.58 ms，p95 146.83 ms。
- `GET /api/:id/versions`：15 次，p50 8.58 ms，p95 133.70 ms。
- `GET /api/research/search`：3 次，p50 114.96 ms，p95 123.78 ms。

`/api/:id` 等是沿用 P4a observer 的匿名路径组，包含未登记的静态段，不伪装成单一接口。浏览器保存的具体路由用于定位：资源 map／log 写入及历史快照等。搜索三次 p95 123.78 ms（P4a 2020.59）；PATCH settings p95 1159.91 ms（P4a 1255.93），长尾来自图视图偏好保存，设置页直接编辑保存则为 84.40 ms。

### 2. 启动时间拆分表

单位 ms，热／冷各三次中位数。应用装配中的子阶段、脚本请求与首屏 API 有嵌套或重叠，不能把全表相加。原生前段之后，创建 WebView 的耗时包含在“HTTP 就绪至首屏渲染”中。

| 阶段 | 热启动 | 冷启动 |
| --- | --- | --- |
| 原生入口至 Node spawn | 15.00 | 32.00 |
| Node 进程创建 | 79.33 | 2691.04 |
| Node bootstrap、入口静态依赖及 observer | 53.21 | 52.46 |
| 应用及传递模块导入 | 653.99 | 614.35 |
| 应用装配总区间 | 278.62 | 2132.75 |
| 其中 core／数据库打开与迁移包围区间 | 18.42 | 96.14 |
| 其中 Python 服务构造 | 0.37 | 0.35 |
| 其中 semantic.start 返回 | 3.27 | 3.53 |
| HTTP 监听绑定 | 18.99 | 89.44 |
| HTTP 就绪至首屏渲染上报（含 WebView） | 5349.89 | 8012.47 |
| 界面脚本请求覆盖区间（并行） | 1189.80 | 1679.00 |
| 首屏 API 最早开始至最晚完成（并行） | 550.90 | 971.10 |
| 首次全量扫描／内容索引 | 无排队首次全扫 | 无排队首次全扫 |

标记来自 `src-tauri/src/main.rs`、`app/main.js`、`app/app.js` 和 `app/server/startup-client.js`。首屏上报是 #app 出现子节点后两次动画帧；“可输入／首页数据就绪”另用外部 DOM 条件测量。数据库没有单独墙钟标记，表中 core 区间同时包含默认数据及凭据历史迁移，是数据库工作的包围区间。

预先生成的数据已完成迁移和解析，六个正式启动都未观察到首次全扫的 listing/indexing 事件，未人为把重建任务塞进启动。单独诊断轮观测 10.727 秒，进程 user/system CPU 为 1296／625 ms；栈采样 DB open 4.75 ms、迁移 0、project index 1.74 ms。另有研究块读取样本合计 124.3 ms，属于知识队列恢复而非首次全扫。采样受 inspector 影响，只用于定位。

### 3. 后台用量表

通过全新测试数据的设置页添加 OpenCode Go、选择 `deepseek-v4.1-flash`，20 次提问均从原生输入框发送，20/20 完成。纪要、记忆、卡片与版本说明保持当前默认，记忆预算 100000、空闲 10 分钟；P4a 曾将验收预算调为 500000。当前版本将本次整理输出预留限定为 32768，本轮默认预算已能完成提取与核对。下列 token 只计服务商实际报告；秒数为各请求累计工作时间，含失败尝试，不能与场景墙钟相加。

| 功能 | P4b 请求 | P4b 已报告 token | P4b 累计秒 | P4a 请求 | P4a token | P4a 累计秒 | 结果／问题 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 设置页连接测试 | 1 | 68 | 2.386 | 1 | 48 | 3.306 | 完成，单列设置请求 |
| 主回答 | 20 | 166380 | 98.915 | 20 | 160564 | 79.163 | 20/20 完成 |
| 版本说明 | 2 | 15609 | 30.698 | 2 | 15240 | 25.698 | 两版各 1 次，均完成 |
| 纪要 | 1 | 9449 | 46.756 | 2 | 17457 | 104.305 | 一次覆盖 40 条问答消息 |
| 知识库卡片 | 1 | 4721 | 31.909 | 1 | 4838 | 27.463 | 新来源完成一次整理 |
| 记忆整理 | 3 | 67217 + 1 次未知 | 335.383 | 4 | 71250 | 243.295 | 提取、核对完成；核对前一次连接失败由产品自动重试 |
| 安装版合计 | 28 | 263444 + 1 次未知 | 546.045 | 30 | 269397 | 483.231 | 27 次有用量、1 次连接失败无用量；全部为 flash |

- 第一轮设置自动化的密钥框定位失败发生在任何模型请求前，0 请求，原回执保留；改正测量脚本选择器后使用另一个空数据目录，不覆盖失败记录。实际 20 轮只执行一遍。记忆的连接失败及产品自动重试均计入 28 次；没有脚本重跑刷结果。
- 总输入（含缓存）208202、输出 55242；场景墙钟约 1127 秒，包含默认空闲等待。对比 P4a 安装版少 2 次请求、已报告 token 少 5953；模型输出、纪要批次及预算条件有差异，不能将这个差值直接归为单项改动的节省。P4a 另外 6 次补充回归不混进本表。
- 后台没有每轮都触发：卡片落在第 4 轮时间窗，版本说明在第 10／11 轮；20 轮后纪要一次，默认空闲后记忆提取与核对。31 个候选全部留待确认，验收没有接受。
- 新后台请求在前台忙碌时启动为 **0**（P4a 为 2）；已有卡片 1 次、说明 2 次与后续前台重叠。当前让路规则保留正在进行的请求，没有发现本轮需要额外取消的证据。
- 19/28 次上下文可从持久记录重建，其中主回答 12/20；这部分完整前缀／最后输入哈希重复均为 0。核对的同一输入另有明确的一次网络重试，失败尝试缺少上下文 hash。实际工具调用、读取及重读均为 0。
- 记忆提取输入 78 行新增纪要及 40 条原文；核对再次读取 40 条原文与 31 个候选，是不同职责的来源复用。提取／核对成功请求约 124／201 秒，思考 token 为 12626／19554，是后台模型耗时最大的部分。建议后续审查提示及 schema 是否重复表示同一证据、是否需要用户可选思考策略；保留证据核对，风险是候选支持度与游标完整性，保护 memory source/checkpoint/budget 测试，本轮不改行为。
- 记忆服务预算记账为 77946，其中含无用量尝试的保守估计；本表使用服务商报告的 67217，并保留 1 次未知。建议继续把预算估算与服务商用量分开，不合并成一个“实际 token”。所有测试凭据已移除，退出码 0，残余进程 0。

第一部分于 2026-10-29 完成并写入本报告，之后才开始结构体检。原始证据：`native-warm/`、`native-cold/`、`startup-diagnostic/`、`native-findings.json`、`live-baseline/`（首次零请求失败）和 `live-baseline-actual/`；均位于忽略的 `.sciencescope-local/temp/p4b/`。

### 热点意见（尚未实施）

1. **先减少对话辅助信息重复请求。** 每轮打开最长对话共 100／97／99 请求，其中 30 turn、30 citations、30 知识修改列表；向上翻页各 153 次；离开再返回展开知识两块各 218 次（90 citations、90 知识列表）。`actions.openMeeting/loadEarlier/loadTurn`、`cited-markdown` 和 `turn-knowledge` 分别请求，组件重新挂载又读一遍。建议增加按消息页批量摘要查询，详情沿用原接口；一页 90 个小请求可收敛到约 3 次批量调用。预计 1–2 天，风险在分页／事件失效／撤回链新旧合并；涉及 meetings/research/knowledge 路由及查询服务，UI 接入归 Claude。保护：server、research citations、turn-knowledge 浏览器及一页消息事件一致性测试。新增接口需另立任务，本轮不改形状。
2. **设置长尾先分清队列、文件 I/O 与消费者。** `core/workspace/workspace.js` 对同一 settings 文件串行读写；`knowledge/jobs.loadSettings`、`card-queue.configure` 等消费者重新读取、重配。图视图偏好保存出现秒级 GET/PATCH，直接设置页保存约 84 ms。建议补分段观测后按变化字段跳过无关后台重配、合并同 revision 重读；预计诊断半天、局部修正半天至一天，收益是减少秒级尾巴与后续页面重叠。风险是漏掉外部设置修改及凭据处理；保护 settings-updates、provider-settings、knowledge jobs、semantic 和设置页测试。
3. **版本树说明存在 30 次串行读取。** `services/versions/graph.js:graph` 每版 catalog 查询、workspace 读说明、查指令；首次工作站 graph 请求约 1.04–1.26 秒，后续同组较快。建议先批查元数据及指令、受控并行读说明；有证据后再考虑可重建摘要投影。预计半天至一天，接口可不变；风险是外部 notes 编辑、缺失说明、删除祖先与并发修订。保护 graph、notes、workbench、version-notes、desk-versions 测试。秒级长尾还含前页 settings 重叠，应先独立观察再确定优化收益。
4. **启动导入与知识恢复有可延后的执行工作。** 单独 profile 的模块编译约 181 ms、canvas 导入约 120 ms、研究块读取约 124 ms；`research/parsers/index.js` 静态引入 PDF 路线，`knowledge/jobs.start/enqueue` 为每个来源取 chunks 算内容版本。建议首次解析时加载 PDF 依赖，用持久版本／checkpoint 判断真正待恢复任务并分批让路。约一天、中等风险；保护 parser、jobs 重启恢复、project-index lifecycle 和 startup 测试。收益目标是这些已观察执行工作，整体启动仍包含 WebView 和文件加载。
5. **比较缓存仍重读原件，优先级较低。** `versions/diffs.js` 命中 diff 缓存仍启动 worker，`diff-worker.js` 读取、解析两版；HTTP p95 241 ms，页面比较 555／1119 ms。若使用频繁，可试以原件 hash／算法版本为键的有界解析缓存，保持 worker 隔离；预计一天，风险是内存、取消、算法更新与原件缺失。保护 diff、block-diff、desk compare 和 foreground 测试；接口可保持。
6. **搜索暂不排优化。** 本轮三次查询 p95 124 ms、页面约 270 ms。建议先扩大查询和命中分布再决定 SQL 调整，保留现有中文检索、分页、范围与扩展规则。现有 store、research routes、expansion、research 浏览器测试可作保护。

界面热点均交 Claude：工作站／200 节点导图的 `MapCanvas.fit` 平均 self 样本 25.59／21.19 ms；编辑台比较 `formatTime` 14.27 ms、`countWords` 4.78 ms；长 DOCX 打开 `countWords` 6.09 ms；知识两块 `request` 5.67 ms、`renderMarkdown` 5.56 ms；图视图 `knowledge-graph.js:173` 2.04 ms。比较页 `getBoundingClientRect` 三轮合计 353／224 ms，含页面布局与就绪检查，需结合父栈读性能面板。本轮不提出或实施界面改动。

## 二、后端结构体检

### 依赖、范围与规模

使用仓库现有 **TypeScript 5.9.3（Apache-2.0）** 编译器 AST，新增可复用 `tools/perf/structure-audit.mjs` 及测试，没有安装新依赖。解析实际 import／re-export、字面量动态 import／require，区分类型导入；记录 Worker 入口。扫描整个 app/tools 以关联测试，生产统计限定 `app/services/`、`core/`、`server/`、`shared/`，排除测试及夹具。

- 271 个生产文件，566 条可解析字面量 import 边，另有 4 个 Worker 入口；解析错误 0、未解析相对 import 0。
- 限定范围图、以及触及该范围的完整 app 生产图，循环依赖均为 0；没有 core/shared 反向引用 services/server/UI。server→core 的 14 条边为错误类型及默认常量，未把它们误报为事务绕层。
- 简单层级规则之外的 `secretary/background.js:6 → runtime/port.js` 使用公开契约 `recordedToolResult`，符合端口边界。横向服务调用、注入对象和事件订阅另由人工审阅，不以无 import 环代替行为解耦结论。
- 3,134 个函数 AST 节点，其中 115 个物理跨度超过 80 行（96 个顶层、19 个嵌套）；扣除直接嵌套函数覆盖区间后仍超过 80 行的有 23 个。物理跨度包括注释及嵌套定义，下面同时保留两种长度，避免把服务工厂误判成单一复杂流程。

最大的 15 个生产文件：

1. `app/services/desk/annotations.js`：531 行。
2. `app/services/research/store.js`：443 行。
3. `app/services/secretary/minutes.js`：440 行。
4. `app/services/tools.js`：402 行。
5. `app/services/python/index.js`：387 行。
6. `app/services/knowledge/project-index.js`：384 行。
7. `app/services/memory/index.js`：383 行。
8. `app/core/meetings.js`：382 行。
9. `app/services/research/semantic/index.js`：365 行。
10. `app/services/export/sanitize.js`：354 行。
11. `app/services/context-assembly.js`：338 行。
12. `app/services/knowledge/mutations.js`：337 行。
13. `app/services/turn-runner.js`：336 行。
14. `app/services/desk/sessions.js`：333 行。
15. `app/services/desk/index.js`：331 行。

<details>
<summary>全部 115 个超过 80 行的函数（文件、范围、词法名称及去嵌套长度）</summary>

```text
app/services/desk/annotations.js:46–531  createAnnotations  486 行；去嵌套 32 行
app/services/secretary/minutes.js:27–440  createMinutesService  414 行；去嵌套 69 行
app/services/python/index.js:24–387  createPython  364 行；去嵌套 31 行
app/services/knowledge/project-index.js:27–384  createProjectIndex  358 行；去嵌套 92 行
app/core/meetings.js:35–382  createMeetings  348 行；去嵌套 68 行
app/services/memory/index.js:36–383  createMemoryService  348 行；去嵌套 35 行
app/services/research/semantic/index.js:20–365  createSemantic  346 行；去嵌套 68 行
app/services/research/store.js:116–443  createResearchStore  328 行；去嵌套 73 行
app/services/desk/sessions.js:13–333  createDeskSessions  321 行；去嵌套 39 行
app/services/knowledge/mutations.js:27–337  createKnowledgeMutations  311 行；去嵌套 34 行
app/services/versions/organizer.js:16–319  createVersionOrganizer  304 行；去嵌套 20 行
app/services/turn-runner.js:34–336  createTurnRunner  303 行；去嵌套 54 行
app/services/desk/index.js:35–331  createDesk  297 行；去嵌套 117 行
app/services/conductor.js:20–313  createConductor  294 行；去嵌套 43 行
app/services/desk/manuscript-tools.js:22–313  createManuscriptTools  292 行；去嵌套 7 行
app/services/context-assembly.js:54–338  createContextAssembly  285 行；去嵌套 28 行
app/core/workspace/workspace.js:49–325  createWorkspace  277 行；去嵌套 80 行
app/services/knowledge/jobs.js:17–292  createKnowledgeJobs  276 行；去嵌套 24 行
app/core/workspace/snapshots.js:31–304  createSnapshots  274 行；去嵌套 51 行
app/services/knowledge/versions.js:21–286  createKnowledgeVersions  266 行；去嵌套 20 行
app/core/messages.js:41–293  createMessages  253 行；去嵌套 75 行
app/services/knowledge/queries.js:10–248  createKnowledgeQueries  239 行；去嵌套 17 行
app/services/export/sanitize.js:132–354  sanitizeSnapshot  223 行；去嵌套 103 行
app/services/memory/sources.js:12–233  createMemorySources  222 行；去嵌套 6 行
app/core/turns.js:46–266  createTurns  221 行；去嵌套 69 行
app/services/knowledge/card-queue.js:11–226  createCardQueue  216 行；去嵌套 16 行
app/services/secretary/catch-up.js:42–255  createSecretaryCatchUp  214 行；去嵌套 19 行
app/services/memory/items.js:8–220  createMemoryItems  213 行；去嵌套 38 行
app/services/tools.js:197–402  createTools  206 行；去嵌套 28 行
app/services/versions/storage.js:20–213  createVersionStorage  194 行；去嵌套 16 行
app/services/context-assembly.js:134–325  createContextAssembly > describe  192 行；去嵌套 89 行
app/services/memory/index.js:106–297  createMemoryService > run  192 行；去嵌套 146 行
app/services/research/search.js:9–198  createResearchSearch  190 行；去嵌套 15 行
app/services/desk/tex-build.js:22–210  createTexBuild  189 行；去嵌套 18 行
app/services/research/semantic/vector-store.js:55–238  createVectorStore  184 行；去嵌套 42 行
app/services/research/items.js:108–287  createResearchItems  180 行；去嵌套 21 行
app/services/mcp/index.js:30–206  createMcp  177 行；去嵌套 21 行
app/services/knowledge/card-writer.js:20–192  createCardWriter  173 行；去嵌套 7 行
app/services/secretary/publish.js:10–182  updateWorkbench  173 行；去嵌套 164 行
app/services/desk/docx/inlines.js:51–220  createInlineReader  170 行；去嵌套 32 行
app/services/secretary/background.js:14–181  createBackgroundRunner  168 行；去嵌套 28 行
app/services/versions/graph.js:11–178  createVersionGraph  168 行；去嵌套 4 行
app/services/export/writer.js:27–193  createExportWriter  167 行；去嵌套 23 行
app/services/knowledge/derived.js:56–217  createDerived  162 行；去嵌套 4 行
app/services/research/index.js:16–177  createResearch  162 行；去嵌套 52 行
app/services/desk/navigation.js:9–169  createDeskNavigation  161 行；去嵌套 14 行
app/services/export/index.js:15–170  createFullExport  156 行；去嵌套 15 行
app/services/knowledge/project-index-listing.js:46–199  listProjectFiles  154 行；去嵌套 108 行
app/services/knowledge/tools.js:13–166  createKnowledgeTools  154 行；去嵌套 6 行
app/services/versions/index.js:18–170  createVersions  153 行；去嵌套 34 行
app/core/outbox.js:23–173  createOutbox  151 行；去嵌套 29 行
app/services/turn-runner.js:160–309  createTurnRunner > run  150 行；去嵌套 99 行
app/server/server.js:88–235  createAppServer  148 行；去嵌套 73 行
app/services/approvals.js:17–164  createApprovals  148 行；去嵌套 29 行
app/services/desk/docx/render.js:13–160  renderBlock  148 行；去嵌套 26 行
app/services/research/semantic/documents.js:11–156  createSemanticDocuments  146 行；去嵌套 10 行
app/services/versions/organizer.js:123–268  createVersionOrganizer > organize  146 行；去嵌套 102 行
app/services/secretary/proposals.js:24–168  createDraftProposals  145 行；去嵌套 34 行
app/services/secretary/catch-up.js:114–252  createSecretaryCatchUp > catchUp  139 行；去嵌套 95 行
app/services/knowledge/layout.js:13–149  createKnowledgeLayout  137 行；去嵌套 16 行
app/services/preview/index.js:13–149  createPreview  137 行；去嵌套 4 行
app/services/knowledge/graph.js:12–147  createGraphView  136 行；去嵌套 6 行
app/services/skills/index.js:22–157  createSkills  136 行；去嵌套 12 行
app/services/python/installer.js:13–145  createInstaller  133 行；去嵌套 3 行
app/services/research/semantic/embedding.js:9–141  createEmbedding  133 行；去嵌套 27 行
app/services/memory/sources.js:13–144  createMemorySources > plan  132 行；去嵌套 92 行
app/services/desk/annotations.js:273–400  createAnnotations > prepare  128 行；去嵌套 93 行
app/services/builtin-tools/shell.js:175–300  runShell  126 行；去嵌套 78 行
app/services/research-input/index.js:10–135  createResearchInput  126 行；去嵌套 6 行
app/core/db/migrations/001-core.js:7–130  up  124 行；去嵌套 124 行
app/services/approval-rules.js:28–151  createApprovalRules  124 行；去嵌套 8 行
app/server/routes/knowledge.js:25–145  registerKnowledgeRoutes  121 行；去嵌套 29 行
app/services/versions/diffs.js:13–133  createVersionDiffs  121 行；去嵌套 14 行
app/services/versions/storage.js:23–141  createVersionStorage > writer  119 行；去嵌套 7 行
app/services/knowledge/project-index-worker.js:35–151  processIndexJob  117 行；去嵌套 114 行
app/services/builtin-tools/files.js:62–177  createFileTools  116 行；去嵌套 3 行
app/services/knowledge/sessions.js:13–127  createKnowledgeSessions  115 行；去嵌套 11 行
app/server/routes/meetings.js:29–142  registerMeetingRoutes  114 行；去嵌套 9 行
app/services/desk/manuscript-tools.js:154–265  createManuscriptTools > edit  112 行；去嵌套 109 行
app/services/desk/tex-build.js:62–173  createTexBuild > execute  112 行；去嵌套 100 行
app/services/research/search.js:26–137  createResearchSearch > search  112 行；去嵌套 56 行
app/services/knowledge/expansion-rank.js:11–120  rankExpansion  110 行；去嵌套 93 行
app/services/providers.js:203–312  createProviderService  110 行；去嵌套 13 行
app/core/projects.js:33–141  createProjects  109 行；去嵌套 21 行
app/services/knowledge/card-writer.js:82–190  createCardWriter > save  109 行；去嵌套 2 行
app/services/knowledge/expansion.js:22–129  createExpansionSearch  108 行；去嵌套 16 行
app/services/provider-header-migration.js:97–204  migrateProviderHeaders  108 行；去嵌套 65 行
app/services/desk/storage.js:88–194  createDeskStore  107 行；去嵌套 9 行
app/services/knowledge/card-writer.js:83–189  createCardWriter > save > core.db.transaction[argument 1]  107 行；去嵌套 74 行
app/services/knowledge/expansion-index.js:25–129  createExpansionIndex  105 行；去嵌套 16 行
app/core/events.js:14–117  createEvents  104 行；去嵌套 36 行
app/services/secretary/background.js:72–173  createBackgroundRunner > run  102 行；去嵌套 70 行
app/services/secretary/minutes.js:157–258  createMinutesService > update  102 行；去嵌套 96 行
app/server/routes/research.js:6–106  registerResearchRoutes  101 行；去嵌套 18 行
app/services/project-files.js:16–116  createProjectFiles  101 行；去嵌套 29 行
app/services/knowledge/expansion-graph.js:103–199  collectExpansionGraph  97 行；去嵌套 78 行
app/services/secretary/store.js:8–103  createMinutesStore  96 行；去嵌套 11 行
app/services/versions/comparison.js:62–157  changeSummary  96 行；去嵌套 88 行
app/services/desk/annotation-store.js:7–101  createAnnotationStore  95 行；去嵌套 4 行
app/services/mcp/connection.js:114–208  openConnection  95 行；去嵌套 34 行
app/services/knowledge/cards.js:42–135  createPaperCards  94 行；去嵌套 11 行
app/services/python/installer.js:51–143  createInstaller > prepare  93 行；去嵌套 92 行
app/core/db/migrations/022-knowledge-base.js:8–99  up  92 行；去嵌套 92 行
app/services/desk/docx/blocks.js:47–138  planBlocks  92 行；去嵌套 74 行
app/services/research/semantic/model-assets.js:118–209  downloadEmbeddingFiles  92 行；去嵌套 90 行
app/services/desk/tex-engines.js:13–102  createTexEngines  90 行；去嵌套 16 行
app/services/research/parsers/latex.js:36–125  parse  90 行；去嵌套 71 行
app/services/knowledge/tools.js:34–121  createKnowledgeTools > write  88 行；去嵌套 6 行
app/services/builtin-tools/files.js:90–176  createFileTools > run  87 行；去嵌套 51 行
app/services/research/semantic/search.js:4–90  createHybridSearch  87 行；去嵌套 10 行
app/services/tools.js:268–354  createTools > run  87 行；去嵌套 85 行
app/services/desk/annotation-recovery.js:16–101  recoverDocx  86 行；去嵌套 76 行
app/services/export/projects.js:7–92  planProjects  86 行；去嵌套 78 行
app/services/desk/docx/comment-edit.js:42–125  applyComments  84 行；去嵌套 55 行
app/core/participants.js:22–103  createParticipants  82 行；去嵌套 29 行
```

</details>

### 4. 后端结构建议表

按维护收益与改动风险排序；估时含局部实现和功能测试，不含最终全检。这里都是下一轮任务的建议，本轮均未实施。

| 排序 | 问题、位置与具体证据 | 建议的边界与值得做的原因 | 估时 | 风险 / 影响文件 | 保护它的测试 | 改接口形状 |
|---|---|---|---|---|---|---|
| 1 | 同一份配置默认值存两处。`core/workspace/resources/settings.js:83-93 DEFAULT_SETTINGS.memory/summary` 与 `services/memory/index.js:25-30 DEFAULT_MEMORY_SETTINGS`、`services/secretary/policy.js:7-15 DEFAULT_SUMMARY` 完整重复；服务再次 merge 它们（memory `:70-73`、policy `:34-41`）。 | 把内存、纪要默认对象置于 core 内独立且无服务依赖的配置模块，settings 和消费者引用同一对象；保留原导出兼容测试/调用。这样调整默认预算或触发规则时只改一处，并保持 core→services 为零。 | 0.25–0.5 天 | 低。嵌套对象需要保持 merge 规则；现有配置读出的值不变。上述 3 文件及 core 配置文件；不把服务或模型目录反向导入 core。 | `core/workspace/resources/settings-updates.test.js`、`services/memory/index.test.js` 默认预算/禁用 idle、`services/secretary/minutes.test.js` 触发规则、`ui/settings.browser.test.js`。 | 否。配置键、默认值与原 service 导出保持。 |
| 2 | 原子替换写入流程重复。`core/workspace/files.js:24-34 writeTextAtomic`、`services/desk/storage.js:17-27 writeAtomic` 都 mkdir→随机临时文件→writeFile→renameWithRetry→finally rm；`services/providers.js:96-120 saveKeys` 的内层重复同一流程，另有凭据串行 merge 与 mode 0600。 | 提取/下沉一个很小的“bytes 写临时文件再替换”原语到 core 文件模块，text 只是 UTF-8 包装。保留凭据 merge 队列、0600 与编辑台的注入点，继续复用已经存在的 renameWithRetry。未来 Windows 文件占用处理只需修一份。 | 0.5 天 | 低至中。只共用写替换，不合并正文修订、凭据 merge 或版本导入。触及上述 3 文件和一个 core 文件；迁移备份的 copy+校验写入有不同语义，继续单独留着。 | `core/workspace/workspace.test.js`、`workspace/snapshots.test.js`、`services/provider-settings.test.js`（含 CLI/外部文件编辑）、`services/desk/sessions.test.js` 保存/重启路径。加一次临时替换失败后旧文件可读且临时文件清理的功能检查。 | 否。保留现有 writer 签名或薄包装。 |
| 3 | HTTP 路由包含应用事务和跨服务协调。`server/routes/meetings.js:43-69` 决定工作目录、检查 stat、mkdir、建 meeting、绑定 Python；`:76-82` 查附属会话家族并禁止运行中移动；`:95-111` 在一个事务里 capture 附件、提交消息、consume 草稿。`routes/memory.js:17-21` 在路由事务中批量 update。 | 把现有完整操作下移成小的 application-service 方法，例如 createMeeting、moveMeeting、submitMessage、decideMemories；路由只 parse 与转发。保留现有 core primitive 和 conductor 入口，其他工具/CLI 将来调用同一个已验证操作，避免复制 HTTP 内的事务规则。 | 1–1.5 天 | 中。附件 consume 与 message 正本必须同事务；mkdir/环境失败、移动带附属会话、事件时序均保留。触及 meeting/memory routes、对应 services、`app/app.js` 装配；不用建立通用 command bus。 | `server/server.test.js`、`services/outbox.test.js`、`research-input/input.test.js`、`research-input/images.test.js`、`services/project-files.test.js`、`core/meetings.test.js`、`services/memory-integration.test.js`。 | 否。HTTP 请求/响应与 SSE 事件保持。 |
| 4 | KB 历史响应把内部行快照变成 UI 契约。`knowledge/versions.js:51-70 page/changes` 选 `rowid,*` 后调用 publicRow；`records.js:123-134 publicRow` 通用转换顶层蛇形字段并 JSON.parse，`before`/`after` 内仍是原数据库行。`queries.js:218-235 revisionDetails` 展开整个 row，且为边兼容 from_ref/fromRef、evidence_json/evidence。`server/routes/knowledge.js:116-126` 直接返回。UI `components/knowledge-panel.js:212-232 FIELD_NAMES/revisionText` 明确依赖 `name_en`、`aliases_json`、`attrs_json` 并对快照字段 JSON.stringify 比较。 | 增加明确的历史视图投影，如 changedFields、removed、名称/两端/evidence、原 revision 标识。完整行快照继续仅作恢复依据；UI 由 Claude 迁移使用投影字段，再决定旧字段何时退出。单次数据库列名变化将不再要求同步改历史文案。 | 1–1.5 天 | 中。旧历史原始行形状必须仍可恢复，不能迁移成仅摘要。触及 knowledge queries/records/versions 的读视图、knowledge route、对应 UI。稳定事件也需保留现有字段语义。 | `services/knowledge/store.test.js`、`server/routes/knowledge.test.js`、`ui/knowledge.browser.test.js`、`ui/turn-knowledge.browser.test.js`；覆盖旧快照恢复和新 changedFields 的同一路径。 | 是，先加字段；旧 before/after 在兼容阶段保留。 |
| 5 | 文件列表查询隐含扫描，索引实现反过来定义文件列表规则。`services/project-files.js:9` 为 ownFolders 导入 `knowledge/project-index-listing.js`（遍历/更新索引算法模块）；`:41-44 list` 在根目录 GET 时调用可选 requestIndex。`app/app.js:70-75` 创建带回调的 files 服务，但 research/index.js:21、journal-files.js:10 等自行创建无回调 files。相同 list 方法的副作用取决于谁装配它。 | 把少量受管目录规则放到文件域自己的数据模块；把“根目录读取是否请求刷新”的选择放在明确的应用操作上，普通文件 list 保持清楚的查询职责。向需要一致行为的服务注入同一 files 入口。先保留当前网页打开资料时会刷新的行为，再整理内部调用。 | 0.5–1 天 | 中。不能丢失文件更名后的索引刷新、内置工作目录隐藏、共享并发预算或 immutable-copy 身份。触及 project-files、project-index-listing、app 装配、需要传入 files 的服务。不会增加新的 parser/index 系统。 | `services/project-files.test.js`、`knowledge/project-index.test.js`、`project-index-fast-moves.test.js`、`project-index-queue.test.js`、`ui/project-folder.browser.test.js`、`ui/workbench.browser.test.js`。 | HTTP 形状否；内部 service 参数/调用更明确。 |
| 6 | 后台失败的返回契约通过给任意异常追加属性形成。`secretary/background.js:146-161 catch` 改写 error.incompleteOutput/usage/turnId；`memory/request.js:67-78` 依赖这些属性保存 checkpoint；`knowledge/cards.js:120-127` 再追加 cardResult；`card-queue.js:123-135` 又读取它。JSDoc 多处 any，跨服务费用/保留输出的关系只有运行时体现。 | 先定义一个小的后台失败结果类型或 BackgroundRunError，把 usage、turnId、保留输出与 cause 一次表达；论文卡片自己的结果放在有类型的 card failure 上。保留运行时 Runtime port 和现有成功返回，不抽象所有 Error。费用记录与失败恢复会更容易审查。 | 0.5–1 天 | 中。取消、max_tokens、stream-cut、empty response、JSON 验证失败须保留请求用量与原文。触及 background、memory/request、cards、card-queue；不统一前台会话与 disposable 后台会话生命周期。 | `services/secretary/minutes.test.js` 失败/取消、`services/memory/index.test.js:207/293` 部分输出与缺失用量、`services/knowledge/cards.test.js`、`cards-api.test.js`、`app/main.runtime.test.js`。 | 对外 HTTP 否；内部 failure 形状明确并保留兼容读取。 |
| 7 | 最大文件内有真正交织的批注投影函数。`services/desk/annotations.js` 531 行，但 factory 自身只有 32 行（去掉 nested spans）；核心是 `prepare:273-398` 同时处理 undo 冲突、Word marker、普通索引重定位、被删文本恢复、live 集合和最终 marker 清理，并调用 `removedWithText:407` 查 journal。 | 仅拆 prepare 的三个明确阶段：显式逆操作校验、正文范围投影、删除/恢复及 marker 收尾。journal 查询留在现有 facade；可计算部分接收已加载记录与范围，仍输出同一 proposal，再由现有 store.commit 一次提交。后续 Word 评论或索引缺陷可局部验证。 | 1–2 天 | 中至高。文本/批注必须共用 journal、撤销与重启恢复；不要新增第二套 undo 状态。触及 annotations 及一个局部 projection helper；保留当前 store、sessions、annotation-store。 | `desk/annotations.test.js`、`annotation-editor.test.js`（删除撤销带回 Word 评论/索引）、`annotation-recovery.test.js`、`annotation-interfaces.test.js`、`docx/blocks-comments.test.js`、`ui/desk.browser.test.js`。 | 否。proposal 与 API 形状保持。 |
| 8 | 记忆单轮 run 的完整状态推进仍集中一处。`services/memory/index.js:106-297 run` 192 行 / own 146，依次处理 eligibility/settings/busy、模型变更 checkpoint 丢弃、分页提取、候选去重、核验批次装配、预算跳过、原文校验、保存候选、提交 cursor、错误和状态；这些步骤已有 sources/request/candidates/store 模块，却仍在一层协调循环内嵌套。 | 随下一次实际记忆功能修改，把 extraction-page 和 verification-batch 各变成显式函数：输入 checkpoint/prepared/context，返回下一阶段或 waiting/skipped；外层 run 保留循环和事务提交。复用当前状态机，不引入通用工作流引擎。 | 1–1.5 天 | 中至高。尤其不能让失败页推进 cursor，或重启后重复花费提取请求。先做行为不变的提取；未安排新记忆功能时排后。触及 memory/index.js 及现有 request/candidates 边界，必要时局部 stage 文件。 | `memory/index.test.js:179` 预算后重启、`:207` 失败不推进、`:313` 长原文分片、`:343` 来源变更、`:426` 复用保存提取、`:508` 大输出模型默认预算、`memory-integration.test.js`。 | 否。checkpoint 持久 schema 与 API 均保留。 |
| 9 | 相似边设置能保存为消费者会拒绝的值。`core/workspace/resources/settings.js` 的 merge 接受 `threshold:2,maxPerPaper:-1`；`knowledge/derived.js:similar` 随后按既有语义拒绝。纯函数探针复现，设置文件未在用户数据中修改。 | 保存边界与消费者共用同一份小型参数规则，错误在保存时可读返回，保留旧值；不增加额外产品上限。 | 0.25–0.5 天 | 低至中；合法值行为不变，0 仍表示不建相似边。涉及 settings 更新及 knowledge 规则。 | `knowledge/jobs.test.js` 的重配／禁用，以及非法保存后旧值仍可用的功能测试。 | 非法输入从保存成功变为 400，需任务书确认；有效响应形状不变。 |
| 10 | embedding adapter 生命周期缺少真实协议结果断言。`research/semantic/index.test.js` 注入 fakeEmbedding；`embedding.js`／`embedding-worker.js` 的启动、并发 ID 对应、退出拒绝未被这些断言覆盖。 | 先补小型本地 worker 协议测试，另将需要实际本地 ONNX 资产的 integration 标明；无需用付费模型或在普通单测中下载模型。 | 0.5–1 天 | 低；只补测试，资产路径与退出需隔离。下载参数检查继续保留但不当作执行测试。 | embedding adapter 专项；semantic 正常降级及重启测试。 | 否。 |

### 设置与测试保护的逐项核对

- `DEFAULT_SETTINGS` 共有 69 个叶子：68 项设置都找到实际消费者，另 1 项 version 为格式元数据。已确认的“存了没人读”与“读了存不进”各 0。检查覆盖动态 panel 键、CSS 字体与密度、原生更新设置、summary.workbench、模型下载源；纯 merge 探针证明 deskNav／deskPanel 能持久化。完整 37 组读写映射和探针在本地 `settings-coverage.json`／`settings-pure-probes.json`。
- 默认纪要、记忆与版本说明模板存在多处重复，当前内容相同；建议先去重，避免日后设置一处、执行另一处。数值 0 的禁用／立即触发语义只作边界观察，没有一律列为错误。
- 271 个模块中 86 个有同名测试、100 个由测试直接导入，269 个有静态测试关联；剩余两份 `core/references.js` 和 parser `types.js` 是 JSDoc 类型文件。补 Worker 入口后没有“仅浏览器可达”的模块。**导入可达只是潜在执行路径，不是断言或行覆盖率。**
- 人工确认了具体保护：export 的 `full.test` 断言导出设置和原件；layout 测试验证坐标、固定点和关闭；block-diff 直接运行 diff worker；`versions/diff.test` 断言 journal 引用撤销／恢复；`desk/text.test` 断言 text-blocks fence 与回环。没有因为这些文件缺同名测试就列为未测。
- 可操作缺口主要是表中 embedding 适配器协议；systemInfo 的部分路径及少数 UI 偏好分支也缺结果断言，优先级较低。不要据宽泛的 createApp 导入图声称全后端已覆盖。

### 保留现有边界

`tools.js` 的约 180 行工具规格和显式分派不需要为了行数改成框架；workspace、versions、desk、Python 的队列具有不同提交和取消语义，不合成万能队列。导出／历史快照要保留原始恢复数据；只给读取端加清晰投影。`annotations.prepare` 与 `memory.run` 的局部拆分应随真实功能修改安排，并保留 journal/checkpoint 真相，不新建第二套状态。

第二部分已完整写入；接下来才执行 KB-12 与干净检出检查。原始清单、依赖边、完整设置矩阵与人工审查分别为 `structure-inventory.json`、`structure-summary.md`、`settings-coverage.md`、`coupling-opinions.md`，均保留在忽略证据目录。

## 三、KB-12 与统一检查

第二部分完整写入后开始。失败如实保留，本轮不修。
