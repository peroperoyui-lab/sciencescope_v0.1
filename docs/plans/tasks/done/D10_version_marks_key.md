# D10 版本的「标记」和「重点」（后端）

- 起草：Claude，2026-10-26。依据：Yui 2026-10-25 版本树右键加「标记」「重点」，专家能读到（`architecture/EDITING_DESK.md` §10 U7 补充）；U7 界面由 Claude 做，本任务只做后端。
- 执行：Sol；审阅：Claude。约 1 小时，一步交付；超出就停下汇报。

## 目标

版本能带一段描述（标记）和一个「重点」标志；界面和专家都能读写描述、设重点。

## 用户会怎么用

- 版本树里右键 v5 →「标记…」，写「导师看过的版本，第三章按他的意见改了」，节点和详情里显示这段话，筛选框按它找得到。
- 右键 v5 →「设为重点」，节点用着重色；比较时选版本，重点版本排在前面。
- 在对话里说「和重点版本比一下现在第三章改了什么」，专家先读版本列表，找到 v5 是重点版本，再去比较。

## 要做的

1. **迁移 030**：`manuscript_versions` 加 `description TEXT NOT NULL DEFAULT ''` 和 `is_key INTEGER NOT NULL DEFAULT 0`。现有 `label` 不动（它是简短标签，界面已在用）。迁移测试照 028 的样子写。
2. **读**：`versions/graph.js` 的 `graph()`、`GET /api/versions`、`GET /api/versions/:id` 返回 `description` 和 `key`（布尔）。
3. **写**：`PATCH /api/versions/:id` 接受 `description`（去掉首尾空白，最多 2,000 字，超了报 `VERSION_DESCRIPTION_TOO_LONG`）和 `key`（布尔，别的类型报错）。只改传了的字段；和现有 title/label/tier/branch 同一事务、同样发 `catalog.changed`（原因写 `marked` 或 `key-changed`，界面据此刷新）。
4. **专家读**：专家能拿到某份文稿的版本列表，每项有 `number`、`id`、`branch`、`tier`、`title`、`description`、`key`、`parentId`、`origin`、`createdAt`。优先挂在现有 `workspace_read manuscript` 上（例如一个列出版本的参数），不另起工具；工具说明里写一句「重点版本是用户标出的关键版本，比较时优先考虑」。专家只读，不能改描述和重点。
5. **专家写不了**：`workspace_edit manuscript` 收到改描述或重点的请求时报清楚的错误（或不提供这个操作），并有测试。

## 可以改的

`app/core/db/migrations/`、`app/services/versions/`、`app/server/routes/versions.js`、`app/services/desk/manuscript-tools.js`（或专家读文稿的工具所在文件），以及相应测试和 `docs/architecture/EDITING_DESK.md` §4.1、§8 的字段和接口说明。

## 不做的

- 不改 `app/ui/`（版本树界面是 Claude 的 U7）。
- 不做版本树布局、分支折叠、「在版本树里定位」。
- 仓库是公开的，不提交真实稿件、个人路径或密钥。

## 完成标准

- 迁移、读、写、专家读各有测试；旧数据迁移后描述为空、不是重点。
- 干净检出 `npm run check` 全部通过（含 Windows 测试），报通过数。
- `EDITING_DESK.md` 的数据模型和接口表已更新。

## 交付

分支 `codex/d10-version-marks-YYYYMMDD`，从 `main` 最新提交开始。报告不超过 15 行，给出远程分支与 SHA。不建 PR、不合并。
