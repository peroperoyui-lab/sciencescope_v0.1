# KB-2c 首次扫描提速：交付与审阅报告

日期：2026-10-23。基线：main e2b9750fef146d2641b5eb044ba6e971f3067133。分支：codex/kb2c-first-scan-20261023。
任务书：[KB-2c_first_scan_speed.md](../../plans/tasks/KB-2c_first_scan_speed.md)，已同步 main `6e19ada` 的移动处理决定。第0条独立完成；扫描主体、规模验收及移动时保留用户修改已完成，最终完整检查结果见下文。

## 第 0 条：KB-7 带向量重评

直接使用 main 上已有的三组评测脚本与原 20 题（一般/方法各10），每题取12条，26篇合成资料加4条笔记。复用本机 multilingual-e5-small int8 缓存，不下载模型、不调用远端模型或模型重排。60次检索均为 hybrid，无向量降级。原始记录保留于开发机忽略目录 kb-7b/retrieval-eval.json，未覆盖 KB-7 旧记录。

|组|一般 Hit@3|一般 Recall@12|方法 Hit@3|方法 Recall@12|
|---|---:|---:|---:|---:|
|baseline|100%|100%|10%|30%|
|expanded-plain|100%|100%|80%|100%|
|expanded-guarded|100%|100%|80%|100%|

一般题不变差，方法题前三由10%提高到80%，满足任务书条件：把 knowledge.retrievalExpansion 默认值改为 true；已有显式 false 保留，工具仍可按次关闭。两项排序修改沿用 Claude 的 main 实现，本步骤不再改排序。

### 方法题前三（最终带枢纽/扇出处理组）

|题|问题|前三结果（按顺序）|前三|前12覆盖|
|---|---|---|---|---|
|m01|Which urban resilience study uses fsQCA?|Urban resilience methods: a review（chunk，search）；Configurations of urban resilience（source，search）；Urban resilience methods: a review（source，search）|命中|100%|
|m02|哪篇碳政策研究采用 DID 准实验？|碳政策识别方法综述（chunk，search）；双重差分（entity，search）；碳政策识别方法综述（source，search）|未命中|100%|
|m03|哪篇奖学金论文使用 RDD 的局部识别？|碳政策识别方法综述（chunk，search）；Financial aid at the scholarship cutoff（chunk，graph）；断点回归（entity，search）|命中|100%|
|m04|Which employment study matches treated and control propensity scores?|Employment matching diagnostics（chunk，search）；Employment matching diagnostics（source，search）；职业培训与再就业（chunk，graph）|命中|100%|
|m05|哪篇信贷研究使用 2SLS 而非普通回归？|信贷研究的识别风险（chunk，search）；Credit access and household investment（chunk，graph）；工具变量（entity，search）|命中|100%|
|m06|Which hospital study estimates a nonparametric production frontier with DEA?|DEA for hospitals: reproducibility notes（chunk，search）；DEA for hospitals: reproducibility notes（source，search）；医院运营效率的非参数评估（chunk，graph）|命中|100%|
|m07|哪项幸福感研究使用潜变量路径模型 SEM？|幸福感测量手册（chunk，search）；Neighborhood trust and subjective wellbeing（chunk，graph）；结构方程模型（entity，search）|命中|100%|
|m08|Which civic-text study uses STM with document covariates?|STM for civic text: a tutorial（chunk，search）；STM for civic text: a tutorial（source，search）；城市热线诉求的主题变化（chunk，graph）|命中|100%|
|m09|哪项公交空间研究使用 GWR 局部回归？|公交研究中的空间诊断（chunk，search）；地理加权回归（entity，search）；公交研究中的空间诊断（source，search）|未命中|100%|
|m10|哪篇省际碳转移研究使用 MRIO 核算？|省际碳转移方法手册（chunk，search）；Embodied carbon in interprovincial trade（chunk，graph）；多区域投入产出分析（entity，search）|命中|100%|

m02、m09 仍未进入前三，但均已在前12找到；保留结果，未调整题目或重跑刷分。

### 第 0 条改动与验证

- 默认值：app/core/workspace/resources/settings.js；回归：app/services/knowledge/expansion.test.js，验证默认开启及显式关闭仍生效。
- 同步 docs/architecture/KNOWLEDGE_BASE.md §5、docs/product/FEATURES.md、docs/log/IMPLEMENTATION_LOG.md，并将本报告随分支提交。
- 命令：node app/services/knowledge/retrieval-eval.js <新的忽略目录> <已安装的模型目录>；node --test app/services/knowledge/expansion.test.js，10/10通过。
- 真实远端模型请求0，token用量0；本机嵌入推理单独列为上述60次检索。最终完整检查见下文。

## 两段式扫描

第0条独立提交为 `b8ea177b441a01d06a42fe8583ecf801736bfef9`。随后实现：

- 第一段完整枚举路径，按大小/时间戳比较，每500项同步事务写资料与文件名FTS；新路径和消失记录的大小/时间戳在两边都唯一时，直接按移动保留旧ID。返回时不曾复制或解析内容。新增记录的编号按批预留，不再每个文件查MAX或删除尚不存在的FTS行。
- 第二段跨项目共用2个处理名额，单次源文件读取同时哈希及写临时副本，按哈希去重；副本位置/哈希与解析投影一起提交，文件之间让出事件循环。普通移动保留旧ID和段落；队列由现有 `queued` 状态恢复，未增加迁移。
- `scan()` 只等建档，`scanAndWait()` 等全程，`idle()` 等已有队列；GET索引状态与每秒至多一次的 `research.index.progress` 供Claude接界面，最终idle同样节流。POST原有计数字段保留并加 `queued`。
- 项目归档暂停，取消归档接续；改绑根目录强制重新确认内容，即使路径、大小、修改时间都一样；缺失记录在后台结束且根目录可读、没有读失败时才删除。持续写入文件自动跟进一轮，仍变化的保留排队，等待下次扫描/启动。

### 改动范围

|文件|用途|
|---|---|
|app/services/knowledge/project-index.js、project-index-listing.js、project-index-worker.js、project-index-progress.js|两阶段调度、目录建档、后台处理、进度节流|
|app/services/knowledge/project-copies.js|单次源读取的哈希副本，Windows原子发布与相同哈希并发去重；删除无调用者的旧双读路径|
|app/services/research/store.js|分批建档、根目录失效、避免重复FTS写入|
|app/services/research/index.js|只扩展项目文件解析的保存环节，使副本身份与解析结果原子提交；解析器和分段算法不变|
|app/services/knowledge/project-index-edits.js、source-removal.js|识别排队条目的用户编辑和持久引用；脱离路径的共享快照也由显式孤立副本清理处理|
|app/server/routes/projects.js；app/ui/api.js|新增GET状态；UI仅登记一个事件名|
|project-index.test.js、project-removal.test.js、project-index-queue.test.js、project-index-lifecycle.test.js、project-copies.test.js|旧完整等待调用迁移及队列、生命周期、副本功能验证|
|project-index-fast-moves.test.js、project-index-edits.test.js、project-index-retention.test.js|唯一/歧义移动、字段/标签/关联/批注及重启历史、保留双方ID/段落引用和共享副本回收|
|KNOWLEDGE_BASE、FEATURES、IMPLEMENTATION_LOG、本报告及文档索引/路线图|现状、验收与可共享审阅材料|

### 发现 → 原因 → 修复 → 验证

1. 大目录建档反复查找不存在的旧全文记录 → 新建资料和新段落仍走“删旧再写”路径，单个编号反复查MAX → 新记录直接写、按批预留编号；只改哈希/状态时保留原文件名FTS → 全量文件名命中、已有资料搜索和修改测试核对。
2. 重启可能看到新哈希配旧段落 → 先保存副本字段、后异步解析会留下中间状态 → 快照与解析结果同事务发布，未完成仍queued → 关闭/重开验证已完成ID不再次解析。
3. 改绑文件夹可能跳过同时间戳的不同内容 → 原判断只比较路径、大小、时间 → 根目录变化使旧记录排队重新确认；移动遇到未完成旧记录仍保留ID并完成解析 → 相同路径/时间但不同内容及跨根移动测试。
4. 最后一个任务完成后根目录可能已移走 → 仅凭首段“缺失”列表会误当删除 → 删除前复核根与所有缺失路径，读取失败保留原记录 → 根消失和失败读取测试；全部worker收尾后才允许清理副本。
5. 2,000文件测试首轮120秒超时 → H盘真实小文件复制/写库超过该测试总预算，首段635.8毫秒已完成；20文件诊断总1.23秒，复制累计1.57秒（并发重叠）、解析累计0.77秒 → 去掉冗余FTS写入，并把重型测试总预算调整为600秒，仍用事件/Promise闸门检查功能 → 首轮记录保留，最终干净检出结果另列。

### Windows规模验收

本机H盘为USB连接的WDC WD40 EFRX-68N32N0、NTFS。代码生成20,000个独特内容小文件：10,000 TXT、4,990 Markdown、4,990 CSV、10 PDF、10 DOCX。生成文件耗时421.91秒，不计入扫描耗时；采用现有解析器，CSV按表格段落解析。

|测量|结果|
|---|---:|
|第一段建档|7.635秒（目标120秒以内）|
|全部完成（包含半程关闭/重开）|1,392.012秒，即23分12秒|
|半程关闭服务与数据库|315.68毫秒|
|重新打开后的剩余处理|680.787秒|
|关闭时已完成 / 排队|10,000 / 10,000|
|已完成项重复解析|0|
|最后状态|20,000 parsed，queued 0，failed 0|
|检索样本数 / 首次 / 平均|687 / 1.720毫秒 / 1.512毫秒|
|检索P95 / 最长|2.271毫秒 / 3.884毫秒|

首段返回时新增20,000、queued 20,000、失败0，全部可按文件名找到，复制/解析尚未开始。20,000项试验在同一Node进程中关闭core/index并重新创建；检索计时为服务层直接调用，样本来自关闭前的后台阶段。

加入唯一大小/时间戳快速配对后，复用同一批20,000合成文件、新建独立数据库复测首段：**8.464秒**（目标120秒以内），全部20,000项排队，复制/解析均0。一次返回全部20,000文件名结果耗504.915毫秒，立即关闭耗18.556毫秒，关闭后复制/解析仍0。此项与上表少量结果查询的毫秒数使用不同返回规模，单独列出；原记录保留于 `kb-2c/first-stage-final-2026-10-23T14-55-48-771Z/report.json`。

另补真实进程退出恢复：100个TXT/MD/CSV文件，第一Node子进程完成50项后正常退出（退出码0），第二个新Node进程只构造服务即自动完成剩余50项（退出码0）；100个资料ID全部保留，每源持久 `source.imported` 恰好1次，重复已完成解析0。两次退出后及最终核验后WAL/SHM均清理。前段3.792秒、重启后3.078秒。原始报告分别位于忽略目录 `kb-2c/run-2026-10-23T13-40-29-791Z/report.json` 和 `kb-2c/process-resume-1792764699052/report.json`。

### 检查与范围

第0条回归10/10；存储和生命周期专项8/8通过。首轮队列测试7项通过、1项因120秒总预算取消，保留原结果。最终在独立、tracked-clean的检出 `3b040007dfc5b911f7c637c96595a98f878d25bc` 上运行 `npm run check`：435/435，失败/取消/跳过均0，耗时1,023.847秒；格式、lint、类型检查和Windows系统打开/NSIS覆盖测试均通过。依赖为独立普通目录，与本分支package.json/package-lock哈希相同，没有重装或下载。

新增队列测试覆盖2,000文件首次全部可检索且未复制/解析、同哈希去重、跨项目共用2个名额、恢复/移动/失败删除/节流/请求合并；7项生命周期测试覆盖后台删除、同时间戳换根、归档恢复、重启移动ID、持续写入、根消失和跨根移动。最终全检中的2,000文件首段710.2毫秒、排队检索0.6毫秒，包含生成、解析及清理的该测试总耗时258.108秒。

没有新依赖或第三方源码复制；复用现有文档解析器及Node内置stream/crypto/fs。真实远端请求0、tokens 0；本机模型评测见第0条。预览安装及其数据不访问、不修改；本轮界面只有EVENT_TYPES一项。用户要求Claude能看到报告，因此另外提交本报告和文档索引，不提交日志、数据库、合成样本或截图。

## 审阅发现与修复：移动时编辑排队条目

独立只读审阅发现一个未覆盖的用户操作竞态，并用51字节合成Markdown在当前代码上复现：完成old.md索引→改名new.md→第一段返回后阻塞后台复制→通过公开服务给新排队source修改标题/metadata、加标签→放开复制。`project-index-worker.js`匹配到旧哈希后调用`research.deleteSource`删除新source，只更新旧source的路径，因此新标题、metadata和标签都丢失。复现结果 `lostUserChanges=true`，记录在忽略目录 `kb-2c/move-edit-repro-result.json`，没有改动产品源码。

用户选择保留两条，并要求第一段先做唯一大小/时间戳配对（main `6e19ada`）。实现与验证：

1. 第一段先汇总所有新路径及消失记录的大小/时间戳，双方均唯一才直接更新旧资料路径；歧义组合不会因遍历顺序或分批顺序而被误认。已完成资料不复制、不重解析，旧标题为自定义时保留。
2. 后台哈希匹配只删除从未编辑、没有持久引用的新排队条目。字段修改、标签、关联、批注及历史记录均作为保留依据，重启后仍能判定。已编辑者保留双方ID、标签、关系和段落引用；旧资料脱离文件夹路径，保留已有副本和段落，排队状态同步恢复为可用状态。
3. API沿用source的metadata字段：`originalFileMissing:true` 和 `missingFolderPath:<原路径>` 表示“原文件已不在项目文件夹”，供Claude接显示；本轮UI仍只加EVENT_TYPES的一项。两条资料可共享同一哈希副本，删除其中任意一条不回收仍被引用的字节，显式cleanup在最后一条引用删除后才回收。
4. 回归覆盖首段唯一/歧义配对、排队/失败旧记录、用户标题、字段改后复原、标签移除历史、关联、批注清除后重启、旧记录completed/queued两种状态保留、再次扫描及共享副本清理。此前丢失修改的复现记录保留，不覆盖。初次新增保留测试把labels返回对象误写为字符串断言，已改为核对label字段，原失败日志另存。

## 材料访问与审阅

本报告随分支推送，Claude可直接从Git读取结果；原始日志、临时数据库和合成文件夹留在开发机忽略目录 .sciencescope-local/temp/kb-2c/（评测数据在kb-7b/）。报告保留可公开的数字、命令、结论与未完成项，作为云端审阅入口。
