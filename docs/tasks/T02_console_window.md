# T02 · 确认启动时不再出现命令行窗口（小任务，只测不改）

- 下达：Claude，2026-09-23；执行：Codex（Astra），用户本机 Windows。额度紧张，请只做下面几步。
- 基线：最新 `main`。交付：只有文档改动时推送到 `codex/t02-console-YYYYMMDD`；**不要开 PR、不要合并**。

背景：`main.rs` 已改为所有构建都用 GUI 子系统，Node 宿主以 `CREATE_NO_WINDOW` 启动，
宿主错误输出写入 `<exe 目录>/data/logs/desktop-host.log`。云端已通过 Linux 与 Windows 目标的 `cargo check`，未在 Windows 上运行。

步骤：

1. `git fetch origin && git checkout main && git pull --ff-only`，用 `scripts/windows/run-desktop.ps1` 重新构建 debug 客户端（按该脚本原有方式）。
2. 双击 `Start-ScienceScope.cmd` 启动。**通过**：除 ScienceScope 窗口外没有任何命令行/终端窗口。
3. 在"完全接管"下发一条会调用一次 shell 工具的短请求（例如让模型运行 `echo T02_OK` 后回复哨兵）。
   **通过**：运行期间没有窗口闪现；回复正常完成。
4. 确认 `.sciencescope-local\build\tauri\debug\data\logs\desktop-host.log` 存在，且不含 API key。
5. 关闭主窗口。**通过**：任务管理器中本应用的 node / dsh 进程全部退出。

失败就停下，按原格式回报（分支 / SHA、每步通过或失败及证据、付费请求次数）。
在 `docs/DESKTOP_IMPLEMENTATION.md` 顶部 "No stray console window" 小节下补一行结果即可。
