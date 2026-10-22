# D1 编辑台版本图后端

- 起草：Claude，2026-10-20。依据：`architecture/EDITING_DESK.md`（已定稿）§4.1–4.3、§8、§10 D1；E0 结论（§3.3：自研路线）；`decisions/DECISIONS.md` 2026-10-19（编辑台五条）。
- 执行：Sol（Windows）；审阅：Claude。约 2 小时，一步交付；超出就停下汇报。

## 目标

文稿版本从一条直线变成一张图：每个版本记父版本、分支、层级、标签和标题，界面能一次读出整组的版本图，并能改这些字段。同时建好编辑会话要用的两张表（D3 用），本任务不写会话逻辑。

## 用户会怎么用

本任务没有界面（版本图窗口是 Claude 的 U7）。它支撑这些操作：

- 用户从 v3 改出一版投稿稿，又回到 v3 改出另一版给导师：版本图里 v3 下面分出两条泳道，第二条自动叫「分支 1」，用户可以改名成「给导师」。
- 用户给 v5 标层级「投稿」、标签「10-20 投 JMS」、标题「投稿版」；在设置里把层级「内部审阅」改名成「组会」，已标的版本跟着变。
- 现有的导入、比较、版本说明照常可用，旧版本的父版本就是原来的基准版本。

## 要做的

1. **新迁移**（编号取目录里实际最高号加一，现在是 024，报告里写明）：照 §4.1 给 `version_groups` 加 `source_path`、`format`，给 `manuscript_versions` 加 `parent_id`、`branch`、`tier`、`label`、`title`、`origin`、`content_hash`、`session_id`，`UPDATE manuscript_versions SET parent_id = baseline_id`；建 `desk_sessions`、`desk_changes` 两张表和索引。`manuscript_bindings`、`manuscript_comments` 留给 D6，不在这次建。已有版本的 `content_hash` 在迁移里不算（文件可能不在了），导入时新版本照算（SHA-256）。
2. **版本服务**（`app/services/versions/`，可新增 `graph.js`）：
   - `createVersion({ groupId, parentId, bytes | path, origin, title?, label?, tier?, sessionId? })`：复制原件到现有版本目录结构、编号加一、记 `content_hash`。父版本已有其他子版本时，新版本的 `branch` 自动取「分支 n」（n 取这一组里还没用过的最小正整数）；否则继承父版本的 `branch`。现有导入和「另存为新版本」改为调它（导入的父版本照旧是上一版，`origin='import'`；另存为 `origin='save-as-new'`）。
   - 比较时没有指定基准就用 `parent_id`；现有「改基准」接口不变，只影响比较。
3. **接口**（加在现有 `app/server/routes/versions.js`）：
   - `GET /api/version-groups/:id/graph`：`{ group, nodes }`，每个节点 `{ id, number, parentId, branch, tier, label, title, displayTitle, origin, createdAt, notesExcerpt, instructions }`。`displayTitle` 是标题，空时用原文件名；`notesExcerpt` 是版本说明前 200 字；`instructions` 是这个版本的 `desk_changes` 里不为空的修改指令（去重，最多 10 条，D1 时为空数组）。已删除的版本不返回，但它的子版本的 `parentId` 改指向最近的未删除祖先。
   - `PATCH /api/versions/:id {title?, tier?, label?, branch?}`：改单个版本的标题、层级、标签。`branch` 改的是整条泳道的名字：这一组里所有同名分支的版本一起改；新名字和组里已有分支重名时返回可读错误。改完发 `versions.changed`。
   - `POST /api/version-tiers/rename {from, to}`：改设置 `desk.tiers` 里的名字和所有用了这个层级的版本：先在一个 SQLite 事务里改版本，再照常用 `workspace.edit` 改设置；改设置失败时把版本改回去，返回可读错误。不改 `workspace.edit`，断电等中途失败不另做恢复（两边对不上时版本照原文字显示，不影响使用）。层级被删掉时不动已标的版本（照原文字显示）。
4. **设置**：`desk.tiers`，默认 `["草稿","内部审阅","投稿","修回","终稿"]`，存进现有设置文件；`PATCH /api/versions/:id` 的 `tier` 只接受列表里的名字或空串。`features.editingDesk` 开关不在这次做（U1 由 Claude 加）。

## 可以改的

`app/core/db/migrations/`（新迁移及测试）、`app/services/versions/`（含测试）、`app/server/routes/versions.js`、设置默认值所在的文件（只加 `desk.tiers`）、`docs/product/FEATURES.md`、`docs/log/IMPLEMENTATION_LOG.md`（不超过 5 行）。

## 不做的

- 不改 `app/ui/`（版本图窗口 U7、编辑台页面 U1 由 Claude 做）。
- 不写编辑会话、块更新、保存和关闭（D3），不改比较算法（D4），不建绑定和批注表（D6）。
- 不改工作区的 `revisions` / `resource_snapshots`；版本说明照旧是 `versions` 文本资源。
- 不动 `<预览安装目录>` 及其数据。

## 完成标准

- 干净检出 `npm run check` 全部通过（含 Windows 测试）。
- 迁移测试：旧库升级后 `parent_id` 等于原 `baseline_id`，新表存在。
- 功能测试：导入 v1、v2 → 从 v1 建一个新版本，它的 `branch` 是「分支 1」，再从它建一个继承「分支 1」→ 把「分支 1」改名「给导师」，两版一起变 → 给 v2 标层级和标签 → 改层级名后 v2 跟着变 → `graph` 返回的节点、父子关系和 `displayTitle` 正确；删掉中间一版后，子版本的 `parentId` 指向它的父版本。
- `FEATURES.md` 写明版本图字段、三个接口和层级设置。

## 交付

- 分支：`codex/d1-version-graph-YYYYMMDD`，从集成分支最新提交开始。报告不超过 15 行，给出远程分支与 SHA、迁移编号。不建 PR、不合并。
