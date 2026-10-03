# 运行时接口（Runtime Port）· 初稿

- 起草：Claude，2026-10-03。状态：**初稿**，描述现有 DSH 适配层实际提供的能力；T23 负责补全契约测试与会话导出。
- 目的：ScienceScope 的产品代码只依赖本文件描述的接口，不依赖 DSH。将来如果更换或自研智能体运行时，新实现只要满足本接口并通过契约测试，就可以逐步替换。
- 原则：
  1. **只有 `adapters/runtime-*/` 可以 import 运行时的包。** 当前 `desktop/`、`scripts/` 中没有任何 `@deepseek-ai/*` 引用，要保持。
  2. 新功能需要运行时能力时，先在本文件中增加接口（语义、参数、事件），再在适配层实现；不允许产品代码绕过接口使用 DSH 的内部服务。
  3. **用户数据归宿主所有**：对话元数据、展示记录、纪要、资料库、设置都在宿主 SQLite。运行时只保存模型上下文历史（见 §7）。
  4. 运行时的标识（如 `session-…`）在宿主中只作为不透明字符串保存，不解析其格式。

## 1. 组成

| 部分 | 当前实现 | 说明 |
|---|---|---|
| 会话宿主 `RuntimeHost` | `adapters/runtime-dsh/host.mjs` → `createDshHost(options)` | 每个活跃会话一个运行时子进程，经本地 HTTP 控制端点（`session-control.mjs`）通信 |
| 服务商配置 `ProviderService` | `provider-service.mjs` + `web-host.mjs`（DSH web 进程） | 服务商、模型、凭据 |
| 技能管理 `SkillManager` | `skill-manager.mjs` | 技能目录的列出、启停、导入、删除 |
| 宿主工具回调 | `host.setToolHandler(handler)` | 运行时调用宿主提供的工具（资料库、上下文查阅、Python 安装等） |
| 安全策略插件 | `protected-path-policy.mjs`、`credential-isolation.mjs` | 受保护路径、凭据位置、会话环境清理（T21） |

## 2. 宿主创建

`createRuntimeHost(options)`（当前名 `createDshHost`）：

| 参数 | 含义 |
|---|---|
| `home` | 运行时数据目录（会话日志、设置）。整体属于受保护路径 |
| `cwd` | 默认工作目录（项目根） |
| `credentialPath` | 凭据文件位置（`secret/credentials.yaml`） |
| `protectedPaths` | 受保护路径表（T21） |
| `env` | 额外环境变量；服务商 key 不得经此进入会话进程 |
| `sessionHeaders` | 测试夹具用的请求头标记 |

返回对象另带 `capabilities`（能力声明，见 §8）。`close()` 结束所有会话及其子进程树，取消所有待审批请求。

## 3. 会话生命周期

| 方法 | 语义 |
|---|---|
| `startSession({model, workspace, runtimeConfig, sessionId?, noTools?, persona?, proposalTargetChatId?, sessionEnv?})` → `sessionId` | 启动或恢复会话。给出已有 `sessionId` 时必须恢复其完整模型上下文。`model = {providerId, modelId, reasoningEffort?}`。`sessionEnv` 是 Python 环境等会话环境；同一会话不能以不同环境重复启动（需先 `releaseSession`） |
| `send({sessionId, text, onEvent})` → `{sessionId, finalResponse}` | 发送一轮用户消息，等整轮（含所有工具循环）结束才返回。没有最终文本时抛错，错误带服务商失败码。事件见 §4 |
| `interrupt(sessionId)` | 停止当前轮，取消该会话的待审批请求 |
| `releaseSession(sessionId)` | 释放会话进程；日志保留，可再次 `startSession` 恢复。宿主不为历史对话常驻进程 |
| `waitForSessionIdle(sessionId, {timeout})` | 等会话空闲 |
| `observeSession(sessionId, onFrame)` → `unsubscribe` | 订阅会话的控制事件（审批、专家、目标、Python 环境刷新等） |
| `sessionTurns({sessionId})` → `{turns:[{endSeq,…}]}` | 已完成的轮次（T12） |
| `forkSession({sessionId, atSeq?})` → `{sessionId, boundarySeq}` | 在某个已完成轮次之后分支，产生一个持久化的新会话，只含该轮及之前的上下文；源会话不变。没有已完成轮次时拒绝（T12） |
| `getContextUsage({sessionId})` | 当前上下文占用（用于上下文环，不允许硬编码百分比） |

## 4. 一轮中的事件（`send` 的 `onEvent`）

| 事件 | 字段 | 语义 |
|---|---|---|
| `accepted` | `sessionId` | 运行时已接受本轮 |
| `text-delta` | `delta, attemptId, index` | 回答文本增量 |
| `text-replace` | `text` | 用新文本替换已显示的回答：一次失败的尝试被丢弃，或工具调用前的"前言"被移到工具卡片 |
| `tool-call` | `turn, step, callId, name, argumentsPreview, preamble?` | 工具调用开始；`preamble` 是调用前模型写的说明，属于工具卡片而不是回答 |
| `tool-result` | `turn, step, callId, isError, resultPreview` | 工具结果 |
| `completed` | `text` | 本轮最终回答 |
| 控制事件 | 见 §5、§6 | 经同一回调透传 |

不变式：同一 `callId` 的 call 与 result 属于同一 `turn`；失败的尝试不会进入模型历史；重试由运行时负责（当前每步最多 5 次，针对传输 / 服务端 / 超时 / 空回复）。

## 5. 执行策略与审批

| 方法 / 事件 | 语义 |
|---|---|
| `configurePolicy({sessionId, approvalPolicy, sandboxMode})` | 询问 / 完全接管等通用策略 |
| 事件 `approval-request` | `requestId, toolName, reason, …`；受保护路径审批另带 `classification:'protected-path', commandSummary`，Python 安装审批带 `packages, targetEnvironment`；专家发起时带 `expertId` |
| 事件 `approval-cancelled` | 请求因中断、释放或专家取消而作废 |
| `replyApproval({sessionId, requestId, outcome})` | 回复审批；`outcome` 取值以适配层为准（测试中使用 `rejected`），T23 补全取值表 |
| `requestApplicationApproval(request)` → `boolean` | 宿主自己的审批（Python 安装）走同一审批卡片 |

强制规则（任何实现都必须满足，见 SYSTEM_SPEC 2.15）：
- 受保护路径：文件工具一律拒绝；shell 命令引用受保护路径（含祖先、通配、拼接）时**始终**要审批，完全接管也不自动放行；拒绝后不执行。
- 服务商 key 不进入会话进程的环境变量。
- 研究资料与网页内容在工具结果中标注为外部内容。

## 6. 会话配置、目标与专家

| 方法 | 语义 |
|---|---|
| `configureModel({sessionId, model, reasoningEffort})` | 换模型，不替换对话历史 |
| `configureReasoning({sessionId, reasoningEffort})` | 推理强度只能取自模型能力声明 |
| `configurePersona({sessionId, persona})` | 角色人设（系统提示词前缀） |
| `configureBrief({sessionId, text})` | 项目简报与查阅规则，作为系统提示词中的一节 |
| `scheduleSessionEnvRefresh(sessionId)` | 下一轮前刷新会话环境（Python） |
| `sessionGoal / getGoal / pauseGoal / resumeGoal / completeGoal / clearGoal` | 自动化目标（目前只在主对话启用） |
| `runExperts({sessionId, runId, prompt, experts, onEvent})` | 有序讨论：各专家并发执行、各自独立子会话，结果按固定顺序展示。事件 `expert-start / expert-delta / expert-reset / expert-tool / expert-tool-result / expert-end`（带 `runId`、专家 id） |
| `cancelExperts({sessionId, runId})` | 取消本轮专家，并作废他们的待审批请求 |

## 7. 宿主工具与数据归属

- 运行时启动会话时向宿主请求工具清单（工具名 `__manifest`，返回 `{contextApi, tools}`），按清单注册工具；调用时把 `{sessionId, name, args, callId, expertId?, signal}` 交给 `setToolHandler` 注册的回调。
- **会话决定范围**：项目、对话、角色由宿主根据 `sessionId` 与绑定表确定，模型参数不能扩大范围。
- 运行时保存且只保存**模型上下文历史**（消息、工具调用与结果、压缩记录），它是"模型能否接着原上下文继续"的依据。这是当前唯一被 DSH 格式锁定的数据。T23 增加中立导出，使更换运行时后旧对话可以迁移。

## 8. 服务商与技能

- `ProviderService`：`listProviders`、`saveProvider`、`removeProvider`、`discoverModels`、`getModelInfo`（返回推理能力）、`getRuntimeConfig`。凭据只写入凭据文件，不回传明文。
- `SkillManager`：列出、读取、启停、导入、删除技能。
- 能力声明 `capabilities`：`sessions`、`tokenStreaming`、`reasoningEffort`、`providerSave`、`providerDiscover` 等。产品代码按能力决定是否显示入口，不按实现名判断。

## 9. 契约测试（T23 整理）

现有覆盖接口语义的真实运行时测试（真实 DSH + 本地模拟模型），以后作为任何新实现的验收集：

| 接口 | 测试 |
|---|---|
| 会话、流式事件、文本替换、工具前言 | `scripts/dsh-stream-smoke.mjs`、`tests/tool-preamble-runtime.test.mjs` |
| 恢复与重开 | `scripts/dsh-reopen-smoke.mjs` |
| 分支 | `tests/session-fork-runtime.test.mjs`、`tests/chat-branch-runtime.test.mjs` |
| 审批 | `scripts/dsh-approval-smoke.mjs`（目前只在 Windows 上跑：依赖 pwsh） |
| 策略、目标 | `scripts/dsh-policy-smoke.mjs`、`scripts/dsh-goal-smoke.mjs` |
| 重试 | `tests/dsh-production-retry.test.mjs` |
| 专家与专家审批 | `tests/expert-discussion-runtime.test.mjs`、`tests/expert-approval-runtime.test.mjs` |
| 人设、宿主工具 | `tests/role-prompt-runtime.test.mjs`、`tests/research-tools-runtime.test.mjs` |
| 受保护路径与凭据 | `tests/secret-isolation-runtime.test.mjs`、`tests/credential-isolation.test.mjs` |

## 10. 已知的 DSH 限制（决策证据，持续追加）

| 日期 | 限制 | 影响 / 当前做法 |
|---|---|---|
| 2026-10-02 | 沙箱只限制写，不限制读 | T21 用工具拦截与 shell 审批弥补；同用户下无法彻底隔离 |
| 2026-10-02 | 凭据默认明文 YAML | T21 移位并限权；DPAPI 只做了评估 |
| 2026-10-03 | 没有读取意图钩子 | 只能拦截公开的内置工具；第三方插件的文件读取需另审 |
| 2026-10-03 | 分支没有公开 API | T12 用 `sessionQuery` 与 `agents.create` 组合实现，随上游升级需要复验 |
| 2026-10-03 | 依赖 alpha 版本（`0.1.6-alpha.1`） | 上游接口仍在变；升级 DSH 单独立任务、单独验收 |
| 2026-10-03 | 会话日志导出只有浏览器 ZIP（`dsh-session-log-export`） | 没有中立格式；T23 自行实现导出 |

**决策时点**：alpha 发布之后。依据本表、上游破坏性变更频率和每次升级 DSH 的实际成本，决定继续使用、替换部分能力，还是更换运行时。在此之前不做迁移。
