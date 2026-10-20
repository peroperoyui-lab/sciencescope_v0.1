# KB-2a 项目文件夹索引：扫描、副本、解析退路

- 起草：Claude，2026-10-20。依据：`architecture/KNOWLEDGE_BASE.md`（已定稿）§1a 第 2、3 条、§3.1、§4.1、§10 KB-2；`decisions/DECISIONS.md` 2026-10-19（每个项目文件都有索引和副本）。KB-2 拆成两份：本任务管「放进来、改了」，KB-2b 管「移走、删掉」和删除资料。
- 执行：Sol（Windows）；审阅：Claude。约 2 小时，一步交付；超出就停下汇报。

## 目标

项目文件夹里的每个文件都在知识库里有一条资料记录和一份 ScienceScope 自己的副本。能解析的照常分段、建全文和向量索引；不能解析的也能按文件名、路径找到。文件改了内容会重新解析，没改的不重复做。

## 用户会怎么用

本任务没有新界面（项目文件夹树是 Claude 的 KB-11）。用户能感到的是：

- 用户在资源管理器里往项目文件夹 `papers/` 放了 3 篇 PDF、`data/raw/` 放了一个 `.dta` 文件。打开这个项目的项目文件夹页后，专家在这个项目的对话里用 `research_search` 能搜到 PDF 里的段落，搜「panel 2020」能找到 `data/raw/panel_2020.dta` 这个文件并知道它在哪。
- 用户改了其中一篇 PDF 再打开项目页：只有这一篇重新解析。
- 用户把项目文件夹整个挪走后，专家用 `research_read` 读那篇论文仍然能读到（读的是副本）。

## 要做的

1. **扫描**（新文件 `app/services/knowledge/project-index.js`，一个文件一件事，需要时可再拆）：
   - 根目录用 `projectFiles.rootOf(projectId)`（外部项目文件夹，或项目自带文件夹）。
   - 每个文件一条 `rb_sources`：`project_id` 为该项目，`folder_path` 为相对路径（正斜杠）。已有记录按 `(project_id, folder_path)` 找到并更新。
   - 先比修改时间和大小，变了再算 SHA-256，哈希变了才重新复制和解析。需要新列（例如大小、修改时间、哈希）就加一个迁移，编号取目录里实际最高号加一。
   - 跳过以 `.` 开头的目录、`node_modules`、`__pycache__`、`.venv`、`renv`。
   - 同一项目同时只跑一次扫描；扫描中再被请求时，等这次结束后补跑一次。
2. **副本**：原件复制到 `data/library/project-files/<项目 id>/`，按内容哈希命名、去重（同一内容只存一份）；记录的 `original_path` 指向副本（相对资料库目录）。读取（`research_read`、预览、`view_image` 的 `sourceId`）优先用项目文件夹里的现文件，找不到时用副本。文件改了内容，新内容另存一份，旧副本先保留（清理在 KB-2b）。
3. **解析与退路**：
   - 解析器支持的格式走现有 `parseSource`（`app/services/research/index.js`），状态照旧。
   - 不支持或失败的文件也建记录，`content_status` 用一个明确的值表示「仅索引文件名」（例如 `name-only`），并保证全文索引和向量文档（`semantic/documents.js` 里资料那一条）里有文件名和相对路径，专家能按名字搜到。
   - 单文件超过 200 MB 不解析内容，退回「仅索引文件名」，`parseError` 写明大小；副本照样复制。
   - 数据文件和项目文件夹里的文稿不抽实体、不整理卡片（§1a 第 3、4 条）；本任务本来也不做抽取，只是不要给它们排卡片任务。
4. **何时扫描**：
   - 新接口 `POST /api/projects/:id/index`：立即扫描，返回结果汇总（新增、更新、未变、仅索引文件名、失败各几个）。
   - `GET /api/projects/:id/files` 请求根目录时，在后台开始一次扫描，不等它结束；每个文件条目多一个 `index` 字段：`{status, sourceId, error}`，状态取 已解析 / 解析中 / 仅索引文件名 / 失败 / 未索引。
   - 应用内对项目文件新建、改名、添加（`project-files.js` 里这些操作）之后，在后台扫描。
   - alpha 不用文件系统监听。
5. **事件**：资料增改照旧发 `research.changed`，让向量索引增量重建。

## 可以改的

`app/services/knowledge/`（新增 `project-index.js` 及测试）、`app/services/research/`（`index.js`、`store.js`、`semantic/documents.js` 里与项目文件相关的部分）、`app/services/project-files.js`、`app/server/routes/projects.js`、`app/app.js`（接线）、`app/core/db/migrations/`（如需新列）、`docs/product/FEATURES.md`、`docs/log/IMPLEMENTATION_LOG.md`（不超过 5 行）。

## 不做的

- 不做文件移动、删除的处理，不做删除资料接口，不做副本清理（KB-2b）。
- 不做派生层的边（KB-3）、不做工具和图接口（KB-4、KB-5）。
- 不改 `app/ui/`。
- 不在项目文件夹里写任何文件（产品原则 1）。
- 不动 `<预览安装目录>` 及其数据。

## 完成标准

- 干净检出 `npm run check` 全部通过（含 Windows 测试）。
- 一个功能测试走完「用户会怎么用」的三步：放入可解析和不可解析的文件 → 扫描后都有记录、PDF 段落可搜、`.dta` 按文件名可搜；改一个文件 → 只有它重新解析；把项目文件夹改名或移走 → 读取用副本。并断言扫描后项目文件夹里没有多出任何文件。
- 用 2 万个小文件的合成目录测一次扫描耗时，写进报告；超过 5 秒就说明慢在哪（是否要改成分批后台扫描，由 Claude 定）。

## 交付

- 分支：`codex/kb-2a-project-index-YYYYMMDD`，从集成分支最新提交开始。报告不超过 15 行，给出远程分支与 SHA。不建 PR、不合并。
