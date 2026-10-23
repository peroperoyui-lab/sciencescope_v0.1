# KB-2c 首次扫描提速：交付与审阅报告

日期：2026-10-23。基线：main e2b9750fef146d2641b5eb044ba6e971f3067133。分支：codex/kb2c-first-scan-20261023。
任务书：[KB-2c_first_scan_speed.md](../../plans/tasks/KB-2c_first_scan_speed.md)。第 0 条先完成并单独提交，后续扫描实现与最终检查在本报告续写。

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
- 真实远端模型请求0，token用量0；本机嵌入推理单独列为上述60次检索。完整 npm run check 在扫描实现完成后做一次。

## 后续扫描工作

待第0条提交后开始。用户预览安装及其数据不访问、不修改；界面仅允许 EVENT_TYPES 新增 progress 事件，新增依赖为0。

## 材料访问与审阅

本报告随分支推送，Claude可直接从Git读取结果；原始日志、临时数据库和合成文件夹留在开发机忽略目录 .sciencescope-local/temp/kb-2c/（评测数据在kb-7b/），不作为云端可直接打开的附件。先前“报告随分支交付”的流程文档提交为 68e143c76731af460783c632761de7ca3fd498df，尚未包含在本任务基线；本任务按用户要求继续提交可公开的审阅报告。
