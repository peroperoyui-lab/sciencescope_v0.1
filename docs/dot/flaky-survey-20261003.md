# B 不稳定测试普查（Linux 补充验证）

结论：22 个可运行的无浏览器项目各连续 30 次；本地 DSH 622/630 通过，真实模型 30/30 通过。28 个浏览器项目 **ENV_BLOCKED**，采纳点击未复验，不能宣称 B 全覆盖或原生验收通过。基线 `edf02f33ccb720c1e0d9178cb03a11ea28f47052`，分支 `dot/flaky-survey-20261003`；无产品改动、PR 或合并。

## 需 Sol / Claude 判断

1. **专家终止回调丢失，6/30（20%）**：`session-control.mjs:34,242,246,340` 未等待终止事件队列发送，`host.mjs:447` 在响应后取消监听。独立观察者 30 轮亦复现 6 次。应用已有 `discussion-service.mjs:193–194` 权威返回结果补偿；新 API 回归 30/30 证明持久化、审核和采纳上下文保留。属回调契约问题，未证明 UI 答案或数据丢失；原严格断言保留。复现：`python3 -B scripts/evals/flaky-repeat.py test:expert-discussion-runtime`。
2. **聊天启动能力失败，2/30（6.7%）**：`/api/providers/save` 在首个模型调用前返回 501。`desktop-api.mjs:174–186` 吞掉 Web 初始化异常，未挂接 provider service（188–190、841/853）。具体启动异常未暴露；15 秒就绪限时仅是时序推断。未改产品或 smoke。复现：`python3 -B scripts/evals/flaky-repeat.py smoke:chat-api`。

## 已验证及限制

- 测试修复：approval smoke 按平台选 shell，30/30；credential 夹具保留并清理已成功资源，Web 限时仅夹具改为 60 秒，最终 30/30。原 15 秒启动失败 4/30 单列保留，不代表生产问题修复。
- 全套：基线 292 通过 / 1 跳过；最终 293 通过 / 1 Windows 专属跳过 / 0 失败（294 项）。Python 重放工具 17 检查通过。最终一次全套通过不抵消上述普查失败。
- 真实模型仅认证和简单完成：OpenCode Go/deepseek-v4.1-flash，30 轮 30 请求；加预检共 31 个已核验请求，27931 prompt + 992 completion = 28923 token。一项此前中止尝试无回执，请求数不明（上限 2）；实际计费未核验。
- 密钥仅宿主现有代理，SDK 用本地模拟 token；普通付费测试禁用工具。未知模型拒绝改为 **本地模拟 404**，不等价于真实 Provider 拒绝；`--long` 未跑，不是长任务、质量或攻防验收。
- Chromium 在加载页面前 AF_UNIX socket 创建被执行环境拒绝；独立 Python 探针同样 EPERM，受审升级运行仍失败。未追加绕过安全控制的参数、未改全局设置；没有浏览器或 Windows 原生通过声明。

证据：`docs/dot/flaky-survey-20261003.json`；`.sciencescope-local/temp/dot/{npm-test-baseline.log,npm-test-final.log,browser-diagnostics/socket-probe.json,discussion-preflight.log,discussion-preflight-escalated.log,playwright-install.log,dsh-one/,dsh-two/,approval-repeat/,fallback-check/,live-repeat/,live-repeat-blocked/,flaky-repeat-wrapper-checks/}`。

重放目录：`python3 -B scripts/evals/flaky-repeat.py --list`；原始日志、密钥、本地状态与构建均不进 Git。
