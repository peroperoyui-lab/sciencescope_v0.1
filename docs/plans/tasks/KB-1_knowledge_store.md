# KB-1 知识库存储：迁移、实体与边、修订和历史版本

- 起草：Claude，2026-10-19。依据：`architecture/KNOWLEDGE_BASE.md`（已定稿）§1a、§3、§10 KB-1；`decisions/DECISIONS.md` 2026-10-19 三条。
- 执行：Sol（Windows）；审阅：Claude。约 2 小时，一步交付；超出就停下汇报（第 5 条可以留给 KB-3）。

## 目标

知识库有了自己的存储层：实体、边、标签、项目归属能增删改；每次修改记一条修订，修改按「一组 = 一个历史版本」归档，可以整组撤回，也能把单条记录恢复到某一版。还没有界面、工具和接口，那是 KB-4、KB-5 和 Claude 的 KB-8 以后的事。

## 用户会怎么用

本任务用户还看不到。它支撑的是设计稿 §2 场景 3、4：用户在图上拖线建边、合并实体后能撤销；专家一轮里写了 3 个实体、9 条边，回答末尾「撤回这组修改」能一次撤回，之后又被用户改过的记录不会被覆盖，并会列出来。

## 要做的

1. **迁移**：新文件 `app/core/db/migrations/0NN-knowledge-base.js`，编号取目录里实际最高号加一（A2-2、A3 先合并的话可能是 022 或 023）。表结构照设计稿 §3.4：`kb_entities`、`kb_edges`、`kb_labels`、`kb_memberships`、`kb_versions`、`kb_revisions`、`kb_jobs`，以及 `rb_sources.folder_path` 列和唯一索引。不导入、不兼容旧数据。
2. **存储服务** `app/services/knowledge/store.js`（可以按需拆成 `entities.js`、`edges.js`、`versions.js`，每个文件一件事）：
   - 实体：建、改、删（改 `removed`，相连的非派生边一起改 `removed`）、合并 `{into, from[]}`（被合并的改 `merged`、`merged_into`，边改挂到 `into`，别名并入；先能返回「将改挂 N 条关系」供界面确认）。
   - 边：建、改、删；端点是引用字符串 `entity:<id>`、`source:<id>`、`item:<id>`、`chunk:<id>`（设计稿 §3.1），建边时检查端点存在。`derived` 层按 `(from_ref, to_ref, relation)` 覆盖写，不记修订、不进版本。
   - 标签和项目归属：加、减。
   - 每条写入记录 `origin`（user / ai / system）、`created_by`，AI 写入另记 `meeting_id`、`turn_id`（§1a 第 1 条：每条 AI 的边都能查到是谁在哪次对话写的）；`evidence_json` 按 §3.2 存资料引文或用户消息引用。
   - 读：按引用读实体（含相连边，分页）、按项目列实体、某个节点 1 跳内的边（按关系、层过滤，分页并返回剩余数）。2 跳和 PPR 是 KB-7 的事。
3. **修订与历史版本**（设计稿 §3.6）：
   - 每改一条实体、边、标签或归属，同一事务写一行 `kb_revisions`（前后状态）。
   - 版本：`open({source, projectId, actorId, meetingId?, turnId?})` / `close(id)`；AI 一轮里第一次写入时按 `turnId` 打开（同一轮复用），提供 `closeTurn(turnId)`，在现有 5 处调用 `captureTurnSnapshots` 的地方旁边接上（`turn-runner.js`、秘书三处、`versions/organizer.js`）。没有修改的版本关闭时删掉。
   - 撤回版本：先把涉及记录的当前状态存成 `before-restore` 版本，再按修订倒序写回 `before_json`；某条记录在该版本之后又被改过就跳过，结果里列出跳过的引用。撤回本身也能撤回。
   - 单条恢复：把某条记录恢复到某条修订的状态，同样先留 `before-restore`。
   - 图的修改**不写**工作区的 `revisions` 表（§0：那会让一轮结束时建出找不到资源处理器的历史版本）。
4. **事件**：写入后发 `knowledge.changed`（受影响的引用列表）和 `research.changed`（让向量索引重建实体文档）。
5. **检索接线**（超时可留给 KB-3，报告里写明）：`rb_fts` 写入 `doc_type='entity'` 行（名称、英文名、别名、描述）；`app/services/research/semantic/documents.js` 加实体作第四个向量来源（`ref_type='entity'`），`rb_vec` 维度不变；`research/store.js` 的资料种类加 `link`，`items.js` 的条目类型加 `code`。
6. **文档**：`product/FEATURES.md` 加一节「知识库存储（无界面）」；`architecture/CORE_MODEL.md` 的数据表清单补上新表；`log/IMPLEMENTATION_LOG.md` 一行。

## 可以改的

`app/core/db/migrations/`、新目录 `app/services/knowledge/`、`app/services/turn-runner.js`、`app/services/secretary/`（只加 `closeTurn` 调用）、`app/services/versions/organizer.js`（同上）、`app/services/research/`（第 5 条）、`app/app.js` 或服务装配处（接入新服务）、相关测试、上面三份文档。

## 不做的

- 不做工具（KB-4）、HTTP 接口（KB-5）、项目文件夹索引（KB-2）、派生层和论文卡片（KB-3、KB-6）。
- 不动 `app/ui/`。
- 不加数量上限或审批门（原则 4、5）；列表分页并返回剩余数。
- 不动旧线和 `<预览安装目录>` 及其数据。

## 完成标准

- 干净检出 `npm run check` 全部通过（含 Windows 测试）。
- 迁移测试：空库和已有资料的库都能升级，新表和列存在。
- 功能测试一（场景 4）：模拟一轮 AI 发言写 3 个实体、9 条边（带 `meeting_id`、`turn_id` 和证据），发言结束得到一个 `ai-turn-end` 版本；用户随后改了其中 1 条边；撤回这个版本后其余记录回到原状，被改过的那条被跳过并列出；再撤回这次撤回，又回到撤回前。
- 功能测试二（场景 3）：合并两个实体，边改挂、别名并入；撤回合并后恢复原状。
- 报告里写明第 5 条做了没有、迁移编号是多少。

## 交付

- 分支：`codex/kb-1-knowledge-store-20261019`，从集成分支最新提交开始。报告不超过 15 行，给出远程分支与 SHA。不建 PR、不合并。
