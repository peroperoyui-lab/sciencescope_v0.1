# T12 · 从消息分支（真实继承模型上下文）

共同规则见 `docs/tasks/RB_COMMON.md`；开关机制见 `docs/tasks/FEATURE_FLAGS.md`（开关 `branch`）。交付分支：`codex/t12-branch-YYYYMMDD`。

## 目标
在任意一条消息上"从此分支"：新建一个对话，它的**模型上下文**与原对话截至该消息时完全一致（不是只复制可见文字），之后两边互不影响。

### 2026-09-29 本机前置核查：BLOCKED（没有开启分支）

- 安装的 SDK client / SDK JSON-RPC server / API session controller 均为 `0.1.6-alpha.1`。
- `SessionController` 的公开接口确有 `session/fork`，但当前 `profile: sdk` 的 stdio server 只分发 `initialize`、`session/prompt`、`shutdown`。真实 DSH + localhost 模型先完成两轮（turn/end seq17、25），再调用 `harness.client.request('session/fork',{sessionId,atSeq:17})`，得到 `JsonRpcResponseError: unknown DeepSeek Harness SDK runtime method: session/fork`。包里存在类型不等于当前运行通道支持。
- 进一步只读验证公开 `ctx.sessions.fork(source,17,childId)`：返回 inheritedEventCount18、flush=true，但这是未取得 Agent 写句柄的 SessionStore 子会话；从新进程通过现有 session-control 恢复，模型没有收到 A，原会话仍有 A/B。安装包 `dsh-session-persistence/README.md` 明确说明只有获得写句柄的会话才持久化，单独 create/flush 不存储。
- 按本任务“不能调用时停下报告”的要求停止，没有改生产代码、增加消息列、复制事件冒充分支、升级依赖或打开 branch。所有探针是本地模拟模型，付费调用0；不是T12通过。
- 待用户/Claude决定接线方式：优先评估将上游**完整公开 SessionController fork 服务**接入现有适配层（包括其必要服务与写句柄生命周期），或等待/采用正式支持fork的SDK版本再实现；两者都必须重新完成A/B隔离、子会话重启、附件草稿与原生验收。不能只复制控制器内部事件切片算法。
- 本机原始证据在 `.sciencescope-local/temp/t12-probe/`，具体run路径与复核记录见 `DESKTOP_IMPLEMENTATION`；不提交临时会话或日志。

### 用户确认的轮次边界（2026-09-27，待实现与验收）

已安装 DSH 的 `session.fork` 按完整轮次结束分叉，不能停在用户消息之后、该轮回复之前。因此以下规则优先于上面的概括：

- 已完成的主专家回复提供“从此回复分支”，直接 fork 到该轮结束。
- 第 N 条用户消息提供“从此处重新提问”：从上一轮已完成的主专家回复处分叉，新分支不含第 N 轮；第 N 条用户消息原文放入新分支可编辑、未发送的草稿。附件与标记尽可能一并保留，不能携带的内容须在交付报告说明，不能连同该轮回复一起分支。
- 第一条用户消息没有上轮分叉点：新建同项目、同设置对话，把原文放入未发送草稿。
- 生成中、失败、被停止的轮次不提供分支入口。旧消息继续按 `BRANCH_POINT_UNKNOWN` 报错；专家讨论沿用下述既定规则。
- 两种入口分别使用上述文案，说明放入 `infoTip()`，补英文词条。
- 回归必须证明：回复处分支的模型上下文截至该轮；用户消息处分支不含该轮回复且草稿正确；首条消息路径；未完成轮次不可分支。
- 端到端验收通过后才打开 `branch` 开关。此确认不代表已经实现。

## 现状
- 入口已存在但被隐藏：消息下方"从此分支"、消息菜单"从此开始分支"、输入框上方"从此分支"（都是 `data-v="branch-message"`），前端调用 `branchAt()`（`desktop/workspace.mjs`，目前为空函数）。
- 已安装的 DSH 提供 `session.fork({sessionId, atSeq?}) -> {sessionId}`（`@deepseek-ai/dsh-api-session-controller` 的 `SessionForkRequest`）。**先确认**当前宿主使用的运行时接口能调用它；不能调用时停下报告，不要用"复制文字再发给新会话"冒充分支。

## 宿主
1. `adapters/runtime-dsh/host.mjs` 增加 `forkSession({sessionId, atSeq})`（框架文件：改之前先把方案发给 Claude）。
2. 消息与运行时序号的对应：在主对话消息被接受和回复完成时记录 DSH 日志序号（`chat-store.mjs` 的 messages 表加可空列 `runtime_seq`，旧数据为空）。
   分支点没有序号（旧消息）时，接口返回 409 `BRANCH_POINT_UNKNOWN`，界面提示"这条较早的消息无法作为分支点"（这是错误说明，不是"未开发"）。
3. `POST /api/chats/branch {chatId, messageId}` → `{chatId, title}`：
   - 原对话必须空闲（运行中返回 409 `CHAT_BUSY`）；
   - 调用 `forkSession`，为新 sessionId 建立运行时绑定（`markRuntimeBinding`），工作区、执行策略、模型、推理强度、Python 环境与原对话一致；
   - 复制分支点及之前的展示记录（新 id），新对话记录 `branchedFrom: {chatId, messageId}`；标题"原标题 · 分支"；
   - 分支点是专家讨论回答时：主会话在该轮讨论之前的最后一个主序号处分叉，讨论条目作为展示记录复制；在任务书与界面说明中写明。
4. 秘书和全局助手的对话不提供分支（按钮本来就不在那里显示）。

## 前端
- `branchAt(messageId)`：调用接口后 `loadThread(newChatId)`；对话标题下方显示"分支自 · 原对话名"（可点击返回原对话，定位到该消息）。
- 在 `scripts/desktop-api.mjs` 的 `capabilities.features.branch` 中返回 `typeof host.forkSession === 'function'`。

## 验收
- 真实 DSH（本地模拟模型）测试：对话中说"记住 A"、"记住 B"，在第一条回复处分支；新对话问"你记得什么"只知道 A；原对话仍记得 A 和 B；重启后两个对话都能继续。
- 界面 smoke：开关关闭时三个入口都不可见；打开后点击产生新对话，原对话不变。
- 原生 Windows 上各做一次截图。

### 2026-09-29 Claude 复核与下一步方向

- 核实：SDK JSON-RPC server 已发布的 0.1.6-alpha.1、0.1.7-rc.2、0.2.0-rc.2 都只分发 `session/prompt`，升级 SDK 不能解决。
- 可以尝试的路线：只用**公开接口**，在我们自己的适配器（`adapters/runtime-dsh/session-control.mjs`，运行在 DSH 进程内、持有 `ctx`）中新增一个 `/fork` 控制端点：
  1. 源会话空闲时，先 `handle = await ctx.sessionPersistence.create(childId)` 取得子会话的写句柄；
  2. 再 `ctx.sessions.fork(sourceId, atSeq, childId)`。持久化后端会把已发布会话的事件路由到该会话的写句柄（见 `dsh-session-persistence/README.md` 第 28、57 行）。如果事件没有自动路由，就用 `handle.append(...)` 写入子会话的事件；
  3. `await handle.flush()`，然后 `await handle.close()`；
  4. 宿主用现有的 `startSession({sessionId: childId})` 在新进程中恢复子会话。
- 这是复制 DSH 自己的事件日志，新进程恢复后模型拿到的是真实上下文，不属于"复制文字冒充分支"。不要复制控制器内部的事件切片算法。
- 用原来的探针验证：A/B 隔离；子会话在新进程中恢复后模型收到 A、没有 B；原会话不受影响。通过后按之前确认的交互（"从此回复分支"和"从此处重新提问"）实现并验收。
- 如果写句柄与 fork 无法这样组合（例如 fork 出的子会话未发布、事件无法取得），停下报告原因，保持分支开关关闭。

