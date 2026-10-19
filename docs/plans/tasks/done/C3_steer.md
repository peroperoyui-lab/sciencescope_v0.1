# C3 运行中插入消息：排队的消息可以「现在插入」

- 起草：Claude，2026-10-19。依据：`plans/C_PERMISSIONS_RUNTIME.md` §4；复盘 `reviews/REVIEW_2026-10-18.md` C 组第 16 条。
- 执行：Sol（Windows）；审阅：Claude。约 1.5 小时，一步交付；超出就停下汇报。

## 目标

1. 回答进行中排队的消息可以提前插进当前回答：模型做完当前一步后读到它，接着按新消息调整，不中断、不重来。

## 用户会怎么用

- 专家正在一步步分析数据，用户在输入框发「只看 2020 年以后的样本」，消息进队列。用户点这条的「现在插入」（按钮由 Claude 做）：专家做完手头这一步后读到它，后面的步骤只用 2020 年以后的样本。对话里这条消息出现在它被插入的位置，不再排在回答之后。
- 点的时候回答刚好结束了：这条消息当作普通消息发出，照常开始新的回答。
- 有序讨论里不提供「现在插入」，队列照旧等这一轮结束。

## 要做的

1. **运行接口**：`app/runtime/port.js` 加 `steer(sessionId, input, images?)`。pi 运行时调用 pi-agent-core 的 `agent.steer()`；脚本运行时在下一步之前把消息交给脚本（测试要能断言脚本在第二步看到了它）。
2. **队列接口**：`POST /api/meetings/:id/outbox/:itemId/steer`：
   - 当前有一个正在运行的发言（工作模式）：把这条记成真正的用户消息，`refs: { steered: true, turnId }`，从队列移除，交给那个发言的运行时会话。
   - 当前没有发言：退回为普通发送（和队列到期时一样）。
   - 当前是有序讨论的一轮：返回一个可读的错误「有序讨论进行中不能插入，这条会在这一轮结束后发出」。
3. **上下文**：之后的回答和重试里，插入的消息按它的 `seq` 出现在对话里，模型看到的顺序和用户看到的一致。
4. **文档**：`docs/product/FEATURES.md` 输入框队列一节；`docs/log/IMPLEMENTATION_LOG.md` 不超过 5 行。

## 可以改的

`app/runtime/port.js`、`app/runtime/pi/runtime.js`、`app/runtime/scripted.js`、`app/services/conductor.js`、`app/services/turn-runner.js`、outbox 相关的核心和 `app/server/routes/outbox.js`、上下文组装、相关测试、`docs/product/FEATURES.md`、`docs/log/IMPLEMENTATION_LOG.md`。

## 不做的

- 不改 `app/ui/`；按钮和插入消息的显示位置由 Claude 做（C3-UI）。
- 不做专家之间互发引导消息（用户 2026-10-19：先把基本功能做好，以后并进中间行动）。
- 不动 `<预览安装目录>` 及其数据。

## 完成标准

- 干净检出 `npm run check` 全部通过（含 Windows 测试）。
- 功能测试：脚本模型两步回答，第一步运行中插入一条，第二步看到它，最终消息顺序为「用户问题、插入的消息、回答」；没有发言时退回普通发送；有序讨论中返回那句错误。
- 真实模型：OpenCode Go `deepseek-v4.1-flash` 做一个多步任务，中途插入一条改变要求的消息，回答按新要求完成。报告请求数和 token。

## 交付

- 分支：`codex/c3-steer-YYYYMMDD`，从集成分支最新提交开始。报告不超过 15 行，给出远程分支与 SHA。不建 PR、不合并。
