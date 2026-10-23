# 运行时接口（Runtime Port）· 初稿

> R5 已删除旧线；文中的旧线路径仅作历史参考，原代码见 main 提交 1dc18e9a3c8f7539e092dcb4ae2fd681ec4ac513。

> **C2（2026-10-19）工具图片结果**：工具可返回 `{text,images:[{data:base64,mimeType}],preview?}`。pi 适配器按模型 `input` 是否含 `image` 转成文字与图片块；不支持时正常返回「当前模型不能看图，请换支持图片的模型」。`tool-result` 事件只携带文字及预览元数据，图片内容不进入宿主数据库；其他 JSON 工具结果保持原样。

> **C3（2026-10-19）**：新端口 `steer(sessionId,input,images?)` 同步返回 boolean；true 表示已交给正在运行的发言，在当前一步完成后读取，false 表示会话已结束或已取消，由宿主普通发送。pi 适配器使用 pi-agent-core 的 `agent.steer`（MIT），脚本运行时向脚本提供 `steered` 消息数组；持久消息与排序仍由宿主维护。

> **A2-1（2026-10-18）新增兼容参数**：新核心端口 `send(sessionId, input, onEvent, images?)` 的第四参数为 `ImageContent[]`，每项 `{type:'image', data:base64, mimeType:string}`；省略时行为不变。宿主按实际选入的消息读取原件，重建与重新回答同样携带；pi 适配器按所选模型的 `input` 能力决定是否传给模型。不支持图片时仍发送文字，返回保留正文的 `stopReason:'failed'` 与可读 `error`，由宿主写入 `turns.error`；取消保持 cancelled。

> **2026-10-16**：用户决定在 P1 用 `@earendil-works/pi-ai` + `@earendil-works/pi-agent-core` 替换 DSH（`reviews/REVIEW_2026-10-16.md` D2，§10 的决策时点提前）。新运行时在 `app/runtime/pi/`，端口新增的事件与选项见 `plans/tasks/done/P1a_runtime_providers.md`，合并后由 Claude 更新本文。

> R4-8a（2026-10-08）：新端口startSession新增可选env:{PATH?,VIRTUAL_ENV?}，只接收宿主解析的这两个变量，不改变宿主process.env。DSH比较model+env，变化时在下一轮释放旧进程并恢复同一sessionId；当前轮工具使用固定环境。真实DSH+本地模型已验证shell变量与历史恢复。

> **2026-10-05 重建后**：新代码的运行时接口是 `app/runtime/port.js`（`startSession`、`send`、`interrupt`、`setInstructions`、`release`、`close`，以及运行时事件）。DSH 实现在 `app/runtime/dsh/`：
>
> - 每个会话一个 DSH 进程，进程内只有一个插件 `plugin.js`，负责事件流、把工具调用转回宿主、处理 prompt / interrupt / instructions；
> - 宿主侧是一个桥接服务 `bridge.js`；
> - 服务商配置与凭据文件路径以补丁传入，key 不进入环境变量；
> - 审批策略设为 never（安全不是当前重点）。
>
> 会议记录归 ScienceScope，DSH 会话只是工作记忆。下文描述的是旧线（`adapters/runtime-dsh/`）的接口，R5 切换后删除。§10 的 DSH 限制表继续有效。

- 起草：Claude，2026-10-03。状态：**初稿**，描述现有 DSH 适配层实际提供的能力；T23 负责补全契约测试与会话导出。
- 目的：ScienceScope 的产品代码只依赖本文件描述的接口，不依赖 DSH。将来如果更换或自研智能体运行时，新实现只要满足本接口并通过契约测试，就可以逐步替换。
- 原则：
  1. **只有 `adapters/runtime-*/` 可以 import 运行时的包。** 当前 `desktop/`、`scripts/` 中没有任何 `@deepseek-ai/*` 引用，要保持。
  2. 新功能需要运行时能力时，先在本文件中增加接口（语义、参数、事件），再在适配层实现；不允许产品代码绕过接口使用 DSH 的内部服务。
  3. **用户数据归宿主所有**：对话元数据、展示记录、纪要、资料库、设置都在宿主 SQLite。运行时只保存模型上下文历史（见 §7）。
  4. 运行时的标识（如 `session-…`）在宿主中只作为不透明字符串保存，不解析其格式。

## 1. 组成

| 部分                         | 当前实现                                                   | 说明                                                                            |
| ---------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 会话宿主 `RuntimeHost`       | `adapters/runtime-dsh/host.mjs` → `createDshHost(options)` | 每个活跃会话一个运行时子进程，经本地 HTTP 控制端点（`session-control.mjs`）通信 |
| 服务商配置 `ProviderService` | `provider-service.mjs` + `web-host.mjs`（DSH web 进程）    | 服务商、模型、凭据                                                              |
| 技能管理 `SkillManager`      | `skill-manager.mjs`                                        | 技能目录的列出、启停、导入、删除                                                |
| 宿主工具回调                 | `host.setToolHandler(handler)`                             | 运行时调用宿主提供的工具（资料库、上下文查阅、Python 安装等）                   |
| 安全策略插件                 | `protected-path-policy.mjs`、`credential-isolation.mjs`    | 受保护路径、凭据位置、会话环境清理（T21）                                       |

## 2. 宿主创建

`createRuntimeHost(options)`（当前名 `createDshHost`）：

| 参数             | 含义                                                 |
| ---------------- | ---------------------------------------------------- |
| `home`           | 运行时数据目录（会话日志、设置）。整体属于受保护路径 |
| `cwd`            | 默认工作目录（项目根）                               |
| `credentialPath` | 凭据文件位置（`secret/credentials.yaml`）            |
| `protectedPaths` | 受保护路径表（T21）                                  |
| `env`            | 额外环境变量；服务商 key 不得经此进入会话进程        |
| `sessionHeaders` | 测试夹具用的请求头标记                               |

返回对象另带 `capabilities`（能力声明，见 §8）。`close()` 结束所有会话及其子进程树，取消所有待审批请求。

## 3. 会话生命周期

| 方法                                                                                                                                            | 语义                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `startSession({model, workspace, runtimeConfig, sessionId?, noTools?, persona?, proposalTargetChatId?, sessionEnv?, maxTokens?})` → `sessionId` | 启动或恢复会话。`maxTokens`（T09 加入）只用于后台整理的短会话，T24 按"输出上限取模型声明值"复核。给出已有 `sessionId` 时必须恢复其完整模型上下文。`model = {providerId, modelId, reasoningEffort?}`。`sessionEnv` 是 Python 环境等会话环境；同一会话不能以不同环境重复启动（需先 `releaseSession`）  |
| `send({sessionId, text, onEvent})` → `{sessionId, finalResponse, stopReason?, usage?}`                                                          | 发送一轮用户消息，等整轮（含所有工具循环）结束才返回。`stopReason: 'max-tokens'` 是达到模型输出上限的正常终止，保留本轮可见文本及工具回执；可见文本为空也不当作错误。用户可在同一会话发送继续指令。其他无最终文本的失败仍携服务商失败码。`usage` 见下方；旧调用者仍可只读 `finalResponse`。事件见 §4 |
| `interrupt(sessionId)`                                                                                                                          | 停止当前轮，取消该会话的待审批请求                                                                                                                                                                                                                                                                   |
| `releaseSession(sessionId)`                                                                                                                     | 释放会话进程；日志保留，可再次 `startSession` 恢复。宿主不为历史对话常驻进程                                                                                                                                                                                                                         |
| `waitForSessionIdle(sessionId, {timeout})`                                                                                                      | 等会话空闲                                                                                                                                                                                                                                                                                           |
| `observeSession(sessionId, onFrame)` → `unsubscribe`                                                                                            | 订阅会话的控制事件（审批、专家、目标、Python 环境刷新等）                                                                                                                                                                                                                                            |
| `sessionTurns({sessionId})` → `{turns:[{endSeq,…}]}`                                                                                            | 已完成的轮次（T12）                                                                                                                                                                                                                                                                                  |
| `forkSession({sessionId, atSeq?})` → `{sessionId, boundarySeq}`                                                                                 | 在某个已完成轮次之后分支，产生一个持久化的新会话，只含该轮及之前的上下文；源会话不变。没有已完成轮次时拒绝（T12）                                                                                                                                                                                    |
| `getContextUsage({sessionId})`                                                                                                                  | 当前上下文占用（用于上下文环，不允许硬编码百分比）                                                                                                                                                                                                                                                   |

## 4. 一轮中的事件（`send` 的 `onEvent`）

| 事件           | 字段                                                    | 语义                                                                                    |
| -------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `accepted`     | `sessionId`                                             | 运行时已接受本轮                                                                        |
| `text-delta`   | `delta, attemptId, index`                               | 回答文本增量                                                                            |
| `text-replace` | `text`                                                  | 用新文本替换已显示的回答：一次失败的尝试被丢弃，或工具调用前的"前言"被移到工具卡片      |
| `tool-call`    | `turn, step, callId, name, argumentsPreview, preamble?` | 工具调用开始；`preamble` 是调用前模型写的说明，属于工具卡片而不是回答                   |
| `tool-result`  | `turn, step, callId, isError, resultPreview`            | 工具结果                                                                                |
| `completed`    | `text, stopReason?, usage?`                             | 本轮终止；达到模型上限时 `stopReason: 'max-tokens'`，文字保留，不能冒称任务已经完整完成 |
| 控制事件       | 见 §5、§6                                               | 经同一回调透传                                                                          |

不变式：同一 `callId` 的 call 与 result 属于同一 `turn`；失败的尝试不会进入模型历史；重试由运行时负责（当前每步最多 5 次，针对传输 / 服务端 / 超时 / 空回复）。

T24 用量回执（additive）：`usage` 汇总本次 `send` 所有已提交模型步骤的服务商用量，字段为 `totalTokens`、`inputTokens`（未缓存输入）、`outputTokens`、`cacheReadTokens`、`cacheWriteTokens`、`reasoningTokens` 及 `requests`、`unknownRequests`。优先使用服务商 `totalTokens`；不存在时按未缓存输入＋缓存读取＋缓存写入＋输出合计，reasoning 是输出子集，不再次相加。未知用量不得当作 0；产品成本设置在缺回执时使用估算并标明。服务商失败/重试未提供的用量不能由适配器虚构，付费评测物理重试另记。

## 5. 执行策略与审批

| 方法 / 事件                                                 | 语义                                                                                                                                                                             |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `configurePolicy({sessionId, approvalPolicy, sandboxMode})` | 询问 / 完全接管等通用策略                                                                                                                                                        |
| 事件 `approval-request`                                     | `requestId, toolName, reason, …`；受保护路径审批另带 `classification:'protected-path', commandSummary`，Python 安装审批带 `packages, targetEnvironment`；专家发起时带 `expertId` |
| 事件 `approval-cancelled`                                   | 请求因中断、释放或专家取消而作废                                                                                                                                                 |
| `replyApproval({sessionId, requestId, outcome})`            | 回复审批；`outcome` 取值以适配层为准（测试中使用 `rejected`），T23 补全取值表                                                                                                    |
| `requestApplicationApproval(request)` → `boolean`           | 宿主自己的审批（Python 安装）走同一审批卡片                                                                                                                                      |

强制规则（任何实现都必须满足，见 SYSTEM_SPEC 2.15）：

- 受保护路径：文件工具一律拒绝；shell 命令引用受保护路径（含祖先、通配、拼接）时**始终**要审批，完全接管也不自动放行；拒绝后不执行。
- 服务商 key 不进入会话进程的环境变量。
- 研究资料与网页内容在工具结果中标注为外部内容。

## 6. 会话配置、目标与专家

| 方法                                                                          | 语义                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `configureModel({sessionId, model, reasoningEffort})`                         | 换模型，不替换对话历史                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `configureReasoning({sessionId, reasoningEffort})`                            | 推理强度只能取自模型能力声明                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `configurePersona({sessionId, persona})`                                      | 角色人设（系统提示词前缀）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `configureBrief({sessionId, text})`                                           | 项目简报与查阅规则，作为系统提示词中的一节                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `scheduleSessionEnvRefresh(sessionId)`                                        | 下一轮前刷新会话环境（Python）                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `sessionGoal / getGoal / pauseGoal / resumeGoal / completeGoal / clearGoal`   | 自动化目标（目前只在主对话启用）                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `runExperts({sessionId, runId, prompt, experts, onEvent})`                    | 有序讨论：各专家并发执行、各自独立子会话，结果按固定顺序展示。事件 `expert-start / expert-delta / expert-reset / expert-tool / expert-tool-result / expert-end`（带 `runId`、专家 id）                                                                                                                                                                                                                                                                                                                      |
| `continueExpert({sessionId, runId, childSessionId, expert, prompt, onEvent})` | T24：恢复宿主记录的原专家子会话，发送显式继续指令，返回单个专家结果。`sessionId` 是其父会话；`childSessionId` 及不可变 `expert` 快照只能来自宿主持久化绑定，界面只提供聊天/消息身份。适配器验证原子会话所属父会话并重建人设、绑定技能、宿主工具归属与审批策略；不能自动向 Main 注入子会话结束通知。`runExperts` 的结果与 `expert-end` additive 提供 opaque `childSessionId`，用于达到上限后的恢复；每次执行后释放进程，保留历史。继续结果在展示记录中追加，不改写已生成文字；未完成审核仍需完成后由用户采纳 |
| `cancelExperts({sessionId, runId})`                                           | 取消本轮专家，并作废他们的待审批请求                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## 7. 宿主工具与数据归属

- 运行时启动会话时向宿主请求工具清单（工具名 `__manifest`，返回 `{contextApi, tools}`），按清单注册工具；调用时把 `{sessionId, name, args, callId, expertId?, signal}` 交给 `setToolHandler` 注册的回调。
- **会话决定范围**：项目、对话、角色由宿主根据 `sessionId` 与绑定表确定，模型参数不能扩大范围。
- 运行时保存且只保存**模型上下文历史**（消息、工具调用与结果、压缩记录），它是"模型能否接着原上下文继续"的依据。这是当前唯一被 DSH 格式锁定的数据。T23 增加中立导出，使更换运行时后旧对话可以迁移。

## 8. 服务商与技能

- `ProviderService`：`listProviders`、`saveProvider`、`removeProvider`、`discoverModels`、`getModelInfo`、`getRuntimeConfig`。凭据只写入凭据文件，不回传明文。`getModelInfo({providerId,modelId})` additive 返回 `limits:{contextWindow,maxOutputTokens,source,contextSource}`，容量来源为 `configured`（保存的模型配置，可能来自发现结果或用户修改）或 `runtime-default`（未知容量时的运行时默认），并保留 `reasoning`。DSH profile 不存两种配置的来源差别，不能声称辨别了服务商声明和用户覆盖。保存链路保留发现结果中的名称、上下文窗口与最大输出；显式用户修改可覆盖最大输出，留空移除覆盖并恢复默认。容量不是价格，不得把缺失价格解释为免费。模型配置更改在下一轮开始前通过释放空闲进程并恢复同一会话应用，运行中的轮次保持原配置。
- `SkillManager`：列出、读取、启停、导入、删除技能。
- 能力声明 `capabilities`：`sessions`、`tokenStreaming`、`reasoningEffort`、`providerSave`、`providerDiscover` 等。产品代码按能力决定是否显示入口，不按实现名判断。

## 9. 契约测试（T23 整理）

现有覆盖接口语义的真实运行时测试（真实 DSH + 本地模拟模型），以后作为任何新实现的验收集：

| 接口                                         | 测试                                                                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 会话、流式事件、文本替换、工具前言           | `scripts/dsh-stream-smoke.mjs`、`tests/tool-preamble-runtime.test.mjs`                                                                     |
| 恢复与重开                                   | `scripts/dsh-reopen-smoke.mjs`                                                                                                             |
| 分支                                         | `tests/session-fork-runtime.test.mjs`、`tests/chat-branch-runtime.test.mjs`                                                                |
| 审批                                         | `scripts/dsh-approval-smoke.mjs`（目前只在 Windows 上跑：依赖 pwsh）                                                                       |
| 策略、目标                                   | `scripts/dsh-policy-smoke.mjs`、`scripts/dsh-goal-smoke.mjs`                                                                               |
| 重试                                         | `tests/dsh-production-retry.test.mjs`                                                                                                      |
| 专家与专家审批                               | `tests/expert-discussion-runtime.test.mjs`、`tests/expert-approval-runtime.test.mjs`                                                       |
| 模型输出上限、空 partial、usage 与流交付积压 | `tests/model-output-runtime.test.mjs`；`/prompt` 必须等模型结束及有序展示队列排空后回应，generation idle 不等于 delivery idle              |
| 专家原子会话继续、应用恢复与隔离             | `tests/expert-continuation-runtime.test.mjs`、`tests/output-continuation-api.test.mjs`；失败/取消的续写尝试保留，不消费原 partial 恢复入口 |
| 自动化输出 receipt                           | `tests/execution-service.test.mjs`；自动化同样保存空/非空 max-tokens 状态，运行中目标仍须用户先暂停                                        |
| 人设、宿主工具                               | `tests/role-prompt-runtime.test.mjs`、`tests/research-tools-runtime.test.mjs`                                                              |
| 受保护路径与凭据                             | `tests/secret-isolation-runtime.test.mjs`、`tests/credential-isolation.test.mjs`                                                           |

## 10. 已知的 DSH 限制（决策证据，持续追加）

| 日期       | 限制                                                                                                                                                      | 影响 / 当前做法                                                                                                                   |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-02 | 沙箱只限制写，不限制读                                                                                                                                    | T21 用工具拦截与 shell 审批弥补；同用户下无法彻底隔离                                                                             |
| 2026-10-02 | 凭据默认明文 YAML                                                                                                                                         | T21 移位并限权；DPAPI 只做了评估                                                                                                  |
| 2026-10-03 | 没有读取意图钩子                                                                                                                                          | 只能拦截公开的内置工具；第三方插件的文件读取需另审                                                                                |
| 2026-10-03 | 分支没有公开 API                                                                                                                                          | T12 用 `sessionQuery` 与 `agents.create` 组合实现，随上游升级需要复验                                                             |
| 2026-10-03 | 依赖 alpha 版本（`0.1.6-alpha.1`）                                                                                                                        | 上游接口仍在变；升级 DSH 单独立任务、单独验收                                                                                     |
| 2026-10-03 | 会话日志导出只有浏览器 ZIP（`dsh-session-log-export`）                                                                                                    | 没有中立格式；T23 自行实现导出                                                                                                    |
| 2026-10-04 | 已安装 pi-ai 按 provider route 取目录默认；ScienceScope 自定义 route 未保存发现容量时默认输出 32768、上下文 262144。公开 session 目录不提供价格或输出容量 | T24 用端点发现和支持的模型 profile 字段保留容量，未知时显示运行时默认并允许用户修改；不根据 URL 猜供应商                          |
| 2026-10-04 | 上游 pi-ai 请求构造还会按上下文估算减去 4096 余量，下调请求输出容量；one-shot 子代理不支持 `subagents.prompt`                                             | T24 不 fork 依赖；公开 `agents.resume` 恢复由宿主管理的专家子会话，恢复角色/工具/审批边界。上游上下文余量行为如实保留为运行时限制 |

**决策时点**：alpha 发布之后。依据本表、上游破坏性变更频率和每次升级 DSH 的实际成本，决定继续使用、替换部分能力，还是更换运行时。在此之前不做迁移。

## R4-11b 交付物接入（2026-10-07，新核心）

采用ScienceScope共享宿主工具 workspace_present（files数组，每项path/description），通过现有ToolSpec与onToolCall接入，不依赖DSH内置present事件语义，也不扩展具体运行时端口。服务层保存原件到data/deliverables，编号迁移010保存消息归属；回答显示旧交付物卡片/缩略图，其他参与者只接收路径和说明。自动测试使用脚本化运行时，原件删除、重启、分支和默认程序调用均保留明确可验证结果。
