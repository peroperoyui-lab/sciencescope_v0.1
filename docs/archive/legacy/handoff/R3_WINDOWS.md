# R3 交接：L1 Windows 本地化（给 Sol）

R3 做好了新界面 `app/ui/`：一比一沿用旧主界面（相同结构和类名，直接使用旧样式表），接的是新核心。L1 的目标：**在 Windows 原生窗口里使用新核心**——原生外壳启动 `app/main.js`，加载新界面，可以开会、看工作站。按 AGENTS.md 交付，报告不超过 15 行。

## 背景

- 启动：`node app/main.js [--data <目录>]`，标准输出一行 JSON `{ url, token, ui, dataRoot }`；`ui` 就是 `<url>/?token=<口令>`，直接打开即可。界面文件由同一个服务提供，不需要构建。
- 界面在浏览器里已能完整使用（Linux 无头 Chromium 测试 `app/ui/ui.browser.test.js`）。窗口按钮只在 `window.__TAURI__` 存在时显示（`app/ui/components/shell.js` 的 `nativeWindow()`），用的是 Tauri v2 `getCurrentWindow()` 的 `minimize` / `toggleMaximize` / `close`。
- 旧外壳 `src-tauri/` 目前启动旧宿主（`host_url`）。
- 欢迎页的学术站点用 `window.open` 打开；在原生窗口里请改用系统浏览器打开（Tauri opener），旧外壳的做法可以照搬。
- 新界面与旧界面应当看起来一样；如果在 WebView2 里有差别，截图对比后写进报告。
- 原生相关的入口：创建项目页的"选择已有文件夹"在 `window.__TAURI__.dialog.open` 存在时出现（需要 dialog 插件与权限）；"在资源管理器打开"和"默认程序打开"由本地服务调用 `explorer`，确认可用；导出走 WebView2 的下载，确认文件名（含中文）正确。

## 要做的

1. 拉取集成分支，`npm install`，`npm run check`。浏览器测试会自动找 Edge（`C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`）或环境变量 `SCIENCESCOPE_CHROMIUM`；在 Windows 上确认它通过，并用 `SCIENCESCOPE_SCREENSHOTS=<目录>` 留一组截图。
2. 原生外壳接新服务：给 `src-tauri` 加一个启动方式（开关或环境变量，例如 `SCIENCESCOPE_APP=new`），启动 `app/main.js --data <数据根>`，读取那一行 JSON，主窗口加载 `ui`。默认仍走旧宿主，直到 R5 切换。
   - 数据根：开发版 `.sciencescope-local/data`；不要和旧版数据目录混用。
   - 退出时结束 `app/main.js` 进程（它会结束自己的 DSH 子进程）；沿用旧外壳的进程树清理方式。
   - 窗口能力：确认 `main-window-controls` 允许新页面调用最小化、最大化、关闭；`data-tauri-drag-region` 的顶栏可以拖动窗口。
3. 浏览器测试共三个（`app/ui/*.browser.test.js`：对话、设置、工作站），在 Windows 上都要通过。
4. 原生里走一遍（真实便宜模型，OpenCode Go key 写入凭据文件）：新建项目 → 项目内新聊天 → 提问 → 回答流式出现 → 让主专家改计划 → 工作站看到计划卡片和更改记录 → 撤销 → Ctrl+K 搜索 → 视图菜单切换英文。各截一张图，并和旧界面同一页面对比。
5. 检查中文输入法（输入框里组字时按 Enter 不应发送）、中文项目名和中文数据路径。

## 重点看的 Windows 问题

- WebView2 对 import map 与 ES 模块的支持（应当没问题，确认即可）；
- 字体：`/vendor/fonts/noto-sans-sc/` 是否正常加载；
- 外壳读取 `app/main.js` 的标准输出时的编码与换行；
- 外壳退出后没有残留 node / DSH 进程。

## 不做的事

- 不改旧代码（`desktop/`、`scripts/`、`adapters/`）；`src-tauri` 只加新启动方式，不删旧路径。
- 不改界面结构和样式；发现界面问题写进报告，平台相关的小修可以直接改。
- 不做设置页、资料库、助手窗口（R4）。
