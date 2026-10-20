# KB-3 知识库派生层：引用和相似边、后台队列

- 起草：Claude，2026-10-20。依据：`architecture/KNOWLEDGE_BASE.md`（已定稿）§1a 第 4 条、§3.2、§4.2、§4.5、§10 KB-3；`decisions/DECISIONS.md` 2026-10-19（建边保守，相似边每篇最多 3 条、相似度 ≥ 0.85）。接在 KB-2b 之后。
- 执行：Sol（Windows）；审阅：Claude。约 2 小时，一步交付；超出就停下汇报。

## 目标

资料解析完后，后台不调用模型就能连出两种边：库内文献之间的引用（`cites`）和高相似（`similar-to`）。这一层是可以整层重算的索引，不记修订、不进历史版本。后台任务有状态，失败可重试，发言进行中让路。

## 用户会怎么用

本任务没有新界面（知识库页是 Claude 的 KB-9、KB-10）。它支撑设计稿 §2 场景 1：用户导入 30 篇论文，点开一篇，相连节点里列出它引用的库内文献和最相似的几篇。

## 要做的

1. **后台队列**（`app/services/knowledge/` 下新文件，例如 `jobs.js`、`derived.js`）：
   - 用 `kb_jobs`（KB-1 已建表）记每份资料 `layer='derived'` 的状态：queued / running / done / failed / skipped，`content_version` 存做这一步时段落内容的哈希。
   - 资料解析完成或重新解析后（段落哈希变了）排队；`content_version` 没变的不重做。启动时把上次没做完的 `running` 改回 `queued`。
   - 让路方式照向量索引（`research/semantic/index.js` 的 `busy()`）：有发言在进行时暂停，空闲时继续。
   - 失败 `attempts` 加一；连续 3 次失败后不再自动重试，留给以后界面上的「重试失败的」（服务方法先提供）。
   - 事件：边变化发 `knowledge.changed`（受影响的引用）；任务状态变化发临时事件 `knowledge.jobs.changed`。
   - 提供一个汇总查询（各状态几份、失败列表带错误原文），给 KB-5 的 `GET /api/knowledge/jobs` 用。
2. **引用边**：
   - 从资料的 `reference` 段落提取 DOI 和标题；没有 `reference` 段落的（例如 Markdown、docx），取标题为 References / Bibliography / 参考文献 之后的段落。
   - 与库里资料精确匹配：DOI 对 `metadata.doi`（忽略大小写），或归一化标题（小写、去标点和空白）完全相同。只连库里已有的文献，不建占位节点，不连自己。
   - 写 `derived` 层 `cites` 边，`origin='system'`、`method='citation'`；后导入的文献要能补上之前文献指向它的边（被引文献入库时，回查已有资料的参考文献）。
3. **相似边**：
   - 只在文献类资料之间建（paper、preprint、thesis、report、chapter、book），不连数据文件和文稿。
   - 用资料级向量找候选对，余弦相似度 ≥ 0.85 才写 `similar-to`，`weight` 为相似度，`method='similar'`；同一对文献只留一条。按相似度从高到低连边，两端都已有 3 条相似边的跳过，所以每篇文献连入和连出合计最多 3 条（2026-10-20 用户确认）。新文献入库时只连还有空位的文献，不挤掉已有的边；全量重算时按上面的顺序整体重排。
   - 阈值和上限是用户可改的设置（2026-10-20 用户提出）：`settings.knowledge.similarity = { threshold: 0.85, maxPerPaper: 3 }`，在 `DEFAULT_SETTINGS` 里给默认值；`maxPerPaper` 为 0 表示不建相似边。设置改动后在后台排一次相似边全量重算（只重算 `method='similar'` 的边，引用边不动），发言时照常让路。设置页界面由 Claude 在知识库页面里做，本任务不改 `app/ui/`。
   - 没开本地语义检索（没有向量）时这一步记 `skipped`，不报错；开启并建好向量后能补做。
   - 用 10 篇以上真实论文（中英文都有，不要从 `<预览安装目录>` 里取；手边没有就在报告里说，由用户提供）跑一次，在报告里列出相似度分布和最终连了几条边；0.85 明显不合适时写出建议值，由 Claude 和用户定，先不改默认值。
4. **重算**：资料重新解析时，先删它作为端点的 `derived` 边再重做；删除资料的处理已在 KB-2b。文件夹层的 `in-folder` 边不存表，由 KB-5 的图接口按 `folder_path` 即时生成。

## 可以改的

`app/services/knowledge/`（新文件及测试）、`app/services/research/`（解析完成后排队的接线）、`app/app.js`（接线）、`app/core/workspace/resources/settings.js`（只加 `knowledge.similarity` 默认值）、`docs/product/FEATURES.md`、`docs/log/IMPLEMENTATION_LOG.md`（不超过 5 行）。

## 不做的

- 不调用任何模型（论文卡片是 KB-6）。
- 不做接口路由（KB-5）和工具（KB-4），不改 `app/ui/`。
- 不改嵌入模型，不下载新模型。
- 不动 `<预览安装目录>` 及其数据。

## 完成标准

- 干净检出 `npm run check` 全部通过（含 Windows 测试）。
- 功能测试：5 篇互相引用的样例文献（可以用带参考文献部分的 Markdown 夹具，DOI 和标题匹配各至少一例）导入后测出正确的 `cites` 边，先导入引用方、后导入被引方也能补上；关闭语义检索时相似一步为 `skipped`；发言进行中队列暂停、结束后继续；重新解析后不重复建边。
- 报告里写出本地真实论文的相似度分布。

## 交付

- 分支：`codex/kb-3-derived-YYYYMMDD`，从集成分支最新提交开始（含 KB-2b）。报告不超过 15 行，给出远程分支与 SHA。不建 PR、不合并。
