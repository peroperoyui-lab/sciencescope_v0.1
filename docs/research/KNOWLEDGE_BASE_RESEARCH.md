# 知识库调研：RAG 加图知识库（1.0.0-alpha）

- Claude，2026-10-18。调研稿，不是设计定稿。
- 依据：IDEAS「知识库」「多模态嵌入」、KNOWLEDGE_GRAPH、RESEARCH_BASE、RESEARCH_MEMO_2026-09-25、DECISIONS、FEATURES §2.8，以及 `app/services/research/` 和迁移 003、004。
- 外部事实后附来源编号（见 §8）；标「推断」的是推算或判断，未实测；版本和日期是 2026-10-18 查询的结果。

## 1. 结论与推荐

1. **存储不换库**：图和向量都放在 `data/` 下现有的 SQLite 里。节点沿用 `rb_sources`、`rb_items`，新增实体表和带属性的边表；1–2 跳用递归 CTE [R1]，向量继续用 sqlite-vec [R2]。LadybugDB [R4]、DuckPGQ [R6]、LanceDB [R7] 都不引入：200 篇论文的规模用不上，多一个存储会破坏「一个文件、可备份、离开应用也能读」。
2. **构图分三层，按成本递增**：第一层「派生」完全不调用模型（引用、目录结构、向量近邻、术语共现，思路同 LazyGraphRAG [R12] 和 FastGraphRAG [R11]）；第二层「论文卡片」每篇论文一次便宜模型调用，抽取方法、数据、变量、代码、结论；第三层「逐段抽取」（LightRAG 式 [R13]）只在用户或智能体对某个主题要求深挖时才跑。
3. **成本**：按 200 篇、DeepSeek V4.1 Flash 的价格 [R24] 推算，第二层约 200 次调用、不到 1 美元；如果全量做第三层约 5 000 次调用、8–12 美元（推断，假设见 §5.3）。
4. **不内置 Python GraphRAG 框架**：GraphRAG、LightRAG、HippoRAG 都是 Python；在 Node 里重写需要的部分（抽取提示、实体合并、个性化 PageRank），注明借鉴来源和许可证（都是 MIT）。
5. **嵌入模型 alpha 不换**：继续用 multilingual-e5-small（ModelScope 源已在 2026-10-12 校验过哈希）。EmbeddingGemma 2（Apache-2.0，文本、代码、图像同一空间 [R27]）是多模态的首选候选，但 12 天前才发布，ONNX 版本和 ModelScope 镜像都没确认，放到 alpha 之后实测。
6. **界面**：知识库页加「图」视图，以当前节点为中心展开 1–2 跳，可以直接拖线建边、改属性；绘图建议用 Cytoscape.js（MIT，编辑扩展齐全 [R33][R34]），超大全局图以后再考虑 sigma.js。
7. **与旧设计的差别**：`KNOWLEDGE_GRAPH.md` 写的「智能体整理先进收件箱、人审核后提交」已被 DECISIONS 2026-10-05「所有修改直接生效并可撤销；可按资源打开先审后改，默认关闭」取代：智能体的改动直接生效、留历史版本，界面标出「AI 添加」；知识库也可按这条提供「先审后改」开关。

## 2. 需求拆解

| 所有者说的（IDEAS 2026-10-17、DECISIONS 2026-10-18） | 对应能力 | 现状 |
|---|---|---|
| 「数据库」改名「知识库」，是 RAG 加图知识库 | 在混合检索之外加实体、带属性的边、按图扩展的检索 | 检索已有；图没有（`rb_links` 只在旧线里） |
| 节点：文献、网络上的权威资料、本地模型抽取的方法文档、代码实现、方法的变种、本地文件和网址 | 节点类型可扩展，有属性和标签；代码片段记语言、仓库、路径、行号 | 文献、文件在 `rb_sources`，知识、模型、主张在 `rb_items`；网址、代码、方法变种没有类型 |
| 节点和边都有属性和标签 | 边要有属性、标签、证据、来源、置信度 | 无 |
| 例：QCA 相关的文献、方法文档、代码和变种连成一张图 | 以「方法」实体为中心的局部图 | 无 |
| 原「数据库」只做项目级，按文件夹管理项目自己的论文、原始和实验数据、过程文件、代码，不用数据库程序 | 项目页显示文件夹树，组织方式就是文件夹；文件仍可解析和建索引，供检索 | `rb_sources.project_id` 已区分项目资料；「不用数据库程序」理解为不做分类管理界面、仍建索引（用户 2026-10-18 确认） |
| 项目里的知识可由专家、秘书整理后加入总知识库 | 共用工具：读图、写节点、写边、合并实体；改动直接生效并留版本 | 角色共用工具集已有；图工具没有 |

## 3. 候选方案对比

### 3.1 本地存储：图和向量

| 方案 | 许可证 | 成熟度与维护（2026-10） | Windows / Node | 判断 |
|---|---|---|---|---|
| **SQLite 表 + 递归 CTE**（节点表、边表、JSON 属性） | 公有领域 | 官方支持递归 CTE，可做广度优先遍历 [R1]；同类做法 simple-graph：节点、边各一张表，属性存 JSON [R3] | 已在用 `node:sqlite` | **推荐**：零新依赖；几万条边做 1–2 跳够用（推断） |
| **sqlite-vec**（向量） | MIT 或 Apache-2.0 [R2] | 0.1.9（2026-03-31），单一维护者，README 写明 pre-v1、可能有破坏性变化；支持元数据列和分区键 [R2][R5] | 有 `sqlite-vec-windows-x64` 预编译包（npm） | **继续用**（迁移 004 已用） |
| **LadybugDB**（Kùzu 的社区分支，Cypher） | MIT [R4] | Kùzu 于 2025-10-10 归档，最后版本 0.11.3 [R9]，公司被 Apple 收购 [R10]；LadybugDB 继续开发，`@ladybugdb/core` 0.21.2（2026-10-01）[R4b] | npm 元数据有 win32-x64 预编译包，未实测 | 不用：第二个存储，要双写同步；规模大到 CTE 吃力时再评估 |
| **DuckDB + DuckPGQ** | DuckDB、`@duckdb/node-api` 为 MIT（npm） | DuckPGQ 是 CWI 研究项目，页面写明部分功能仍在开发 [R6] | 社区扩展在 Windows 上未核实 | 不用 |
| **LanceDB** | Apache-2.0 [R7] | `@lancedb/lancedb` 0.40.0（2026-10-07），支持 Windows x86_64 [R7] | 适配 | 不用：只有向量；sqlite-vec 在 3 万段规模已够 |

另看过：GraphQLite（MIT，在 SQLite 里跑 Cypher，只有 Python、Rust 绑定，未见 Windows [R8]）；Neo4j、FalkorDB（Graphiti 的后端，都是独立服务器 [R19]）。都不适合桌面内嵌。

### 3.2 GraphRAG 类方法（都是 Python，只借方法，不内置）

| 方法 | 许可证 | 建图与查询 | 成本（公开数据） | 可借的部分 |
|---|---|---|---|---|
| **GraphRAG 标准** | MIT，PyPI 3.0.9 [R14] | 每块用模型抽实体和关系、合并写摘要，再按社区写报告；局部查询和全局查询 [R11] | 有作者按默认配置推算：1 000 万 token 语料约 430 美元（抽取约 328，社区报告约 99）[R15]；一次全局查询 12 次调用、约 15 万 token [R16] | 社区报告用于「整体怎么说」 |
| **FastGraphRAG** | 同上 | 实体是 NLTK / spaCy 抽的名词短语，关系是同块共现，模型只写社区报告；NLTK 默认只适合英文 [R11] | 同一推算约 100 美元 [R15] | 名词短语 + 共现 |
| **LazyGraphRAG** | 只有方法公布，未见独立开源实现 [R12] | 名词短语共现图 + 层级社区，建索引不用模型；查询时拆 3–5 个子问题，按向量和社区逐级测相关性，有预算参数 [R12] | 建索引约为完整 GraphRAG 的 0.1% [R12] | **派生层的主要参照** |
| **LightRAG** | MIT [R13] | 每块 1 200 token 抽实体（类型、描述）和关系（强度、关键词），gleaning 1 次 [R17]；可增量插入和删除 [R13]；五种查询模式，默认 mix [R13] | 抽取成本与 GraphRAG 相近 [R15]；建议本地模型至少 Qwen3-30B-A3B 级 [R13] | 抽取提示与结构；按需深挖 |
| **MiniRAG** | 许可证未核实 [R18] | 块节点 + 实体节点的异构图，为小模型设计 [R18] | 称存储只需 LightRAG 的 25% [R18] | 二部图结构 |
| **HippoRAG 2** | MIT，2.0.0a5 [R21] | 每段 OpenIE 抽三元组，以问题实体为种子跑个性化 PageRank [R21][R22] | 称离线索引资源显著少于 GraphRAG、LightRAG，未给金额 [R21] | **PPR 扩展**，Node 里几十行可实现（推断） |
| nano-graphrag | 页面未写许可证 [R23] | GraphRAG 的约 1 100 行复刻 [R23] | — | 只作阅读参考 |
| Graphiti / Zep | Apache-2.0 [R20] | 带有效时间的事实边，后端 Neo4j / FalkorDB [R19] | — | valid_from / valid_to 已采纳 |

查询成本（GraphRAG-Bench 配置，只算输入）：向量 RAG 每题约 879 token，GraphRAG 局部约 3.9 万，LightRAG 约 10 万，GraphRAG 全局约 33 万 [R15]。所以我们的查询只让图「挑段落」，交给模型的仍是原文段落加一行路径说明。

### 3.3 同类研究工具怎样组织知识

| 产品 | 知识怎样建模 | 可借的点 |
|---|---|---|
| Zotero | 条目、合集、标签；相关条目只有无类型的 related 和合并产生的 sameAs，带类型关系多年未实现 [R25] | 合集 + 标签管理文献；也说明边需要类型 |
| Obsidian | 笔记是节点，链接是边；局部图有深度滑块、按标签过滤、按搜索词分组着色 [R26]；插件 Juggl 加了边类型标签和固定 / 隐藏节点的工作区 [R28] | **局部图 + 深度 + 分组着色** |
| Logseq 数据库版 | 2026-07 beta，以 SQLite 为准；标签带属性字段并可继承 [R29] | 标签 = 类型 + 属性模板 |
| Tana | supertag 让节点成为有类型的对象，字段在模板里，可继承 [R30] | 实体类型模板（「方法」带年份、适用数据、实现） |
| Scholarcy | 识别关键术语、主张、发现，生成摘要卡片 [R31] | 每篇一张结构化卡片 |
| Elicit | 2026-09-30 起找论文、抽数据并入 Research Agent；系统综述有筛选、抽取、PRISMA [R32] | 按列抽取，做方法比较表 |
| ResearchRabbit | 从任一论文找相似、更早、更晚的文献，看论文和作者网络；数据来自 Semantic Scholar、Crossref、OpenAlex [R35] | 三个按钮 |
| Connected Papers | 按共被引和文献耦合算相似度，不是引用树；节点大小 = 被引数，颜色深浅 = 年份 [R36] | 文献子图的视觉编码 |
| InfraNodus | 4 词窗口共现成网，按介数中心性定大小、按模块度分社区，找相距远的社区作「结构空缺」再让模型提问题 [R37] | **结构空缺 → 专家提研究问题**，不需模型建图 |

补充：OpenAlex 单条查询免费，列表和搜索按日预算计费 [R38]，可补引用边；属于跨境流量，只在用户点击时调用（推断的做法）。

### 3.4 图的显示与编辑库（都画在一个 DOM 容器里，可与 Preact 一起用）

体积是我从 npm 包取 min 文件实测的 gzip 值；ESM 按需引入可能更小（推断）。

| 库 | 版本 | 许可证 | min / gzip | 渲染与编辑 | 判断 |
|---|---|---|---|---|---|
| **Cytoscape.js** | 3.34.4（2026-10-15） | MIT | 436 / 137 KB | Canvas，3.31 起有 WebGL 预览：1 200 节点、1.6 万边时约 100 FPS（Canvas 约 20）[R39]；复合节点；扩展 edgehandles（拖线建边）、cxtmenu、fcose，均 MIT，edgehandles 上次发版 2021 年（npm） | **alpha 推荐**：编辑优先，几千元素以内 |
| **sigma.js + graphology** | sigma 4.0.3（4.0.0 发布于 2026-10-08）；graphology 0.26.0 | MIT | 392 / 103 KB；74 / 14 KB | WebGL 2，4.0 起标签也用 WebGL，原生平行边、自环、拖动 [R40]；编辑要自己写；graphology 有 Louvain、中心性等算法包 | 以后的全库地图；4.0 刚发布、有破坏性变化 [R40] |
| AntV G6 | 5.1.1 | MIT | 1.38 MB / 391 KB | 交互多 | 太大 |

另看过：force-graph 1.52.0（MIT，173 / 56 KB，编辑弱）；vis-network 10.1.2（Apache-2.0 或 MIT，npm 包 84 MB）；React Flow 依赖 React，按简报排除。图算法（PPR、社区、中心性）放在 Node 宿主里算，界面只画和编辑（推断的分工）。

### 3.5 嵌入模型（要求 ModelScope 有源，CPU 上用 ONNX 跑）

| 模型 | 许可证 | 规模 / 维度 | 模态 | ModelScope | ONNX | 判断 |
|---|---|---|---|---|---|---|
| **multilingual-e5-small**（现用） | MIT | 118 MB int8，384 维 | 文本 | 有，2026-10-12 已逐文件校验 SHA-256（`model-assets.js`） | 有 | **alpha 继续用** |
| **EmbeddingGemma 2** | Apache-2.0（第一代是 Gemma 条款）[R27] | 740M（文本 270M、视觉 170M、音频 300M，可只加载部分）；768 维，可截到 512 / 256 / 128；上下文 8 192 [R27] | 文本、代码、图像、视频、音频同一空间 [R27] | **未确认**，搜索只见 Gemma 4 [R41] | 发布资料列 GGUF、LiteRT 等，未提 ONNX [R27][R27b] | 多模态首选候选，alpha 后实测；不能用 fp16 [R27] |
| EmbeddingGemma 300M（第一代） | **Gemma 条款** [R42] | 768 维 | 文本 | 未确认 | 有，q8 / q4，可用 transformers.js，但在 Hugging Face [R42] | 许可证不宽松，标记 |
| Qwen3-Embedding-0.6B | Apache-2.0 [R43] | 约 6 亿参数，32–1024 维可调，100+ 语言，含代码检索 [R43] | 文本、代码 | 有，另有 GGUF [R44] | 社区转换版只在 Hugging Face [R45] | 文本 + 代码升级候选；参数约 5 倍于 e5-small，建索引明显变慢（推断） |
| bge-m3 | MIT（据模型卡，本次未重新核实） | 约 5.7 亿参数，1024 维（同上） | 文本 | 有，另有 GGUF [R46] | 社区版在 Hugging Face [R47] | 重，内存约 1.4 GB 级（参照 e5-large 实测） |

另看过：Qwen3-VL-Embedding 2B / 8B（Apache-2.0，ModelScope 有，2B 输出 2048 维 [R48]，8 GB 机器上 CPU 太慢，推断）；Chinese-CLIP（MIT [R49]，只能以文搜图，要单独向量表）；jina-clip-v2（**CC BY-NC 4.0**，865M [R50]，排除）。

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
  kind TEXT NOT NULL,              -- method / variant / dataset / variable / software / concept …
  name TEXT NOT NULL,
  name_en TEXT,                    -- 双语界面和跨语言检索
  aliases_json TEXT NOT NULL DEFAULT '[]',
  description TEXT NOT NULL DEFAULT '',
  attrs_json TEXT NOT NULL DEFAULT '{}',   -- 类型模板里的字段，如 method: {year, inventor, dataType}
  created_by TEXT NOT NULL,
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

初始关系（库里存英文键，中英文名放 i18n）：`cites`、`proposes`、`implements`、`variant-of`、`uses`、`compares`、`evaluates-on`、`describes`、`supports` / `contradicts` / `qualifies`、`defines`、`part-of`、`same-as`、`derived-from`；派生层用 `mentions`、`similar-to`、`co-occurs`。QCA 的例子：`entity:fsQCA` —`variant-of`→ `entity:QCA`；`source:Ragin 2008` —`proposes`→ `entity:fsQCA`；`item:code(R QCA 包的 truthTable 调用)` —`implements`→ `entity:fsQCA`，`attrs`：{language: "R", package: "QCA"}。

### 4.3 与现有表的对应和迁移

- **迁移 `021-knowledge-graph.js`（020 已被 `020-input-images.js` 占用）**：建 `kb_entities`、`kb_edges`、`kb_labels`、`kb_memberships`；`rb_fts` 加入 `doc_type='entity'` 的行（实体名、别名、描述可被关键词检索）；`rb_vec_docs.ref_type` 接受 `entity`，实体描述也写向量。都是新增，不改旧列，回滚风险低。
- **历史版本**：图的写入记入核心 `revisions` 表（before / after 存 JSON，记 actor、turn），一轮 AI 修改结束时按 `resource_snapshots` 的 `ai-turn-end` 留可恢复版本，与导图、计划一致（DECISIONS 2026-10-07）。
- **派生层可整层重算**：`layer='derived'` 的边和 `rb_fts`、`rb_vec` 一样是索引，不进历史版本。
- **项目归属**：项目资料（`rb_sources.project_id`）不变；整理进总知识库的实体和条目用 `kb_memberships` 记相关项目，不复制（DECISIONS 2026-09-27「一个库、项目是视图」）。
- **向量维度**：`rb_vec` 固定 `FLOAT[384]`，换 768 维模型要另建 vec0 表；图像向量单独一张表。

### 4.4 工具（所有角色共用一套）

| 工具 | 作用 |
|---|---|
| `kb_graph {ref \| query, depth?, relations?, layers?}` | 取以某节点为中心的子图，或用检索结果作种子取子图；返回节点、边、路径说明 |
| `kb_write {entities?, edges?, labels?}` | 新建或修改实体、边、标签；直接生效，返回版本 id |
| `kb_merge {into, from[]}` | 合并重复实体，边改挂到目标实体，旧实体标 `merged` |
| `kb_remove {ref}` | 删除边或归档实体（可从历史版本恢复） |

参数不设上限（软边界）；结果过大时分页并说明还有多少条。

## 5. 构建与检索流程

### 5.1 导入与构图

1. **导入**（已有）：复制原件、解析段落、写 FTS 和向量。
2. **派生层（不调用模型，导入后自动）**：
   - 引用边：从参考文献段落解析 DOI、标题，和库里已有文献匹配，写 `cites`；用户点击时可用 OpenAlex 补全 [R38]。
   - 相似边：每篇文献取向量最近的 k 篇，写 `similar-to`（k 是排序参数，不是硬上限）。
   - 术语与共现：英文用规则抽名词短语（FastGraphRAG 的思路 [R11]），中文用 Node 自带的 `Intl.Segmenter` 分词 [R51] 加领域词表，统计同段共现，写 `co-occurs`。这一步效果对中文没有把握，需要实测（见 §7）。
   - 目录结构：项目文件夹里同一文件夹的文件、代码文件与同名数据文件，写 `part-of`。
3. **论文卡片（每篇一次便宜模型调用，后台空闲时跑，可在设置里关闭）**：输入标题、摘要、方法、结论等部分，输出 JSON：研究问题、方法（名称、变种、参数）、数据集、变量、指标、软件和代码链接、主要结论。先用名称、别名和向量相似度与已有实体对齐（Mem0 的「先检索相似再决定新增或合并」，见 RESEARCH_MEMO §1.1），再写成 `origin='ai'` 的实体和边，带证据段落。
4. **深挖（按需）**：用户或智能体对一个主题（例如 QCA）要求「把相关文献逐段梳理」时，对选定文献逐块抽取（LightRAG 式 [R13][R17]），写入同一张图。
5. **主题摘要（可选，默认关闭）**：对实体图跑 Louvain 社区，用便宜模型为每个社区写一段摘要，用于「我的库里关于 X 整体怎么说」。

### 5.2 查询

1. 现有混合检索（向量为主、关键词为辅、中英文多问法）找到种子段落、条目和实体。
2. 从种子沿 curated 层扩展 1–2 跳，用个性化 PageRank 打分（HippoRAG 的做法 [R21]）；derived 层只用于召回候选，权重更低。
3. 用 RRF 融合后返回**原文段落和条目**，每条附一行路径说明（如「经由：fsQCA → 由 R 包 QCA 实现」），不塞大段实体描述，避免每题几万到几十万 token 的查询成本 [R15]。
4. 「结构空缺」：在实体图上找两个相距远、但都和当前项目相关的社区，交给专家提出研究问题（InfraNodus 的想法 [R37]）。

### 5.3 成本估算（推断，假设都写在这里）

假设：200 篇论文；每篇正文约 1.5 万 token（不含参考文献）；价格按 DeepSeek V4.1 Flash：输入 0.30 美元 / 百万 token，缓存命中输入 0.006，输出 1.20 [R24]。没有实测，误差可能在 2 倍以内。

| 步骤 | 调用次数 | 输入 token | 输出 token | 费用 |
|---|---|---|---|---|
| 派生层 | 0 | — | — | 0（只有本机嵌入的时间） |
| 论文卡片：每篇取约 6 000 token 正文 + 1 500 token 提示 | 200 | 150 万 | 20 万（每篇约 1 000） | 约 0.45 + 0.24 ≈ **0.7 美元**；提示前缀命中缓存后更低 |
| 深挖全库（每块 1 200 token，约 2 600 块；每块抽取一次加 gleaning 一次，每次提示约 1 500 token） | 约 5 200 | 约 1 600 万 | 约 260 万 | 约 4.7 + 3.1 ≈ **8 美元**；加上实体描述合并约 10%，合计 8–12 美元 |
| 主题摘要（假设 300 个社区，每个输入 8 000、输出 1 500） | 300 | 240 万 | 45 万 | 约 **1.3 美元** |
| 每次查询 | 0–1 次额外调用 | 与现在相近（数千 token） | — | 与现在相近 |

时间：论文卡片在并发 4、每次约 10 秒的假设下约 10 分钟；深挖全库约 3–4 小时（推断）。界面只显示结果和下一步（如「已整理 186 篇，14 篇解析失败可重试」），不显示 token 计数（AGENTS 原则 6）。

## 6. 界面形态

- **知识库页**（原「数据库」页）：保留现有的表格视图（文献、条目、筛选、合集、标签），新增「图」视图；项目页里的「项目资料」改为文件夹树。
- **图视图**：
  - 以当前选中的节点为中心，深度滑块 1–3（Obsidian 局部图 [R26]）；按节点种类着色并带图标（Lucide），按标签分组高亮。
  - 文献子图用 Connected Papers 的视觉编码：节点大小 = 被引数，颜色深浅 = 年份 [R36]。
  - curated 层实线，derived 层虚线标「自动」；AI 写入的带标记，悬停显示哪位专家、哪一轮、依据哪段原文。
  - 编辑：从节点拖线建边（edgehandles），选关系类型；右侧属性面板改实体字段、边属性、标签；合并实体时显示「把 B、C 合并到 A」的预览。所有改动立即保存，撤销 / 重做只在本次打开的页面内，离开后留历史版本（DECISIONS 2026-10-07）。
  - 右侧面板列出证据段落，可打开原文预览。
- **对话中的入口**：引用标签可「在图中查看」；专家改图后，回答下方显示「本轮修改了知识库：新增 3 个实体、5 条关系」，点开是变更列表和恢复按钮。
- **库健康**（KNOWLEDGE_GRAPH §6）：重复实体、孤立节点、缺证据的边、矛盾主张，可一键交给秘书或全局助手。
- 说明文字放在「i」提示里；未完成的视图（例如全库语义地图）用功能开关隐藏，不显示「即将推出」。

## 7. 风险与待验证

| 风险 | 怎样验证 |
|---|---|
| 中文术语抽取（`Intl.Segmenter` + 词表）质量太差，派生层只剩噪声 | 取 10 篇中文、10 篇英文真实论文，人工标 50 个方法 / 变量名，看召回率；不行就把术语抽取并入论文卡片那一次模型调用 |
| 便宜模型抽出的实体名不一致（同一方法多种写法），图碎片化 | 论文卡片跑 30 篇，统计合并前后的实体数；对齐规则（别名 + 向量阈值）调到重复率可接受 |
| 图扩展没有提升检索效果 | 用现有评测题集比较混合检索与加 PPR 扩展后的前 3 命中率；没提升就只把图用于浏览和编辑 |
| sqlite-vec 是 pre-v1 [R2] | 锁定 0.1.9；升级前用旧库副本跑迁移与检索测试 |
| 递归 CTE 在边数增长后变慢 | 合成 5 万实体、50 万边的库测 2 跳耗时；超过 300 ms 再考虑内存邻接表或 LadybugDB |
| Cytoscape.js 的扩展多年未发版、高 DPI 清晰度和 2 000 节点帧率未知 | 最小原型（拖线建边、右键菜单、fcose）在 3.34.4 上跑通，Windows 100% / 125% 截图，对比 WebGL 预览 [R39] |
| EmbeddingGemma 2 没有 ONNX 或 ModelScope 镜像；视觉部分在 8 GB 机器上太重 | alpha 后查 ModelScope；没有就自行导出 ONNX，只加载文本 + 视觉（约 440M [R27]），在 Windows CPU 上对照 e5-small 测速度和内存；超过 1.5 GB 则图片检索做成可选下载 |
| 「项目级不用数据库程序」理解有误 | 设计稿给出「项目页 = 文件夹树，文件仍建索引」草图，请所有者确认 |
| 智能体直接写入错误关系，用户难发现 | 「AI 添加」标记、每轮变更列表、缺证据的边标黄；用真实模型跑一次整理，人工抽查 30 条边 |
| nano-graphrag、MiniRAG 的许可证未核实 | 借代码前读仓库 LICENSE；目前只借思路 |

## 8. 参考资料

- [R1] https://www.sqlite.org/lang_with.html
- [R2] https://github.com/asg017/sqlite-vec
- [R3] https://pypi.org/project/simple-graph-sqlite/
- [R4] https://dbdb.io/db/ladybugdb ；[R4b] https://docs.ladybugdb.com/installation
- [R5] https://depscope.dev/pkg/npm/sqlite-vec
- [R6] https://duckdb.org/community_extensions/extensions/duckpgq
- [R7] https://npmjs.com/package/%40lancedb%2Flancedb
- [R8] https://www.sourcepulse.org/projects/27495750
- [R9] https://oneuptime.com/blog/post/2026-08-12-kuzu-archived-pin-0-11-3-fork-or-migrate/view
- [R10] https://9to5mac.com/2026/02/11/kuzu-database-company-joins-apples-list-of-recent-acquisitions/ ；https://uwaterloo.ca/computer-science/news/waterloo-based-graph-database-start-up-kuzu-acquired-apple
- [R11] https://mintlify.wiki/microsoft/graphrag/indexing/methods
- [R12] https://www.microsoft.com/en-us/research/blog/lazygraphrag/
- [R13] https://github.com/hkuds/lightrag
- [R14] https://depscope.dev/pkg/pypi/graphrag
- [R15] https://www.beri.net/article/graphrag-vs-vector-rag-indexing-query-cost-lightrag-lazygraphrag-2026
- [R16] https://baeke.info/2024/07/11/
- [R17] https://arxiv.org/abs/2410.05779 ；https://arxiv.org/html/2410.05779
- [R18] https://arxiv.org/html/2501.06713v1
- [R19] https://help.getzep.com/graphiti/configuration/graph-db-configuration
- [R20] https://mcp.depscope.dev/pkg/pypi/graphiti-core
- [R21] https://github.com/osu-nlp-group/hipporag
- [R22] https://arxiv.org/abs/2405.14831 ；https://arxiv.org/abs/2502.14802
- [R23] https://www.sourcepulse.org/projects/1827747
- [R24] https://opencode.ai/data/deepseek/deepseek-v4-1-flash.md ；https://anotherwrapper.com/llm-pricing/deepseek-v4.1-flash
- [R25] https://forums.zotero.org/discussion/comment/311949/
- [R26] https://obsidian.md/help/plugins/graph
- [R27] https://www.eesel.ai/blog/embeddinggemma-2 ；https://vpsranking.com/news/ai/ai-2026-10-06-google-embeddinggemma-2/ ；[R27b] https://aireiter.com/pt/blog/embeddinggemma-2-api-local-deployment
- [R28] https://forum.obsidian.md/t/juggl-out-now-1-0-1-a-completely-interactive-stylable-and-expandable-graph-view-plugin/9625/1
- [R29] https://logseq.io/page/e87c7359-51f7-44fe-87b3-4a0cd9f2dee3/695feeec-88be-4c5b-8bf2-572513c2f730
- [R30] https://outliner.tana.inc/learn/features/supertags
- [R31] https://www.scholarcy.com/article-summarizer
- [R32] https://support.elicit.com/en/articles/1418881
- [R33] https://npmjs.com/package/cytoscape
- [R34] https://blog.js.cytoscape.org/2025/01/13/3.31.0-release/
- [R35] https://learn.researchrabbit.ai/en/articles/12440130-welcome-to-the-new-researchrabbit
- [R36] https://libguides.lmu.edu/AIresearchtools/CP
- [R37] https://infranodus.com/about/how-it-works
- [R38] https://developers.openalex.org/api-reference/authentication
- [R39] https://blog.js.cytoscape.org/2025/01/13/webgl-preview/
- [R40] https://newreleases.io/project/github/jacomyal/sigma.js/release/sigma@4.0.0
- [R41] https://www.modelscope.cn/models
- [R42] https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX
- [R43] https://dev.co/ai/llms/qwen3-embedding-0-6b
- [R44] https://www.modelscope.cn/models/Qwen/Qwen3-Embedding-0.6B ；https://www.modelscope.cn/models/Qwen/Qwen3-Embedding-0.6B-GGUF
- [R45] https://huggingface.co/Qdrant/Qwen3-Embedding-0.6B-onnx
- [R46] https://www.modelscope.cn/models/BAAI/bge-m3 ；https://modelscope.cn/models/ggml-org/bge-m3-Q8_0-GGUF
- [R47] https://huggingface.co/onnx-community/bge-m3-ONNX
- [R48] https://github.com/QwenLM/Qwen3-VL-Embedding
- [R49] https://hellogithub.com/en/repository/OFA-Sys/Chinese-CLIP
- [R50] https://jina.ai/models/jina-clip-v2/
- [R51] https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Segmenter
- npm 注册表（版本、日期、许可证、平台包，2026-10-18 查询）：https://registry.npmjs.org/ （sigma、graphology、cytoscape 及其扩展、@antv/g6、force-graph、vis-network、@ladybugdb/core、@lancedb/lancedb、sqlite-vec、@duckdb/node-api、kuzu、web-tree-sitter）
