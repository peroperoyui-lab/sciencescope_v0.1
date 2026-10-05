# R2 交接：Windows 本地化（给 Sol）

R2 让 AI 真正发言：会议里发一条消息，主专家通过 DSH 回答、调用工具、修改工作台。请在 Windows 上确认它能跑，有平台问题直接修。按 AGENTS.md 交付，报告不超过 15 行。

## 要做的

1. 拉取集成分支，运行 `npm install` 和 `npm run check`。其中两个真实 DSH 测试会启动 DSH 进程：
   - `app/runtime/dsh/runtime.runtime.test.js`：单个会话的指令、流式输出、工具回调、释放后恢复；
   - `app/app.runtime.test.js`：从 HTTP 接口到 DSH 再到工作区文件的全链路。
   两个都使用本地模拟模型，不联网。
2. 用真实便宜模型走一遍（OpenCode Go key）：
   - 把 key 写进凭据文件：`POST /api/providers/keys/<keyRef>`，请求体 `{"key": "..."}`；
   - 在 `PATCH /api/settings` 里设置 `providers`（id、baseUrl、api、keyRef、models）和 `models.default`；
   - 建项目、建会议（成员为 `person_user` 和 `agent_main`），发消息"请把'清洗数据'加进计划"；
   - 确认回答正常，`projects\<项目>\workbench\plans.md` 被修改，`/api/revisions` 里记录的执行者是 `agent_main`。
   具体命令和请求次数写进报告；key 只出现在凭据文件里。
3. 进程：发言结束 10 分钟后 DSH 进程应该退出（测试时可以临时把 `idleReleaseMs` 调小来验证）；`app/main.js` 按 Ctrl+C 退出时，所有 DSH 子进程都应结束。

## 重点看的 Windows 问题

- DSH 子进程的工作目录、临时目录（`data\runtime\temp`）和中文路径；
- `plugin.js` 通过 `file://` URL 加载，确认 Windows 路径（盘符）下能正常加载；
- 关闭时 DSH 进程树能完整结束，不留残余。

## 不做的事

- 不改旧代码（`desktop/`、`scripts/`、`adapters/`）。
- 不做界面，那是 R3。
