# 知识库调研：RAG 加图知识库（1.0.0-alpha）

- 起草：Claude，2026-10-18。性质：调研，不是设计定稿；设计和任务书在所有者看过本文后另写。
- 依据：`plans/IDEAS.md`「知识库」「多模态嵌入」、`architecture/KNOWLEDGE_GRAPH.md`、`architecture/RESEARCH_BASE.md`、`research/RESEARCH_MEMO_2026-09-25.md`、`decisions/DECISIONS.md`、`product/FEATURES.md` §2.8，以及 `app/services/research/` 和迁移 003、004 的现状。
- 标注：每条外部事实后面给出来源编号（见文末「参考资料」）；标「推断」的是我的推算或判断，没有实测；版本号和日期以 2026-10-18 查询 npm 注册表和网页的结果为准。

## 1. 结论与推荐

1. **存储不换库**：图和向量都放在现有的 `data/` 下那个 SQLite 里。节点沿用 `rb_sources`、`rb_items`，新增实体表和带属性的边表；1–2 跳查询用递归 CTE [R1]，向量继续用已经在用的 sqlite-vec [R2]。嵌入式图数据库（LadybugDB [R4]、DuckPGQ [R6]）和 LanceDB [R7] 都不引入，理由是 200 篇论文规模的图用不上它们，而且多一个存储会破坏「一个文件、可备份、离开应用也能读」。
2. **构图分三层，按成本递增**：第一层「派生」完全不调用模型（引用、目录结构、向量近邻、术语共现，思路同 LazyGraphRAG [R12] 和 FastGraphRAG [R11]）；第二层「论文卡片」每篇论文一次便宜模型调用，抽取方法、数据、变量、代码、结论；第三层「逐段抽取」（LightRAG 式 [R13]）只在用户或智能体对某个主题要求深挖时才跑。
3. **成本**：按 200 篇、DeepSeek V4.1 Flash 的价格 [R24] 推算，第二层约 200 次调用、不到 1 美元；如果全量做第三层约 5 000 次调用、8–12 美元（推断，假设见 §5.3）。
4. **不内置任何 Python GraphRAG 框架**。它们（GraphRAG、LightRAG、HippoRAG）都是 Python，默认依赖服务型存储；我们在 Node 里重写需要的那一小部分（抽取提示、实体合并、个性化 PageRank），并在代码里注明借鉴来源和许可证（都是 MIT）。
5. **嵌入模型 alpha 不换**：继续用 multilingual-e5-small（ModelScope 源已在 2026-10-12 校验过哈希）。EmbeddingGemma 2（Apache-2.0，文本、代码、图像同一空间 [R27]）是多模态的首选候选，但 12 天前才发布，ONNX 版本和 ModelScope 镜像都没确认，放到 alpha 之后实测。
6. **界面**：知识库页加「图」视图，以当前节点为中心展开 1–2 跳，可以直接拖线建边、改属性；绘图建议用 Cytoscape.js（MIT，编辑扩展齐全 [R33][R34]），超大全局图以后再考虑 sigma.js。
7. **与旧设计的差别**：`KNOWLEDGE_GRAPH.md` 写的「智能体整理先进收件箱、人审核后提交」已被 2026-10-07 的原则取代（DECISIONS 第 44 行）；新方案是智能体的改动直接生效、留历史版本、可恢复，界面上标出「AI 添加」。

## 2. 需求拆解

| 所有者说的（IDEAS 2026-10-17、DECISIONS 2026-10-18） | 对应能力 | 现状 |
|---|---|---|
| 「数据库」改名「知识库」，是 RAG 加图知识库 | 统一检索（关键词 + 向量）之外，加实体、带属性的边、按图扩展的检索 | 检索已有（FTS5 + sqlite-vec）；图没有，`rb_links` 只在旧线里有，`app/` 的迁移里没有 |
| 节点：文献、网络上的权威资料、本地模型抽取的方法文档、代码实现、方法的变种、本地文件和网址 | 节点类型可扩展；每个节点有属性和标签；代码片段节点记录语言、仓库、路径、行号 | 文献、文件在 `rb_sources`；知识、模型、主张在 `rb_items`；网页、代码片段、方法变种没有专门类型 |
| 节点和边都有属性和标签 | 边表要有 `attrs_json`、标签、证据、来源（谁加的）、置信度 | 无 |
| 例：QCA 相关的文献、方法文档、代码和变种连成一张图 | 以「方法」实体为中心的局部图；边类型如「提出」「实现」「变种」「使用」「比较」 | 无 |
| 原「数据库」只做项目级，按文件夹管理项目自己的论文、原始和实验数据、过程文件、代码，不用数据库程序 | 项目页显示文件夹树，组织方式就是文件夹；文件仍可解析和建索引，供检索 | 现有 `rb_sources.project_id` 区分项目资料；需要确认「不用数据库程序」指的是不做分类管理界面，而不是不建索引（推断，待所有者确认） |
| 项目里的知识可由专家、秘书整理后加入总知识库 | 共用工具：读图、写节点、写边、合并实体；改动直接生效并留版本 | 角色共用工具集已有；图工具没有 |
| 先调研成熟方案 | 本文 | — |

## 3. 候选方案对比

### 3.1 本地存储：图和向量

| 方案 | 许可证 | 成熟度与维护（2026-10） | Windows / Node | 对我们的成本 | 判断 |
|---|---|---|---|---|---|
| **SQLite 表 + 递归 CTE**（节点表、边表、JSON 属性） | SQLite 公有领域 | SQLite 官方支持递归 CTE，可做广度优先遍历 [R1]；同类开源做法有 simple-graph（节点、边各一张表，属性存 JSON）[R3] | 已在用 `node:sqlite` | 零新依赖；1–2 跳查询在几万条边的规模上够用（推断） | **推荐** |
| **sqlite-vec**（向量） | MIT 或 Apache-2.0 [R2] | 0.1.9，2026-03-31 发布，单一维护者，README 写明「pre-v1，可能有破坏性变化」[R2][R5]；支持元数据列和分区键 [R2] | 有 `sqlite-vec-windows-x64` 预编译包（npm 注册表） | 已在用（迁移 004） | **继续用**；风险是 pre-v1 |
| GraphQLite 等「SQLite 里跑 Cypher」的扩展 | MIT [R8] | 约 8 个月历史，Python、Rust 绑定，未见 Windows 和 Node 支持 [R8] | 不适配 | 要自己编译 | 不用 |
| **LadybugDB**（Kùzu 的社区分支） | MIT [R4] | Kùzu 在 2025-10-10 归档，最后版本 0.11.3 [R9]；Kùzu 公司被 Apple 收购 [R10]；LadybugDB 继续开发，npm `@ladybugdb/core` 0.21.2（2026-10-01），有 `core-win32-x64` 可选包（npm 注册表）；文档给出 `npm install @ladybugdb/core` [R4b] | 有 Windows x64 预编译（按 npm 元数据，未实测） | 第二个存储文件；数据要在两个库间同步；分支只有一年历史 | 不用；规模大到 CTE 吃力时再评估 |
| **DuckDB + DuckPGQ** | DuckDB 和 `@duckdb/node-api` 为 MIT（npm 注册表） | DuckPGQ 是 CWI 的研究项目扩展，页面写明「部分功能仍在开发」[R6] | 社区扩展在 Windows 上的可用性未核实 | 第二个数据库引擎 | 不用 |
| **LanceDB** | Apache-2.0 [R7] | `@lancedb/lancedb` 0.40.0（2026-10-07），支持 Windows x86_64 [R7] | 适配 | 第二个存储（列式文件目录）；只有向量，没有图 | 不用：sqlite-vec 在 3 万段规模已够（RESEARCH_BASE §3.2） |
| Neo4j、FalkorDB（Graphiti 的后端） | Graphiti 本身 Apache-2.0 [R20]；后端是独立服务器 [R19] | 成熟 | 需要单独进程 | 太重 | 不用 |

### 3.2 GraphRAG 类方法

| 方法 | 许可证 / 形态 | 怎么建图 | 怎么查 | 建索引成本（公开数据） | 能否本地跑、能借什么 |
|---|---|---|---|---|---|
| **Microsoft GraphRAG**（标准） | MIT，Python，PyPI 3.0.9 [R14] | 每个文本块用模型抽实体和关系，合并重复项并写摘要，可选抽取主张，再按社区写报告 [R11] | 局部查询、全局查询（遍历社区报告） | 有作者按微软默认配置推算：1 000 万 token 语料约 430 美元（抽取约 328 + 社区报告约 99）[R15]；全局查询一次 12 次调用、约 15 万 token [R16] | 太贵；社区报告的想法可用于「这个主题整体怎么说」 |
| **FastGraphRAG**（GraphRAG 的快速模式） | 同上 | 实体是用 NLTK 或 spaCy 抽的名词短语，关系是同一文本块里的共现，模型只写社区报告 [R11] | 同上 | 同一推算约 100 美元 [R15] | 「名词短语 + 共现」可借；但 NLTK 默认只适合英文 [R11]，中文要换方法 |
| **LazyGraphRAG** | 微软研究博客公布方法；未见独立开源实现 [R12] | 名词短语和共现构成概念图，用图统计分出层级社区；建索引阶段完全不用模型 [R12] | 查询时把问题拆成 3–5 个子问题，先按向量排文本块，再按社区逐级测试相关性，有预算参数控制成本 [R12] | 与向量 RAG 相同，约为完整 GraphRAG 的 0.1% [R12] | **思路最适合我们的派生层** |
| **LightRAG** | MIT，Python [R13] | 每块 1 200 token，模型抽实体（带类型、描述）和关系（带强度、关键词），gleaning 1 次 [R17]；支持增量插入，删除文档时用缓存重建受影响的实体 [R13] | local、global、hybrid、naive、mix 五种模式，默认 mix [R13]；检索阶段只需一次模型调用生成关键词 [R17] | 推算与 GraphRAG 抽取相近，约 330 美元 / 1 000 万 token [R15]；官方建议本地模型至少 Qwen3-30B-A3B 级别 [R13] | 抽取提示和「实体–关系都有描述」的结构可借（MIT）；按需对一个主题跑 |
| **MiniRAG** | Python；许可证未核实 [R18] | 文本块节点 + 实体节点的异构图，实体–块边带简短描述，设计目标是小模型也能抽 [R18] | 图上的启发式检索 | 论文称存储只需 LightRAG 的 25% [R18] | 「块节点 + 实体节点」的二部图结构可借 |
| **HippoRAG 2** | MIT，Python，2.0.0a5 [R21] | 对每段做 OpenIE（实体识别 + 三元组），存段落、实体、事实三种向量 [R21] | 以问题匹配到的实体为种子跑个性化 PageRank（PPR）[R21][R22] | 官方称离线索引资源显著少于 GraphRAG、LightRAG，未给金额 [R21] | **PPR 扩展可借**，在 Node 里几十行就能实现（推断） |
| **nano-graphrag** | 约 1 100 行 Python；许可证在页面上未写明 [R23] | GraphRAG 的精简复刻 | 同 GraphRAG | — | 只作阅读参考；**许可证需核实后才能借代码** |
| **Graphiti / Zep** | Apache-2.0 [R20] | 带有效时间和系统时间的事实边 | 余弦 + BM25 + 图遍历 | — | 「边有 valid_from / valid_to」已在备忘录 §1.2 采纳；后端要 Neo4j 或 FalkorDB [R19]，不用 |

查询成本的对比（有作者根据 GraphRAG-Bench 的配置统计，只算输入）：向量 RAG 每题约 879 token，GraphRAG 局部约 3.9 万，LightRAG 约 10 万，GraphRAG 全局约 33 万 [R15]。结论是：即使建图便宜，查询时把大量图描述塞给模型也很贵。我们的查询应当由图「挑段落」，最终交给模型的仍是原文段落和简短的路径说明，而不是整段实体描述。

### 3.3 同类研究工具怎样组织知识

| 产品 | 知识怎样建模 | 可借的点 | 不适合的点 |
|---|---|---|---|
| Zotero | 条目、合集、标签；「相关条目」只有无类型的 related 和合并产生的 sameAs，带类型的关系计划多年仍未实现 [R25] | 合集 + 标签已够管理文献；用户熟悉 | 无类型关系不够用；正说明我们的边需要类型和属性 |
| Obsidian | 笔记是节点，内部链接是边；全局图与局部图，局部图有深度滑块、按标签过滤、按搜索词分组着色 [R26] | **局部图 + 深度滑块 + 分组着色**直接照搬 | 原生链接无类型；插件 Juggl 加了「链接类型作为边标签」和工作区模式（固定、隐藏节点）[R28] |
| Logseq（数据库版） | 2026-07 发布 beta，数据以 SQLite 为准；标签可携带属性字段并可继承 [R29] | 「标签 = 类型，带属性模板」与我们的实体类型一致 | — |
| Tana | supertag 把节点变成有类型的对象，字段写在模板里，可以继承（extend）[R30] | 实体类型的属性模板（如「方法」带「提出年份、适用数据、实现语言」） | 概念复杂，界面不照搬 |
| Scholarcy | 从论文识别关键术语、主张、发现，生成摘要卡片 [R31] | 「每篇论文一张结构化卡片」= 我们的第二层 | 只做单篇，不连图 |
| Elicit | 2026-09-30 起「找论文、抽数据、和论文对话」并入 Research Agent；系统综述流程有筛选、抽取、PRISMA 报告 [R32] | 按列抽取（每篇论文填同一组字段）适合方法比较表 | 云端服务 |
| ResearchRabbit | 从任一论文找相似、更早、更晚的文献；可视化论文和作者网络；数据来自 Semantic Scholar、Crossref、OpenAlex [R35] | 「更早 / 更晚 / 相似」三个按钮 | 依赖在线数据库 |
| Connected Papers | 图不是引用树，而是按共被引和文献耦合算的相似度；节点大小 = 被引数，颜色深浅 = 年份，力导向布局 [R36] | 视觉编码（大小、颜色、年份）可用于文献子图 | 依赖 Semantic Scholar |
| InfraNodus | 词元为节点，4 词窗口内共现为边；按介数中心性定大小，按模块度分社区，找相距远的社区作为「结构空缺」，再让模型提研究问题 [R37] | **「结构空缺 → 让专家提问题」**很适合研究场景，且不需要模型建图 | 词级网络对长论文噪声大（推断） |

在线元数据：OpenAlex 单条查询免费、不限量，列表和搜索按日预算计费（免费 key 每天 1 美元额度）[R38]，可用来补引用边，但属于跨境流量，按 AGENTS 的下载规则只在用户点击时调用（推断的做法）。

### 3.4 图的显示与编辑库（需与 Preact 兼容：都是往一个 DOM 容器里画，不依赖 React）

体积为我从 npm 包里取出 min 文件实测，gzip 后数值；按需引入的 ESM 构建可能更小（推断）。

| 库 | 版本 / 发布 | 许可证 | min / gzip | 渲染 | 编辑能力 | 判断 |
|---|---|---|---|---|---|---|
| **Cytoscape.js** | 3.34.4，2026-10-15 | MIT | 436 KB / 137 KB | Canvas；3.31 起有 WebGL 预览，1 200 节点、1.6 万边时 WebGL 约 100 FPS、Canvas 约 20 FPS [R39] | 复合节点；扩展 edgehandles（拖线建边）、cxtmenu（环形菜单）、fcose 布局，都是 MIT（npm 注册表；edgehandles 最近一次发布 2021 年） | **推荐用于 alpha**：编辑优先、规模在几千元素以内 |
| **sigma.js + graphology** | sigma 4.0.3（4.0.0 于 2026-10-08 发布）；graphology 0.26.0 | MIT | sigma 392 KB / 103 KB；graphology 74 KB / 14 KB | WebGL 2；4.0 起标签也用 WebGL 绘制，原生支持平行边、自环、节点拖动 [R40] | 编辑要自己写；graphology 生态有 Louvain 社区、中心性、最短路径（均 MIT） | 适合以后的「全库语义地图」；4.0 刚发布、有破坏性变化 [R40]，不宜现在押注 |
| AntV G6 | 5.1.1，2026-05-08 | MIT | 1.38 MB / 391 KB | Canvas / WebGL | 内置交互多 | 体积最大 |
| force-graph | 1.52.0 | MIT | 173 KB / 56 KB | Canvas | 只读为主 | 编辑能力弱 |
| vis-network | 10.1.2 | Apache-2.0 或 MIT | npm 包 84 MB（含多种构建） | Canvas | 有内置编辑模式 | 包太大 |
| React Flow（`@xyflow/react`） | — | MIT | — | DOM | 节点编辑器 | 依赖 React，按简报排除；其框架无关核心 `@xyflow/system` 0.0.83 仍是 0.0.x |

图算法放在 Node 宿主里算（PPR、社区、中心性），用 graphology 的算法包或自己写；界面只负责画和编辑（推断的分工）。

### 3.5 嵌入模型（要求有 ModelScope 源，能在 CPU 上用 ONNX 跑）

| 模型 | 许可证 | 规模 / 维度 | 模态 | ModelScope | ONNX | 判断 |
|---|---|---|---|---|---|---|
| **multilingual-e5-small**（现用） | MIT | 118 MB int8，384 维（`models/default-embedding.json`） | 文本 | 有：`Xenova/multilingual-e5-small`，2026-10-12 已逐文件校验 SHA-256（`model-assets.js` 注释） | 有 | **alpha 继续用** |
| **EmbeddingGemma 2** | Apache-2.0（第一代是 Gemma 条款、需申请下载）[R27][R27b] | 共 740M：文本 270M、视觉 170M、音频 300M，可只加载需要的部分；768 维，可截到 512 / 256 / 128；上下文 8 192 [R27] | 文本、代码、图像、视频、音频同一空间 [R27] | **未确认**（ModelScope 搜索只见 Gemma 4 等，没见到它）[R41] | 发布资料列出 llama.cpp GGUF、LiteRT 等运行时，没提 ONNX [R27] | 多模态首选候选；alpha 后实测。注意不能用 fp16 推理 [R27][R42] |
| EmbeddingGemma（第一代 300M） | Gemma 条款 [R42] | 768 维 | 文本 | 未确认 | 有 `onnx-community/embeddinggemma-300m-ONNX`（q8、q4、fp32，可用 transformers.js）[R42]，但在 Hugging Face | **许可证不是 MIT/Apache，标记** |
| Qwen3-Embedding-0.6B | Apache-2.0 [R43] | 约 6 亿参数，维度 32–1024 可调，100+ 语言，含代码检索 [R43] | 文本、代码 | 有：`Qwen/Qwen3-Embedding-0.6B` 和 GGUF 版 [R44] | 社区 ONNX 版只在 Hugging Face（如 Qdrant 的转换）[R45] | 文本加代码的升级候选；约 5 倍于 e5-small 的参数，CPU 建索引会明显变慢（推断） |
| bge-m3 | MIT（同类模型规模见 RESEARCH_BASE §3.1） | 568M，1024 维 | 文本 | 有：`BAAI/bge-m3`，另有 GGUF 版 [R46] | 社区 ONNX 版在 Hugging Face [R47] | 质量好但重；内存约 1.4 GB 级（参照 e5-large 实测） |
| Qwen3-VL-Embedding-2B / 8B | Apache-2.0 [R48] | 2B 输出 2048 维 [R48] | 文本、图像、截图、视频 [R48] | 有 [R48] | 未提及 | 8 GB 内存的机器上 CPU 跑 2B 太慢（推断），不适合默认 |
| Chinese-CLIP | MIT [R49] | 多种尺寸 | 图文 | 未核实 | 未核实 | 只解决「以文搜图」，向量空间与文本模型不同，要单独一张向量表 |
| jina-clip-v2 | **CC BY-NC 4.0**（非商用）[R50] | 865M，1024 维 [R50] | 图文 | — | — | **许可证不合适，排除** |

## 4. 推荐的数据模型草图

原则：节点不另起一张「大一统」的表，**已有的记录本身就是节点**；新增的只有实体、边、标签和项目归属。端点统一写成引用字符串 `类型:id`，与现有引用格式和 `rb_vec_docs.ref_type/ref_id` 对齐。

### 4.1 节点

| 节点种类 | 存在哪里 | 新增或调整 |
|---|---|---|
| 文献（论文、书） | `rb_sources` kind=`paper` 等 | 无 |
| 网络资料、网址 | `rb_sources` kind=`webpage`、`link`（`link` 只存元数据，不抓正文） | 新 kind `link` |
| 本地文件（项目文件夹里的数据、过程文件） | `rb_sources`，`project_id` 不为空，`original_path` 指向文件 | 无；项目页按文件夹树显示 |
| 方法文档、提炼的知识、公式、主张、笔记 | `rb_items`（type = knowledge / model / claim / note） | 无 |
| 代码片段 | `rb_items` type=`code`，`payload_json`：language、code、repo_url、path、line_start、line_end、commit、license | 新 type；代码可用 web-tree-sitter（MIT，0.27.1）切函数级片段（推断的做法） |
| 实体（方法、方法变种、数据集、变量、指标、软件、概念、人物、机构） | **新表 `kb_entities`** | 见下 |
| 段落 | `rb_chunks` | 只作为证据端点，不在图上默认显示 |

```sql
CREATE TABLE kb_entities (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,              -- method / variant / dataset / variable / metric / software / concept / person / org
  name TEXT NOT NULL,
  name_en TEXT,                    -- 双语界面和跨语言检索
  aliases_json TEXT NOT NULL DEFAULT '[]',
  description TEXT NOT NULL DEFAULT '',
  attrs_json TEXT NOT NULL DEFAULT '{}',   -- 类型模板里的字段，如 method: {year, inventor, dataType}
  created_by TEXT NOT NULL,        -- user / participant id
  origin TEXT NOT NULL,            -- user / ai / derived
  status TEXT NOT NULL DEFAULT 'active',   -- active / merged / archived
  merged_into TEXT REFERENCES kb_entities(id),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
```

### 4.2 边

```sql
CREATE TABLE kb_edges (
  id TEXT PRIMARY KEY,
  from_ref TEXT NOT NULL,          -- 'source:…' / 'item:…' / 'entity:…' / 'chunk:…'
  to_ref TEXT NOT NULL,
  relation TEXT NOT NULL,          -- 见下表；允许自定义值
  attrs_json TEXT NOT NULL DEFAULT '{}',   -- 例：{"parameter":"一致性阈值 0.8","note":"…"}
  evidence_json TEXT NOT NULL DEFAULT '[]',-- [{ref:'chunk:…', quote:'…', page:4}]
  layer TEXT NOT NULL,             -- curated（用户或 AI 写入的）/ derived（可重算的索引）
  origin TEXT NOT NULL,            -- user / ai / citation / cooccur / similar
  confidence REAL,
  created_by TEXT NOT NULL,
  valid_from TEXT, valid_to TEXT,  -- 沿用备忘录 §1.2 的双时间思路
  status TEXT NOT NULL DEFAULT 'active',
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX kb_edges_from ON kb_edges(from_ref, relation, status);
CREATE INDEX kb_edges_to   ON kb_edges(to_ref, relation, status);

CREATE TABLE kb_labels (ref TEXT NOT NULL, label TEXT NOT NULL, PRIMARY KEY (ref, label));
CREATE TABLE kb_memberships (project_id TEXT NOT NULL REFERENCES projects(id), ref TEXT NOT NULL,
  added_by TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (project_id, ref));
```

建议的初始关系（中英双语名放在 i18n，库里存英文键）：`cites`、`proposes`（文献提出方法）、`implements`（代码实现方法）、`variant-of`（方法变种）、`uses`（研究使用方法、数据集、软件）、`compares`、`evaluates-on`、`describes`（方法文档描述方法）、`supports` / `contradicts` / `qualifies`（主张与证据）、`defines`、`part-of`、`same-as`、`derived-from`、`mentions`（派生）、`similar-to`（派生，向量近邻）、`co-occurs`（派生）。QCA 的例子：`entity:fsQCA` —`variant-of`→ `entity:QCA`；`source:Ragin 2008` —`proposes`→ `entity:fsQCA`；`item:code(R QCA 包的 truthTable 调用)` —`implements`→ `entity:fsQCA`，`attrs`：{language: "R", package: "QCA"}。

### 4.3 与现有表的对应和迁移

- **迁移 `020-knowledge-graph.js`**：建 `kb_entities`、`kb_edges`、`kb_labels`、`kb_memberships`；`rb_fts` 加入 `doc_type='entity'` 的行（实体名、别名、描述可被关键词检索）；`rb_vec_docs.ref_type` 接受 `entity`，实体描述也写向量。都是新增，不改旧列，回滚风险低。
- **历史版本**：图的写入走核心的 `revisions` 表（resource=`kb_entity` / `kb_edge`，before / after 存 JSON 快照，记录 actor、turn），一轮 AI 修改结束时按 `resource_snapshots` 的 `ai-turn-end` 规则留一个可恢复版本，与导图、计划的做法一致（DECISIONS 2026-10-07）。`rb_items` 继续用 `rb_revisions`。
- **派生层可以整层重算**：`layer='derived'` 的边随时删掉重建，不进历史版本，和 `rb_fts`、`rb_vec` 一样属于索引。
- **项目归属**：已有的项目资料（`rb_sources.project_id`）保持原样；从项目整理进总知识库的实体和条目，用 `kb_memberships` 记「它和哪个项目相关」，不复制（沿用 DECISIONS 2026-09-27「一个库、项目是视图」）。
- **向量维度**：`rb_vec` 固定 `FLOAT[384]`。将来换 768 维的模型要新建一张 vec0 表（vec0 的列维度是建表时定的），`model_id` 分区键继续区分版本。图像向量单独一张表。

### 4.4 工具（所有角色共用一套）

| 工具 | 作用 |
|---|---|
| `kb_graph {ref \| query, depth?, relations?, layers?}` | 取以某节点为中心的子图，或用检索结果作种子取子图；返回节点、边、路径说明 |
| `kb_write {entities?, edges?, labels?}` | 新建或修改实体、边、标签；直接生效，返回版本 id |
| `kb_merge {into, from[]}` | 合并重复实体，边改挂到目标实体，旧实体标 `merged` |
| `kb_remove {ref}` | 删除边或归档实体（可从历史版本恢复） |

参数不设数量上限（软边界原则）；返回结果过大时按页给出并说明「还有多少条」。

## 5. 构建与检索流程

### 5.1 导入与构图

1. **导入**（已有）：原件复制到 `library/originals/`，解析成段落，写 FTS 和向量。
2. **派生层（不调用模型，导入后自动）**：
   - 引用边：从参考文献段落解析 DOI、标题，和库里已有文献匹配，写 `cites`；用户点击时可用 OpenAlex 补全 [R38]。
   - 相似边：每篇文献取向量最近的 k 篇，写 `similar-to`（k 是排序参数，不是硬上限）。
   - 术语与共现：英文用规则抽名词短语（FastGraphRAG 的思路 [R11]），中文用 Node 自带的 `Intl.Segmenter` 分词 [R51] 加领域词表，统计同段共现，写 `co-occurs`。这一步效果对中文没有把握，需要实测（见 §7）。
   - 目录结构：项目文件夹里同一文件夹的文件、代码文件与同名数据文件，写 `part-of`。
3. **论文卡片（每篇一次便宜模型调用，后台空闲时跑，可在设置里关闭）**：输入标题、摘要、方法、结论等部分，输出 JSON：研究问题、方法（名称、变种、参数）、数据集、变量、指标、软件和代码链接、主要结论。先用名称、别名和向量相似度与已有实体对齐（Mem0 的「先检索相似再决定新增或合并」[备忘录 §1.1]），再写成 `origin='ai'` 的实体和边，带证据段落。
4. **深挖（按需）**：用户或智能体对一个主题（例如 QCA）要求「把相关文献逐段梳理」时，对选定文献逐块抽取（LightRAG 式 [R13][R17]），写入同一张图。
5. **主题摘要（可选，默认关闭）**：对实体图跑 Louvain 社区，用便宜模型为每个社区写一段摘要，用于「我的库里关于 X 整体怎么说」。

### 5.2 查询

1. 现有混合检索（向量为主、关键词为辅、中英文多问法）找到种子段落、条目和实体。
2. 从种子沿 curated 层扩展 1–2 跳，用个性化 PageRank 打分（HippoRAG 的做法 [R21]）；derived 层只用于召回候选，权重更低。
3. 用 RRF 融合后返回**原文段落和条目**，每条附一行路径说明（例如「经由：fsQCA → 由 R 包 QCA 实现」），不把大段实体描述塞进上下文，避免 LightRAG / GraphRAG 那种每题几万到几十万 token 的查询成本 [R15]。
4. 「结构空缺」：在实体图上找两个相距远、但都和当前项目相关的社区，交给专家提出研究问题（InfraNodus 的想法 [R37]）。

### 5.3 成本估算（推断，假设都写在这里）

假设：200 篇论文；每篇正文约 1.5 万 token（不含参考文献）；价格按 DeepSeek V4.1 Flash：输入 0.30 美元 / 百万 token，缓存命中输入 0.006，输出 1.20 [R24]。没有实测，误差可能在 2 倍以内。

| 步骤 | 调用次数 | 输入 token | 输出 token | 费用 |
|---|---|---|---|---|
| 派生层 | 0 | — | — | 0（只有本机嵌入的时间） |
| 论文卡片：每篇取约 6 000 token 正文 + 1 500 token 提示 | 200 | 150 万 | 20 万（每篇约 1 000） | 约 0.45 + 0.24 ≈ **0.7 美元**；提示前缀命中缓存后更低 |
| 深挖全库（每块 1 200 token，约 2 600 块；每块抽取一次加 gleaning 一次，每次提示约 1 500 token） | 约 5 200 | 约 1 600 万 | 约 260 万 | 约 4.7 + 3.1 ≈ **8 美元**；加上实体描述合并约 10%，合计 8–12 美元 |
| 主题摘要（假设 300 个社区，每个输入 8 000、输出 1 500） | 300 | 240 万 | 45 万 | 约 **1.3 美元** |
| 每次查询 | 0–1 次额外调用 | 与现在的 RAG 相近（数千 token） | — | 与现在相近 |

时间：论文卡片在并发 4、每次约 10 秒的假设下约 10 分钟；深挖全库约 3–4 小时（推断）。按 AGENTS 的要求，界面只显示结果和下一步（「已整理 186 篇，14 篇解析失败可重试」），不显示 token 计数。

## 6. 界面形态

- **知识库页**（原「数据库」页）：保留现有的表格视图（文献、条目、筛选、合集、标签），新增「图」视图；项目页里的「项目资料」改为文件夹树。
- **图视图**：
  - 以当前选中的节点为中心，深度滑块 1–3（Obsidian 局部图 [R26]）；按节点种类着色并带图标（Lucide），按标签分组高亮。
  - 文献子图用 Connected Papers 的视觉编码：节点大小 = 被引数，颜色深浅 = 年份 [R36]。
  - curated 层实线，derived 层虚线并标「自动」；AI 写入的节点和边带小标记，悬停显示是哪位专家、哪一轮、依据哪段原文。
  - 编辑：从节点拖线建边（edgehandles），选关系类型；右侧属性面板改实体字段、边属性、标签；合并实体时显示「把 B、C 合并到 A」的预览。所有改动立即保存，撤销 / 重做只在本次打开的页面内，离开后留历史版本（DECISIONS 2026-10-07）。
  - 右侧面板列出与选中节点相关的段落（证据），可直接打开原文预览。
- **对话中的入口**：回答里的引用标签旁边可以「在图中查看」；专家整理图之后，回答下方显示「本轮修改了知识库：新增 3 个实体、5 条关系」，点开即是变更列表和恢复按钮。
- **库健康**（沿用 KNOWLEDGE_GRAPH §6）：重复实体、孤立节点、缺证据的边、相互矛盾的主张；每项可一键交给秘书或全局助手处理。
- 说明文字放在「i」提示里；未完成的视图（例如全库语义地图）用功能开关隐藏，不显示「即将推出」。

## 7. 风险与待验证

| 风险 | 怎样验证 |
|---|---|
| 中文术语抽取（`Intl.Segmenter` + 词表）质量太差，派生层只剩噪声 | 取 10 篇中文、10 篇英文真实论文，人工标 50 个方法 / 变量名，看召回率；不行就把术语抽取并入论文卡片那一次模型调用 |
| 便宜模型抽出的实体名不一致（同一方法多种写法），图碎片化 | 论文卡片跑 30 篇，统计合并前后的实体数；对齐规则（别名 + 向量阈值）调到重复率可接受 |
| 图扩展没有提升检索效果，只增加复杂度 | 用 T10 / R4 的同一评测题集，比较「混合检索」和「混合检索 + PPR 扩展」的前 3 命中率；没有提升就把图只用于浏览和编辑 |
| sqlite-vec 仍是 pre-v1，升级可能有破坏性变化 [R2] | 锁定 0.1.9；升级前在 `.sciencescope-local/temp` 用旧库副本跑迁移与检索测试 |
| 递归 CTE 在边数增长后变慢 | 合成 5 万实体、50 万边的测试库，测 2 跳查询耗时；超过 300 ms 再考虑在宿主内存里缓存邻接表，或重新评估 LadybugDB |
| Cytoscape.js 在 125% 缩放和高 DPI 下的清晰度、2 000 节点时的帧率 | 在 Windows 上用真实库数据截图（100% / 125%），开 WebGL 预览对比 [R39] |
| edgehandles 等扩展多年未发版，可能与新版 Cytoscape 不兼容 | 先做一个最小原型：拖线建边、右键菜单、fcose 布局，在 3.34.4 上跑通 |
| EmbeddingGemma 2 没有 ONNX 版或 ModelScope 镜像 | alpha 后在 ModelScope 搜索；若只有 safetensors，自行用 Optimum 导出 ONNX 并在 Windows CPU 上测速度、内存（对照 e5-small）；导出模型要能从国内源分发 |
| 多模态模型的视觉部分在 8 GB 内存机器上太重 | 只加载文本 + 视觉（约 440M 参数 [R27]），测建索引时的进程内存；超过 1.5 GB 则图片检索做成可选下载 |
| 所有者说的「项目级不用数据库程序」理解有误 | 在设计稿里给出「项目页 = 文件夹树，文件仍建索引」的截图草图，请所有者确认 |
| 智能体直接改图可能把错误关系写进去，用户难以发现 | 「AI 添加」标记 + 每轮变更列表 + 证据必填（边没有证据时界面标黄）；用真实模型跑一次整理任务，人工抽查 30 条边的正确率 |
| nano-graphrag、MiniRAG 的许可证未核实 | 借代码前读仓库 LICENSE；目前只借思路 |

## 8. 参考资料

- [R1] SQLite WITH 子句（递归 CTE）：https://www.sqlite.org/lang_with.html
- [R2] sqlite-vec 仓库：https://github.com/asg017/sqlite-vec
- [R3] simple-graph（SQLite 图模式）：https://pypi.org/project/simple-graph-sqlite/
- [R4] LadybugDB（DBDB 条目）：https://dbdb.io/db/ladybugdb
- [R4b] LadybugDB 安装文档：https://docs.ladybugdb.com/installation
- [R5] sqlite-vec npm 概况：https://depscope.dev/pkg/npm/sqlite-vec
- [R6] DuckPGQ 社区扩展：https://duckdb.org/community_extensions/extensions/duckpgq
- [R7] LanceDB npm：https://npmjs.com/package/%40lancedb%2Flancedb
- [R8] GraphQLite：https://www.sourcepulse.org/projects/27495750
- [R9] Kùzu 归档与迁移：https://oneuptime.com/blog/post/2026-08-12-kuzu-archived-pin-0-11-3-fork-or-migrate/view
- [R10] Apple 收购 Kùzu：https://9to5mac.com/2026/02/11/kuzu-database-company-joins-apples-list-of-recent-acquisitions/ ；https://uwaterloo.ca/computer-science/news/waterloo-based-graph-database-start-up-kuzu-acquired-apple
- [R11] GraphRAG 索引方法（标准与 Fast）：https://mintlify.wiki/microsoft/graphrag/indexing/methods
- [R12] LazyGraphRAG：https://www.microsoft.com/en-us/research/blog/lazygraphrag/
- [R13] LightRAG 仓库：https://github.com/hkuds/lightrag
- [R14] graphrag（PyPI 概况）：https://depscope.dev/pkg/pypi/graphrag
- [R15] GraphRAG、LightRAG、LazyGraphRAG 成本对比（作者推算）：https://www.beri.net/article/graphrag-vs-vector-rag-indexing-query-cost-lightrag-lazygraphrag-2026
- [R16] GraphRAG 查询 token 实测：https://baeke.info/2024/07/11/
- [R17] LightRAG 论文：https://arxiv.org/abs/2410.05779 ；https://arxiv.org/html/2410.05779
- [R18] MiniRAG 论文：https://arxiv.org/html/2501.06713v1
- [R19] Graphiti 图数据库配置：https://help.getzep.com/graphiti/configuration/graph-db-configuration
- [R20] graphiti-core 许可证：https://mcp.depscope.dev/pkg/pypi/graphiti-core
- [R21] HippoRAG 仓库：https://github.com/osu-nlp-group/hipporag
- [R22] HippoRAG 论文：https://arxiv.org/abs/2405.14831 ；HippoRAG 2：https://arxiv.org/abs/2502.14802
- [R23] nano-graphrag：https://www.sourcepulse.org/projects/1827747
- [R24] DeepSeek V4.1 Flash 价格：https://opencode.ai/data/deepseek/deepseek-v4-1-flash.md ；https://anotherwrapper.com/llm-pricing/deepseek-v4.1-flash
- [R25] Zotero 相关条目的关系类型：https://forums.zotero.org/discussion/comment/311949/
- [R26] Obsidian 图谱视图：https://obsidian.md/help/plugins/graph
- [R27] EmbeddingGemma 2 介绍：https://www.eesel.ai/blog/embeddinggemma-2 ；https://vpsranking.com/news/ai/ai-2026-10-06-google-embeddinggemma-2/
- [R27b] EmbeddingGemma 2 本地部署：https://aireiter.com/pt/blog/embeddinggemma-2-api-local-deployment
- [R28] Juggl（Obsidian 插件）：https://forum.obsidian.md/t/juggl-out-now-1-0-1-a-completely-interactive-stylable-and-expandable-graph-view-plugin/9625/1
- [R29] Logseq 数据库版 FAQ（社区）：https://logseq.io/page/e87c7359-51f7-44fe-87b3-4a0cd9f2dee3/695feeec-88be-4c5b-8bf2-572513c2f730
- [R30] Tana supertag：https://outliner.tana.inc/learn/features/supertags
- [R31] Scholarcy：https://www.scholarcy.com/article-summarizer
- [R32] Elicit 工作流：https://support.elicit.com/en/articles/1418881
- [R33] Cytoscape.js（npm）：https://npmjs.com/package/cytoscape
- [R34] Cytoscape.js 3.31 发布：https://blog.js.cytoscape.org/2025/01/13/3.31.0-release/
- [R35] ResearchRabbit 新版：https://learn.researchrabbit.ai/en/articles/12440130-welcome-to-the-new-researchrabbit
- [R36] Connected Papers 说明（LMU 图书馆指南）：https://libguides.lmu.edu/AIresearchtools/CP
- [R37] InfraNodus 工作原理：https://infranodus.com/about/how-it-works
- [R38] OpenAlex 认证与额度：https://developers.openalex.org/api-reference/authentication
- [R39] Cytoscape.js WebGL 预览：https://blog.js.cytoscape.org/2025/01/13/webgl-preview/
- [R40] sigma.js 4.0.0 发布说明：https://newreleases.io/project/github/jacomyal/sigma.js/release/sigma@4.0.0
- [R41] ModelScope 模型库：https://www.modelscope.cn/models
- [R42] embeddinggemma-300m ONNX：https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX
- [R43] Qwen3-Embedding-0.6B 概况：https://dev.co/ai/llms/qwen3-embedding-0-6b
- [R44] Qwen3-Embedding-0.6B（ModelScope）：https://www.modelscope.cn/models/Qwen/Qwen3-Embedding-0.6B ；GGUF：https://www.modelscope.cn/models/Qwen/Qwen3-Embedding-0.6B-GGUF
- [R45] Qwen3-Embedding-0.6B ONNX（Hugging Face）：https://huggingface.co/Qdrant/Qwen3-Embedding-0.6B-onnx
- [R46] bge-m3（ModelScope）：https://www.modelscope.cn/models/BAAI/bge-m3 ；GGUF：https://modelscope.cn/models/ggml-org/bge-m3-Q8_0-GGUF
- [R47] bge-m3 ONNX（Hugging Face）：https://huggingface.co/onnx-community/bge-m3-ONNX
- [R48] Qwen3-VL-Embedding：https://github.com/QwenLM/Qwen3-VL-Embedding
- [R49] Chinese-CLIP：https://hellogithub.com/en/repository/OFA-Sys/Chinese-CLIP
- [R50] jina-clip-v2：https://jina.ai/models/jina-clip-v2/
- [R51] Intl.Segmenter（MDN）：https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Segmenter
- npm 注册表（版本、发布时间、许可证、可选平台包，2026-10-18 查询）：https://registry.npmjs.org/ 下的 sigma、graphology、cytoscape、@antv/g6、force-graph、vis-network、@xyflow/system、@ladybugdb/core、@lancedb/lancedb、sqlite-vec、@duckdb/node-api、kuzu、web-tree-sitter、cytoscape-edgehandles、cytoscape-fcose、cytoscape-cxtmenu、graphology-metrics、graphology-communities-louvain
