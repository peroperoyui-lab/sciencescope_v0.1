<!-- 2026-09-26 补充（Claude）：`chat_recall` 的关键词检索（scripts/project-memory.mjs，T17 后在 scripts/context/sources/conversation.mjs）在本任务完成后改用混合检索。 -->
# T10 · 混合检索主方案（本地向量 + 关键词 + 多问法）与每轮记忆召回

共同规则见 `docs/tasks/RB_COMMON.md`。设计与实测数据见 `docs/design/RESEARCH_BASE.md` §3（**先读**）；测速与小评测脚本为 `scripts/evals/embedding-bench.mjs`。
用户决定（2026-09-25）：只用一套系统，混合检索为主，纯关键词只是降级；设定最低配置，不迁就老电脑。

## 已确认接口修订（用户，2026-09-27）

本节优先于下文旧接口草案：保留同步 `search()`；新增异步
`searchHybrid({query, queries, …scope}) → {hits, mode, fallbackReason?}`。
`mode` 为 `hybrid | keyword`；降级原因是 `timeout | model-missing | index-incomplete | model-version-mismatch`，工具结果明确写“本次为关键词检索”。

- 300ms 覆盖整个向量阶段（所有问法），超时丢弃全部向量结果；启动后后台预热，首次加载不占查询预算。
- `queries` 最多 6 个、每个最多 2000 字符；仅 query 等价于单元素数组，两者同时给出则合并去重；提示模型至少给出中英文各一问法。
- 加权 RRF：k=60，向量 1.0、关键词 0.5；同分按稳定引用身份排序。
- 两路使用同一范围过滤，融合前排除不可见的项目/个人/私有条目，专门测试私有条目不泄漏。
- 向量记录模型及版本；不一致时降级并后台排队重建。
- 可异步的内部召回调用方改用 searchHybrid，同步调用方保留 search；交付列出各调用方。
- 假检索器单测覆盖成功、超时、模型缺失、版本不一致、私有排除、query/queries 兼容；同一 52 题照常重测与原 43/52 逐题对比。
- T17 已将工具清单迁至宿主 `scripts/context/tools.mjs`，新参数由该清单下发，继续使用已安装 DSH 的值 schema DSL，不重新在适配器复制工具定义。

## 1. 嵌入引擎 `scripts/research-base/embedding.mjs`（新模块）
- 使用 `onnxruntime-node`（MIT）在 `worker_threads` 中运行，`intraOpNumThreads=2`；分词用 `@huggingface/transformers` 的 AutoTokenizer，从本地文件读取，**禁止远程下载**。
- 模型（用户 2026-09-25 决定：先装一个轻量的默认模型，更换模型的入口以后再做）：**只实现一个默认模型 multilingual-e5-small**（int8 ONNX，约 118 MB，384 维，MIT）。
  - 文件：Hugging Face `Xenova/multilingual-e5-small` 的 `onnx/model_quantized.onnx`，以及 `tokenizer.json`、`tokenizer_config.json`、`config.json`、`special_tokens_map.json`。
  - 下载地址依次尝试 `https://huggingface.co/...` 和 `https://hf-mirror.com/...`。首次在 Windows 上下载成功后，把每个文件的 SHA-256 和 revision 写进仓库中的 `models/default-embedding.json`，以后下载都按它校验。
  - 模型存放在应用数据目录下的 `models/`。首次开启语义检索时在设置中下载，显示进度；失败时如实提示，并继续使用关键词检索。
  - 输入要加 `query: ` / `passage: ` 前缀。
  - **本次不做更换模型的界面**。向量表中要记录模型名和版本，以后更换模型时全部重算即可。
- 接口：`embedPassages(texts) → Float32Array[]`（批大小 8，最长 512 token）、`embedQuery(text)`，每个向量都做 L2 归一化。
- **安装脚本**：`onnxruntime-node` 必须用 `--ignore-scripts` 安装（它的安装脚本会去下载 GPU 组件）；CPU 所需的二进制已包含在包内。
  Windows 打包时把 `onnxruntime-node` 的原生文件和 `sqlite-vec-windows-x64` 的 DLL 放进 Tauri 资源并签名。

## 2. 向量存储与混合检索
- 使用 `sqlite-vec`（MIT / Apache），新表 `rb_vec`（vec0，int8 或 float[1024]），通过 `ref_type` 和 `ref_id` 关联到段落、条目或来源；rowid 用 BigInt 绑定；加载扩展后关闭扩展加载。
- 表 `rb_vec` 的维度按模型的 `config.json` 读取（默认 384）。
- 在 `search.mjs` 中增加向量检索器的注入点，这是允许对框架做的改动。**先把接口草案交给 Claude 确认**，再按下面的规则实现：
  - `search({queries: string[]…})` 支持多个问法。每个问法都跑向量检索（取前 30）和关键词检索（取前 30），用加权 RRF 融合（k=60，向量权重 1.0，关键词 0.5）。
  - 保留现有的可见性规则。
  - 向量不可用或查询超过 300 ms 时退回关键词检索，并在结果中带上 `mode: 'keyword-fallback'`。
- `research_search` 工具新增 `queries` 参数，要求模型给出多个问法、**中英文至少各一个**；原来的 `query` 参数继续可用。工具定义由 Claude 在 `session-control.mjs` 中修改，请在接口确认时一并提出。
- 建索引：在 ingest 之后入队，逐篇处理并可断点续传；对话进行中暂停。条目新建或修改时即时重新嵌入。更换模型时全部重算。设置页显示进度。

## 3. 每轮记忆召回
- 主专家每轮发送前，用用户消息做向量检索，只在记忆、知识、模型、主张中查找，取前 8 条且不超过 1500 字符，放进本轮上下文的"与本轮相关的记忆"一节，
  排除已在简报中出现的条目。记录使用回执（how=`recall`）。专家的共享输入同样处理。
- 召回耗时计入发送前的准备时间，目标 < 100 ms（查询嵌入 30 ms 加上检索时间）。

## 4. 最低配置检测
启动时检测 CPU 是否支持 AVX2、内存是否 ≥ 8 GB、剩余磁盘是否 ≥ 5 GB。不满足时明确告知，只提供关键词检索，其他功能照常使用。

## 5. 评测与验收
- 用 `embedding-bench` 的方法建立检索评测集：用户会下载一批真实论文（依赖 T04 的 PDF 解析），在其中标注 ≥ 50 个查询及其应命中的段落。
  覆盖中文问英文论文、同义词或缩写、公式或变量名、换说法，以及记忆类问题（改过的决定、以前的约定）。标注放 `tests/fixtures/retrieval-eval/`，**不提交论文原件**。
- 报告以下几种方法的 R@1 / R@5 / R@10，以及查询 P50 / P95、每段嵌入耗时、500 篇首次建索引的总时长、内存峰值：
  关键词、单问法向量、双语向量、加权混合、加 LLM 重排（可选）。在两台机器上测：云端容器，以及用户的 Windows 电脑（由 Codex 执行）。
- 在 Windows 上实测默认的 e5-small：每段耗时、500 篇首次建索引的时间、内存，以及上面的召回指标。可选：用 `embedding-bench` 同时测 e5-large 作对比，结论写进 DESKTOP_IMPLEMENTATION，是否更换由用户决定。
- 单元测试用一个很小的假嵌入器（确定性向量）测试融合、降级和召回逻辑，**不在测试里加载真实模型**。

## 补充（Claude，2026-09-27，来自第 1 批真实评测）
第 1 批真实评测（deepseek-v4.1-flash，52 题）：43 题的核心答案有原文支持，1 题错误、1 题未作答、6 题没有完整回答。混合检索实现后，用同一题集重测，并逐项处理以下问题：
- 预算耗尽：检索结果太长。按段落截断，并返回"用 research_read 读全文"的提示，而不是一次塞满。
- 模型偏离研究检索工具，转去调用 shell 或文件工具：在工具描述和查找规则中写明"研究问题先用 research_search"。评测记录每题的工具调用序列。
- 引用格式不受支持：扩展 `/api/research/cite` 与标签解析，支持模型常写的变体（如 `[S3, p.4]`、`[S3 p4]`），不认识的格式原样保留并记录。
- 额外的无依据论断：评测中加入"每个论断都有引用"的判定。这一项只衡量问题，不在检索层硬拦。

