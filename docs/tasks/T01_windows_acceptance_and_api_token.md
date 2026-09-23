# T01 · Windows 复验 + 本地 API 调用口令

> **第 2 轮（2026-09-23，接续 `93de558` 的回报）**：F1 的"宿主存活 + 中文提示 + 按钮恢复"已通过；
> 唯一失败项"失败后草稿被清空"已由 Claude 在 `desktop/live-chat.mjs` 修复并合入 main（见 DESKTOP_IMPLEMENTATION 顶部）。
> 请：拉取最新 main → 从 main 新建 `codex/t01-round2-YYYYMMDD` → 在 Windows 上先跑
> `node scripts/failed-send-draft-smoke.mjs`（使用已安装 Edge）→ 用原生客户端**只重跑 F1**（同样的不存在模型路径，
> 确认失败后原文回到输入框）→ 通过后继续 F2 → 再做第 2、3 部分。停止条件与回报格式不变。
> `desktop/live-chat.mjs` 的这段失败恢复逻辑属于本轮修复，如需再改先停下说明。

- 下达：Claude（云端审阅/合并），2026-09-23；执行：Codex（Astra），用户本机 Windows。
- 基线：`main`（先 `git fetch origin && git checkout main && git pull --ff-only`）。
- 交付：新分支 `codex/t01-api-token-YYYYMMDD`，推送后报告分支名与 SHA。**不要开 PR、不要合并**；由 Claude 审阅后合并。
- AGENTS.md 全部规则继续有效（测试目录在 `.sciencescope-local/temp`、不提交密钥/日志/构建产物、实测与 fixture 分开写）。

背景见 `docs/REVIEW_CLAUDE_2026-09-23.md`（F1–F6 已合入 main，H1/H2 是本任务）。

## 第 1 部分：Windows 原生复验（先做，只测不改）

云端（Linux）已验证：`npm test` 104/104；真实 OpenCode Go `deepseek-v4.1-flash`：
小请求返回哨兵、不存在的模型返回分类错误而非崩溃。以下两项**只有 Windows 原生客户端能证明**：

1. **F1 宿主崩溃**：重走 2026-09-20 失败的路径——在真实 UI 中选择一个未注册/不存在的模型发送。
   通过标准：API 宿主进程仍在（后续请求不出现 `ECONNREFUSED`），界面给出"找不到模型"类中文提示，发送按钮恢复，草稿保留。
2. **F2 长轮次**：执行策略"完全接管"，发一条让模型运行一次约 330 秒命令的请求
   （Windows 可用 `Start-Sleep -Seconds 330; echo SLEPT`），完成后要求回复固定哨兵。
   通过标准：界面最终显示完成与哨兵，而不是 5 分钟时报失败。只发这一条，控制付费用量。
   云端等价脚本：`node scripts/runtime-hardening-live-smoke.mjs --long`（可参考，不必强制使用）。

结果写进 `docs/DESKTOP_IMPLEMENTATION.md` 顶部新小节：日期、SHA、实际步骤、请求次数、通过/失败。失败就如实写 FAILED 并停下报告，不要自行扩大改动。

## 第 2 部分：H1 · 每次启动的 API 口令

问题：`scripts/desktop-api.mjs` 只校验 Host/Origin。本机任何进程都能 POST `/api/chat` 且 `executionMode:'full'`（DSH `danger-full-access`）。

要求：

1. `scripts/preview-desktop.mjs`：像现有 `shutdownToken` 一样，启动时生成 32 字节随机 `apiToken`，
   并在 `--desktop` 输出的 JSON 里加上 `apiToken` 字段（不写入任何文件或日志）。
2. `scripts/desktop-api.mjs`：所有 `/api/*` 请求要求 `Authorization: Bearer <apiToken>`，用 `timingSafeEqual` 比较；
   缺失或错误返回 401，**`/api/status` 也不例外**。`createDesktopApi` 增加 `apiToken` 参数；未传入时（单元测试）保持现有行为，
   但 `createDesktopServer` 必须总是传入。
3. `src-tauri/src/main.rs`：解析宿主输出的 `apiToken`（校验非空、≤256），通过 `WebviewWindowBuilder::initialization_script`
   注入到**所有**本应用窗口（main、assistant、orb、secondary-*），例如定义一个不可枚举、不可改写的
   `window.__SCIENCESCOPE_API_TOKEN__`。只对宿主自己的 origin 注入。
4. 前端：`desktop/host-client.mjs` 的 `hostRequest` 与 `streamChat`、`desktop/native-window.mjs:44` 的直接 `fetch`
   统一带上该头。新增代码不得再直接 `fetch('/api/...')`；全部走 host-client。
5. 测试与 smoke：需要访问 API 的现有 smoke/测试改为从 `createDesktopServer` 返回值取 token。
   新增测试：无 token → 401；错误 token → 401；正确 token → 200；token 不出现在任何 API 响应体中。

## 第 3 部分：H2 · 收窄 Tauri 远程权限

`src-tauri/capabilities/main.json` 的 `"remote": {"urls": ["http://127.0.0.1:*"]}` 让任何回环端口页面都拿到窗口 IPC。
在运行时把权限限定到宿主实际端口（例如启动后用运行时 capability 注册具体 URL，或在各 command 内校验调用窗口的 URL origin
等于宿主 origin）。选一种实现，写明理由；`cargo build --offline` 通过，原生窗口 smoke 通过。

## 本任务不要改动的文件（Claude 正在云端并行修改，避免冲突）

`scripts/research-input.mjs`、`scripts/chat-attachments.mjs`、`adapters/runtime-dsh/host.mjs`、
`adapters/runtime-dsh/assistant-stream-bridge.mjs`，以及任何多专家/Slice B 相关的新文件。确需改动时先停下说明原因。

## 完成回报格式

```
分支 / SHA:
第 1 部分：F1 通过/失败（证据）；F2 通过/失败（证据）；付费请求次数：
第 2、3 部分：改动文件列表；实际运行的命令与结果（npm test 数量、smoke、cargo build）
未完成 / 风险：
```
