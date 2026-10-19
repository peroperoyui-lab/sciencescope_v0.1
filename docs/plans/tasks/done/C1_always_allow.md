# C1 「总是允许」：规则、匹配和接口

- 起草：Claude，2026-10-19。依据：`plans/C_PERMISSIONS_RUNTIME.md` §1、§7（用户 2026-10-19 已定）；`decisions/DECISIONS.md` 2026-10-19「总是允许」一条；复盘 `reviews/REVIEW_2026-10-18.md` C 组第 5 条。
- 执行：Sol（Windows）；审阅：Claude。约 1.5 小时，一步交付；超出就停下汇报。

## 目标

1. 用户批准一次操作时可以选「总是允许」并选一个范围，之后同一项目里同类操作不再问。
2. 规则每个项目分开记（用户原话：「每个项目分开记录」）；不属于项目的单独对话，规则只管那个对话。

## 用户会怎么用

- 项目 A 的对话里专家要跑 `python analysis.py`，卡片上用户选「总是允许 → 以 python 开头的命令」。之后项目 A 里任何对话跑 `python plot.py` 都直接执行，时间线照常有这一步，细节写「按规则自动允许」。项目 B 里跑 `python` 仍然要问。
- 专家要跑 `python a.py && rm -rf out`：前缀规则不算命中，仍然弹卡片。
- 用户在设置里删掉一条规则后，下一次同类操作又会问。
- 卡片菜单和设置页由 Claude 做（C1-UI），本任务只交后端。

## 要做的

1. **规则存储**：设置 `approvals.rules`（`app/core/workspace/resources/settings.js` 默认 `[]`），每条 `{ id, projectId, meetingId, tool, kind, value, createdAt }`：
   - 项目里的对话记 `projectId`、`meetingId: null`；单独对话（会议 `projectId` 为空）记 `meetingId`、`projectId: null`。
   - `kind`：`exact`（命令完全一致）、`prefix`（命令前缀）、`folder`（绝对路径，含子文件夹）、`package`（包名）、`any`（这个工具的所有操作，只给安装包用）。
2. **范围候选**：新函数（放在 `app/services/approvals.js` 或同目录新文件 `approval-rules.js`）按工具和参数生成菜单候选，随批准请求一起存进 `args.scopes`，界面直接用：
   - `shell`：`exact` 整条命令；`prefix` 取第一个词，`npm`、`npx`、`git`、`uv`、`pip`、`conda` 取前两个词。命令含 `;`、`&&`、`||`、`|`、反引号或 `$(` 时只给 `exact`。
   - `write_file` / `edit_file`：`exact` 这个文件（绝对路径）；`folder` 它所在的文件夹。
   - `python_env_install`：每个包一条 `package`；再加一条 `any`。
   - 每个候选带一句给用户看的说明，如「以 python 开头的命令」「这个文件夹里的文件」（中英文都进 `app/ui/i18n/en.js`）。
3. **匹配**：`approvals.request`（`summaryFor` 之前或之中）先查当前会议所属项目（或这个单独对话）的规则：
   - `prefix` 命中要求命令以该前缀加空格开头或完全相等，并且命令里没有第 2 条列出的连接符。
   - `folder` 命中要求目标真实路径在该文件夹内（用现有的 `realpath` 处理方式）。
   - 命中：不建卡片，直接执行；这一步的工具调用记录里写 `approvedBy: { ruleId }`，供时间线显示「按规则自动允许」。
4. **接口**：`POST /api/turns/:turnId/approvals/:activityId` 的 `decision` 加 `always`，带 `scope`（`args.scopes` 里的一项）。效果是允许这一次，并写入一条规则。规则的查看和删除用现有设置读写，不另加接口。
5. **文档**：`docs/product/FEATURES.md` 批准一节写明规则和范围；`docs/log/IMPLEMENTATION_LOG.md` 不超过 5 行。

## 可以改的

`app/services/approvals.js`（及同目录新文件）、`app/server/routes/approvals.js`、`app/core/workspace/resources/settings.js`、`app/ui/i18n/en.js`（只加候选说明的英文）、相关测试、`docs/product/FEATURES.md`、`docs/log/IMPLEMENTATION_LOG.md`。

## 不做的

- 不改 `app/ui/` 的组件和样式（`en.js` 除外）；卡片菜单、设置里的规则列表由 Claude 做。
- 不加迁移（规则放设置里）。
- 不动 `<预览安装目录>` 及其数据。

## 完成标准

- 干净检出 `npm run check` 全部通过（含 Windows 测试）。
- 一个功能测试走完：请求批准 → `always` + `prefix` → 同项目另一对话同前缀命令不再请求；带 `&&` 的仍请求；另一项目仍请求；删规则后又请求。另加文件夹规则一条断言。
- 真实模型：OpenCode Go `deepseek-v4.1-flash` 在请求批准模式下让专家跑两条 `python` 命令，第一条选总是允许，第二条自动执行。报告请求数和 token。
- 报告里写清 `args.scopes` 的字段和 `approvedBy` 放在哪里，Claude 做界面要用。

## 交付

- 分支：`codex/c1-always-allow-YYYYMMDD`，从集成分支最新提交开始（A2-2 合并之后）。报告不超过 15 行，给出远程分支与 SHA。不建 PR、不合并。
