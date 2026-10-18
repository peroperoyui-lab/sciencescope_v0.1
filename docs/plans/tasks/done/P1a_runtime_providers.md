# P1a 运行时与服务商：用 pi-ai 替换 DSH

- 起草：Claude，2026-10-16。依据：用户首测（`REVIEW_2026-10-16.md` §1 第 2、3 条，§3 编号 1、2、大3）与用户决定 D2。
- 执行：Sol（后端、Windows 验收）；审阅：Claude。界面由 Claude 另做（`ROADMAP.md` P1-UI），本任务**不改 `app/ui/` 的组件和样式**，只提供接口和事件。
- 第 0 步单独提交；第 1–9 步约 2 小时一段，按"可合并"分段推送，每段跑一次 `npm run check`。超出就停下汇报。
- 本任务合并后、P1b 合并前**不出安装包**：P1a 去掉了 DSH 自带的命令、文件和网页工具，P1b 补回。

## 用户怎么用

1. 设置 → 模型与服务：点"OpenCode Go"或"DeepSeek"，只粘贴密钥，点"测试连接"，看到"连接正常 · 1.2 秒"。
2. 回到对话，输入栏里选模型和思考强度，发送。状态行依次显示"已发送 → 连接中 → 思考中 → 回答中"，调用工具时显示"正在调用工具"。
3. 点方形中断按钮，2 秒内停下，已经写出的内容保留。
4. 断网、密钥错、额度用完时，回答位置显示一句看得懂的原因和"重试"，而不是一直转圈。

## 选型（已定，不用再比较）

- `@earendil-works/pi-ai@1.0.0` 与 `@earendil-works/pi-agent-core@1.0.0`，MIT，2026-10-01 发布。精确锁版本。
- 理由：DSH 本身就是用 pi-ai（0.85.1）发请求的，首测里能用的 DeepSeek 官方接口走的就是它；我们设置里的接口类型 `openai-completions` / `openai-responses` / `anthropic-messages` 正是 pi-ai 的命名，旧的服务商配置不用迁移。pi-ai 内置 `opencode-go` 和 `deepseek` 两个服务商，带完整的模型目录（地址、每个模型的接口类型、兼容参数、上下文窗口、最大输出、支持的思考强度）。pi-agent-core 提供工具循环、`beforeToolCall`（P1b 的批准用它）、`transformContext`（P1b 的压缩用它）和 `abort()`。
- 两个包的 README 都要读完再动手：Abort、Error Handling、Stop Reasons、Thinking、createProvider、OpenAI Compatibility、Faux Provider、Credential Store；agent-core 的 Event Flow、Agent Options、Control。
- 参考实现：pi 编程智能体（同一仓库的 `coding-agent`）怎么组合这两个包；opencode 的 session 处理。可以照抄思路，复制代码要保留出处注释。

## 第 0 步：启动耗时测量（只测不改，单独提交）

用户反馈"启动慢，肉眼可见的慢"。先量清楚：
- 在原生外壳和 `app/main.js` 里加时间点，写到 `data/logs/startup.log`（每次启动一行 JSON，保留，不是临时代码）：外壳进程开始、Node 子进程启动、`createApp` 开始与结束（其中 `createCore`、`semantic.start()`、Python 服务各自耗时）、HTTP 开始监听、页面首次渲染完成（页面调一个接口报告）。
- 在用户首测用的同一台机器上，冷启动（重启电脑后第一次）和热启动各 3 次，报告每段耗时。**不动 `<预览安装目录>`**，用 R6a-3 的测试产品名装一份。
- 这一步不做任何优化。

## 第 1–9 步

### 1. 依赖

- 加 `@earendil-works/pi-ai@1.0.0`、`@earendil-works/pi-agent-core@1.0.0`（`dependencies`，精确版本）。
- `@deepseek-ai/dsh`、`@deepseek-ai/dsh-sdk-client` 移到 `devDependencies`：旧线（`desktop/`、`adapters/`）在开发时还能跑，R5 再删；打包用 `npm ci --omit=dev`，安装包里就不再有 DSH。
- 锁文件里的下载地址保持默认 registry，不写死镜像（R6a-1 的教训）；本机下载走镜像照 `AGENTS.md`。

### 2. 新运行时 `app/runtime/pi/`

- 实现 `app/runtime/port.js` 的全部方法：`startSession`、`send`、`interrupt`、`setInstructions`、`release`、`close`。没有子进程、没有本地 HTTP 桥。
- `app/app.js` 默认用它，`runtimeName` 改为 `'pi'`。`turn-runner.js` 已有的逻辑会让旧 DSH 会话按会议记录重建（`saved.runtime !== runtimeName`），不需要迁移旧会话。
- `ModelChoice.effort` 映射到 pi 的思考强度（`off`…`max`）；为空时不传，用模型默认。`maxTokens` 照传。
- 宿主工具（`services/tools.js` 的 `specs`）转成 pi 的工具定义：把字段描述转成 JSON Schema（可用 `Type.Unsafe`），执行时调 `onToolCall`，把 pi 的 `signal` 一并传下去。`noTools` 时不注册任何工具。
- 删除 `app/runtime/dsh/` 及其测试。

### 3. 服务商与模型目录

- 设置里的服务商条目加可选字段 `preset`：
  - `preset: 'opencode-go'` 或 `'deepseek'`：用 pi-ai 内置的服务商，地址、接口类型、模型目录都来自 pi-ai，用户只提供密钥。
  - 没有 `preset`：自定义服务商，沿用现有字段（`baseUrl`、`api`、`keyRef`、`headers`、`models`），用 `createProvider` 建。
- 密钥：实现 pi-ai 的 `CredentialStore`，从 `secret/credentials.yaml` 按 `keyRef` 读取。密钥不进环境变量、不进日志、不回传前端（原则 5）。pi-ai 内置服务商默认会读 `OPENCODE_API_KEY` 等环境变量，要确保只用我们的存储。
- 模型容量**全部自动获取**，不再让用户手填（用户 2026-10-16）：
  - 内置服务商：用 pi-ai 目录里的值；
  - 自定义服务商：按模型 ID 在 pi-ai 全部内置目录里精确匹配，找到就用；
  - 都没有：上下文 131,072、最大输出 32,768，标明是默认值。
  - 设置里旧的手填 `contextWindow` / `maxTokens` 不再读取。
- 新接口（Claude 按这个做界面，字段名请照用；要改先说）：
  - `GET /api/providers/presets` → `[{ id, name, keyHint, modelCount }]`，目前两项：OpenCode Go、DeepSeek。
  - `POST /api/providers/presets/:presetId` `{ key }` → 新建或更新该服务商条目（`id` 等于 preset id），保存密钥，返回条目（不含密钥）。条目的 `models` 写入目录里的模型 ID 和名称，现有界面的模型菜单因此能直接选到；容量和思考强度仍以模型目录为准。
  - `POST /api/providers/:providerId/test` `{ model? }` → 用该服务商的一个模型发一条极短的请求，返回 `{ ok, model, latencyMs }` 或 `{ ok: false, error: { status, message } }`；`message` 是第 4 步的中文说明。
  - `GET /api/models` → `{ providers: [{ id, name, preset, hasKey, models: [{ id, name, contextWindow, maxTokens, limitsSource: 'catalog' | 'matched' | 'default', reasoning, thinkingLevels, input }] }] }`。`thinkingLevels` 来自 `getSupportedThinkingLevels`。现在各处读 `provider.models[].contextWindow` 和 `efforts` 的地方（秘书、记忆、上下文环）改为用同一个模型目录服务。
  - 现有的 `/api/providers/discover` 保留给自定义服务商。

### 4. 请求控制：超时、重试、中断

- **超时**，常量集中在 `app/runtime/pi/limits.js`，不做成设置：
  - 从发出请求到收到第一个流事件（包括思考内容）：90 秒；
  - 流开始后两个事件之间：120 秒；
  - SDK 的整体超时设为 60 分钟，只作兜底，长输出不应被它打断。
  - 超时就中断这次请求（AbortSignal），按下面的规则重试或结束。
- **重试**：SDK 自带的重试关掉（`maxRetries: 0`），由我们的循环做，这样重试看得见、能中断。
  - 只在这次尝试还没有写出可见内容时重试：网络错误、超时、429、5xx；最多 3 次尝试，间隔 2 秒、6 秒，服务商给了 `Retry-After` 就照它（不超过 60 秒）。可以用 pi-ai 的 `utils/retry`。
  - 401、403、404、400 和上下文超长不重试，直接结束。
  - 已经写出内容后失败：不自动重试，保留已写内容，状态为失败，用户点"重试"。
- **错误说明**：把常见错误翻成一句中文，带上 HTTP 状态码，例如：
  - 401/403："密钥无效或没有权限（HTTP 401）。请在设置里检查 OpenCode Go 的密钥。"
  - 404："找不到这个模型或接口地址（HTTP 404）。"
  - 429："请求太频繁或额度已用完（HTTP 429），稍后再试。"
  - 5xx："服务暂时不可用（HTTP 503），已重试 3 次。"
  - 连不上："连不上 opencode.ai，请检查网络或代理。"
  - 超时："模型 120 秒没有返回新内容，已停止。"
  - 上下文超长（可用 pi-ai 的 `isContextOverflow` 判断）："内容超过了模型的上下文容量。"
- **中断**：`interrupt` 直接中止进行中的请求和工具调用（工具收到的 `signal` 触发），`send` 在 2 秒内返回 `stopReason: 'cancelled'`，已写出的文字保留。不要再出现"界面显示已停止、后台还在等"。

### 5. 阶段、思考与重试事件

运行时端口新增事件（写进 `port.js` 的类型注释）：

```
{ type: 'phase', phase: 'connecting' | 'thinking' | 'answering' | 'tool' | 'retrying' }
{ type: 'thinking-delta', delta: string }
{ type: 'retry', attempt: number, maxAttempts: number, error: string, delayMs: number }
```

- `text-delta` 改为真正的逐字流式（DSH 是整段结束后一次发出）。
- 迁移 018：
  - `turns` 加 `phase TEXT NOT NULL DEFAULT ''`。`turn-runner.js` 收到 `phase` 时更新，值变化才写库并发事件 `turn.phase`；发言结束时清空。界面据此显示状态行，"已发送"是发言已创建、还没有阶段。
  - `tool_calls` 加 `kind TEXT NOT NULL DEFAULT 'tool'`，让它成为一次发言的"活动条目"列表，按 `seq` 排序：
    - `kind: 'thinking'`：一段连续的思考内容，`name` 为 `thinking`，全文存在 `result_json`。流式更新至多每 500 毫秒写一次库、发一次事件；
    - `kind: 'retry'`：一次重试，`result_json` 存 `{ attempt, maxAttempts, error }`；
    - P1b 还会加 `approval` 和 `compaction`。
  - 已有读取工具调用的接口原样带出 `kind`，前端由 Claude 改。
- 前言（模型在调用工具前写的话）照现有逻辑归到工具条目上。

### 6. 请求日志

- 每次模型请求写一行 JSON 到 `data/logs/model-requests.jsonl`：时间、会话、服务商、模型、接口类型、主机名、HTTP 状态码、总耗时、首个事件耗时、结束原因、错误说明、用量。
- **不记**密钥、请求头、请求体和回答内容。
- 超过 5 MB 时改名为 `model-requests.previous.jsonl`，只保留一份旧的。
- 用户以后反馈"模型没反应"时，这个文件就是第一手证据。

### 7. 会话保存与恢复

- 每个会话的模型上下文（pi 的消息列表，含思考、工具调用和结果）存到 `data/runtime/pi/sessions/<sessionId>.json`，每完成一步写一次，先写临时文件再改名。
- `startSession({ sessionId })` 读这个文件恢复；文件不存在或损坏就抛错，`turn-runner.js` 会按会议记录重建。
- `release` 只释放内存。恢复时换模型或思考强度要能直接生效（pi-ai 支持跨服务商接着用同一份上下文）。

### 8. 用量与上下文

- `send` 的返回照旧带 `usage`：汇总本次所有请求的输入、输出、缓存读写、推理 token 和请求数，字段名沿用现有的（`docs/design/RUNTIME_PORT.md` §4 T24）。
- `usage.context = { usedTokens, contextWindow, estimated }`，供输入栏的上下文环使用：`usedTokens` 取最后一次请求的实际输入加输出，`contextWindow` 取模型目录。

### 9. 测试

- 运行时测试用 pi-ai 的 `fauxProvider`，不联网：逐字流式、思考事件、工具调用往返、中断 2 秒内返回、首个事件超时、流中空闲超时、重试后成功、401 不重试、保存后恢复、`usage.context`。超时常量允许测试注入更短的值。
- 再加一个用本地 HTTP 假服务器（OpenAI 兼容的流式接口）的测试，走真实的 `openai-completions` 代码，验证中断时连接确实断开。
- `turn-runner` 的测试补阶段和活动条目；脚本运行时（`runtime/scripted.js`）同步支持新事件。
- 一个用户路径一个测试（`AGENTS.md`），不写防御分支的测试矩阵。

## 验收（Windows，干净检出）

先在开发环境（`npm run start:app`）上验收；界面里的快速配置入口由 Claude 另做，这次用接口验证：
1. 空白数据目录：用 `POST /api/providers/presets/opencode-go` 和 `/deepseek` 加两个服务商（真实密钥），`/test` 都返回 `ok`。
2. 用现有界面，主对话分别用 OpenCode Go 的 `deepseek-v4.1-flash` 和 DeepSeek 官方各完成一轮带工具调用的回答；秘书更新一次纪要；全局助手回答一次。报告请求数和 token。
3. 回答进行中点停止：2 秒内停下，文字保留，`model-requests.jsonl` 里有这次请求、结束原因为中断。
4. 断网（禁用网卡）后发送：重试过程有 `retry` 条目，最后显示"连不上…"。
5. 故意填错密钥：立即显示"密钥无效…"，没有重试。
6. 打包一次（不安装，不出给用户）：报告 `node_modules` 里是否还有 `@deepseek-ai`、文件数、程序大小、安装包大小，和 R6a-3 的数字对比。

## 可以改的

`app/runtime/`、`app/app.js`、`app/services/turn-runner.js`、`app/services/providers.js`、`app/services/secretary/`、`app/services/memory/` 中读模型容量的地方、`app/server/routes/providers.js`（及新的模型目录路由）、`app/core/turns.js`、`app/core/db/migrations/`、`app/main.js` 与原生外壳的启动时间点、`package.json`、`package-lock.json`、`DESKTOP_IMPLEMENTATION.md`（不超过 5 行）。

## 不做的

- 不改 `app/ui/` 的组件、样式和文案；前端读的数据结构有变化时，只保证接口照上面的字段给出，界面由 Claude 改。
- 不实现命令、文件、网页工具和批准、压缩（P1b）。
- 不加新的服务商预设，不做 OAuth 登录。
- 不删 `desktop/`、`scripts/`、`adapters/`（R5）。
- 不动 `<预览安装目录>`。

## 完成标准

- 干净检出 `npm run check` 通过（Linux 上 Claude 会重跑）。
- 验收 1–6 全部通过，第 2 步报告请求数和 token，第 6 步给出体积对比。
- 第 0 步给出冷、热启动各段耗时。

## 交付

- 分支：`codex/p1a-runtime-providers-20261016`，从集成分支最新提交开始；第 0 步可以是同一分支上的第一个提交。
- 报告不超过 15 行，给出远程分支与 SHA，写明参考或复制了哪些开源代码。
- 不建 PR、不合并。
