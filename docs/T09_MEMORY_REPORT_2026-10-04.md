# T09 记忆整理与多轮对照评测交付报告

> 实现、Windows 验收和两组各三轮真实评测已完成；等待 Git 推送回执。功能闭环通过，合成题未证明核心事实准确率有整理增益；预算失败及来源推论如实保留，等待 Claude 审阅。

## 工作区、基线与交付

- 唯一工作区：`H:\ScienceScope_v0.1-desktop`；远端 `https://github.com/peroperoyui-lab/sciencescope_v0.1.git`，外置盘已核对，没有使用 D 盘备份。
- 分支：`codex/t09-memory-consolidation-20261004`，直接基于 Claude 已合并 `edf02f33ccb720c1e0d9178cb03a11ea28f47052`，没有叠加未合并任务分支。
- 开工前已读 2026-10-03 审阅记录；合并后的受保护路径检查及引用行显示修复，在 Windows 基线验收通过。
- 后续取回的远端 `91b471a` 为新任务/规则/许可及包元数据的文档更新，本任务仍以用户指定的 `edf02f3` 为代码基线。未把 T09 扩展为新的运行时迁移任务。
- 不开 PR、不合并。完成并推送后停止，等 Claude 审阅；本轮未开始其他任务。
- 交付SHA以该分支实际远端HEAD及本次最终交付消息为准；本地Git提交前不宣称推送成功。

## 实现行为

整理服务订阅 T17 的 `chat.idle`。默认空闲 10 分钟，秘书设置可关闭、改为 1–1440 分钟或显式选模型；对话菜单支持手动整理。模型默认沿用秘书配置，未设置时用该对话模型，明确选择不可用时失败，不自动换模型。

输入是新增消息区间及纪要版本差异。差异引用旧消息时，在同一原文预算内补入对应原文；旧消息只作差异证据，不推进新消息区间。不能完整补入的差异明确延后，不静默截断。持久化游标、运行状态和去重数据仍在同一个 SQLite。临时、助手私聊、私有对话不参与整理，不另生成整段摘要。

每次使用两个独立、有界的无工具 DSH 会话：抽取结构化 JSON 候选，再批量比较每个候选的同类、共享、有效 item top-5，决定 `create/update/supersede/noop`。所有非 noop 写入只调用 `store.propose`，候选必须逐条经用户在收件箱确认。接受、编辑后接受、拒绝和来源定位沿用资料库入口；确认前候选不进入有效记忆或主专家简报。外部来源不能在编辑确认时降级，证据和项目/可见性/类型边界保留，旧修订冲突保持 pending。

宿主依据输入回执、资料引用、资源、条目及成功的网页工具活动决定 external 标记并记录来源，模型不能自行声明其为用户指令。逐字证据校验只证明出处；模型对候选事实的支持仍可能判断错误，收件箱人工确认是必要边界。

预算：最多 8 候选；40 条原文 / 24000 字符 / 估算 8000 token；纪要差异 6000 字符；单次提示 48000 字符 / 估算 12000 token；累计估算 30000 token，提前预留两次输出全额预算。抽取与比较的实际输出上限各 8192 token，包含推理，正文另限 12000 / 16000 字符。估算预算不是实际账单 token。解析/证据/预算失败不产生半批候选、不推进游标、不自动重跑整理；DSH 原有暂时性错误重试保留。

## 验收与证据

所有夹具、日志、截图、数据库及原始模型结果都在 Git 忽略的 `.sciencescope-local/temp/t09-validation/`。

| 验收 | 结果 | 证据 |
|---|---|---|
| Windows 合并基线实际 `npm test` | 293/293，0 fail/cancel/skip/todo，400425.5367 ms | `baseline/final-baseline-receipt.json` |
| 基线指定 secret-isolation-ui / discussion-ui / dsh-approval | 3/3；0 付费请求 | 同上，17 张图及退出回执 |
| 来源删除修复前整理聚焦回归 | 21/21，132201.5006 ms | `audit-final/candidate-fix-regression-20261004.log` |
| 整理 API / 动态 idle 事件 | 4/4、6/6 | 聚焦回归原始日志；最终 npm 重新覆盖 |
| 真实 DSH + 本地模拟 provider | 独立 2/2，8192 预算与 CSV→Parquet 取代 | `audit-final/candidate-fix-dsh-isolated-20261004.log` |
| T09 浏览器 / Windows Tauri-WebView2 | 各 PASS，各 16 图；真实 idle、确认 2/拒绝 1、下一 Main 简报、设置持久化、来源定位 | `acceptance/final-20261004/ui-n32kxU/` |
| 原生退出 | 正常关闭，记录的 9 个自有 PID（含主程序 PID 38340）全部消失 | `acceptance/final-20261004/native-owned-closed-verification.json` |
| 角色晚就绪回归 | PASS，三表单身份/未保存草稿保留，GET 不重复；旧整页 render 变异明确失败 | `acceptance/final-20261004/role-{positive,mutation}-final.log` |
| 第一次收口实际 npm | 330/330，0 fail/cancel/skip/todo，476428.8426 ms；在删除来源修复之前，不能代替最终源码验收 | `acceptance/final-20261004/suite-BmOCHW/npm-test/` |
| 删除 source/chunk 来源回归 | 旧码 0/2；修后连同来源保护/私有过滤 4/4，14802.6529 ms | `audit-final/deleted-source-chunk-{before,after}.log` |
| 既有 27 项浏览器/API smoke | 同一串行 run 全 PASS，0 fail；paid=0，真实 DSH / 本地模拟请求单列 | `acceptance/final-20261004/suite-BmOCHW/summary.json`（28/28 包含旧来源修复前 npm） |
| 最终实际 npm | 332/332，0 fail/cancel/skip/todo，471186.5209 ms，exit 0；Node 25.8.1/npm 11.11.0、默认并发 2 | `acceptance/final-20261004/npm-final-Iv0hpv/npm-test/{stdout-stderr.log,receipt.json}` |

浏览器/原生 T09 UI 使用本地模拟模型，每次 2 个整理请求、2 个 Main 回答，paid=0；不能当作真实模型质量证据。真实 DSH 模拟 provider 的运行单列。Windows 原生验收使用生产桥及本地构建程序，未验证安装包、升级或签名。

最终截图目录：`acceptance/final-20261004/ui-n32kxU/{memory-consolidation-browser,memory-consolidation-native}/artifacts/`。root 已查看原生英文深色设置/编辑确认与浏览器中文浅色收件箱，布局、来源提示与文字清晰。另有 summary 12 图及角色回归 2 图。

早期及失败验收保留：暂停前 npm 327/327 属于旧源码；23 smoke PASS、summary-policy FAIL、semantic 被用户暂停中断，不是最终全套。最终 UI 首次 3/4：角色回归未等待导航 hashchange，修夹具同步后独立 PASS；原 FAIL 留存。此前并发 DSH 启动/终态两项失败且 provider 0 请求，隔离 2/2 通过，未加等待时间掩盖。

当前串行 27 项全部通过：chat-ui、discussion-ui、marks-ui、research-input-ui、settings-ui、workspace-ui、desktop-navigation、failed-send-draft、workbench-ui、shortcuts-ui、extensions-ui、background-chat、desktop-interaction、creation-details、features、deliverables、i18n、minutes、viewer-ui、context-access-ui、summary-policy-ui、assistant-api（含 UI）、research-base-ui、chat-branch-ui、semantic-ui、dsh-retry-ui、secret-isolation-ui。基线 dsh-approval 也已通过；最终 npm 覆盖相应审批运行时回归，不宣称本次重复跑了未在列表内的 smoke。

提交前安全扫描源码/文档448文件、文本证据6544文件：active key 精确字节零命中、ignored 本地文件零跟踪；扫描不宣称已解压二进制历史。i18n 全量 3220 片段/1751 历史 missing；最终再次运行 `node scripts/i18n-extract.mjs --missing`，exit0，本轮变化的 22 个中文片段新增 missing=0。最终核对回执见audit-final/delivery-key-scan-latest.json，全部本地证据不进Git。

最终 npm 的 305 个运行时/界面/测试源码起讫哈希零漂移；来源修复后已复核回执。上述两次 npm、原失败 UI 和早期被暂停的 smoke 都保留独立日志，未拼成一次无失败运行。

## 真实评测协议

30 道虚构题，6 项目、12 个 Main 会话；单事实、知识更新、时间、跨会话、未记录信息拒答各 6 题。语料/问题/gold 由源码生成到 ignored 夹具目录。gold 不进模型提示，严格字段规则在真实评测前冻结。

“不整理”与“整理”都得到相同原文和全部纪要版本，保留生产 T17 概览及查阅工具，不削弱基线。整理组每项目执行初版、修订、交接三个阶段；只在隔离评测夹具中自动确认本 run 全部候选，不按 gold 筛选。失败阶段保留，不重复或补确认来刷分。

每题使用独立应用数据库副本及全新的生产全局助手，避免 Main 的跨对话范围限制和上题历史泄露。生产 global 路径没有 Research Base 简报，因此 brief hit = 0；两组首轮都有自动工作区概览，0 简报命中不等于没有任何预加载事实。该概览可带最近会话纪要前6行的最多300字符及待办，短合成语料部分事实因此已进入上下文。这是保留生产路径的强基线，限制了本集衡量整理增益的能力；不能据严格格式分差证明记忆更有用。下一轮 Main 简报在 UI smoke 单独验证。

模型固定 `deepseek-v4.1-flash`；每题 6 有效步骤 / 36 物理请求 / 180 秒 / 输出 4096 token，整理阶段 2 有效步骤 / 12 物理请求。请求及自动传输重试分开计数。正式顺序为 baseline1、consolidated1、consolidated2、baseline2、baseline3、consolidated3，各 30 题。源码身份、语料、问题、gold、提示、预算和来源历史哈希核对，不改原记录或冻结分数。

严格字段评分与逐题语义来源审核分栏：字段标签等正确事实可能严格不匹配；引用位置存在也不能证明全部断言有依据。每条原文、实际纪要及引用 item 的修订/来源单独核实。代理/网络/DSH 初始化等基础设施失败单列并排出模型质量分母；模型预算、错误答案、偏离工具、无依据附加论断均保留在质量结论中。

正式每轮观察（全部六组完成；人工来源审核与冻结的严格分数分列）：

| 组 / 轮 | 严格字段 | 人工事实正确 | 人工全部论断与引用支持 | 基础设施失败 | 无依据附加论断 | 引文字面保真问题 |
|---|---|---|---|---|---|---|
| 不整理 r1 | 18/30 | 30/30 | 29/30 | 0 | 1 | 3 |
| 整理 r1 | 20/30 | 30/30 | 29/30 | 0 | 1 | 4 |
| 整理 r2 | 19/30 | 30/30 | 29/30 | 0 | 1 | 13 |
| 不整理 r2 | 19/30 | 30/30 | 29/30 | 0 | 1 | 7 |
| 不整理 r3 | 18/30 | 30/30 | 28/30 | 0 | 3 | 9 |
| 整理 r3 | 22/30 | 30/30 | 30/30 | 0 | 0 | 6 |

不整理严格均值 **18.33/30（61.11%）**，整理 **20.33/30（67.78%）**；人工核心事实均 **30/30（100%）**，所有轮的拒答事实均6/6。全论断和引用语义支持均值分别 **28.67/30（95.56%）**、**29.33/30（97.78%）**；引文字面保真问题另列，不能把语义可定位称为逐字引用。严格差异主要是JSON外说明、字段标签、等义术语和引用schema，不能据此宣称记忆提高事实准确率。样本小、短纪要预加载、未安装向量模型的隔离夹具（检索明确keyword/model-missing），均限制效用结论。

| 组 / 轮 | JSON/schema格式失分 | 字段标签/等义措辞失分 | 核心事实错 | 回答预算/工具偏离 | 基础设施终结失败 | 整理阶段完成 / 预算失败 |
|---|---|---|---|---|---|---|
| 不整理 r1 | 5 | 7 | 0 | 0 | 0 | — |
| 不整理 r2 | 9 | 2 | 0 | 0 | 0 | — |
| 不整理 r3 | 4 | 8 | 0 | 0 | 0 | — |
| 整理 r1 | 4 | 6 | 0 | 0 | 0 | 15 / 3 |
| 整理 r2 | 6 | 5 | 0 | 0 | 0 | 13 / 5 |
| 整理 r3 | 5 | 3 | 0 | 0 | 0 | 11 / 7 |

基础设施失败为0，质量分母每轮仍30。实际15次传输重试另外计费/记录，不等于15题基础设施失败。54整理阶段39完成、15输出预算失败（HTTP200、8192全部reasoning、正文0、max-tokens）；失败不排除出整理质量，也没有重跑替换。问答无预算终结、工具偏离、错误核心事实；无依据额外运行断言分别不整理1/1/3、整理1/1/0，逐题原因见下面及矩阵。

不整理 r1 的严格失分为 5 道 JSON 外附说明和 7 道字段标签/解释/等义英译不匹配，题目事实和当前/历史含义均正确；严格分数不更改。tide-unanswerable 的“已读取 minutes”与实际工具 `minutes:null / No conversation selected` 矛盾，记 1 条无依据运行覆盖论断，拒答事实仍正确。tide-cross_session 的 handoff 引文以省略号拼接，lumen-cross_session 的两条引文以斜线拼接，共 3 处 quoteFidelity=false；人工按原回答明确的 chatId/消息编号定位后语义支持，但不称逐字 quoteLocated。该组原回答、来源、纪要及评分哈希保持；人工审计独立保存：`audit-final/t09-formal8192-baseline-r1-20261004T044401395Z/`，root 已复核全部答案和失败分类。

该组全部 30 题有回答，83 物理请求、81 有效步骤、2 重试；prompt 1035971 + completion 20844 = 1056815 已知 tokens，cached 915968 / reasoning 9026 为子集；2 请求 usage 未知，无未终结请求。Research Base 简报命中 0；研究库没有条目，research_search/read 的人工支持命中为 0，题目依据由同等保留的 T17 概览/对话原文查阅取得。其余轮、平均值和分类已在本节及最终逐题矩阵列出。

整理 r1 的严格失分为 4 道格式问题（3 道 JSON 外说明、1 道 itemHandle 使用完整 `itm_` ID）和 6 道跨会话字段标签不匹配，题目事实及时间含义均正确。完整 item ID 经人工唯一定位到实际 revision、已接受的 supersede 提议及 planning #5，不能因此改严格 schema 评分。lumen-unanswerable 的“map 均为空”与实际 status 的项目根节点矛盾，记 1 条无依据运行观察；plans/log 为空、latestVersion=null 有真实回执。lumen-cross_session 和 grain-unanswerable 各两条斜线拼接引文共 4 处字面保真问题。全部 30 项人工审计、原始记录完整性回执及 root 复核另存 `audit-final/t09-formal8192-consolidated-r1-20261004T044401395Z/`。

整理 r1 有 18 阶段：15 完成、3 模型输出预算失败，26 提议全部由评测夹具确认，候选事实质量另作完整来源审核。失败为 cedar-handoff 比较、moss-handoff 比较、grain-revision 抽取：HTTP200、8192 completion 全为推理、正文0、max-tokens，无 JSON；不是基础设施失败。原记录保留，不补跑。118 物理请求、115 有效步骤、3 重试，prompt1090260 + completion144304 = 1234564 已知 tokens、3 usage 未知、0 unfinished。research_search 6 调用均非空、35 hit；人工核实其中 2 hit 支持题问的历史事实（cedar/moss temporal 各1），research_read 支持0；非空命中不自动视为答案依据。全局助手Research Base简报命中仍0。两组原始60消息/18版纪要的 sourceIdentity 均为 `852ff2…`，完整哈希记录于账本。

整理 r1 候选完整审查已完成：35 个完整抽取候选中 32 个全文支持、3 个附加推论；26 实际提议中 24 个全文支持、2 个含附加推论。未写入的一条 cedar-revision 通用教训被比较阶段正确 noop；orbit-initial 的“而非外部要求”不能由“内部研究决定”推出，moss-initial 的“后续可能调整”未在当时原文/纪要明确表达，两条被夹具确认，不能称完整可靠记忆。后续修订不得回填成初版猜测的依据。比较 rationale 的“acoustic velocity profiler”过窄译法另记，中文 item 设备事实正确。

5 次成功 supersede 的原目标、项目、属性和历史均正确；grain-revision 预算失败留下旧 5 折 item active、游标4/v1，未生成 8 折 item。问答可回查 T17 原文而答对8折，不能据此称整理覆盖了该更新。部分 item 正文仍写提议时“未确认”控制元数据，与夹具随后确认的状态不一致，作为正文/状态一致性限制记录；不伪作新的研究事实。完整候选/操作/来源审计：`audit-final/consolidation-stage-audit-20261004/prepared-GGaWbo/{manual-stage-review-complete.json,stage-source-review.md}`。

整理 r2 全30题有答案，严格失分6道格式（JSON外说明）、5道跨会话字段标签不匹配；事实/时态/拒答各类均6/6。grain-unanswerable 的“核查其 minutes”只有 `minutes:null / No conversation selected` 回执且无后续成功读取，记1条无依据运行覆盖；tide先null后实际读取带chatId的纪要，不误记同类错误。lumen-unanswerable附文4个item引用逐条唯一定位、修订/实际检索/原文证据核实，旧时间约定没有被误述为当前UTC。13处拼接引用有明确消息编号并人工语义核定，quoteFidelity=false独立记录，不自动推作事实错误。其检索均为未记录ID问题，25 hit不能证明absence，题问支持hit为0。答案审计 `audit-final/t09-formal8192-consolidated-r2-20261004T044401395Z/`。

整理 r2 的18阶段13完成/5预算失败，27提议由夹具确认。5失败均在比较阶段：cedar-revision、tide-handoff、lumen-revision、orbit-revision、moss-handoff；HTTP200、8192推理、正文0、max-tokens，非基础设施或非空JSON解析失败。组127物理/122有效/5重试，prompt1172670 + completion135266 = 1307936已知tokens；5请求usage未知，0unfinished。来源哈希与前两组一致。

整理 r2 候选逐条审计：40个完整抽取候选、27实际提议的研究断言均有原文及实际用户纪要支持，未发现无依据附加研究断言。轨道项目的宽泛目标、交接计划的chat定位确实来自用户纪要，不能冒称消息引文单独支持。3次supersede保留旧0.80/48人/5折的历史，当前记录分别为0.92/64人/8折；其研究生效日与实际确认生命周期时间分开。另有1条重复质量问题：moss-revision的episode再次记录已经supersede保存的48→64事件，比较以缺少episode子类为理由create，不记作事实幻觉。预算失败留下CSV/当地时间/OLS的旧item仍active、游标4/v1，潮汐/苔原交接负责人及期限未整理；T17原文可查不等于整理已覆盖。来源审计及root复核：`audit-final/consolidation-stage-audit-20261004/prepared-dAtACr/`、`audit-final/root-consolidation-r2-review-20261004.json`。

不整理 r2 全30题有回答，严格19/30；9道JSON外说明格式失分、2道字段标签不匹配，核心事实/时态/拒答各类6/6。grain-unanswerable说地图为空，但实际map有项目根节点，记1条无依据运行观察；plans/log/latestVersion为空属实。orbit-unanswerable先返回null纪要后又成功读取两会话纪要，不误判“已查全部记录”。7处斜线/省略号拼接引文有明确原消息定位，语义支持与quoteFidelity=false分列。87物理/84有效/3重试，1100849已知tokens，3usage未知、0unfinished；研究支持命中0，来源审计 `audit-final/t09-formal8192-baseline-r2-20261004T044401395Z/`。

不整理 r3 全30题有回答，严格18/30；4道格式失分、8道字段标签/主谓语不匹配（跨会话6题、lumen-single、orbit-temporal），核心事实每类6/6。3条无依据运行说明分别为lumen-unanswerable的“已查minutes”（实际仅null且无后续成功读取）、moss-unanswerable的“全部4条”（实际两chat4+6共10条）、同题的“status空”（实际有project和根map，相关plans/log/version空可支持）。28题全论断支持；9处拼接quote单列字面保真。85物理/84有效/1重试，1097547已知tokens，1usage未知、0unfinished，research支持0。该组审计与root回执另存。

整理 r3 全30题有回答，严格22/30；5格式失分（4 JSON外说明、lumen-unanswerable完整itemID不符schema）及3字段/等义措辞失分，人工事实/全论断支持30/30，无额外无依据运行断言。lumen-unanswerable的 `itm_ae3e16cdb7fe4b10bc68` 经人工核对active revision1、已确认create及原文handoff#3；planning定位来自真实用户纪要。6拼接引文按明确消息编号语义定位，字面保真false。4次search非空29hit和1次read只涉及已知项目事实，不支持题问未知编号，支持命中0；拒答由完整原文/纪要和条目核定。审计初版有3条从别题复制的附加prose引用注释，root发现后另存 `-annotation-erratum1/` 修正版，原版保留；没有改任何模型回答、严格分数或人工质量分数，全部30题附加引用存在性重新检查。

整理 r3 候选42条中39全文支持、3含附加推论；27提议中26全文支持、1含较强的权威来源措辞。tide-handoff候选3的依据和planning定位有来源，但“登记处”“以该登记处为准”把“详见”加强为权威约定，按保守标准记入库附加推论；lumen-initial候选0把“内部研究决定”扩成整个“内部研究项目”，该阶段预算失败未提议；moss-revision通用“需要标记、避免混淆”无显式来源，被正确noop。1次moss supersede保留旧48人历史；lumen初版失败游标0，后续已计划的新revision阶段带1–6原文和v2正常补齐夜间照度/UTC/旧当地时间事件，没有旧item可supersede，也未重跑初版阶段。该轮未发现已接受重复事件。7预算失败：cedar-revision、lumen-initial、orbit-revision、orbit-handoff、grain-revision在比较，tide-revision、moss-handoff在抽取；CSV/0.80/OLS/5折旧item仍active、游标4/v1，orbit/moss交接未覆盖，不能据问答正确掩盖。完整阶段审核 `audit-final/consolidation-stage-audit-20261004/prepared-ol0TJI/`。

| 整理轮 | 完整候选 / 全文支持 / 含附加推论 | 提议 / 全文支持 / 含附加推论 | 成功supersede | 已确认重复事件 |
|---|---|---|---|---|
| r1 | 35 / 32 / 3 | 26 / 24 / 2 | 5 | 0 |
| r2 | 40 / 40 / 0 | 27 / 27 / 0 | 3 | 1 |
| r3 | 42 / 39 / 3 | 27 / 26 / 1 | 1 | 0 |

候选及提议质量独立于180条问答，不能把三条夹具确认的附加推论计作回答幻觉，也不能称全部80条提议可靠。产品始终人工确认；夹具自动接受是测量手段。实际external网页/文献未进入合成质量语料，其强制分类/编辑保留/删除source回执由单元、API及browser/native夹具验证。

| 组 / 轮 | 物理 / 有效步骤 / 重试 | prompt | completion | 已知total | usage未知请求 |
|---|---|---|---|---|---|
| 不整理 r1 | 83 / 81 / 2 | 1035971 | 20844 | 1056815 | 2 |
| 不整理 r2 | 87 / 84 / 3 | 1076678 | 24171 | 1100849 | 3 |
| 不整理 r3 | 85 / 84 / 1 | 1075125 | 22422 | 1097547 | 1 |
| 整理 r1 | 118 / 115 / 3 | 1090260 | 144304 | 1234564 | 3 |
| 整理 r2 | 127 / 122 / 5 | 1172670 | 135266 | 1307936 | 5 |
| 整理 r3 | 114 / 113 / 1 | 1075454 | 153727 | 1229181 | 1 |
| 正式合计 | **614 / 599 / 15** | **6526158** | **500734** | **7026892** | **15** |

正式整理阶段的108物理/105有效/3重试、555633tokens已包含在表中，不再重复相加；问答部分506物理/494有效/12重试、6471259tokens。cached5694464及reasoning391696为prompt/completion子集，不重复加算。加预验后的本任务实付调用总账：**650物理/624有效/26重试，6650967prompt + 545287completion = 7196254已知tokens，28usage未知**；无未终结请求、未知不估算、不推算金额。

原系列2026-10-04T04:44:01.395Z–06:15:09.799Z完整执行，原exec46124 exit0，runner65280及周期观察的11个唯一自有PID均消失（不是每个短命历史子进程的OS事件trace）。六组60原文/18版纪要哈希均 `852ff2ea22e827dbcdca5645b59a63fd186e51a7b3e73f62eb75e4938db2bdd2`，12冻结源码及3夹具哈希一致，raw抓取全部完成。原始状态保留SOURCE_AUDIT_PENDING，独立派生审计回执完成而不回写付费结果。

正式冻结 `formal-evidence-freeze-20261004.json`，SHA `84f2eef68a448bdd0e02d50733e8b52297de0ce27aa7e320cfcbaa6076938d86`；仅在独立来源审核和真实最终 npm 成功后启动。系列 `formal-resume-series-20261004T044401395Z.json`，2026-10-04T04:44:01.395Z 开始，所有 run 都是新目录。冻结前最后来源分类修复只改变 consolidate 的 external 边界，精确反向替换可重构旧 SHA；提示/预算/合成来源保持一致。旧付费预验属于旧源码，不冒称在最后边界修复后的源码重测过预验。



正式117个完整候选111全文支持、6含附加推论；80实际提议77全文支持、3含附加推论。比较阶段正确拦截两条无来源通用教训，另1条未进入提议源于该阶段预算失败；9次实际supersede、1条已确认重复事件。两组brief支持命中0，research_search对题问支持命中不整理0、整理2（r1 cedar/moss历史题各1），research_read支持0；其余大量非空结果只是未知ID题的已知资料，不能作为不存在的证明。

### 最终逐题矩阵

B=不整理，C=整理；单元格为原严格评分 / 人工核心事实 / 人工全部论断及引用语义支持。Y/N只代表人工结果，未修正原严格失分。

| Question | Category | B1 | C1 | C2 | B2 | B3 | C3 | Extra factual claim locations |
|---|---|---|---|---|---|---|---|---|
| cedar-single | single | full / Y / Y | full / Y / Y | full / Y / Y | full / Y / Y | full / Y / Y | full / Y / Y | — |
| cedar-update | update | full / Y / Y | format_fail / Y / Y | full / Y / Y | full / Y / Y | full / Y / Y | full / Y / Y | — |
| cedar-temporal | temporal | full / Y / Y | format_fail / Y / Y | full / Y / Y | full / Y / Y | full / Y / Y | full / Y / Y | — |
| cedar-cross_session | cross_session | wrong / Y / Y | wrong / Y / Y | wrong / Y / Y | format_fail / Y / Y | wrong / Y / Y | full / Y / Y | — |
| cedar-unanswerable | unanswerable | correct_refusal / Y / Y | correct_refusal / Y / Y | correct_refusal / Y / Y | format_fail / Y / Y | correct_refusal / Y / Y | correct_refusal / Y / Y | — |
| tide-single | single | format_fail / Y / Y | full / Y / Y | full / Y / Y | full / Y / Y | full / Y / Y | full / Y / Y | — |
| tide-update | update | full / Y / Y | format_fail / Y / Y | full / Y / Y | full / Y / Y | full / Y / Y | full / Y / Y | — |
| tide-temporal | temporal | wrong / Y / Y | full / Y / Y | full / Y / Y | full / Y / Y | full / Y / Y | full / Y / Y | — |
| tide-cross_session | cross_session | format_fail / Y / Y | wrong / Y / Y | wrong / Y / Y | format_fail / Y / Y | wrong / Y / Y | format_fail / Y / Y | — |
| tide-unanswerable | unanswerable | format_fail / Y / N | correct_refusal / Y / Y | format_fail / Y / Y | correct_refusal / Y / Y | correct_refusal / Y / Y | correct_refusal / Y / Y | B1 claim 1: 已读取 t09-tide 的 minutes/status/log/plans/map/versions（其中minutes已读取） |
| lumen-single | single | format_fail / Y / Y | full / Y / Y | full / Y / Y | full / Y / Y | wrong / Y / Y | full / Y / Y | — |
| lumen-update | update | full / Y / Y | full / Y / Y | full / Y / Y | full / Y / Y | full / Y / Y | wrong / Y / Y | — |
| lumen-temporal | temporal | full / Y / Y | full / Y / Y | full / Y / Y | full / Y / Y | full / Y / Y | format_fail / Y / Y | — |
| lumen-cross_session | cross_session | wrong / Y / Y | wrong / Y / Y | wrong / Y / Y | wrong / Y / Y | wrong / Y / Y | wrong / Y / Y | — |
| lumen-unanswerable | unanswerable | format_fail / Y / Y | format_fail / Y / N | format_fail / Y / Y | correct_refusal / Y / Y | format_fail / Y / N | format_fail / Y / Y | C1 claim 1: plans、log、versions、map 均为空（其中map为空）; B3 claim 1: 已查阅…该项目的minutes/log/plans/map/versions（其中minutes已查阅） |
| orbit-single | single | full / Y / Y | full / Y / Y | full / Y / Y | format_fail / Y / Y | full / Y / Y | full / Y / Y | — |
| orbit-update | update | wrong / Y / Y | full / Y / Y | full / Y / Y | full / Y / Y | full / Y / Y | full / Y / Y | — |
| orbit-temporal | temporal | full / Y / Y | full / Y / Y | format_fail / Y / Y | full / Y / Y | wrong / Y / Y | full / Y / Y | — |
| orbit-cross_session | cross_session | full / Y / Y | wrong / Y / Y | wrong / Y / Y | wrong / Y / Y | wrong / Y / Y | format_fail / Y / Y | — |
| orbit-unanswerable | unanswerable | correct_refusal / Y / Y | correct_refusal / Y / Y | correct_refusal / Y / Y | format_fail / Y / Y | format_fail / Y / Y | correct_refusal / Y / Y | — |
| moss-single | single | full / Y / Y | full / Y / Y | full / Y / Y | full / Y / Y | full / Y / Y | format_fail / Y / Y | — |
| moss-update | update | wrong / Y / Y | full / Y / Y | full / Y / Y | format_fail / Y / Y | full / Y / Y | full / Y / Y | — |
| moss-temporal | temporal | full / Y / Y | full / Y / Y | format_fail / Y / Y | full / Y / Y | full / Y / Y | full / Y / Y | — |
| moss-cross_session | cross_session | wrong / Y / Y | wrong / Y / Y | wrong / Y / Y | format_fail / Y / Y | wrong / Y / Y | wrong / Y / Y | — |
| moss-unanswerable | unanswerable | correct_refusal / Y / Y | correct_refusal / Y / Y | format_fail / Y / Y | correct_refusal / Y / Y | format_fail / Y / N | correct_refusal / Y / Y | B3 claim 1: 全部4条聊天记录（handoff4条、planning6条）; B3 claim 2: 项目log、status、plans、versions均为空（status为空） |
| grain-single | single | full / Y / Y | full / Y / Y | full / Y / Y | full / Y / Y | full / Y / Y | full / Y / Y | — |
| grain-update | update | full / Y / Y | full / Y / Y | full / Y / Y | full / Y / Y | full / Y / Y | full / Y / Y | — |
| grain-temporal | temporal | full / Y / Y | full / Y / Y | full / Y / Y | full / Y / Y | full / Y / Y | full / Y / Y | — |
| grain-cross_session | cross_session | wrong / Y / Y | wrong / Y / Y | full / Y / Y | format_fail / Y / Y | wrong / Y / Y | full / Y / Y | — |
| grain-unanswerable | unanswerable | correct_refusal / Y / Y | correct_refusal / Y / Y | format_fail / Y / N | format_fail / Y / N | format_fail / Y / Y | correct_refusal / Y / Y | C2 claim 1: 并核查其 minutes、plans、log、map、versions、status 与知识条目（其中核查minutes）; B2 claim 1: 项目计划、日志、地图与版本记录均为空（地图为空） |

最终去重聚合及输入核对：`.sciencescope-local/temp/t09-validation/formal-aggregate-20261004T062230615Z.json`（SHA256 `6ca8cb031d72a881cf482273020484ed876134f3889c8341a4f84c8f0480ad5a`），逐题派生矩阵`.sciencescope-local/temp/t09-validation/final-question-matrix.md`；原回答/工具/来源明细保留在每组目录。原严格规则不放宽，六组180人工条目无pending，candidate审计三组均经root采用。

## 预验原始结果与用量

| 独立预验 | 请求 / 有效步骤 / 重试 | 已知 total tokens | 结果 |
|---|---|---|---|
| 直连两题 | 12 / 2 / 10 | 0，12 请求 usage 未知 | 全 TLS `ERR_TLS_CERT_ALTNAME_INVALID`，无模型答案；另 1 题预留但零请求，原样保留 |
| 代理不整理两题 | 4 / 4 / 0 | 45311 | 严格 1/2，语义 2/2 |
| 旧 2048 输出整理 + 两题 | 8 / 8 / 0 | 69294 | 三个抽取 JSON 被输出预算截断，零候选；问答严格 1/2、语义 2/2 |
| 8192 旧来源提示三阶段 | 7 / 6 / 1 | 31071，1 usage 未知 | 3 阶段完成、8 候选 fixture 确认；来源审计有 3 条无依据的流程/缺失推论，不能称可靠记忆 |
| 最终来源修复单次三阶段 | 5 / 5 / 0 | 23686 | 2 完成 / 1 输出预算失败；4 候选逐条支持，修订失败原样保留 |

预验去重总计 **36 物理请求、25 有效步骤、11 重试；prompt 124809 + completion 44553 = 169362 已知 tokens，13 请求 usage 未知**，无未终结请求。只从 16 份 canonical 账本逐序列去重，result 内副本不重复计费：`preformal-fee-deduplicated-20261004.json`。未知不估算；cached/reasoning 属 prompt/completion 子集，不重复加算。

最终来源修复预验的 4 候选支持：采样对象、初版 CSV/日期、复核负责人及范围、复核期限/依据。最后一条的 planning 定位由实际用户纪要支持，不能冒称其消息 quote 单独支持定位。来源审计：`audit-final/sourcefix-stage-review-20261004.{json,md}`。

修订失败的实际输出是 HTTP 200、8192 completion 全为 reasoning、正文 0、`turn/end max-tokens`，归为 `MODEL_OUTPUT_BUDGET_FAILURE`，非网络失败；未产提议，游标保持消息 4 / 纪要 v1。输入已包含旧 #1/#3 与新 #5/#6、完整 v2 差异，不能将失败归因于缺少原文，也不能称付费验证已成功推进 v2：`live/t09-sourcefix-stagevalidate-20261004T035900056Z/revision-failure-diagnosis.json`。

key 只由 H 工作区父计数代理读取；session/子进程只有一次性 localhost token。直连证书异常用无凭据探针验证，代理 10808 的 HEAD 200/TLS 有效；评测增加可选父代理配置，未改产品网络设置、未关闭 TLS。预验、失败和正式轮用量分别报告。

## 发现 → 原因 → 修复 → 验证

| 发现 | 原因 | 修复 | 验证 |
|---|---|---|---|
| 角色加载后设置草稿丢失 | role ready 整页 render 重建其他表单 | 只更新角色 surface | 三表单身份与草稿保留；旧 render 变异明确失败 |
| 角色回归误判表单被角色销毁 | 测试捕获表单时 hashchange 导航尚未结束 | 等目标导航事件完成，再释放角色响应 | 精确正例 PASS、旧 render 负例 FAIL；没有加固定等待 |
| summary-policy 启动时值不稳定 | 只等待 Workspace，不涵盖独立 profile/preferences/role 初始化 | 等各实际 Promise；延迟 role 测试 readiness | summary 完整 PASS，去除 role-await 变异失败 |
| 初始三次抽取 JSON 半截 | 2048 输出预算包含 DeepSeek 推理 | 公开 DSH AgentOptions 传 8192；提前预留全额预算 | 本地真实 DSH 实际参数与新付费回执；正式15个reasoning-only预算失败全部保留 |
| 旧真实候选出现流程或缺失推论 | 混合旧/新引用差异被过滤；比较阶段缺 evidence 文本 | 有界补齐旧原文，比较传 quote 与差异；两阶段排除控制元数据/局部遗漏推论 | 新三条输入/提示回归；最新 4 条预验候选来源审核通过；正式117候选完整审核111支持/6附加推论，80提议77支持/3附加推论，失败阶段保留 |
| 直连未到模型 | TLS 域名不符，自动重试同样失败 | 仅评测父代理选用本机已存在代理，保持 TLS 验证 | 无凭据 direct/proxy 探针及实际代理上游 200，旧失败不覆盖 |
| idle 设置调整不影响已有时钟 | 原 idleMs 固定且 busy 重新调度可能零延迟 | 动态 delay、最后活动时间、设置后 refresh | mock clock 关闭/开启/调整/busy 6/6 |
| 删除资料后 external 标记丢失，删除 chunk 后整批失败 | 只由当前 catalog 对象判 external；缺 chunk 仍读取 undefined sourceId | 已存宿主 source/chunk 使用回执仍保守 external 并保留定位，缺 chunk 不再查 undefined | 两条旧码回归均失败，修后与来源编辑保护/私有过滤 4/4；不改变合成语料、两阶段提示和预算 |

## 改动文件与范围

已核对本任务共 31 个改动文件（20 个已有文件、11 个新文件）：

- 应用/运行时：`scripts/research-base/consolidate.mjs`，`scripts/{desktop-api,host-events,preview-desktop,build-desktop}.mjs`，`adapters/runtime-dsh/{host,session-control}.mjs`。
- 界面：`desktop/{memory-consolidation,secretary-settings,research-base,settings,role-settings,features,i18n-en}.mjs`，`desktop/assistant-chat.css`。
- 评测/回归：`scripts/evals/memory-eval{,-core,-fixture}.mjs`，既有 `scripts/evals/hybrid-live-retrieval.mjs` 的 opt-in 工具/会话分类；`scripts/{memory-consolidation-ui-smoke,role-settings-ready-ui-smoke,summary-policy-ui-smoke}.mjs`；`tests/{memory-consolidation,memory-consolidation-api,memory-eval,host-events}.test.mjs`。
- 文档：本报告、SYSTEM_SPEC、DESKTOP_IMPLEMENTATION 顶部日期节、ROADMAP、FEATURE_FLAGS。

白名单外逐项（依用户授权作最小改动并有回归）：

| 文件 | 必要原因与验证 |
|---|---|
| `adapters/runtime-dsh/host.mjs` | opt-in `maxTokens` 传给公开 DSH AgentOptions；实际 DSH 本地provider及全回归核参数 |
| `adapters/runtime-dsh/session-control.mjs` | 会话端解析同一预算；无 opt-in 时保持现有默认值，真实 DSH 参数回执 |
| `scripts/host-events.mjs` | 空闲设置即时重挂时钟、busy不零延迟循环；mock clock回归6/6 |
| `scripts/preview-desktop.mjs` | 传递有界快时钟注入供API/UI验收；生产默认1分钟仍为60000ms |
| `scripts/desktop-api.mjs` | 整理服务/认证路由/关闭/模型能力/确认来源guard；API4/4及UI闭环 |
| `scripts/build-desktop.mjs` | 登记新模块，复制与宿主资源白名单使用同一清单；生产smoke传递导入 |
| `desktop/secretary-settings.mjs` | 已批准设置位置接入整理表单；中英文深浅色browser/native |
| `desktop/memory-consolidation.mjs` | 设置、手动菜单和状态/收件箱；idle及手动无需新模型请求smoke |
| `desktop/research-base.mjs` | 外部来源说明和消息定位；来源保留、编辑接受与拒绝smoke |
| `desktop/assistant-chat.css` | 复用相邻表单布局；新增表单几何断言及深浅色截图 |
| `desktop/features.mjs` | 验收后开放完整能力入口；既有features smoke |
| `desktop/i18n-en.mjs` | 所有新增可见文字英文词条；新增22中文片段missing0 |
| `desktop/settings.mjs` | 角色独立surface容器避免角色晚就绪销毁其他表单；三表单身份/草稿回归 |
| `desktop/role-settings.mjs` | ready只更新角色surface；旧整页render变异失败、正例通过 |
| `scripts/evals/hybrid-live-retrieval.mjs` | 可选allowedTools/sessionKind供生产global对照；默认兼容旧T10，显式许可与默认拒绝回归 |
| `scripts/summary-policy-ui-smoke.mjs` | 等独立初始化Promise；移除role-await变异失败，全smoke通过 |
| `scripts/role-settings-ready-ui-smoke.mjs` | 延迟角色响应确定性复现草稿丢失；等待目标hashchange后采样 |
| `scripts/memory-consolidation-ui-smoke.mjs` | 新功能browser/native来源、确认和简报验收 |
| `tests/host-events.test.mjs` | 动态设置/关闭再开/busy真实时钟根因回归 |

其余新评测与整理测试为任务所需，文档同步现状。没有 fork DSH、新依赖、原型改动、现有研究工具范围变化或检索排序变化。

与任务书差异：夹具不放任务书历史 `tests/fixtures`，按用户规则全部生成于 ignored temp；结构化输出用 JSON Schema 提示和严格本地解析，不宣称 provider 强制 structured-output；比较批量一次完成以守住两步预算；全局助手做跨会话对照，Main 简报闭环另测；输出包含推理的预算失败如实保留。

未完成与限制：任务书要求的实现、Windows测试、browser/native及六组真实评测均已完成；Git交付以实际远端回执为准。预算内仍可能只有推理、候选仍可能误判事实；人工确认不可省略。本数据是 30 道合成题，不能外推复杂研究项目的普遍增益。安装包/升级/签名与 OS 出网控制不在本任务。其他任务等审阅后再执行。
