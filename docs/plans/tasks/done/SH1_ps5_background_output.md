# SH1 Windows PowerShell 5 下，启动后台进程的命令要等到超时才返回

- 起草：Claude，2026-10-25。依据：R6c 验收记录（`docs/handoff/RELEASE.md`「完整检查中的发现与处理」第 2 条，定位日志在 Sol 本机 `shell-background-compare/`）；Yui 2026-10-25 同意交给 Sol。
- 执行：Sol（Windows）；审阅：Claude。约 2 小时，一步交付；超出就停下汇报。

## 目标

1. 用户的电脑只有 Windows 自带的 PowerShell 5（没装 PowerShell 7）时，专家在 shell 里启动后台进程（例如开一个本地服务、后台跑脚本），命令应在 shell 退出后很快返回，后台进程继续运行，不要等到超时。
2. PowerShell 7、macOS/Linux 的现有行为不变；取消和超时仍然结束整个进程树。

## 用户会怎么用

- 专家运行 `Start-Process python -ArgumentList server.py`、`node launcher.js` 这类启动后台进程的命令，几秒内就得到结果（退出码 0，输出完整），接着做下一步；后台进程还在跑。
- 失败时：命令真的卡住或超时，仍然按 `timeoutSeconds` 停下并结束进程树，结果里写「Command stopped after N seconds.」。

## 要做的

1. **先定位**（结论写进报告，3 行内）：
   - 现状：`app/services/builtin-tools/shell.js` 等到子进程 `close` 才返回。PS5 下 shell 主进程约 1.1 秒就退出了，但 stdout/stderr 管道被后台进程拿着，直到超时才关闭（`shell.test.js` 里的「normal completion preserves a background process」在 PS5 下 6 秒失败，PS7 下 1.4 秒通过）。
   - 要查清：后台进程是怎么拿到管道句柄的（PS5 启动子进程时继承了可继承的句柄？Job 守护 `windows-shell-job.cs` 里管道的继承设置？），以及 PS7 为什么没有。
2. **修复**：
   - 优先从根上修：让后台进程拿不到这两个管道（例如守护程序创建 PowerShell 时只把需要的句柄交出去，或在 PowerShell 启动前把管道设为不可继承）。
   - 如果根上修不了：shell 主进程退出后，最多再等一小段时间（建议 1–2 秒，常量写明理由）读完剩余输出就返回，不结束后台进程。读到的输出要完整写进输出文件。
   - 没有 Job 守护的退路（`taskkill` 那条）也要一起考虑，行为一致。
3. **测试**：
   - 现有 Windows 测试在 PS5 和 PS7 下都要通过。给测试加一种能指定 PowerShell 5 的办法（例如测试里传入可执行文件，或环境变量只在测试中生效），让 PS5 的用例在装了 PS7 的机器上也能跑到。
   - 补一个用例：后台进程持续往自己的输出写，shell 照样按时返回，输出文件里有 shell 自己的全部输出。

## 可以改的

- `app/services/builtin-tools/shell.js`、`shell.test.js`
- `app/services/builtin-tools/windows-shell-job.cs`、`windows-shell-job.js`
- 打包里预编译守护程序的部分（`tools/package/` 中相关文件），如果守护程序有改动
- `docs/product/FEATURES.md` 的 shell 条目、`docs/log/IMPLEMENTATION_LOG.md`

## 不做的

- 不调大超时，不改 `timeoutSeconds` 的默认值，不把「装 PowerShell 7」当成方案。
- 不改界面（`app/ui/`）。不加依赖。
- 不动 `<预览安装目录>` 及其数据。

## 完成标准

- 干净检出 `npm run check` 全部通过（含 Windows 测试）。
- PS5 和 PS7 各跑一次后台进程用例，报告两者的耗时（修复前后对照）。
- 取消、超时用例仍然结束整个进程树。
- 安装版冒烟：在只用 PS5 的环境里，让专家用 shell 启动一个后台进程，几秒内返回，报告请求数和 token（OpenCode Go `deepseek-v4.1-flash`）。

## 交付

- 分支：`codex/sh1-ps5-background-YYYYMMDD`，从 `main` 最新提交开始。报告不超过 15 行，给出远程分支与 SHA。不建 PR、不合并。
