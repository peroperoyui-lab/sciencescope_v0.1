# P1b 内置工具、请求批准与上下文压缩

- 起草：Claude，2026-10-16。依据：用户首测（`reviews/REVIEW_2026-10-16.md` §3 编号 2、16、大7）与用户决定 D3。前置：P1a 已合并。
- 执行：Sol（后端、Windows 验收）；审阅：Claude。批准卡片、执行方式菜单、压缩提示等界面由 Claude 做，本任务**不改 `app/ui/` 的组件和样式**。
- 分三段交付，各自可合并：**1 内置工具**、**2 请求批准**、**3 上下文压缩**。每段约 2 小时，超出就停下汇报。

## P1a 合并后的补充（2026-10-17）

- 从集成分支 `10c83dc` 开始（P1a 与审阅修改都在里面）；分支名改为 `codex/p1b-tools-approval-20261017`。
- 迁移已用到 019（`turns.error` 保存失败原因）；本任务需要的话从 020 开始。拒绝批准和取消不是失败，不写 `turns.error`。
- 活动条目状态变化（等批准 → 允许 / 拒绝 / 取消）用 P1a 已有的 `tool.updated` 或 `tool.ended` 事件；界面已经按 `kind` 分行显示 `thinking` 和 `retry`，`approval`、`compaction` 两种由 Claude 接着做。
- 发言阶段新增的 `waiting-approval`、`compacting` 写进 `port.js` 的类型注释即可，状态行由 Claude 做；`app/ui/features.js` 的 `approval` 开关也由 Claude 打开。

## 用户怎么用

- 让主专家"用 Python 跑一下这份数据"：它写脚本、在项目文件夹里运行，时间线里能看到每条命令和输出。
- 执行方式选"请求批准"时，每条命令、每次写项目文件夹、每次安装包，时间线里先出现一张批准卡片："运行命令 `python analyze.py` · 允许 / 拒绝"。拒绝后模型收到"用户拒绝了"，换别的办法。
- 长对话里，上下文用到设定的百分比（默认 80%）时自动压缩，时间线里出现一行"上下文已自动压缩（12.3 万 → 1.8 万 token）"，对话接着进行。

## 1. 内置工具

DSH 自带的命令、文件和网页工具随 P1a 去掉了，这里补回。它们是 ScienceScope 的宿主工具，写在 `app/services/` 下，和现有工具一样经 `tools.run` 执行、记录活动条目，所有角色共用（原则 2）。

| 工具 | 作用 | 要点 |
|---|---|---|
| `shell` | 在工作目录运行一条命令 | Windows 用 `pwsh`（没有就用 `powershell.exe`），其他系统用 `bash`；`PATH` 带上会议的 Python 环境（沿用 P1a 之前传给 DSH 的 `env`）；默认超时 10 分钟，可传 `timeoutSeconds`；中断或超时时结束整个进程树（Windows 用 `taskkill /T /F`）；返回退出码和输出 |
| `read_file` | 读文本文件 | 相对路径以工作目录为准，也接受绝对路径；可按行分页；二进制文件说明不能读，PDF、Word 提示用资料库工具 |
| `write_file` | 新建或覆盖文件 | 自动建上级目录 |
| `edit_file` | 精确替换文件里的一段文字 | 找不到或匹配多处时报错并说明 |
| `list_files` | 按通配模式列文件 | 跳过 `.git`、`node_modules` |
| `grep_files` | 按正则在文件里搜索 | 返回文件、行号和该行 |
| `web_fetch` | 读取一个网页 | 转成纯文本或 Markdown；结果标明是外部内容（沿用研究资料的标注方式） |

- 输出过长时只按原则 4 处理：保留开头和结尾，写明"共 N 字节，省略了中间 M 字节，完整输出在 `<路径>`"，完整内容存到 `data/temp/`。不设硬上限、不静默截断。
- `data/secret/` 下的文件一律拒绝读写（保留现有的凭据保护）。
- 实现参考 pi 编程智能体的 `bash`、`read`、`write`、`edit`、`grep`、`find` 工具（MIT）：可以复制改写，保留出处注释，不引入 `@earendil-works/pi-coding-agent` 这个包本身。
- 网页搜索（DSH 原来用 DeepSeek 的搜索服务）这次不做；在 `plans/ROADMAP.md` 的"alpha 之后"里记一行，等用户决定用哪个搜索服务。

## 2. 请求批准

- 会议的发言规则加 `approval: 'ask' | 'auto'`（存在 `policy_json`），新会议默认 `'ask'`；已有会议没有这个字段时按 `'ask'` 处理。
- 界面上的执行方式由 Claude 做成三项："请求批准"（`direct` + `ask`）、"常规"（`direct` + `auto`）、"自动化"（`autonomous` + `auto`）。后端只认这两个字段，有序讨论同样适用 `approval`。
- `approval: 'ask'` 时需要批准的操作：
  - `shell`；
  - `write_file`、`edit_file` 写到 ScienceScope 数据目录之外（即项目文件夹或其他位置）；
  - `python_env_install`。
  - 研究资料、工作区（计划、导图、日志等有历史版本可恢复）和读取类工具不需要批准。
- 流程（用 pi-agent-core 的 `beforeToolCall` 或在 `tools.run` 里实现，选一个，说明理由）：
  1. 新建活动条目 `kind: 'approval'`，状态 `pending`，`args` 存 `{ tool, summary }`：命令全文、目标路径（编辑时附改动行数）、要装的包；
  2. 发言阶段设为 `waiting-approval`（端口事件 `phase` 新增这个值），发事件；
  3. 等用户决定：`POST /api/turns/:turnId/approvals/:activityId` `{ decision: 'approve' | 'reject' }`；
  4. 允许就执行；拒绝就给模型返回"用户拒绝了这次操作"，条目状态记为 `rejected`；
  5. 中断、结束目标或程序退出时，待批准的条目记为 `cancelled`，工具返回已取消。
- 自动化目标在等批准时，后台活动显示"等待批准"（发 `goal.changed` 或现有的后台活动事件，选最省事的一种）。
- 推翻了 2026-10-07 的"审批两档不做"：`AGENTS.md` 原则 5 已写明这一例外；`design/INTERACTION_CONTRACTS.md` 加一条 2026-10-16 修订。

## 3. 上下文压缩

- 设置加一项全局的 `context.compactPercent`，默认 80（可取 50–95），所有模型共用（用户 2026-10-16：统一一个百分比门槛）。以前按模型分别设置的压缩相关字段如果有，一并去掉。
- 每次向模型发请求前（pi-agent-core 的 `transformContext` 或 `prepareRequest`），估算这次请求的上下文 token；达到"门槛 × 模型上下文窗口"时：
  1. 发言阶段设为 `compacting`；
  2. 用同一个模型把较早的消息整理成一份工作摘要（一次请求），新上下文为：摘要 + 最近两轮用户消息之后的原文（含进行中这一步的工具结果）；
  3. 保存到会话文件，新建活动条目 `kind: 'compaction'`，`result_json` 存 `{ beforeTokens, afterTokens }`；
  4. 摘要失败时不压缩，照常发请求，在请求日志里记一行。
- 这和秘书纪要是两回事：纪要是会议层面的记录，照旧；压缩只管单个会话的模型上下文。
- 参考 pi 编程智能体的 compaction 和 opencode 的 session compaction 实现。

## 测试

- 每个内置工具一个用户路径测试（在临时目录里）；`shell` 再测中断能结束子进程、超时有说明、过长输出有省略说明。
- 批准：允许后执行、拒绝后模型收到拒绝、中断时待批准条目变为已取消；`auto` 时不出现批准。
- 压缩：用 `fauxProvider` 构造超过门槛的上下文，验证摘要请求、压缩后的上下文和活动条目；摘要失败时照常继续。

## 验收（Windows）

1. 让主专家写一个 Python 脚本并在项目文件夹运行（真实 flash），时间线里有 `shell` 条目、输出和退出码。
2. 执行方式为"请求批准"：同样的任务出现批准条目；拒绝一次、允许一次，结果符合预期。界面卡片如果 Claude 还没做完，用接口验证。
3. 回答进行中点停止：正在运行的命令进程被结束（任务管理器里看不到残留的 `python` 或 `pwsh`）。
4. 把门槛临时调到 50，用一段长对话触发一次压缩，报告压缩前后的 token 和之后的回答是否连贯。
5. 报告请求数和 token。

## 可以改的

`app/services/`（新工具、`tools.js`、`turn-runner.js`）、`app/runtime/pi/`、`app/core/`（发言规则、活动条目）、`app/core/db/migrations/`（需要时）、`app/server/routes/`（批准接口）、`docs/design/INTERACTION_CONTRACTS.md`（一条修订）、`plans/ROADMAP.md`（"alpha 之后"一行）、`log/IMPLEMENTATION_LOG.md`（不超过 5 行）。

## 不做的

- 不改 `app/ui/` 的组件、样式和文案。
- 不做网页搜索、沙箱、受保护路径表（安全仍不是当前重点，只做用户要的批准）。
- 不给批准加"记住本次选择"之类的规则；要长期放行就把执行方式切到"常规"。

## 完成标准

- 干净检出 `npm run check` 通过。
- 验收 1–5 通过；P1a 与 P1b 都合并后，由 Claude 和 Sol 一起出下一个预览安装包，届时再装到用户机器上。

## 交付

- 分支：`codex/p1b-tools-approval-20261017`，从集成分支 `10c83dc` 开始。
- 报告不超过 15 行，给出远程分支与 SHA，写明参考或复制了哪些开源代码。
- 不建 PR、不合并。
