# T03 · Windows 实测：专家讨论 + 无命令行窗口（替代单独的 T02）

- 下达：Claude，2026-09-23；执行：Codex（Astra），用户本机 Windows。额度紧张，只做以下步骤，不改代码。
- 基线：最新 `main`。交付：只改文档，推送到 `codex/t03-native-YYYYMMDD`；**不要开 PR、不要合并**。
- 云端已验证：`npm test` 111/111；Linux Chromium 全部界面 smoke；真实 OpenCode Go 三模型讨论端到端
  （见 `docs/DESKTOP_IMPLEMENTATION.md` 顶部 Slice B 与 "No stray console window" 两节）。

## 步骤

1. `git fetch origin && git checkout main && git pull --ff-only`；`npm ci`；按 `scripts/windows/run-desktop.ps1` 原有方式重建 debug 客户端。
2. 双击 `Start-ScienceScope.cmd`。**通过**：除 ScienceScope 外没有任何命令行/终端窗口。
3. 设置 → 专家角色：把三位专家分别设为三个不同的便宜模型（例如 glm-5.3-flash、qwen3.8-flash、mimo-v2.6-flash），保存；重开设置页确认已保存。
4. 新对话先发一条普通消息，再把"工作"切换为"有序讨论"，问一个需要判断的研究问题。
   **通过**：三张专家卡片按名册顺序出现，名字与模型正确；运行中文字逐步出现（若专家调用工具，显示"正在使用工具：…"）；
   运行期间没有窗口闪现；全部完成后发送按钮恢复。
5. 点"互相质询"。**通过**：三位专家的第二轮回答引用了其他专家的具体观点。
6. 切到"自由讨论"，发 `@统计审稿人 …`。**通过**：只有统计审稿人作答。
7. 关闭并重开客户端，打开该对话。**通过**：所有专家回答仍在，作者、模型与顺序正确。
8. 确认 `.sciencescope-local\build\tauri\debug\data\logs\desktop-host.log` 存在且不含 API key；关闭主窗口后任务管理器中本应用的 node/dsh 进程全部退出。

失败就停下，按原格式回报（分支 / SHA、每步通过或失败及证据、付费请求次数）。
在 `docs/DESKTOP_IMPLEMENTATION.md` 顶部新增一节记录结果。T02 不再单独执行。
