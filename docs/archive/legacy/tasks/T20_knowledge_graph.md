# T20 · 资料库图层：确认层 / 派生层、图检索、整理提议与审核、图视图

- 下达：Claude，2026-09-27。执行：Astra（后端，以及本任务书写明的界面），Claude 审阅。通用约定见 `RB_COMMON.md`、`QUEUE.md`。
- 设计：`docs/design/KNOWLEDGE_GRAPH.md`（先读完）。依赖：T10（向量检索）、T06（引用元数据）、T17（范围表与工具清单）、T05（收件箱界面）。
- 交付：`codex/t20-knowledge-graph-YYYYMMDD`。不开 PR、不合并。按设计 §7 先做实测，再定默认值。

## 后端

1. 新表（新模块 `scripts/research-base/graph.mjs`，`CREATE TABLE IF NOT EXISTS` + 迁移）：
   - `rb_entities(id, kind, name, aliases_json, scope, project_id, status 'confirmed', created_at, updated_at)`；
   - `rb_entity_mentions(entity_id, chunk_id, span, confidence, extractor_version)`，派生层；
   - `rb_memberships(project_id, ref_type, ref_id, added_at)`；
   - `rb_derived_edges(from_ref, to_ref, relation, weight, source 'cooccurrence'|'citation'|'extractor', version)`。
   - `rb_links` 的端点增加 `entity`。
2. 派生层：
   - 索引流程中抽取实体提及：先用规则加词表，便宜模型作为可选项，每篇论文设 token 上限；
   - 共现边和 T06 引用边写入派生表，可整体重算，重算时带版本号。
3. 图检索：`research_search` 增加可选参数 `expand: 0|1|2`（默认 1）。
   - 从混合检索的种子出发，在确认层上做个性化 PageRank；派生层权重较低；
   - 结果带 `via` 路径说明。
   - 用第 1 批的 52 题评测集对比开启前后的得分，把结果写进 DESKTOP_IMPLEMENTATION。
4. 智能体工具（经 T17 的工具清单下发，范围由范围表决定）：
   - `graph_query({seed?, query?, kinds?, depth?, limit?})`，只读；
   - `graph_propose({title, rationale, changes:[…]})`：操作包括 `add_node`、`add_edge`、`merge`、`rename`、`retype`、`remove_edge`、`confirm_derived`、`flag_contradiction`，每项附理由与证据引用。
   - 提议写入 `rb_proposals`，kind 为 `graph`，作为一个整理方案，可以逐项决定。
   - **不接受的提议不写入确认层，也不影响检索。**
5. 接受后写入确认层，并记录修订（`rb_revisions`），可以撤销；撤销冲突时返回 409。
6. 接口：`GET /api/research/graph?projectId&seed&depth`、`GET /api/research/graph/overview`、`GET /api/research/graph/map`（语义地图的 2D 坐标，后台计算并缓存）、提议决定沿用 `proposals/decide`（增加逐项决定）。

## 界面（数据库页；Claude 审阅；浅色 / 深色、中文 / 英文截图）

- 新增页签：**概念图谱**、**引用网络**、**语义地图**、**库健康**。表格视图由 T05 负责。
  - 绘图用 sigma.js + graphology（MIT），加入 `VENDOR_ASSETS`。
  - 确认层用实线，派生层用虚线并标"自动"。
- 点击节点打开侧栏：
  - 节点详情；
  - 相连的条目与来源（点击在阅读器中打开）；
  - 所属项目；
  - "让秘书整理这里"按钮：生成一个整理请求，结果进收件箱。
- 收件箱中的"图谱整理"卡片：以差异方式显示（新增为绿色、删除为红色、合并时显示箭头），可以逐项接受、修改后接受或拒绝，也可以整体接受。
- 库健康：列出重复、解析失败、缺元数据、孤立条目、矛盾的主张；每项可以一键生成整理请求。

## 验收

- 单元测试：
  - 迁移；
  - 派生层可以重算；
  - 扩展检索的路径说明正确；
  - 秘书读不到其他项目，全局助手能读到，所有角色都读不到私有条目；
  - 未接受的提议不影响检索；
  - 逐项接受与撤销，撤销冲突返回 409。
- 真实 DSH：四种角色拿到的 `graph_query` / `graph_propose` 及其参数正确。
- 真实便宜模型评测：
  - 52 题检索对比（`expand` 为 0 和 1）；
  - 让秘书整理一个故意放入重复实体的项目，检查提议质量，以及整理方案是否只在接受后生效。
- 浏览器 smoke `research-graph-ui-smoke`：四个页签、节点侧栏、收件箱的差异审核、撤销。
- 文档：SYSTEM_SPEC 2.17（资料库）与接口 / 数据表索引、ROADMAP、`design/KNOWLEDGE_GRAPH.md` 的状态。
