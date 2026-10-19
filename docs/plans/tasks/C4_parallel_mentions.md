# C4 同时 @ 多位专家时并行回答，每位只看自己那一段

- 起草：Claude，2026-10-19。依据：`plans/C_PERMISSIONS_RUNTIME.md` §5、§7；`decisions/DECISIONS.md` 2026-10-19 并行一条；复盘 `reviews/REVIEW_2026-10-18.md` C 组第 13 条。
- 执行：Sol（Windows）；审阅：Claude。约 1.5 小时，一步交付；超出就停下汇报。

## 目标

1. 工作模式下一条消息 @ 了两位及以上专家时，他们同时开始、各自回答，互相看不到这一轮的回答。
2. 每位专家只看到这条消息里「自己的 @ 之后、下一个 @ 之前」的内容（用户原话：「只看@后的后文和下一个@前的截止内容」）。

## 用户会怎么用

- 「@方法学家 看识别策略 @统计审稿人 看标准误」：两位同时开始；方法学家收到「看识别策略」，统计审稿人收到「看标准误」。进行中各占一个固定高度的状态框（界面复用 B 组，由 Claude 接上）。
- 「@方法学家 @统计审稿人 帮我看看这个回归」：两个 @ 紧挨着，中间没有文字，两位都收到「帮我看看这个回归」。
- 「关于第三章，@方法学家 看结构 @统计审稿人 看数据」：第一个 @ 之前的「关于第三章，」是共同前提，两位都收到，后面接各自那一段。
- 只 @ 一位或不 @：和现在一样，看整条消息。
- 对话里这条消息永远显示原文。

## 要做的

1. **切分**：在 `app/core/context.js` 的 `mentionedParticipants` 旁加一个函数，返回每位被 @ 专家的那一段：共同前提（第一个 @ 之前的文字，去掉首尾空白）加上该专家的 @ 到下一个 @ 之间的文字；紧挨着的几个 @ 共用后面那一段。同一位专家被 @ 两次时，取两段连起来。复用现有的长名优先规则。
2. **并行**：`app/services/conductor.js` 的 `runDirect` 在选中两位及以上时，改成和 `runRound`（`conductor-round.js`）一样：先全部 `reserve`，再 `Promise.all` 一起跑，上下文都截到这条消息为止。回合上带 `discussion: { kind: 'mention', triggerMessageId, cutoffSeq }`（或按现有约定取名，报告里写明），供界面判断用状态框。停止按钮同时停下所有人。
3. **上下文**：上下文组装里，这一轮每位专家看到的触发消息换成他那一段（只在这一轮；之后的回答和别人的上下文仍用原文）。重试某一位时也用他那一段。
4. **文档**：`docs/product/FEATURES.md` 工作模式一节；`docs/log/IMPLEMENTATION_LOG.md` 不超过 5 行。

## 可以改的

`app/core/context.js`、`app/services/conductor.js`、`app/services/conductor-round.js`（只在需要抽出共用代码时）、`app/services/turn-runner.js`、`app/services/context-assembly.js`、相关测试、`docs/product/FEATURES.md`、`docs/log/IMPLEMENTATION_LOG.md`。

## 不做的

- 不改 `app/ui/`；状态框的判断条件由 Claude 改。
- 不做专家之间互相查看和发引导消息（用户 2026-10-19 推迟）。
- 不改有序讨论的行为。
- 不动 `<预览安装目录>` 及其数据。

## 完成标准

- 干净检出 `npm run check` 全部通过（含 Windows 测试）。
- 单元测试：切分函数覆盖上面「用户会怎么用」的三种写法。
- 功能测试：脚本模型下 @ 两位，两个回合同时处于运行状态，各自上下文里的触发消息是自己那一段，且看不到对方这一轮的回答。
- 真实模型：OpenCode Go `deepseek-v4.1-flash` 用第一个例子跑一次，确认两位同时开始、各自只回答自己那部分。报告请求数和 token。

## 交付

- 分支：`codex/c4-parallel-mentions-YYYYMMDD`，从集成分支最新提交开始。报告不超过 15 行，给出远程分支与 SHA。不建 PR、不合并。
