# T23 · 运行时接口边界、契约测试与会话中立导出

- 下达：Claude，2026-10-03。执行：Sol。通用约定见 `QUEUE.md`、`RB_COMMON.md`。
- 设计：`docs/design/RUNTIME_PORT.md`（Claude 初稿，先读完）。
- 交付：`codex/t23-runtime-port-YYYYMMDD`。不开 PR、不合并。
- 背景：DSH 仍是 alpha 版本，将来可能需要替换或自研运行时。本任务**不迁移、不替换**，只做低成本的保险：守住边界、让接口可测、让模型上下文历史能以中立格式导出。不改变任何用户可见行为。

## 要做的

1. **边界检查**（可测试）：
   - 新增测试：`desktop/`、`scripts/`（smoke、评测和 `scripts/rehearsal/` 除外）中不得出现 `@deepseek-ai/` 引用；产品代码只调用 `RUNTIME_PORT.md` 列出的宿主方法。
   - 如发现产品代码依赖了文档未列出的方法或事件字段，补进文档（附语义），或改为经接口调用，报告里列清单。
2. **补全接口文档**：
   - 核对 `RUNTIME_PORT.md` 每个方法的参数、返回值、错误与事件字段与实际代码一致，修正初稿的错误；
   - 补全审批 `outcome` 取值、`observeSession` 的帧类型、`capabilities` 全部字段、`runtimeConfig` 结构；
   - 状态从"初稿"改为"已核对"，写明核对日期与 DSH 版本。
3. **契约测试集**：
   - 把文档 §9 中的测试整理为一个可单独运行的入口（如 `npm run test:runtime-contract`），只针对接口语义断言，不断言 DSH 内部细节；
   - 依赖 pwsh 的测试（如 `dsh-approval-smoke`）改为按平台选择 shell（Windows 用 pwsh，其他系统用 bash），使契约测试在 Windows 和 Linux 上都能跑；
   - 缺口：文档列出但没有测试覆盖的接口，补最小测试（模拟模型 + 真实 DSH）。
4. **会话中立导出**：
   - 新模块（如 `adapters/runtime-dsh/session-export.mjs`），经公开的 `sessionQuery` 读取会话日志，导出为 ScienceScope 自己定义的 JSON 格式：
     - 会话元信息（id、模型、创建时间、父会话 / 分支点）；
     - 按轮的消息：用户消息、助手回答、工具调用（名称、参数）与结果、压缩摘要；
     - 格式带 `schema` 版本号，写进 `RUNTIME_PORT.md` §7。
   - 不导出凭据，不包含系统提示词中的密钥类内容；导出文件属于用户数据，不进 Git。
   - 宿主方法 `exportSession({sessionId})` 加入接口文档。**本任务不做界面入口**（以后用于数据迁移和备份）。
   - 测试：两轮对话加一次工具调用加一次分支，导出后断言内容完整、顺序正确、无 key。
   - 评估（只写结论）：用导出文件能否在一个新会话中重建等价的模型上下文（例如作为种子历史）。写清限制，不实现导入。
5. **DSH 限制表**：`RUNTIME_PORT.md` §10 补充执行中发现的新限制。

## 验收

- `npm test` 与现有 smoke 全部通过；契约测试入口在 Windows 上通过。如能在 Linux 上跑（Dot 或 Claude 的云端环境），一并报告。
- 边界检查测试、导出测试通过。
- 文档：`RUNTIME_PORT.md` 已核对；SYSTEM_SPEC 增加"运行时接口"小节（指向设计文档，写明导出格式与契约测试入口）；ROADMAP、DESKTOP_IMPLEMENTATION。
- 无用户可见变化，不需要截图。
