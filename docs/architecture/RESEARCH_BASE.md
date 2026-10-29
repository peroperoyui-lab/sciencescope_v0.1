# 研究资料库（Research Base）设计与开发框架

> R5 已删除旧线；文中的旧线路径仅作历史参考，原代码见 main 提交 1dc18e9a3c8f7539e092dcb4ae2fd681ec4ac513。

- 起草：Claude，2026-09-25。用户需求（原话要点）：
  1. PDF / Word / Markdown / 纯文本 / LaTeX 的解析与显示、应用内浏览器，**复用成熟工具再做视觉微调**；
  2. 长期记忆要为本项目**特别设计**，参考成熟项目与前沿研究；
  3. 需要"结论与证据台账"；
  4. 数据库要分好类——**文献、提炼的知识、理论模型/公式/算法、需要保存的记忆**——本质上同属一个数据库后端，统一检索与抓取。
- 调研依据：`docs/research/RESEARCH_MEMO_2026-09-25.md`（记忆系统、知识管理、检索、文档工具、浏览器；每项标注核实方式）。
- 本文件是**设计与分工**；当前实现状态以 `docs/product/FEATURES.md` 2.17 为准。

---

## 1. 总体结构

```
            ┌──────────── 桌面界面（desktop/*.mjs）────────────┐
            │ 资料库各分类页 · 阅读器 · 记忆收件箱 · 项目简报 · 引用标签 │
            └───────────────┬──────────────────────────────────┘
                            │ /api/research/*（HTTP，带口令）
┌───────────────────────────▼─────────────────────────────────────────┐
│ scripts/research-base/（应用宿主，Node）                              │
│  store.mjs   分类记录、关系、提议收件箱、修订、使用回执               │
│  search.mjs  检索（FTS5 + 中文二元组）、阅读窗口、引用解析、项目简报    │
│  ingest.mjs  资源 → 解析器 → 段落 → 索引（后台队列）                  │
│  parsers/    解析器注册表：txt/md/tex 已实现；pdf/docx 待 T04         │
│  index.mjs   路由 + 智能体工具入口                                    │
└───────────────┬───────────────────────────────▲─────────────────────┘
                │ configureBrief（系统提示分段）   │ /host-call（工具回调）
┌───────────────▼───────────────────────────────┴─────────────────────┐
│ DSH 会话进程（adapters/runtime-dsh/session-control.mjs）              │
│  主专家与每位专家子代理都注册：research_search / research_read /       │
│  research_propose；项目简报作为系统提示中的一个分段                     │
└─────────────────────────────────────────────────────────────────────┘
```

**一个后端，五类记录**（用户第 4 点）：

| 分类 | 表 / 类型 | 例子 |
|---|---|---|
| 文献与资料（可引用的来源） | `rb_sources` + `rb_chunks`（按页/章节的段落） | 论文、书、网页、数据集、项目文件 |
| 提炼的知识 | `rb_items` type=`knowledge`（finding / definition / method / fact） | "IF 对 CRP 的效应在 12 周后消失" |
| 理论模型 / 公式 / 算法 | type=`model`（theory / formula / algorithm / statistical-model / protocol），`payload`：latex、variables(symbol, meaning, unit)、assumptions、steps、domain | Matsuda 指数、ANCOVA 模型、分组算法 |
| 结论与主张（台账） | type=`claim`，`payload.claimStatus`：hypothesis / supported / contested / refuted / uncertain / retracted；证据用 `rb_links`（supports / contradicts / qualifies，带引文与定位） | "本研究不能得出因果结论" |
| 长期记忆 | type=`memory`（preference / profile / goal / decision / convention / open-question / lesson / episode） | "主要终点改为 Matsuda 指数" |
| 笔记 | type=`note`（note / mark / summary） | 标记升级而来的笔记 |

所有记录可以互相链接（`rb_links`：cites、supports、contradicts、qualifies、derived-from、defines、uses、about、supersedes、mentions、same-as、part-of），
也可以链接到对话消息（ref type `message`），所以"这条结论来自哪次讨论、哪段原文"始终可追溯。

## 2. 长期记忆：为科研项目特化的设计

调研结论（备忘录 §1.2）落到本项目的取舍：

1. **记忆和知识分开存，但放在同一个库里**。记忆只记录"这个人、这个项目的工作状态"：目标、决定及理由、约定、偏好、未决问题、经验、阶段摘要。
   论文里的事实和公式进入知识、模型、主张，由记忆通过链接引用，不复制内容。这样检索可以统一，语义又不会混在一起。
2. **分层（CoALA）**：
   - *核心记忆*（Letta 的常驻块）：**项目简报**，在每轮开始前放进系统提示，有字符预算（默认 3500 字符，约 1.5k token）。
     内容依次是用户偏好、研究问题与目标、当前主张、已做决定、术语与约定、待解决问题、本专家的经验、置顶的知识和模型。
   - *语义记忆*：知识、模型、主张，通过 `research_search` / `research_read` 按需取用。
   - *情景记忆*：会话摘要（memory/episode，T09），指向对话 ID，不复制全文；DSH 仍是完整历史的来源。
   - *程序记忆*：专家经验（scope `expert:<id>`），只注入这位专家。
3. **时间与取代（借鉴 Zep/Graphiti 的双时间模型）**：记录不删除。旧的决定被新的取代时，状态变为 `superseded`，
   写入 `valid_to` 和 `superseded_by`，并建立 supersedes 链接。默认只检索和注入当前有效的记录，问到"当时怎么定的"时仍可查到。
   每次修改都保存修订快照（`rb_revisions`），编辑时用 `expectedRevision` 防止覆盖别人的修改。
4. **写入必须经过确认**（Mem0 的 ADD/UPDATE/NOOP 流程，但不自动执行）：模型只能调用 `research_propose` 生成**提议**，进入"记忆收件箱"，
   由用户接受、修改后接受或拒绝。提议记录来源（对话、消息、角色、专家、工具调用 ID）并做去重。
   这同时防御记忆投毒：来自网页或文献的内容不能直接变成"已确认"。
5. **可见性**：`private` 记录永远不给任何智能体；专家经验只给对应专家；默认检索不返回已被取代或已拒绝的记录。
6. **透明**：每轮记录"用到了哪些记录"（`rb_usage`，how = brief / search / read），界面可以在回答下显示"本轮用到的记忆与资料"（T05）。
7. **引用格式**：来源 `[S3]`，段落 `[S3 p.4]`，条目 `[@a1b2c3d4]`（条目 ID 的前 8 位）。模型在回答中照原样书写，界面把它们渲染成可点击的标签（T05）。
8. **评测**：自建 30–50 题的项目记忆评测集，题型参考 LongMemEval（知识更新、时间推理、跨会话、拒答），由 T09 负责；真实模型的结果与本地模拟模型的结果分开报告。

## 3. 检索：混合检索是主方案，纯关键词只是降级（用户 2026-09-25 修订）

### 3.1 实测（本仓库 `scripts/evals/embedding-bench.mjs`，云端 4 核 Xeon 2.8 GHz / AVX-512，2026-09-25）
模型：multilingual-e5-large（XLM-R large 骨架，560M 参数，1024 维，MIT；与 bge-m3 同一规模），用 onnxruntime-node 在 CPU 上运行，动态 int8 量化后为 551 MB。

| 项目 | int8 · 4 线程 | int8 · 2 线程 | fp32 · 4 线程 |
|---|---|---|---|
| 一次查询（约 40 token） | 28 ms | 32 ms | 57 ms |
| 每段（256 token） | 177 ms | 319 ms | 414 ms |
| 每段（512 token） | 223 ms | 387 ms | 506 ms |
| 进程内存 | 约 1.4 GB | 约 1.4 GB | 约 1.7 GB |
| 模型加载 | 5.6 s | 5.5 s | — |

小评测（15 个问题、24 段中英混合研究文字，多数问题与答案没有共同关键词或者跨语言；**样本很小，只看方向**）。
> 数据来源说明：这 24 段文字、15 个问题、标准答案以及"中英各查一次"所用的翻译，**全部由 Claude 手写**，内容是虚构的示例（沿用跑步社间歇性禁食的例子），数字也是虚构的；没有使用真实论文或用户数据。
> 每段只有一两句话，比真实论文段落短得多；出题人知道答案，可能有偏差；翻译是人工给的，没有测试真实模型翻译的效果。
> "500 篇约 2–3.5 小时"是按每篇约 60 段乘以实测单段耗时推算出来的，没有实际跑过 500 篇。正式结论以 T10 用真实论文、在用户电脑上的评测为准。

| 方法 | 第 1 名命中 | 前 3 名命中 |
|---|---|---|
| 关键词（现有） | 1 | 1 |
| 向量 | 3 | 6 |
| 关键词 + 向量（RRF） | 2 | 5 |
| 关键词，中英各查一次 | 5 | 6 |
| **向量，中英各查一次** | **12** | **13** |
| 三路 RRF（关键词两次 + 双语向量） | 6 | 13 |

结论：
1. 纯关键词检索在"换个说法"或"跨语言"时几乎全部失效，确实只能作为降级方案。
2. 多语言向量模型有明显的**语言偏好**：中文问题倾向匹配中文段落，即使内容不相关。**同一个问题用中英文各查一次**，效果从 3/15 提升到 12/15。
3. 关键词和向量按相同权重融合会拉低第 1 名的准确度。关键词应作为辅助，负责精确的术语、公式名、数字和缩写，权重要低于向量。

### 3.2 方案（一套系统）
- **主方案 = 本地向量检索（为主）+ 关键词检索（为辅）+ 多问法**：
  - `research_search` 让模型一次给出多个问法，**至少包含中英文各一个**（模型调用工具时顺手翻译，不额外调用模型）。每个问法都跑向量检索和关键词检索，再用加权 RRF 融合（向量权重 1.0，关键词 0.5）。
  - 模型（用户 2026-09-25 决定：先装一个轻量的默认模型，更换模型的入口以后再做）：默认使用 **multilingual-e5-small**（int8 ONNX，约 118 MB，384 维，MIT，支持中英文；来源为 Hugging Face 的 `Xenova/multilingual-e5-small` 中的 `onnx/model_quantized.onnx`，国内可改用 hf-mirror.com）。
    它在云端下载不到，**速度和效果都还没有实测**，由 T10 在用户电脑上实测。上表中 e5-large 的数据只能作为同类大模型的参考；按参数量推算，small 大约快 4–5 倍，但这只是推算。
    以后如果效果不够，可以换成 e5-large 或 bge-m3，模型版本记录在向量表中，更换后全部重算。
  - 向量存放在 SQLite（sqlite-vec；384 维 float32 的 30k 段约 45 MB，int8 约 12 MB），查询时逐条比对，这个规模下已经足够快。
- **长期记忆用同一套检索**：记忆、知识、模型、主张同样写入向量。另外，主专家**每轮自动召回**：用用户这一轮的消息检索记忆类条目，取最相关的若干条，和项目简报一起放进本轮上下文（RAG 式），有字符预算；检索文献仍由模型主动调用工具。
- **降级**：模型未安装、索引未完成，或向量查询超过 300 ms 时，自动退回关键词检索，并在工具结果中说明"本次为关键词检索"。
- **建索引**：在后台 worker 线程中用 2 个线程运行，按篇入队，可断点续传；对话进行时自动让路。按 e5-large 的实测，一篇论文（约 60 段）约 12–25 秒，500 篇首次建索引约 2–3.5 小时；默认的 small 模型应明显更快（推算，待实测）。首次建索引只做一次，之后导入新论文时增量完成。
- **重排**（可选，放后面）：用便宜模型对前 20 条做列表式重排，由评测决定是否默认开启。

### 3.3 最低配置（不迁就老电脑）
| | 最低 | 推荐 |
|---|---|---|
| 系统 | Windows 10 22H2 / 11，64 位 | Windows 11 |
| CPU | 4 核、支持 AVX2（约 2015 年以后的 Intel / AMD） | 6 核以上 |
| 内存 | 8 GB（默认小模型建索引时预计占用数百 MB；e5-large 实测约 1.4 GB） | 16 GB |
| 硬盘 | 空余 5 GB（默认模型约 0.12 GB，Python 环境约 0.5 GB，加上资料和索引） | SSD |
| GPU | 不需要 | — |
启动时检测 AVX2 和内存；不满足最低配置就明确提示，并只提供关键词检索。

## 4. 文档解析与显示（用户第 1 点）

- **解析器注册表**（`scripts/research-base/parsers/index.mjs`）：接口是 `parse(bytes,{name}) → {blocks[], pages?, metadata?, warnings?}`，
  block 字段为 kind、text、page、section、anchor（锚点采用 W3C Web Annotation 的 TextQuoteSelector，加页码和坐标矩形）。
  已有：纯文本 / CSV / 代码、Markdown（标题形成章节路径，数学公式和表格整块保留）、LaTeX（章节、公式原样、标题/作者/摘要）。
  **T04 负责**：PDF（`pdfjs-dist`，Apache-2.0，逐页文字与坐标）、DOCX（`mammoth`，BSD-2）。
- **阅读器**（T04）：PDF 用 pdf.js 的 viewer 组件加文字层和高亮层；DOCX 用 mammoth 转 HTML 或用 docx-preview 按版式显示；Markdown 用 marked 加 KaTeX 加 highlight.js；
  LaTeX 有"源码"（CodeMirror 6 只读，stex 模式）和"公式渲染"（KaTeX）两种视图；代码和 CSV 用只读编辑器或表格。**聊天回答里的公式也用 KaTeX 渲染**。
  这些都放进现有右侧"文件预览与标记"栏，标记和定位沿用已完成的标记功能。
- **禁止内置的许可**：PyMuPDF（AGPL）、Marker（GPL / 权重限制）、Nougat（权重 NC）、Zotero translators（AGPL）。GROBID、Docling 只能作为用户自行运行的外部服务。

## 5. 应用内浏览器（用户第 1 点，T08）

远程页面放在独立的 WebviewWindow 中，**不授予任何 capability**，拦截 file / tauri / 回环地址，关闭 DevTools。
"保存为来源"由 Node 宿主重新抓取页面，用 Readability + linkedom 提取正文，再读取 `citation_*`、JSON-LD、DOI 等元数据，写入 `rb_sources`（kind `webpage`）。

## 6. 已实现的框架（本次提交，可直接在上面开发）

- 表：`rb_sources`、`rb_chunks`、`rb_items`、`rb_links`、`rb_proposals`、`rb_revisions`、`rb_usage`、`rb_fts`（`schema.mjs`）。旧的 `knowledge` 表每行镜像一次（`legacy_id`）。
- 接口（`index.mjs`；GET 用查询参数，POST 用 JSON）：

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/research/sources?projectId=&kind=&readStatus=&tag=&limit=&offset=` | 来源列表（`projectId=` 为空表示个人资料库） |
| GET | `/api/research/source?id=` | 来源详情 + 段落数 + 链接 |
| POST | `/api/research/sources` `{source}` | 手动新建来源（元数据，如 DOI 导入） |
| POST | `/api/research/sources/update` `{id, patch}` | 修改元数据、标签、阅读状态、评分 |
| POST | `/api/research/sources/remove` `{id}` | 删除来源记录（不删原件） |
| POST | `/api/research/sources/ingest` `{id \| resourceId, wait?}` | 解析并索引一份资料 |
| POST | `/api/research/sync` `{projectId, wait?}` | 登记并解析某项目（或个人资料库）的全部资料 |
| GET | `/api/research/search?q=&projectId=&types=&itemTypes=&k=&includeSuperseded=` | 统一检索 |
| POST | `/api/research/read` `{ref, page?, fromOrdinal?, maxChars?}` | 阅读窗口 |
| GET | `/api/research/items?projectId=&type=&subtype=&status=&scope=&pinned=` | 条目列表 |
| GET | `/api/research/item?id=`（也接受 8 位短 ID） | 条目 + 链接 + 修订历史 |
| POST | `/api/research/items` `{item}` · `/items/update` `{id, patch}` · `/items/supersede` `{id, item}` | 新建 / 修改（可带 `expectedRevision`）/ 取代 |
| POST | `/api/research/links` `{link}` · `/links/remove` `{id}` | 建立 / 删除关系 |
| GET | `/api/research/proposals?projectId=&status=` · POST `/proposals/decide` `{id, accept, edits?}` | 记忆收件箱 |
| GET | `/api/research/brief?projectId=&expertId=` | 项目简报（与模型看到的一致） |
| GET | `/api/research/cite?label=&projectId=` | `[S3 p.4]` / `[@id]` → 记录 |
| GET | `/api/research/usage?chatId=&messageId=` | 本轮用到了哪些记录 |
| GET | `/api/research/formats` | 目前可解析的扩展名 |

- 智能体工具（主专家与专家子代理都有；会话决定对话、项目和角色，模型传入的参数无法扩大范围）：
  `research_search {query, types?, itemTypes?, limit?}`、`research_read {ref | cite, page?, fromOrdinal?, maxChars?}`、
  `research_propose {op, item?, targetId?, evidence?[{ref | cite, relation, quote}], from?, to?, relation?, rationale}`。
- 项目简报：主专家每轮发送前如有变化就更新系统提示分段（`host.configureBrief`）；有序讨论和 @ 邀请的专家通过共享输入拿到同一份简报。
- 验证：`research-base`（索引、分段、解析、检索、阅读、引用、取代、简报预算、可见性、提议与证据、修订、旧数据迁移）、
  `research-api`（路由、简报注入、按会话绑定的工具调用、使用回执）、`research-tools-runtime`（**真实 DSH**：主专家与专家子代理调用工具、简报进入系统提示）；
  真实模型：`scripts/evals/research-base-live.mjs`（结果见 DESKTOP_IMPLEMENTATION 2026-09-25）。

## 7. 分工（交给 GPT 的任务书在 `docs/plans/tasks/`）

| 任务 | 内容 | 依赖 |
|---|---|---|
| T04 | PDF / DOCX 解析器；阅读器（pdf.js、mammoth/docx-preview、KaTeX、highlight.js、CodeMirror）；聊天中的公式渲染 | 框架（已完成） |
| T05 | 资料库分类页（文献 / 知识 / 模型与公式 / 主张与证据 / 记忆）、记忆收件箱、项目简报编辑、引用标签、"本轮用到的资料" | 框架；阅读器部分依赖 T04 |
| T06 | 文献元数据：DOI / arXiv / PMID 查询、BibTeX / RIS / CSL-JSON 导入导出、citekey、去重 | 框架 |
| T07 | 主张–证据台账：状态流转、证据链接、从审核结论登记、证据表导出 | T05 的界面框架 |
| T08 | 应用内浏览器：隔离窗口、阅读模式、保存为来源、引用元数据 | T04（阅读器）、T06（元数据） |
| T09 | 记忆整理：会话摘要、空闲时抽取候选并与相似条目对照后生成提议、记忆评测集 | 框架 |
| T10 | 混合检索主方案（本地向量 + 关键词 + 多问法）、每轮记忆召回、最低配置检测、真实论文评测 | T04（PDF 解析，用于真实论文评测） |

## 8. 已知风险与后续

- **应用数据读取边界已处理（T21，2026-10-03，待 Claude 审阅）**：宿主维护受保护路径表，文件工具直接拒绝应用数据库、凭据、运行历史等内部路径；shell 引用或在这些路径工作时始终审批，Full 也不自动批准，拒绝不执行并保留 DSH 审计。凭据移至独占 ACL/0600 的 `secret/credentials.yaml`，旧文件经安全迁移后删除；模型进程的 shell 环境过滤凭据变量。四角色真实 DSH、本地模拟、浏览器及 Windows 原生已验证。此为纵深防御，同用户权限及任意构造脚本仍有局限；完全接管不限制网络，OS 出网控制列 alpha 后，DPAPI 只评估。详见 SYSTEM_SPEC 2.15。
- 简报每轮最多约 1.5k token；更长的记忆依赖检索。项目很大时需要 T09 的整理任务控制简报的膨胀。
- 中文二元组偶尔会误命中（两个二元组恰好相邻出现），在混合检索中关键词只是辅助，影响有限。
