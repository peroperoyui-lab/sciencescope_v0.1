# ScienceScope 研究备忘：长期记忆、研究数据库、检索、文档解析与应用内浏览器

- 日期：2026-09-25；性质：调研备忘，不是实现记录，也不改变 SYSTEM_SPEC 中任何功能的状态。
- 核实方式标记：**[网]** = 本次联网或本机实测核实；**[知]** = 依据既有知识，本次未能联网核实（arxiv.org、mem0.ai、crossref.org 被出口代理拦截，论文细节多数属此类）；**[测]** = 在本机 Node v22.22.2 实测。
- 结论优先级：先给可落地的建议，再给依据。不确定处直接写明。

---

## 1. LLM 智能体长期记忆

### 1.1 系统与研究逐项

| 系统 | 核心机制 | 可借鉴 | 应避免 |
|---|---|---|---|
| **MemGPT / Letta** [知+网] | 把上下文当"内存"：核心记忆（常驻）、recall（完整消息历史，可检索）、archival（向量库）；由智能体自己调用函数换入换出。Letta 用带标签和字符上限的 memory block；sleep-time agent 在后台共享并改写主智能体的 block [网] | 带字符上限、有标签的常驻块（如"项目目标""约定"）；空闲时后台整理 | 让主模型在每轮对话里自己管理分页，便宜模型做不稳；不要为每个历史对话常驻一个智能体进程（与 AGENTS.md 一致） |
| **Mem0** [知] | 两阶段：先从"会话摘要 + 最近消息"中抽取候选事实，再为每条候选检索 top-k 相似记忆，由 LLM 选择 ADD/UPDATE/DELETE/NOOP。图变体 Mem0ᵍ 抽取实体和关系三元组，冲突时把旧关系标为过时 | 抽取→对照→四选一的整合流程；"标记过时"而非物理删除 | 让模型静默 DELETE；LoCoMo 上的领先数字是厂商自报，别当作选型依据 |
| **Zep / Graphiti** [网] | 双时间知识图：每条事实边同时记录有效时间（valid_at/invalid_at，事实在现实中何时成立）和事务时间（created_at/expired_at，系统何时得知）；新信息让旧边失效但不删除，可查询"当时为真"。检索结合余弦、BM25 与图遍历，再做重排 [知] | **研究场景最值得借鉴**：假设被推翻、参数被修正、结论被撤回都需要"曾经为真"的记录 | 依赖 Neo4j/FalkorDB 等图数据库，本地桌面端太重；用 SQLite 表加 valid/expired 列即可 |
| **A-MEM** [知] | Zettelkasten 式：每条记忆是一张笔记（内容、关键词、标签、上下文描述、向量），写入时由 LLM 连接邻居，并"演化"更新邻居的描述 | 写入时建立显式链接；链接即可解释性 | 自动改写既有笔记会破坏出处，研究场景不能接受无痕改写 |
| **Generative Agents** [知] | 记忆流；检索分数 = 近因（指数衰减）+ 重要性（LLM 打 1–10 分）+ 相关性（余弦）；重要性累计超过阈值就触发反思，生成更高层的洞见 | 三因子打分做注入排序；反思就是"周期性综述" | 反思结论要标为"推断"，并链接到它依据的记忆 |
| **MemoryBank** [知] | 艾宾浩斯遗忘曲线 R=e^(−t/S)，被回忆一次 S 就增大 | 用 last_used_at/use_count 做排序衰减 | 研究记录不应被"遗忘删除"，只降低注入优先级 |
| **HippoRAG / HippoRAG 2** [知] | 用 OpenIE 三元组建图，以查询实体为种子跑 Personalized PageRank 做多跳检索；v2 加入段落节点、查询到三元组的匹配和 LLM 识别过滤，事实类问答也不退化 | 多跳（"A 方法 → B 数据集 → C 结论"）适合放在第二阶段 | 建索引要对每段调用 LLM，成本随文献量线性增长 |
| **GraphRAG / LightRAG** [知] | GraphRAG：抽取实体和关系，Leiden 社区划分，生成社区摘要，支持全局与局部查询，建索引很贵；LightRAG：低层和高层两级关键词检索，支持增量更新，更便宜 | "项目全局综述"类问题可用社区摘要 | 不作为默认管线；更新时重算社区的成本高 |
| **CoALA** [知] | 分类：工作记忆 / 情景 / 语义 / 程序；动作分为内部（检索、推理、学习）和外部 | 作为本项目的记忆类型词汇 | — |
| **Anthropic memory tool** [网] | 类型 `memory_20250818`；客户端执行 `/memories` 目录下的 view/create/str_replace/insert/delete/rename；API 会自动注入"先查看记忆目录"的协议；官方强调防路径穿越、限制文件大小、过期清理，建议配合 context editing 与 compaction | "记忆即文件"：用户可读、可编辑、可 diff；按需读取（just-in-time）而不是一次全量注入 | 我们用的是 OpenAI 兼容的廉价模型，没有这个内置工具；要在 DSH 中注册同语义的自定义工具，并做严格的路径校验 |
| **Claude / ChatGPT 产品记忆** [知] | 用户可见、可编辑、可删除；ChatGPT 区分"已保存记忆"和"参考聊天历史"；Claude 的记忆按项目隔离，并有无痕对话 | 用户可见可编辑、按项目隔离、可关闭 | 不透明的自动画像 |
| **LangMem** [知] | 语义/情景/程序三类；"热路径"写入与后台 memory manager 两种方式；程序记忆通过优化提示实现 | 后台整理与热路径分离 | 引入 LangChain 生态与 DSH 重复 |
| **Cognee** [知] | ECL 管线（extract–cognify–load），图加向量，可挂本体 | 本体约束抽取 | Python 服务依赖重 |
| **程序记忆/技能** [知] | Voyager 技能库、Agent Workflow Memory、ReasoningBank（从成败中提炼策略）、Anthropic Agent Skills（SKILL.md 渐进披露） | 把"检索文献的方法""某审稿偏好"沉淀为可审阅的技能文件，按角色和项目挂载 | 自动改写技能且没有版本 |
| **基准** | LoCoMo（ACL 2024）、LongMemEval（ICLR 2025，500 题，含知识更新、时间推理、拒答）[网]；MemoryAgentBench（ICLR 2026，考察准确检索、测试时学习、长程理解、冲突消解）[网]；BEAM（1M/10M token）[网] | 用其题型自建小型项目评测集 | 追榜 |
| **2026 值得关注** [网，仅检索到标题] | "Beyond Memory Leaderboards: Evaluating Scientific Memory as Budgeted Context Restoration"（arXiv 2607.16848，把科研记忆定义为"在预算内恢复上下文"，与我们的注入预算直接相关）；"Hidden in Memory: Sleeper Memory Poisoning"（2605.15338，记忆投毒）；MemOps、MemTrapBench 等生命周期/陷阱类基准 | 投毒风险：来自网页或文献的内容写入记忆前必须标为"外部"并经用户确认 | 未读全文，不引用具体数字 |

### 1.2 综合建议：研究项目工作站的记忆设计

1. **边界**：记忆 ≠ 知识库。论文中的主张、公式、证据放进研究数据库（§2）；记忆只存"关于这个人和这个项目的工作状态"：目标、约定与偏好、决策及理由、被否定的路线、未决问题、阶段进度，并通过外键链接到研究库条目。
2. **类型（CoALA）**：`profile`（全局偏好）、`project`（语义：目标、约定、决策）、`episode`（会话摘要，指向 DSH 历史 ID，不复制全文）、`procedure`（技能/工作流，按专家角色挂载）、`insight`（反思产物，必须标为推断）。
3. **作用域**：global / project / chat / expert-role。各专家历史互相独立，但共享 project 记忆；角色私有的程序记忆只注入该角色。
4. **出处**：每条记忆必须带 `source_refs`（消息 ID、文献段落锚点、URL）、`author`（user / 哪位专家 / 整理任务）、`origin_trust`（user / model / external）。
5. **时间与替代（Graphiti 式）**：`valid_from/valid_to`（研究事实何时成立）+ `recorded_at/retired_at`（系统何时得知、何时失效）+ `supersedes_id`。不物理删除（用户明确要求删除时除外），默认只注入当前有效的版本。
6. **用户确认**：抽取结果先成为 `proposed`；低风险类型（进度）可自动确认，但在 UI 中留下可撤销记录；决策、偏好以及来自外部内容的记忆必须由用户确认。提供可编辑的记忆面板，并可导出为 `memory/*.md`（"记忆即文件"视图；数据库是真源）。
7. **注入预算**：固定块（置顶的目标和约定）≤ 约 1.5k tokens；检索块 ≤ 约 2k tokens；每条带 ID，模型引用时写 ID。其余通过 `memory.search` / `memory.read` 工具按需取用。预算与 DSH 当前上下文压力联动（与上下文环一致）。
8. **检索排序**：混合检索（§3）召回，再按"相关性 + 置顶/类型权重 + 近因衰减（last_used_at）"加权；已失效的版本只在时间类问题中返回。
9. **整合**：turn 结束后由廉价模型抽取候选，按 Mem0 流程对照 top-k 相似记忆，决定 ADD/UPDATE(=supersede)/NOOP；空闲时的整理任务（sleep-time）负责去重、发现冲突并生成阶段综述，全部以提案形式交给用户。整理任务归应用宿主调度，不常驻进程。
10. **评测**：自建 30–50 题的项目评测集，覆盖知识更新、时间推理、跨会话、拒答（LongMemEval 题型）；上线后追踪注入命中率、用户驳回率和冲突数。只有针对 fixture 的测试，不能算验收真实提供商的效果。

---

## 2. 科研知识管理参考与 schema 借鉴

- **Zotero** [知]：item（itemType + 字段 + creators）/ attachment / note / collection / tag / relation；本地 `zotero.sqlite`；交换格式用 CSL-JSON；Better BibTeX 提供稳定 citekey（按公式生成，可"钉住"，存在 Extra 字段）。**借鉴**：文献元数据直接采用 CSL-JSON 字段名（`type, title, author[], issued, DOI, URL, container-title`），另设稳定 `citekey`；导入/导出用 `@citation-js/core`（MIT）[知]。
- **Elicit / Consensus / Scite** [知]：Elicit 按用户定义的列抽取数据，每格附原文引句；Consensus 汇总是/否倾向；Scite 把引用分为 supporting / contrasting / mentioning。**借鉴**：证据要细到"句子/段落锚点"，并给出立场极性。
- **NotebookLM** [知]：只基于用户上传的来源作答，行内引用可跳转到段落。**借鉴**：回答中的引用必须能跳转到 PDF 高亮位置（§4 锚点）。
- **Obsidian / Logseq** [知]：wikilink 和反向链接，块级引用。**借鉴**：所有实体（文献、主张、模型、记忆）可用 `[[id]]` 互链，并由反链表自动维护。
- **ORKG** [知]：论文 → contribution（研究问题、方法、材料、结果等属性）→ 可比较表；有模板。**借鉴**：每篇文献可有多个 contribution，按"研究问题"横向比较。
- **Nanopublication** [知]：assertion / provenance / publication-info 三个命名图，加上 trusty URI。**Micropublication**（Clark 2014）：claim 与 support/challenge 构成图。**SEPIO**：assertion ← evidence line ← evidence item，外加 provenance。**Toulmin**：claim、grounds、warrant、backing、qualifier、rebuttal。
- **电子实验记录本**：只追加、带时间戳和签名；修改留下版本。

**建议的"主张–证据账本"最小 schema**（SQLite）：
- `claim(id, project_id, text, qualifier, status[proposed|accepted|disputed|retracted], valid_from, valid_to, supersedes_id, created_by, created_at)`
- `evidence(id, claim_id, polarity[supports|contradicts|qualifies], kind[passage|data|experiment|derivation|model_output], source_id, anchor_json, quote, warrant, strength, created_by)`；`anchor_json` 采用 W3C Web Annotation 的 TextQuoteSelector + TextPositionSelector + PDF 页码/矩形。
- `claim_link(from, to, rel[depends_on|generalizes|conflicts_with])`。
- 区分"文献声称"与"本项目认为"：accepted 只能由用户设置；专家产出的主张默认 proposed。

**理论模型 / 公式 / 算法**：
- `model(id, name, kind[theory|equation_system|statistical|algorithm], statement_md, assumptions[], domain_of_validity, source_refs, version, supersedes_id)`
- `formula(id, model_id, latex, label, derivation_from[], notes)`，渲染用 KaTeX；可选保存 SymPy 可解析形式（放到二期）。
- `variable(id, model_id, symbol_latex, meaning, unit(UCUM), dimension, type, range)`：可借鉴 MaRDI MathModDB（数学模型、量、公式、任务）的思路 [知，不确定其现状]。
- `algorithm(id, model_id, pseudocode, inputs, outputs, complexity, impl_url, lang)`。
- 这些都挂到 claim/evidence 上，例如"模型 M 在假设 A 下预测 X"就是一条 claim，其证据类型为 derivation。

---

## 3. 检索

- **混合检索 + RRF** [知]：FTS5 bm25 与向量 KNN 各取 top-50，用 RRF(k=60) 融合；实现简单，不需要调权重。
- **Contextual Retrieval**（Anthropic, 2024）[知]：为每个 chunk 生成 50–100 token 的上下文前缀，再同时进 BM25 和向量索引；报告 top-20 检索失败率降低 49%，加重排后降低 67%。用廉价模型生成前缀即可，在导入文献时批量完成，结果缓存。
- **Late chunking**（Jina, 2024）[知]：需要长上下文嵌入模型；jina-embeddings-v3 权重为 CC-BY-NC，**商用许可有风险**，暂不采用。
- **重排** [知]：bge-reranker-v2-m3（约 568M，Apache-2.0）在 CPU 上较慢；可改为用廉价 LLM 对 top-20 做列表式重排（这属于模型调用，允许联网）。
- **中文分词** [测]：Node 22.22.2 内置 SQLite 3.51.2，FTS5 的 `trigram` 分词器可用，中文子串 MATCH 命中；trigram 对 1–2 字查询不起作用，需要回退到 `LIKE`（trigram 索引可加速 LIKE）。`unicode61` 会把连续汉字当作一个词，**不可用于中文**。零依赖的分词方案：`Intl.Segmenter('zh',{granularity:'word'})` 实测分词为"长期 记忆 系统 用于 科研 项目 的 知识 管理"；可把分词结果以空格连接存入影子列，用 unicode61 建索引，查询端做同样的分词。备选：`@node-rs/jieba` 2.0.3（MIT，原生 napi）；wangfenjin/simple（jieba 分词的 FTS5 扩展，需要自行分发 Windows DLL）[知]。
- **sqlite-vec** [网+测]：0.1.9，MIT/Apache 双许可，仍处于 v1 之前（会有破坏性变更）；npm 包含 `sqlite-vec-windows-x64`。**在 node:sqlite 中实测可用**：`new DatabaseSync(p,{allowExtension:true}); db.loadExtension(sqliteVec.getLoadablePath())`，vec0 的 KNN 查询正常。坑：rowid 必须以 BigInt 绑定（`1n`），否则报 "Only integers are allows for primary key"；向量可传 JSON 字符串或 Float32Array 字节。`loadExtension` 自 Node 22.13 起提供 [网]。vec0 是暴力搜索，十万级向量在 CPU 上足够用。**安全**：加载完扩展后调用 `enableLoadExtension(false)`。打包时注意 Tauri 资源路径和签名。
- **本地嵌入** [知]：`@huggingface/transformers` 4.3.0 [网]（在 Node 中使用 onnxruntime-node 1.30.0 [网]）。候选：bge-m3（约 568M，1024 维，8k 上下文，MIT，int8 ONNX 约 0.6GB，CPU 上每 512-token chunk 约百毫秒级，**估算未实测**）；multilingual-e5-small（约 118M，384 维，MIT，快 5 倍左右）；Qwen3-Embedding-0.6B（Apache-2.0）。首次下载模型必须由用户显式触发，并存放在应用数据目录下。
- **分阶段路径**：S1 FTS5 trigram + Intl.Segmenter 影子列 + LIKE 回退（离线、零模型）→ S2 sqlite-vec + multilingual-e5-small，用 RRF 融合，嵌入在后台增量计算 → S3 导入时生成 contextual 前缀 + LLM 重排 → S4 按需做 HippoRAG 式实体图多跳检索。每个阶段用 §1.2 的评测集衡量召回率后再推进。

---

## 4. 文档解析与显示（JS 优先、CPU 即可）

| 用途 | 包（npm 版本，均为 [网] 本日 npm view） | 许可 | 备注 |
|---|---|---|---|
| PDF 显示 | `pdfjs-dist` 6.3.289 | Apache-2.0 | 使用 `web/pdf_viewer` 组件（PDFViewer、EventBus、FindController）加文本层；内置高亮编辑器 [知]。高亮用"页码 + 引文选择器 + PDF 坐标矩形"持久化，不依赖 DOM |
| PDF 备选 | `@embedpdf/core` 2.15.1 | MIT | 基于 PDFium WASM；框架无关性需核实 [知] |
| PDF 高亮组件 | `react-pdf-highlighter` 8.0.0-rc.0 | MIT | 依赖 React，与 `desktop/*.mjs` 原生栈不合，只参考其数据模型 |
| PDF 结构抽取（可选外部服务） | GROBID | Apache-2.0 | Java，CPU 可跑，TEI 输出页眉和参考文献，最适合抽取引用 [知] |
| | Docling | MIT | Python，CPU 可跑 [知] |
| | Marker | **代码 GPL-3.0，权重有商用收入限制** | 避免内置 [知] |
| | MinerU | 早期为 AGPL-3.0，据称 2025 年改为自定许可 | **需复核** [知] |
| | PyMuPDF | **AGPL-3.0** | 避免 [知] |
| | Nougat | 权重 CC-BY-NC | 避免 [知] |
| OCR | tesseract.js | Apache-2.0 | 扫描件兜底 [知] |
| DOCX | `mammoth` 1.12.3（语义 HTML）/ `docx-preview` 0.4.1（版式还原） | BSD-2 / Apache-2.0 | 两者都要经过 DOMPurify |
| Markdown | `marked` 18.0.14 + DOMPurify | MIT | marked 不做消毒 |
| 数学 | `katex` 0.18.9（MathJax 4 为 Apache-2.0，作备选） | MIT | |
| 代码高亮 | `highlight.js` 11.12.0（轻）/ `shiki` 4.4.3（重，质量高） | BSD-3 / MIT | 桌面端建议先用 highlight.js |
| LaTeX 源码 | `latex.js` 0.12.6 只支持子集渲染；源码查看用 CodeMirror 6（`@codemirror/view` 6.43.13 + `@codemirror/legacy-modes` 6.5.4 的 stex） | MIT | `codemirror-lang-latex` 0.6.1 的许可未核实 |
| 纯文本/代码 | CodeMirror 6 只读模式（EditorState.readOnly） | MIT | |
| EPUB | `epubjs` 0.3.93（维护慢）/ foliate-js（MIT，npm 1.0.1 是否为官方发布**未核实**） | BSD-2 / MIT | 低优先级 |

所有新增模块都要同步进桌面 HTTP 资源白名单，并通过生产路由测试传递导入（AGENTS.md 规定）。

---

## 5. Tauri 2 应用内浏览器

- **隔离** [知]：远程内容放在独立的 `WebviewWindow`（例如 label `browser-*`），**不在任何 capability 中列出它的 label，也不配置 `remote.urls`**，这样远程页面无法调用任何命令；不向这个窗口注入全局 Tauri 对象；独立的数据目录或 incognito；用 `on_navigation` 拒绝 `file:`、`tauri:`、自定义协议和本地回环地址（防止远程页面访问 localhost 宿主 API，宿主 API 还应校验 Origin 和 token）；关闭 DevTools 和浏览器右键菜单；下载一律经过宿主确认。Tauri 当前版本：`@tauri-apps/api` 2.11.1 [网]。
- **阅读模式/保存来源**：推荐由 Node 宿主按 URL 重新抓取，用 `@mozilla/readability` 0.6.0 + `linkedom` 0.18.13 [网] 抽取正文，再经 DOMPurify 净化后存入 `source`（原始 HTML 快照、正文、抓取时间、URL、内容哈希）。缺点是登录页和 JS 渲染页取不到内容；要"保存所见"必须给远程窗口开一条通道，这会扩大攻击面，建议放到后期，并只允许宿主单向发起调用 [知，需做方案验证]。
- **引用元数据**：按优先级读取 `citation_*`（Highwire：title/author/doi/pdf_url/date）→ JSON-LD `ScholarlyArticle` → Dublin Core `DC.*` / `prism.doi` → COinS；DOI 正则 `10.\d{4,9}/[-._;()/:A-Z0-9]+`（不区分大小写）；arXiv ID 另外识别。Zotero translators 和 translation-server 为 **AGPL-3.0**，只借鉴思路，或作为用户自行运行的外部服务 [知]。
- **外部 API 与礼貌访问**：
  - Crossref：请求带 `mailto` 或在 User-Agent 中写联系邮箱即进入 polite 池；2025-12-01 调整过限额，2026-07 又有更新，具体数值**未能核实**（crossref.org 被拦截）[网，部分]。
  - OpenAlex：**自 2026-02-13 起必须提供 API key**（免费）；每天有 1 美元的免费额度，单条查询免费，list 类约 1 万次/天，超过 100 次/秒会收到 429 [网]。key 由用户在设置中填写，不进入被跟踪的文件。
  - Semantic Scholar：带 key 的入门限额为 1 次/秒；无 key 时使用共享池，易被限流 [网]。
  - arXiv API：约每 3 秒 1 个请求，单连接 [知]。
  - Unpaywall：用 `?email=` 参数，每天 10 万次，用于找开放获取 PDF [网]。
  - 全部走宿主侧的每主机令牌桶，带缓存（以 DOI 为键）和指数退避；失败要如实报告，不当作"服务不可用"的证据。

---

## 参考文献（URL）

- Anthropic memory tool：https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool
- Anthropic Contextual Retrieval：https://www.anthropic.com/news/contextual-retrieval
- Anthropic 长时智能体 harness：https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- MemGPT：https://arxiv.org/abs/2310.08560 ；Letta sleep-time：https://docs.letta.com/guides/agents/architectures/sleeptime/ ；https://www.letta.com/blog/sleep-time-compute/
- Mem0：https://arxiv.org/abs/2504.19413
- Zep：https://arxiv.org/abs/2501.13956 ；Graphiti：https://github.com/getzep/graphiti ；https://blog.getzep.com/beyond-static-knowledge-graphs/
- A-MEM：https://arxiv.org/abs/2502.12110
- Generative Agents：https://arxiv.org/abs/2304.03442
- MemoryBank：https://arxiv.org/abs/2305.10250
- HippoRAG：https://arxiv.org/abs/2405.14831 ；HippoRAG 2：https://arxiv.org/abs/2502.14802
- GraphRAG：https://arxiv.org/abs/2404.16130 ；LightRAG：https://arxiv.org/abs/2410.05779
- CoALA：https://arxiv.org/abs/2309.02427
- LangMem：https://langchain-ai.github.io/langmem/ ；Cognee：https://github.com/topoteretes/cognee
- LoCoMo：https://arxiv.org/abs/2402.17753 ；LongMemEval：https://arxiv.org/abs/2410.10813 ；MemoryAgentBench：https://github.com/HUST-AI-HYZ/MemoryAgentBench
- 2026：https://arxiv.org/pdf/2607.16848 ；https://arxiv.org/pdf/2605.15338 ；https://arxiv.org/pdf/2607.12893 ；https://arxiv.org/pdf/2606.30306
- ReasoningBank：https://arxiv.org/abs/2509.25140 ；Agent Workflow Memory：https://arxiv.org/abs/2409.07429
- Late chunking：https://arxiv.org/abs/2409.04701 ；RRF：https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf
- Node sqlite：https://nodejs.org/api/sqlite.html ；sqlite-vec：https://github.com/asg017/sqlite-vec ；FTS5 trigram：https://sqlite.org/fts5.html#the_trigram_tokenizer ；simple 分词扩展：https://github.com/wangfenjin/simple
- bge-m3：https://huggingface.co/BAAI/bge-m3 ；Transformers.js：https://huggingface.co/docs/transformers.js
- Zotero 数据模型：https://www.zotero.org/support/dev/client_coding/direct_sqlite_database_access ；CSL-JSON：https://citeproc-js.readthedocs.io/en/latest/csl-json/markup.html ；Better BibTeX：https://retorque.re/zotero-better-bibtex/citing/
- Scite：https://scite.ai ；Elicit：https://elicit.com ；NotebookLM：https://notebooklm.google
- ORKG：https://orkg.org ；Nanopub：https://nanopub.net ；Micropublications：https://doi.org/10.1186/2041-1480-5-28 ；SEPIO：https://github.com/monarch-initiative/SEPIO-ontology ；W3C Web Annotation：https://www.w3.org/TR/annotation-model/
- MaRDI MathModDB：https://www.mardi4nfdi.de
- pdf.js：https://github.com/mozilla/pdf.js ；EmbedPDF：https://www.embedpdf.com ；GROBID：https://github.com/kermitt2/grobid ；Docling：https://github.com/docling-project/docling ；Marker：https://github.com/datalab-to/marker ；MinerU：https://github.com/opendatalab/MinerU
- mammoth：https://github.com/mwilliamson/mammoth.js ；docx-preview：https://github.com/VolodymyrBaydalka/docxjs ；KaTeX：https://katex.org ；CodeMirror：https://codemirror.net ；latex.js：https://latex.js.org
- Tauri capabilities：https://v2.tauri.app/security/capabilities/ ；Readability：https://github.com/mozilla/readability ；linkedom：https://github.com/WebReflection/linkedom
- Crossref 限额：https://www.crossref.org/blog/announcing-changes-to-rest-api-rate-limits/ ；OpenAlex 定价：https://blog.openalex.org/openalex-api-new-features-and-usage-based-pricing/ ；Semantic Scholar：https://www.semanticscholar.org/product/api/tutorial ；arXiv API：https://info.arxiv.org/help/api/tou.html ；Unpaywall：https://unpaywall.org/products/api ；Zotero translators：https://github.com/zotero/translators
