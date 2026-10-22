# KB-10a 知识库节点位置与后台布局

- 起草：Claude，2026-10-20。依据：`architecture/KNOWLEDGE_BASE.md` §7a、§8、§10 KB-10a；`decisions/DECISIONS.md` 2026-10-20（知识库规模方案，按视野加载由用户提出）。接在 KB-5（`routes/knowledge.js`）和 KB-6 之后，Claude 的 KB-10 图视图依赖它。
- 执行：Sol（Windows）；审阅：Claude。约 2 小时，一步交付；超出就停下汇报。

## 目标

知识库图视图不再每次打开都重新排布局，也不一次画完整库。宿主给每个节点存一个位置，后台排好；界面打开时只取全部节点的位置索引，平移到哪里再取那一块的名称和边。本任务做宿主这一半：位置表、后台布局、三个接口。

## 用户会怎么用

本任务没有新界面（图视图是 Claude 的 KB-10）。它支撑这些体验：

- 打开知识库图，几秒内看到整个范围的节点分布；拖动、缩放时只加载视野附近的节点。
- 同一个节点在全局和项目视图里位置相同；新整理出的节点出现在它的邻居旁边，原来的节点不动。
- 用户拖过的节点停在原处，以后自动排列也不动它；删掉的节点留出空位，用户点「重新排列」才整体重排。

## 要做的

1. **位置表**（新迁移，编号用写代码时下一个可用的，报告里写明）：
   `kb_positions(ref TEXT PRIMARY KEY, x REAL NOT NULL, y REAL NOT NULL, pinned INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)`。`ref` 与 KB-1 的节点引用一致（`source:<id>`、`item:<id>`、`entity:<id>`）。全局和项目共用这一套坐标，不分范围存。位置不记修订、不进历史版本（和派生层一样是可重算的索引）。
2. **布局**（`app/services/knowledge/layout.js` 及 worker 文件）：
   - 用 graphology（MIT）和 graphology-layout-forceatlas2（MIT，开 Barnes-Hut），从 npmmirror 安装，写进 `package.json`。在 `worker_threads` 里算，不阻塞主线程；发言进行中照派生层队列的方式让路。
   - **全图布局**：没有任何位置时（第一次），或调用「重新排列」时，对范围内全部 `active` 节点和边排一次。`pinned` 的节点不动。迭代次数按节点数定（写成代码常量），排完一次写库，不持续运行。
   - **新节点局部布局**：新建实体、新资料入库、合并后出现没有位置的节点时，攒一小批（例如停顿 2 秒）再处理：初始位置放在已有位置的邻居的平均点附近，加一点随机偏移；没有邻居的放在当前图的边缘。然后只让新节点做少量迭代，其余节点固定。graphology-layout-forceatlas2 的节点固定方式在开工时核对文档；不支持就自己实现只移动新节点的迭代，并在报告里说明。
   - **删除**：节点改 `removed` 或被删除时删掉它的位置，其余位置不变，空位不补。
   - 事件：位置变化发 `knowledge.layout.changed`（带受影响的 ref，全图重排时只发一次带 `all: true`）。
3. **接口**（加在 `app/server/routes/knowledge.js`，都要口令）：
   - `GET /api/knowledge/layout?projectId=`：范围内全部有位置的节点，紧凑数组 `{nodes: [[ref, x, y, kind, degree], ...], pending}`。范围规则同 §3.3（不传 `projectId` 是全局：`project_id` 为空的资料加各项目的文献，即 `LITERATURE_KINDS`，加全部实体和条目；2026-10-21 所有者决定，见 DECISIONS）。`kind` 用界面的节点种类（source / method / dataset / variable / software / code / concept / person / org 等，和 KB-8 设计稿一致），`degree` 是 `active` 边数。`pending` 是还没排到位置的节点数。不含名称、说明和边。
   - `POST /api/knowledge/viewport {refs, projectId?}`：这些节点的 `{ref, name, kind}`，加上两端都在 `refs` 里的 `active` 边 `{id, from, to, relation, layer, origin, aiUntouched}`。`refs` 不设上限，界面一次大约 1 500 个。
   - `PATCH /api/knowledge/positions {positions: [{ref, x, y, pinned?}]}`：保存拖动后的位置；拖过的节点由界面传 `pinned: true`，取消钉住传 `false`。
   - `POST /api/knowledge/layout/rerun {projectId?}`：排队一次全图重排，立即返回，不等待。`projectId` 只决定参与重排的节点；坐标仍是同一套。
4. **测试和测速**：
   - 功能测试：建几个实体和边 → 首次布局后都有位置；再加一个实体连到其中一个 → 新节点在它的邻居附近，旧节点坐标完全不变；拖动钉住一个节点后重排，它不动；删除一个节点后其余坐标不变；`viewport` 只返回两端都在给定集合里的边。
   - 测速（写在报告里，不写成测试）：合成 5 万个节点、50 万条边，报告全图布局耗时、期间主线程是否有超过 100 毫秒的卡顿、`layout` 响应大小和耗时、`viewport` 取 1 500 个节点的耗时、新增 100 个节点的局部布局耗时。全图布局超过 2 分钟或 `layout` 超过 1 秒时停下汇报。

## 可以改的

`app/services/knowledge/`（新文件及测试）、`app/core/db/migrations/`（新迁移）、`app/server/routes/knowledge.js`、`app/app.js`（接线）、`package.json` / `package-lock.json`（只加 graphology 两个包）、`docs/product/FEATURES.md`、`docs/log/IMPLEMENTATION_LOG.md`（不超过 5 行）。

## 不做的

- 不改 `app/ui/`，不打包 Cytoscape（都是 KB-10）。
- 不做社区发现和聚类（alpha 之后）。
- 不改检索（KB-7）、不改工具结果（KB-4）。
- 不动 `<预览安装目录>` 及其数据。

## 完成标准

- 干净检出 `npm run check` 全部通过（含 Windows 测试）。
- 上面的功能测试通过；报告写出测速结果。
- `FEATURES.md` 写明位置表、三个接口和布局行为。

## 交付

- 分支：`codex/kb-10a-layout-YYYYMMDD`，从集成分支最新提交开始。报告不超过 15 行，给出远程分支与 SHA、新迁移编号、测速结果、所用库的版本和许可证。不建 PR、不合并。
