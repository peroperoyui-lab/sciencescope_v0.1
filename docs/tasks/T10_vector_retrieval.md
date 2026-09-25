# T10 · 混合检索主方案（本地向量 + 关键词 + 多问法）与每轮记忆召回

共同规则见 `docs/tasks/RB_COMMON.md`。设计与实测数据见 `docs/design/RESEARCH_BASE.md` §3（**先读**）；测速与小评测脚本为 `scripts/evals/embedding-bench.mjs`。
用户决定（2026-09-25）：只用一套系统，混合检索为主，纯关键词只是降级；设定最低配置，不迁就老电脑。

## 1. 嵌入引擎 `scripts/research-base/embedding.mjs`（新模块）
- 使用 `onnxruntime-node`（MIT）在 `worker_threads` 中运行，`intraOpNumThreads=2`；分词用 `@huggingface/transformers` 的 AutoTokenizer，从本地文件读取，**禁止远程下载**。
- 模型：int8 量化的多语言嵌入模型，存放在应用数据目录下的 `models/`。首次使用时由用户在设置中点击下载，显示进度并校验 SHA-256。
  下载源由 Claude 和用户确定后写进设置（云端环境无法访问 Hugging Face，已验证 fastembed 在 Google 存储上的 multilingual-e5-large 可以下载）。
  e5 系列要加 `query: ` / `passage: ` 前缀；换成 bge-m3 时按其说明处理。
- 接口：`embedPassages(texts) → Float32Array[]`（批大小 8，最长 512 token）、`embedQuery(text)`，每个向量都做 L2 归一化。
- **安装脚本**：`onnxruntime-node` 必须用 `--ignore-scripts` 安装（它的安装脚本会去下载 GPU 组件）；CPU 所需的二进制已包含在包内。
  Windows 打包时把 `onnxruntime-node` 的原生文件和 `sqlite-vec-windows-x64` 的 DLL 放进 Tauri 资源并签名。

## 2. 向量存储与混合检索
- 使用 `sqlite-vec`（MIT / Apache），新表 `rb_vec`（vec0，int8 或 float[1024]），通过 `ref_type` 和 `ref_id` 关联到段落、条目或来源；rowid 用 BigInt 绑定；加载扩展后关闭扩展加载。
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
- 在 Windows 上用真实论文对比 multilingual-e5-large 和 bge-m3，二选一，把结论写进 DESKTOP_IMPLEMENTATION。
- 单元测试用一个很小的假嵌入器（确定性向量）测试融合、降级和召回逻辑，**不在测试里加载真实模型**。
