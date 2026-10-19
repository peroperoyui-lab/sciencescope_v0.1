# 知识库设计（RAG 加图，1.0.0-alpha）

- 起草：Claude，2026-10-18。状态：**已定稿**（2026-10-19 所有者认可 §12 全部推荐，并补充四条原则，见 §1a）。
- 依据：`research/KNOWLEDGE_BASE_RESEARCH.md`（本文照它的推荐落地，外部事实和来源见该文 §8）；`decisions/DECISIONS.md`（2026-10-18：alpha 包含知识库；项目页按文件夹树显示，文件照样解析和建索引；正式发布前不要求数据兼容；各角色补上数据库写入工具）；`product/FEATURES.md` §2.8–2.9、§4。核对的代码基线 `74ae483`。
- 取代：`KNOWLEDGE_GRAPH.md` 的「智能体整理先进收件箱」和「用 sigma.js 画图」（前者已被 DECISIONS 2026-10-05「修改直接生效并可撤销」取代）。`RESEARCH_BASE.md` 里的 `rb_links`、`rb_proposals` 只在旧线存在，本文不沿用。

## 0. 现状核对

| 事实                                                                                                                                                                   | 位置                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 迁移最高编号 020；任务书 A2-2 还要占一个号（删目标表），所以知识库迁移按现在的排队是 **022**，实现时取目录里实际最高号加一                                             | `app/core/db/migrations/index.js`、`plans/tasks/A2-2_*.md` |
| 资料 `rb_sources`（`project_id` 可空，11 种 `kind`，没有 `link`）；段落 `rb_chunks`（有 `reference` 类）；条目 `rb_items`（没有 `code` 类型）；条目修订 `rb_revisions` | 迁移 003、`research/store.js`、`items.js`                  |
| 导入一律复制原件到 `data/library/originals/`；项目文件夹里的文件**目前不解析入库**，项目页只列文件                                                                     | `research/index.js`、`services/project-files.js`           |
| 混合检索 = 向量（权重 1.0）+ 关键词（0.5）的 RRF；向量阶段超过 300 毫秒整次退回关键词                                                                                  | `search.js`、`semantic/hybrid.js`                          |
| 向量文档来自资料、段落、条目三处，`rb_vec` 固定 384 维；`research.changed` 触发增量重建                                                                                | `semantic/documents.js`、`semantic/index.js`               |
| `revisions` 和 `resource_snapshots` 以**文件为正本**：恢复要写回资源文件；`captureTurnSnapshots` 会把一轮里所有 `revisions` 行做成历史版本                             | `core/workspace/workspace.js`、`snapshots.js`              |
| 资料库工具只有 `research_search`、`research_read`，没有写入工具                                                                                                        | `services/tools.js`                                        |

由此得出一个约束：图的修改**不能写进 `revisions`**，否则 AI 一轮结束时会为它建一个找不到资源处理器的历史版本。图用自己的修订表和版本表，形状照抄 `revisions` 和 `resource_snapshots`（§3.6）。

## 1. 目标与范围

**alpha 做：**

1. 「数据库」页改成「知识库」：在资料、条目和混合检索之上，加实体、带属性和证据的边、标签、项目归属，有表格和图两种看法。
2. 三层构图：派生层（不调用模型）、论文卡片层（每篇一次便宜模型调用）、按需的主题深挖层。
3. 检索沿图扩展，交给模型的仍是原文段落，每条附一行「经由」路径。
4. 所有角色共用的图工具，修改直接生效、留历史版本，界面标出「AI 添加」。
5. 项目页按文件夹树显示项目文件夹，里面的**每个**文件都在 ScienceScope 的数据目录里留一份副本并建索引；能解析的解析，不能解析的退回到只记文件名和元数据（§4.1）。

**alpha 不做：** 不换存储（不引入图数据库、LanceDB、DuckDB）；不换嵌入模型，不做图像检索；不做全库语义地图、引用时间轴、主张台账、主题社区摘要（以后用功能开关接入，不留入口）；不做中文术语共现（调研 §7 第 1 条风险，术语抽取并入论文卡片）；不做在线元数据补全和 BibTeX；不做知识库的「先审后改」（§12）；不导入旧数据、不写兼容迁移。

## 1a. 所有者补充的原则（2026-10-19）

1. **记录谁建的边。** 每条 AI 写的边都能查到是哪位专家、在哪次对话的哪一轮、依据哪段原文（§3.2 `origin`、`created_by`、`meeting_id`、`turn_id`、`evidence_json`）。
2. **不强制解析，数据都存一份在 ScienceScope 里。** 项目文件夹里的文件不要求都能解析：能解析的照常分段和建索引；不能解析的退回到只记文件名、路径、类型和大小，向量照样用文件名和路径生成；无论能否解析，原件都复制一份到 `data/` 下（§4.1），防止项目文件夹被移动、改写或损坏后索引失效。
3. **知识库只存知识，不存数据，也不存模型自己的观点。** 节点和边只来自资料原文（带引文）或用户在对话里明确表达的观点和需求（引用那条消息）；模型自己的推断、评价、猜测不写进图。数据文件（表格、原始数据、代码输出）由用户在项目文件夹里管理，知识库只给它们建文件级索引，不从中抽实体。
4. **编辑台不进知识库；建边保守；检索控制深度。** 编辑台的文稿、版本、批注和来源绑定存在编辑台自己的表里，不成为图的节点或边（绑定可以引用知识库节点，反过来不行）；项目文件夹里的文稿作为文件照常建文件级索引，但不整理卡片、不抽实体。派生层只写高置信的边（§4.2），检索默认只沿图扩一跳，图带来的结果只占一小部分（§5）。

## 2. 用户怎么用

1. **导入论文，看卡片和关系。** 用户把 30 篇 PDF 拖进知识库页。几秒内表格里出现这些文献，状态「已解析」；随后后台逐篇整理卡片，状态变「已整理」。点开一篇，右侧面板显示卡片：研究问题、方法（如 fsQCA，一致性阈值 0.8）、数据、变量、软件、主要结论，每项带原文页码，点击打开预览并高亮。面板下半部分列出相连节点：它引用的库内文献、相似文献、它提出或使用的方法。页头只有一行结果，如「已整理 28 篇；2 篇是扫描件，没有文字」。
2. **问专家，看用到的节点和路径。** 用户问「我们的数据适合 fsQCA 还是 csQCA」。检索结果里有经图找到的段落，附「经由：csQCA —变种→ QCA ←变种— fsQCA」。回答照常用 `[S3 p.4]` 引用；「本轮用到的资料」可展开路径，点「在图中查看」打开局部图。
3. **手动改图。** 在图视图选中「fsQCA」，拖线到一段 R 代码条目，选关系「由…实现」，在侧栏填属性 `package: QCA`。合并「模糊集 QCA」到「fsQCA」时先显示「7 条关系将改挂」。改动立即保存；本页内可撤销、重做；离开后留一个历史版本。
4. **专家加边，标为 AI 添加。** 用户让方法专家整理 QCA 相关文献和代码。专家用 `kb_graph` 读子图，用 `kb_write` 新建 3 个实体、9 条带证据的边。回答末尾一行「本轮修改了知识库：新增 3 个实体、9 条关系」，可展开清单或「撤回这组修改」。图上这些边带「AI」角标，悬停显示哪位专家、哪次对话、依据哪段原文；用户改过后角标消失。
5. **项目文件夹树。** 项目页「项目资料」就是项目文件夹的树：`papers/`、`data/raw/`、`code/`……每个文件后一个状态点（已解析、解析中、仅索引文件名、失败）。用户在资源管理器里放进的新 PDF，下次进入项目页时自动解析入库；删掉的文件从索引消失。这里不做分类。
6. **找结构空缺**（alpha 可选）。在图视图点「找空缺」，系统列出当前项目里两个联系很少的实体群组（如「组态方法」和「纵向面板数据」）及代表节点；点「请专家提问题」，把两组节点和代表段落交给主专家提出研究问题。

## 3. 概念与数据模型

### 3.1 节点

已有记录本身就是节点，只新增实体表。端点统一写成引用 `类型:id`，与 `rb_vec_docs.ref_type/ref_id` 对齐。

| 节点                                                         | 存在哪里                                                     | 引用          | 改动                                                                       |
| ------------------------------------------------------------ | ------------------------------------------------------------ | ------------- | -------------------------------------------------------------------------- |
| 文献、网页、数据集、软件等                                   | `rb_sources`                                                 | `source:<id>` | `kind` 加 `link`（只存网址和元数据）                                       |
| 项目文件夹里的文件                                           | `rb_sources`，`project_id` 非空                              | `source:<id>` | 加列 `folder_path`，`original_path` 为空                                   |
| 知识、模型与公式、主张、笔记                                 | `rb_items`                                                   | `item:<id>`   | 无                                                                         |
| 代码片段                                                     | `rb_items` 类型 `code`（子类型 snippet / function / script） | `item:<id>`   | `payload`：language、code、repo、path、lineStart、lineEnd、commit、license |
| 实体：方法、变种、数据集、变量、指标、软件、概念、人物、机构 | 新表 `kb_entities`                                           | `entity:<id>` | 新增                                                                       |
| 段落                                                         | `rb_chunks`                                                  | `chunk:<id>`  | 只作证据端点，图上默认不画                                                 |

记忆（类型 `memory`）不进图，仍走记忆收件箱和项目简报。

### 3.2 边

- **关系**（存英文键，中英文名在 i18n）：`cites`、`proposes`、`implements`、`variant-of`、`uses`、`compares`、`evaluates-on`、`describes`、`supports`、`contradicts`、`qualifies`、`defines`、`part-of`、`same-as`、`derived-from`；派生层专用 `similar-to`、`in-folder`。允许自定义键，界面直接显示键名。
- **层** `layer`：
  - `derived`：不调用模型算出的（引用、相似、文件夹），是索引，可整层重算，不进修订和版本，画虚线。
  - `extracted`：论文卡片或主题深挖由模型抽出，带证据；重新整理该资料时被替换。
  - `curated`：用户或角色用工具直接写的。用户改动 `extracted` 的记录时它升为 `curated`，以后重新整理不再覆盖。
- **来源** `origin`：`user` / `ai` / `system`；`created_by` 记参与者，AI 另记 `meeting_id`、`turn_id`。「AI 添加」= `origin='ai'` 且之后没有用户修改。
- **证据** `evidence_json`：`[{ref:'chunk:…', quote, page}]` 或 `[{ref:'message:…', quote}]`（用户在对话里说的话）。提示要求 AI 写的边必须有其中一种依据，没有就不写（§1a 第 3 条，靠提示词引导，不做硬拦截）；界面仍把无证据的 AI 边标「缺证据」，便于用户删掉。
- **有效期** `valid_from` / `valid_to`：观点被推翻时写 `valid_to`，不删行。**状态** `active` / `removed`：删除只改状态，便于撤回。

### 3.3 标签、归属、范围

- 标签 `kb_labels(ref, label)`：节点和边（`edge:<id>`）都能打。资料原有的 `metadata.tags` 不动，界面合并显示；新标签一律写 `kb_labels`。
- 项目归属 `kb_memberships(project_id, ref)`：全局节点「与某项目相关」时记一行，不复制（DECISIONS 2026-09-27「一个库，项目是视图」）。
- **全局**：`project_id IS NULL` 的资料和条目，加全部实体。实体永远是全局的。
- **项目**：`project_id = 该项目` 的资料、条目（主要是项目文件夹里的文件），加归属到该项目的节点。边不分项目，有一端在项目范围内就在项目视图显示。专家默认检索当前项目并带上全局资料（与现有 `includePersonal` 默认一致）。「把项目知识整理进总知识库」= 建实体和边并记归属。
- 私有：`visibility='private'` 的条目和实体不给智能体。

### 3.4 新迁移

文件 `app/core/db/migrations/022-knowledge-base.js`（编号见 §0）。

```sql
CREATE TABLE kb_entities (
  id TEXT PRIMARY KEY,                -- ent_<uuid>
  kind TEXT NOT NULL,                 -- method / variant / dataset / variable / metric / software / concept / person / org，可自定义
  name TEXT NOT NULL, name_en TEXT,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  description TEXT NOT NULL DEFAULT '',
  attrs_json TEXT NOT NULL DEFAULT '{}',
  layer TEXT NOT NULL,                -- extracted / curated
  origin TEXT NOT NULL,               -- user / ai
  created_by TEXT NOT NULL, meeting_id TEXT, turn_id TEXT,
  visibility TEXT NOT NULL DEFAULT 'shared',
  status TEXT NOT NULL DEFAULT 'active',  -- active / merged / removed
  merged_into TEXT REFERENCES kb_entities(id),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX kb_entities_name ON kb_entities(name COLLATE NOCASE, status);
CREATE INDEX kb_entities_kind ON kb_entities(kind, status);

CREATE TABLE kb_edges (
  id TEXT PRIMARY KEY,                -- edg_<uuid>
  from_ref TEXT NOT NULL, to_ref TEXT NOT NULL,
  relation TEXT NOT NULL,
  attrs_json TEXT NOT NULL DEFAULT '{}',
  evidence_json TEXT NOT NULL DEFAULT '[]',
  layer TEXT NOT NULL,                -- derived / extracted / curated
  origin TEXT NOT NULL,               -- user / ai / system
  method TEXT,                        -- citation / similar / folder / card / topic
  produced_from TEXT,                 -- extracted 边来自哪份资料，重新整理时按它替换
  weight REAL,                        -- 相似度或模型置信度；curated 为空
  created_by TEXT NOT NULL, meeting_id TEXT, turn_id TEXT,
  valid_from TEXT, valid_to TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX kb_edges_from ON kb_edges(from_ref, status, relation);
CREATE INDEX kb_edges_to ON kb_edges(to_ref, status, relation);
CREATE INDEX kb_edges_produced ON kb_edges(produced_from, layer);
CREATE UNIQUE INDEX kb_edges_derived ON kb_edges(from_ref, to_ref, relation) WHERE layer = 'derived';

CREATE TABLE kb_labels (
  ref TEXT NOT NULL, label TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY (ref, label)
);
CREATE INDEX kb_labels_label ON kb_labels(label);

CREATE TABLE kb_memberships (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  ref TEXT NOT NULL, added_by TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, ref)
);
CREATE INDEX kb_memberships_ref ON kb_memberships(ref);

CREATE TABLE kb_versions (            -- 一组修改 = 一个历史版本
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,               -- ai-turn-end / leave-page / build / before-restore
  project_id TEXT, actor_id TEXT, meeting_id TEXT, turn_id TEXT,
  summary_json TEXT NOT NULL DEFAULT '{}',  -- 新增、修改、删除各几项
  description TEXT NOT NULL DEFAULT '',
  restored_by TEXT,                   -- 被撤回时指向撤回产生的版本
  created_at TEXT NOT NULL, closed_at TEXT
);
CREATE INDEX kb_versions_project ON kb_versions(project_id, created_at);
CREATE UNIQUE INDEX kb_versions_turn ON kb_versions(turn_id) WHERE turn_id IS NOT NULL;

CREATE TABLE kb_revisions (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES kb_versions(id) ON DELETE CASCADE,
  ref TEXT NOT NULL,                  -- entity:… / edge:… / label:<ref>#<label> / membership:<project>#<ref>
  op TEXT NOT NULL,                   -- create / update / remove / merge
  before_json TEXT, after_json TEXT,
  actor_id TEXT, created_at TEXT NOT NULL
);
CREATE INDEX kb_revisions_ref ON kb_revisions(ref, created_at);
CREATE INDEX kb_revisions_version ON kb_revisions(version_id);

CREATE TABLE kb_jobs (                -- 每份资料每层一行，界面状态从这里汇总
  source_id TEXT NOT NULL REFERENCES rb_sources(id) ON DELETE CASCADE,
  layer TEXT NOT NULL,                -- derived / card / topic
  topic TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL,                -- queued / running / done / failed / skipped
  content_version TEXT,               -- 做这一步时段落的哈希，变了就重做
  error TEXT, attempts INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
  PRIMARY KEY (source_id, layer, topic)
);

ALTER TABLE rb_sources ADD COLUMN folder_path TEXT;
CREATE UNIQUE INDEX rb_sources_folder ON rb_sources(project_id, folder_path) WHERE folder_path IS NOT NULL;
```

同一任务里的代码调整：`rb_fts` 写入 `doc_type='entity'` 行（名称、英文名、别名、描述）；`semantic/documents.js` 加实体作第四个来源（`ref_type='entity'`），`rb_vec` 不变；`store.js` 加 `link`，`items.js` 加 `code`。

### 3.5 删除

- 删除资料（新接口；`rb_sources` 现在不能删）：删记录、段落、FTS、向量和 `derived` 边；删 `produced_from` 指向它的 `extracted` 记录；指向它的 `curated` 边改 `removed` 并记修订；原件移到回收站。实体不随资料删除。
- 项目文件被删：扫描发现后同上。被移动（同一哈希出现在新路径）：只改 `folder_path`。
- 删除实体：改 `removed`，相连的非派生边一起改 `removed`，可撤回。

### 3.6 历史版本

- **逐条修订**：每改一个实体、边、标签或归属，同一事务写一行 `kb_revisions`。条目、资料元数据照旧走 `rb_revisions` 和 `rb_sources`。
- **版本 = 一组修改**，时机与工作区一致（DECISIONS 2026-10-07）：
  - AI：一轮发言第一次写图时打开 `ai-turn-end` 版本，发言结束时关闭。钩子放在现有 5 处调用 `captureTurnSnapshots` 的位置（`turn-runner.js`、秘书三处、`versions/organizer.js`），旁边加 `knowledge.closeTurn(turnId)`。
  - 用户：图视图打开时开编辑会话，离开且有修改时关闭为 `leave-page`。页内撤销、重做用会话自己的栈（同导图编辑器）。
  - 整理：一份资料的卡片或深挖结果是一个 `build` 版本，可整篇撤回。
- **撤回**：先把涉及记录的当前状态存为 `before-restore` 版本，再按修订倒序写回 `before_json`。某条记录在这个版本之后又被改过，就跳过并在结果里列出，界面显示「3 条之后又被修改过，未撤回」。撤回也能撤回。
- 节点详情按 `kb_revisions` 列单条历史，可「恢复到这一版」，同样先留 `before-restore`。`derived` 层不记修订。不设保留上限。

## 4. 构建流程

### 4.1 入库（已有，补项目文件夹）

- 全局导入照旧：复制原件、解析、写段落、FTS、向量。
- **项目文件夹索引**：扫描 `project.folder` 或 `data/projects/<目录>/`，为每个文件建或更新 `rb_sources`（`folder_path` 为相对路径），并把原件复制到 `data/library/project-files/<项目 id>/`（按内容哈希去重，同一内容只存一份；文件改动后新内容另存，旧副本随资料版本保留）。读取优先用项目文件夹里的现文件，找不到时用副本，界面标「原文件已不在项目文件夹」。不在项目文件夹里写任何管理文件（原则 1）。
- **解析的退路**（§1a 第 2 条）：解析器支持的格式照常分段、FTS、向量；不支持或解析失败的文件也建资料记录，状态「仅索引文件名」，用文件名、路径、类型、大小生成一条向量文档和 FTS 记录，专家能按名字找到它并知道它在哪。状态点区分「已解析」「仅索引文件名」「失败」。
- **副本占用磁盘**：项目里的大数据文件会让 `data/` 变大。设置页的存储一栏显示项目副本占用，并能清理「原文件已删除」的副本；不设大小上限（原则 4）。
- 扫描时机：进入项目页；应用内对项目文件新建、改名、添加、回收之后；用户点「重新扫描」。先比修改时间和大小，变了再算哈希，哈希变了才重解析。alpha 不用文件系统监听，避免 Windows 上的 EBUSY 和大目录开销。
- 跳过以 `.` 开头的目录、`node_modules`、`__pycache__`、`.venv`、`renv`。单文件超过 200 MB 不解析内容，退回「仅索引文件名」并写明大小，副本照样复制（解析上限是资源上限，会写明省略了什么，原则 4）。
- 项目页「导入」= 复制文件到当前打开的子文件夹，再按上面的规则索引（§12 第 2 条）。

### 4.2 第 1 层：派生（不调用模型）

资料解析完后自动排队，空闲时跑，发言进行中让路（同向量索引）：

1. **引用**：从 `reference` 段落和参考文献部分提取 DOI 和标题，与库里资料的 `metadata.doi` 精确匹配，或与归一化标题（小写、去标点空白）精确匹配，写 `cites`。只连库里已有文献，不建占位节点。
2. **相似**（保守，§1a 第 4 条）：每篇文献用资料级向量取最近 3 篇，余弦相似度 ≥ 0.85 才写 `similar-to`，`weight` 为相似度；只在文献之间建，不连数据文件和文稿。阈值是代码常量，KB-3 用样例库校准，宁缺不滥。没开本地混合检索时记 `skipped`，不报错。
3. **文件夹**：项目文件写 `in-folder` 到虚拟节点 `folder:<项目>/<路径>`，由路径即时生成，只在项目视图显示。

### 4.3 第 2 层：论文卡片

- **对象**：文献类资料（paper、preprint、thesis、report、chapter、book）和用户手动点「整理」的资料。数据文件、代码输出和编辑台文稿不整理卡片（§1a 第 3、4 条）。
- **模型**：设置 `knowledgeBase.cardModel`，未设时依次用记忆整理模型、秘书模型、对话模型（同 `memory.model` 的回退）。调用方式照记忆整理：后台会议加运行器，经运行时接口，输出 JSON（参照 `app/services/memory/request.js`）。
- **输入**：标题、元数据、摘要，加按章节名挑出的方法、数据、结果、结论段落，约 6 000 token；没有这些章节时取正文前部。这是挑选顺序，不是硬上限，短论文全给。
- **输出**：`{question, methods:[{name, variantOf?, parameters?, evidence}], datasets, variables, metrics, software, code, findings:[{text, evidence}]}`，每个 `evidence` 是原文引文。写入前核对引文确实在给出的段落里（记忆整理已有同样检查），对不上的项丢掉并记在任务结果里。
- **实体对齐**：先按名称或别名完全相同（忽略大小写和空白）找；找不到再用实体向量取最近 3 个，相似度 ≥ 0.92 且种类相同就并入并补别名；否则新建。阈值是代码常量，KB-6 调。
- **写入**：一份资料一个 `build` 版本。卡片存为 `rb_items`（`note` / `summary`，`payload.card`）；实体和边写 `extracted`、`origin='ai'`、`produced_from='source:<id>'`。方向：资料 →`proposes`/`uses`/`evaluates-on`→ 方法、数据集；变种 →`variant-of`→ 母方法；代码 →`implements`→ 方法。
- **开关**：`knowledgeBase.cards.enabled`（默认值见 §12 第 1 条）。关闭后仍可对单篇手动整理。

### 4.4 第 3 层：主题深挖（按需）

用户点「深挖这个主题」或角色调用 `kb_build {action:'topic'}` 触发。范围是主题实体一跳内的资料加混合检索前 20 篇，界面先显示篇数请用户确认。对选中资料逐块抽取（LightRAG 式提示结构，MIT，每块约 1 200 token，补抽一次），对齐规则同上，写 `extracted`、`method='topic'`。重复深挖时按 `content_version` 跳过没变的资料。

### 4.5 重建、失败与状态

- 资料重解析后段落哈希变化：派生层重算；卡片、深挖任务重排，重做时先删该资料产生的 `extracted` 记录（已升为 `curated` 的不动；被删实体若还有别的连接就保留）。换嵌入模型时相似边整层重算。
- 失败 `attempts` 加一；连续 3 次失败后不再自动重试，等用户点「重试失败的」。
- 一个知识库后台队列，与记忆整理、向量索引并列，模型任务并发 2，发言开始时暂停。事件 `knowledge.changed`（受影响的引用）和临时事件 `knowledge.jobs.changed`；图写入同时发 `research.changed`，让向量重建实体文档。
- 界面只说结果和下一步（原则 6）：进行中「正在整理 12 篇」；完成「已整理 186 篇；14 篇失败，可重试」；没配置模型「整理卡片需要先在设置里添加模型服务」加按钮。不显示 token、批次和百分比。每份资料一个状态标记，悬停看错误原文。

### 4.6 成本估算

假设（同调研 §5.3，推断、未实测，误差可能在 2 倍以内）：200 篇论文，每篇正文约 1.5 万 token；DeepSeek V4.1 Flash：输入 0.30 美元 / 百万 token，缓存命中 0.006，输出 1.20。

| 步骤                                       | 调用     | 费用                        | 时间（并发 2，每次约 10 秒）  |
| ------------------------------------------ | -------- | --------------------------- | ----------------------------- |
| 派生层                                     | 0        | 0                           | 每篇不到 1 秒，加本机嵌入时间 |
| 论文卡片（每篇约 7 500 输入、1 000 输出）  | 200      | 约 0.7 美元，缓存命中后更低 | 约 17 分钟                    |
| 一个主题深挖（约 20 篇、260 块，每块两次） | 约 520   | 约 0.8–1.2 美元             | 约 45 分钟                    |
| 全库深挖（不提供一键入口）                 | 约 5 200 | 约 8–12 美元                | 3–4 小时                      |
| 每次检索                                   | 0        | 不增加                      | 图扩展在本机，目标 100 毫秒内 |

KB-6 用 10 篇真实论文实测，按实测更新本表。

## 5. 检索流程

1. **种子**：现有 `research.search` 取前 20 条段落和条目；同一查询在 `rb_fts` 和向量里取前 5 个实体。
2. **扩展，第一版就用个性化 PageRank**：从种子（段落换成所属资料）默认只取 **1 跳**内的 `active` 边，调用者显式传 `graphDepth: 2` 才取 2 跳（§1a 第 4 条）；子图超过 2 000 个节点时按边权截取并在结果里写明。边权：`curated` 1.0、`extracted` 0.7、`derived` 0.3（`similar-to` 再乘相似度），过期边不参与。Node 里幂迭代，阻尼 0.5（HippoRAG 的取值），重启向量按种子名次分配，最多 30 次。比「只扩一跳」多处理了多路径汇聚，代码只有几十行，不加依赖。
3. **回到原文**：PPR 分数高的资料、条目、实体各取与查询最相关的段落（实体取其证据段落），与原始结果按 RRF 合并（图来源权重 0.5），总数仍按调用者的 `limit`，其中经图找到的结果默认不超过四分之一，其余仍是直接检索命中的原文。
4. **给模型的内容**：原文段落或条目正文，加引用标签和一行路径，如 `经由：fsQCA —由…实现→ [@a1b2c3d4]`。实体描述不整段塞进去，避免图式检索每题几万 token 的成本。
5. **引用**：格式不变（`[S3 p.4]`、`[@a1b2c3d4]`）；实体不能单独当引用，只作路径说明，保证「引用 = 可核查的原文」。结果的 `via` 字段供「本轮用到的资料」显示路径。
6. **降级**：图为空、出错或超过 300 毫秒，返回原始结果并写「本次未使用图扩展」。设置 `knowledgeBase.retrievalExpansion`（默认开）由检索读取。

## 6. 工具

所有角色共用（原则 2），加在 `TOOL_SPECS`。修改直接生效，记修订、归入本轮版本，结果返回 `versionId` 和改了什么。参数不设上限，结果大时分页并写明剩余数（原则 4）。

| 工具                                         | 参数                                                                                                                                                          | 结果                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `research_search`（扩展）                    | 原参数 + `graph?`                                                                                                                                             | 每条多 `via`、`origin`（search / graph）                                 |
| `research_read`（扩展）                      | `type` 加 `entity`                                                                                                                                            | 实体字段、别名、标签、相连边（分页）                                     |
| `research_write`（新，DECISIONS 2026-10-18） | `op`: createItem / updateItem / supersedeItem / updateSource / importUrl；`args`                                                                              | 记录与修订号；条目用现有 `rb_revisions`                                  |
| `kb_graph`                                   | `ref?` 或 `query?`、`depth?`（默认 1）、`relations?`、`layers?`、`projectId?`、`mode?`（neighborhood / gaps）、`limit`、`offset`                              | `{nodes, edges, paths?, remaining}`                                      |
| `kb_write`                                   | `ops[]`：createEntity、updateEntity、createEdge、updateEdge、remove {ref}、merge {into, from[]}、label {ref, add?, remove?}、member {projectId, ref, remove?} | 每项结果（新 id 或错误原因），整批一个 `versionId`；一项失败不影响其他项 |
| `kb_build`                                   | `action`: card {sourceIds} / topic {topic, sourceIds?} / status                                                                                               | 排队结果或汇总状态，不等待完成                                           |
| `workspace_versions`（扩展）                 | `resource` 加 `knowledge`                                                                                                                                     | 列出、读取知识库版本；restore 即撤回                                     |

**提示词指导**（写进共用工具说明）：用户没有明确要求整理或修改时不写图，回答问题时只读；写边必须附依据：资料原文引文，或用户在对话里明确说的话（引用那条消息）；不写自己的推断、评价和猜测，没有依据就不写；不从数据文件和编辑台文稿里抽实体；新建实体前先查同名和别名，有就复用或合并；关系优先从内置列表选；写完在回答里一两句说清改了什么；`derived` 层是线索不是结论，引用必须是原文。

## 7. 界面

界面由 Claude 设计和实现，先出设计稿给用户审（KB-8）。这里只定结构；全部用设计系统的令牌、`ss-` 组件和 Lucide 图标。

- **知识库页**（侧栏和页头改名，英文 Knowledge base；路由 `library` 是全局知识库）：页头有范围切换（全局 / 当前项目）、统一检索框、导入、状态行，右侧「表格 / 图」分段切换。
- **表格视图**：沿用现有标签页（文献与资料、知识、模型与公式、主张与证据、记忆、记忆收件箱、项目简报），新增「实体」「代码」。文献行加整理状态和关系数两列；漏斗筛选加「层」「AI 添加」。单击一行打开节点详情。
- **图视图**：局部图，左上是中心节点和深度（1 / 2 / 3，默认 1），右上是筛选（种类、关系、层、标签、只看 AI 添加）。节点按种类配色加图标，文献大小按库内被引数、深浅按年份；`curated` 实线，`extracted` 实线带圆点，`derived` 虚线；AI 添加的带「AI」角标。双击节点设为中心；未选中节点时显示当前范围连接最多的 30 个实体作入口，不画整库。
- **节点详情侧栏**（现有 `side-panel.js`）：标题和种类；可编辑字段；卡片（资料才有）；标签；按关系分组的相连列表，可删可改属性；证据列表，点开在文件预览里高亮；底部历史，可恢复。AI 写的项显示「由 方法专家 在《某对话》中添加」并能跳回消息。
- **编辑交互**：选中节点后拖手柄建边，松开弹关系菜单（可输入自定义键）；多选实体右键「合并到…」，先显示改挂边数；删除立即生效，状态行给「撤销」；Ctrl+Z / Ctrl+Shift+Z 只在本次页面内。回答下方「本轮修改了知识库」行：变更清单、在图中查看、撤回这组修改。
- **项目文件夹树**：项目页「项目资料」是现有 `project-folder.js` 的整页版，左树右预览（或文件夹统计）。文件后状态点（已解析、解析中、仅索引文件名、失败），悬停看原因；右键加「重新解析」「整理卡片」「在知识库图中查看」。顶部只有「导入到此文件夹」「新建文件夹」「重新扫描」，不做分类、标签、筛选。
- **绘图库**：Cytoscape.js 3.34.4（MIT，gzip 约 137 KB），扩展 `cytoscape-edgehandles` 和 `cytoscape-fcose`（都是 MIT）。从 npmmirror 安装，用已有的 esbuild 打进 `app/ui/vendor/`。选它是因为编辑扩展齐全、几千元素以内够用；sigma.js 留给以后的全库地图。图算法在 Node 宿主里算，界面只画和编辑。
- **空状态**：一句说明加一个下一步按钮（知识库为空：导入；图上没有边：说明整理完成后会出现，也可手动拖线；项目文件夹为空：打开文件夹、导入）。
- **文字**：层、PPR、AI 标记的解释放「i」提示；新字符串都加 `app/ui/i18n/en.js` 英文，关系和实体种类的中英文名放同一张表；用户和模型的内容不翻译；「找空缺」在开关打开前不显示。

## 8. 接口

新文件 `app/server/routes/knowledge.js`，都要口令；界面和工具共用同一个知识库服务。

| 方法与路径                                                                     | 作用                                                           |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `GET /api/knowledge/graph`                                                     | 子图（ref / query、depth、relations、layers、projectId、分页） |
| `GET/POST /api/knowledge/entities`                                             | 实体列表（projectId、kind、q、分页）、新建                     |
| `GET/PATCH/DELETE /api/knowledge/entities/:id`                                 | 读取（含相连边和证据）、修改、删除                             |
| `POST /api/knowledge/entities/merge`                                           | 合并 `{into, from[]}`                                          |
| `POST /api/knowledge/edges`；`PATCH/DELETE /api/knowledge/edges/:id`           | 新建、修改、删除边                                             |
| `POST /api/knowledge/labels`、`POST /api/knowledge/memberships`                | 加减标签、项目归属                                             |
| `POST /api/knowledge/session`、`POST /api/knowledge/session/:id/close`         | 图视图编辑会话开关（形成 leave-page 版本）                     |
| `GET /api/knowledge/versions`、`GET /api/knowledge/versions/:id`               | 版本列表（projectId、meetingId、turnId）、变更明细             |
| `POST /api/knowledge/versions/:id/restore`                                     | 撤回一组修改                                                   |
| `GET /api/knowledge/history?ref=`、`POST /api/knowledge/revisions/:id/restore` | 单条记录历史、恢复到某一版                                     |
| `GET/POST /api/knowledge/jobs`                                                 | 汇总状态与失败列表；`{action: card / topic / retry}`           |
| `GET /api/knowledge/gaps?projectId=`                                           | 结构空缺（功能开关后）                                         |
| `POST /api/projects/:id/index`                                                 | 重新扫描项目文件夹                                             |
| `GET /api/projects/:id/files`（扩展）                                          | 每项多 `index` 字段（状态、资料 id、错误）                     |
| `DELETE /api/research/sources/:id`（新）                                       | 删除资料（§3.5）                                               |

## 9. 嵌入模型

- **alpha 不换**：继续用 multilingual-e5-small（int8，384 维，MIT），下载、校验和退回关键词检索的逻辑不变；实体描述进同一张 `rb_vec`。
- **升级路径**（alpha 后）：新模型写自己的清单（id、版本、维度、逐文件 SHA-256，同 `model-assets.js`）；维度不同就用新迁移建新 vec0 表（如 `rb_vec_768`），`rb_vec_docs` 已有 `model_id`、`model_version`，新索引建好前旧向量继续用；换模型后相似边重算、对齐阈值重新校准。
- **候选**：文本加代码 Qwen3-Embedding-0.6B（Apache-2.0，ModelScope 有）；多模态等 EmbeddingGemma 2（Apache-2.0）在 ModelScope 出现可用权重后实测。
- **来源**：新模型只从 ModelScope 下载；没有 ModelScope 源的不进候选。

## 10. 分阶段与任务拆分

每条一份任务书，约 1–2 小时，超出就停下报告；每条在同一提交里更新 `product/FEATURES.md` 和实施日志。

| #     | 执行         | 内容                                                                                                                                                 | 完成标准                                                                                                                       | alpha 必需 |
| ----- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| KB-1  | Sol          | 迁移 + `app/services/knowledge/store.js`：实体、边、标签、归属增删改；修订和版本（开、关、撤回、单条恢复）                                           | 迁移测试；功能测试：建、改、删、撤回后回到原状，之后又被改的记录被跳过并列出                                                   | 是         |
| KB-2  | Sol          | 项目文件夹索引：扫描、`folder_path`、副本复制与去重、解析退路（仅索引文件名）、按哈希重解析、移动和删除、`/index` 接口、文件列表带状态；删除资料接口 | 测试：放入、修改、移动、删除文件后索引正确；不支持的格式能按文件名检索到；删掉原文件后副本仍可读；项目文件夹里没有应用写的文件 | 是         |
| KB-3  | Sol          | 派生层（引用、相似、文件夹）、`kb_jobs`、后台队列与让路、事件                                                                                        | 5 篇互引样例测出 `cites`；关闭混合检索时相似为 skipped                                                                         | 是         |
| KB-4  | Sol          | 工具 `kb_graph`、`kb_write`、`research_write`，`research_read` 支持实体，`workspace_versions` 支持知识库，发言结束关闭版本，工具说明                 | 脚本运行时：专家写实体和边后有一个 ai-turn-end 版本；真实模型（deepseek-v4.1-flash）跑场景 4，报告请求数和 token               | 是         |
| KB-5  | Sol          | `routes/knowledge.js` 与编辑会话                                                                                                                     | 路由测试覆盖一次完整编辑会话                                                                                                   | 是         |
| KB-6  | Sol          | 论文卡片：章节挑选、提示、引文核对、实体对齐、build 版本、设置与模型回退、重做替换                                                                   | 10 篇真实论文（中英各半）实测请求、token、费用、合并前后实体数；失败篇状态正确                                                 | 是         |
| KB-7  | Sol          | 检索扩展：CTE 子图、PPR、RRF、`via`、降级、设置                                                                                                      | 现有评测题加 10 道方法题比较前 3 命中；无提升则默认关闭并说明                                                                  | 是         |
| KB-8  | Claude       | 设计稿：知识库页（表格、图）、节点侧栏、编辑交互、项目文件夹树、空状态                                                                               | 用户认可；画廊加整页示例                                                                                                       | 是         |
| KB-9  | Claude       | 表格视图改造、节点详情侧栏、页面改名                                                                                                                 | 100% / 125% 截图，中英文                                                                                                       | 是         |
| KB-10 | Claude       | Cytoscape 打包；图视图：局部图、深度、筛选、拖线、合并、删除、页内撤销、AI 标记                                                                      | 先在 Windows 验证原型帧率和高 DPI；功能测试：建边后刷新仍在                                                                    | 是         |
| KB-11 | Claude       | 项目页文件夹树整页（状态点、右键、重新扫描）                                                                                                         | 截图；场景 5 走通                                                                                                              | 是         |
| KB-12 | Claude       | 对话侧：「本轮用到的资料」显示路径和在图中查看；「本轮修改了知识库」行与撤回                                                                         | 全新安装上场景 2、4 走通                                                                                                       | 是         |
| KB-13 | Sol          | 主题深挖（确认篇数、按版本跳过）                                                                                                                     | 一个主题 5 篇实测请求和 token                                                                                                  | 否（可选） |
| KB-14 | Sol + Claude | 结构空缺（Louvain 用 graphology，MIT）与「请专家提问题」，功能开关                                                                                   | 场景 6 走通                                                                                                                    | 否         |

顺序：KB-1 →（KB-2 ∥ KB-8）→ KB-3 → KB-4 → KB-5 → KB-9 → KB-6 → KB-10 → KB-11 → KB-7 → KB-12；KB-13、KB-14 视时间。

## 11. 风险与验证

| 风险                                        | 验证或对策                                                             |
| ------------------------------------------- | ---------------------------------------------------------------------- |
| 便宜模型抽出的实体名不一致，图碎片化        | KB-6 统计合并前后实体数并调阈值；「实体」标签按名称排序便于人工合并    |
| 引文核对丢弃太多，卡片空洞                  | KB-6 报告丢弃比例；超过三成就改提示要求逐字引用，或改为段落内模糊匹配  |
| 图扩展没有提升检索                          | KB-7 对比；无提升就默认关闭，图只用于浏览和编辑                        |
| 智能体写错关系，用户难发现                  | AI 标记、缺证据标记、每轮清单和撤回；KB-4 真实模型跑完人工抽查 20 条边 |
| 项目文件夹很大                              | KB-2 用 2 万文件合成目录测，超过 5 秒改后台扫描                        |
| 递归 CTE 随边数变慢                         | KB-7 用 5 万实体、50 万边测 2 跳，超过 300 毫秒改内存邻接表            |
| Cytoscape 扩展多年未发版，高 DPI 和帧率未知 | KB-10 先做原型并截图；不行就用 Cytoscape 事件自写拖线                  |
| 读取被占用的用户文件（Windows EBUSY）       | 沿用现有重试节奏；仍失败标「暂时无法读取」，下次扫描再试               |

## 12. 用户的决定（2026-10-19：五条都按推荐）

1. **论文卡片是否默认开启。** 推荐：默认开启，只对文献类资料；第一次整理前提示一次「将为 N 篇整理卡片，预计费用在 X 美元以内」，可在提示里关闭。理由：不开卡片，图上只有引用和相似边；每篇不到半美分。
2. **项目页「导入」是否复制进项目文件夹。** 推荐：是，复制到当前子文件夹再原地索引，项目不再有只存在于应用里的「项目资料」。理由：符合「项目级只按文件夹管理」，资源管理器里看到的就是全部。
3. **知识库要不要「先审后改」开关。** 推荐：alpha 不做，靠 AI 标记、每轮清单和撤回，用一段时间再定。理由：DECISIONS 2026-10-05 的开关默认关闭，收件箱式审核会让场景 4 多一步。
4. **全库深挖是否给一键入口。** 推荐：不给，只按主题深挖并先显示篇数。理由：全库一次 8–12 美元、3–4 小时。
5. **找结构空缺是否进 alpha。** 推荐：不进，放功能开关后。理由：依赖实体图有一定规模，alpha 先保证构图和检索可靠。
