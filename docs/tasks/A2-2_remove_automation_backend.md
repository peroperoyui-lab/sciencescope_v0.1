# A2-2 删掉自动化（后端）

- 起草：Claude，2026-10-18。依据：用户 2026-10-18 决定删掉「自动化」执行方式和目标功能，只留请求批准和常规（`REVIEW_2026-10-18.md` 第 19 条）。界面部分 Claude 已删（输入栏执行方式只剩两档，目标面板、轮数输入、`goal.changed` 订阅都已去掉）。
- 执行：Sol（Windows）；审阅：Claude。约 1 小时，一步交付；超出就停下汇报。可以接在 A2-1 后面做，也可以和 A2-1 放在同一个分支里分两个提交。

## 目标

后端不再有目标服务：没有自动化发言规则、目标表的读写、目标接口和 `goal_update` 工具。已经用过自动化的旧对话升级后照常是普通对话，发消息就回答。

## 用户会怎么用

- 打开以前用过自动化的对话（包括目标停在「已暂停」「需要处理」的），发一条消息：主专家像普通对话一样回答，不会被目标吞掉或自己继续跑。
- 新对话里看不到任何自动化相关的东西（界面已删）。

## 要做的

1. 新迁移（编号接 019 之后）：把 `meetings` 里 `policy.mode = 'autonomous'` 的改成 `'direct'`，删掉 `policy.goal`；删除 `meeting_goals` 表。旧数据里的目标文本不需要保留（用户已决定删掉这个功能）。
2. 删除 `app/core/goals.js` 及其在 `app/core/index.js` 的接线；`app/core/meetings.js` 去掉 `autonomous` 类型和「请先结束目标」那段检查。
3. `app/services/conductor.js`：去掉目标调度（`scheduleGoal`、`resumeGoal`、`startGoal`、`controlGoal`、停止时暂停目标等），`onMessage` 只分 `round` 和普通；`conductor-round.js` 开头注释随之改。
4. `app/services/context-assembly.js`：去掉 `automationInput`。
5. `app/services/tools.js`：去掉 `goal_update` 工具。
6. `app/services/approvals.js`：去掉 `goal.changed` 相关的两段（批准等待时发目标事件、目标结束时取消批准）。停止回答、关闭程序时取消批准的行为不变。
7. `app/server/routes/meetings.js`：删除 `/api/meetings/:id/goal` 三个接口；`/api/activity` 不再返回 `goals` 字段（界面已不读）。
8. 测试：删除 `app/services/automation.test.js`；`approvals.test.js` 里的 `goal` 情形删掉，其余三种保留；加一条迁移测试：一个 `autonomous` 会议带一条 `paused` 目标，迁移后是 `direct`，发消息得到普通回答。
9. 文档：`SYSTEM_SPEC.md` 删除新核心里自动化的描述（旧线 2.3 节保留原样，那是旧原型），`02_INTERACTION_CONTRACTS.md` 去掉目标接口；`DESKTOP_IMPLEMENTATION.md` 一行。

## 可以改的

上面列出的文件、`app/core/db/migrations/`、相关测试和文档。

## 不做的

- 不动 `app/ui/`（界面已删完）。
- 不动旧线（`desktop/`、`scripts/`）。
- 不动 `<预览安装目录>` 及其数据。

## 完成标准

- 干净检出 `npm run check` 全部通过（含 2 项 Windows 测试）。
- `rg -n "goal" app --glob '!**/i18n/**'` 只剩研究目标、纪要和记忆分类这类无关用法，报告里列出剩下的几处。
- 用一份带自动化旧对话的数据目录副本（不是用户的 `<预览安装目录>\data`）启动，打开那个对话发一条消息能正常回答。

## 交付

- 分支：`codex/a2-2-remove-automation-20261018`（或并进 A2-1 分支，报告里写明）。报告不超过 15 行，给出远程分支与 SHA。不建 PR、不合并。
