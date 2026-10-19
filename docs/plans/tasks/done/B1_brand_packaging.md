# B1 新图标和安装程序图接进打包

- 起草：Claude，2026-10-19。依据：用户 2026-10-19 认可设计画廊「品牌」组（图标用绿底）；路线图阶段 2 美术资产。
- 执行：Sol（Windows）；审阅：Claude。约 1 小时，一步交付；可以和第三个预览包（R6a-6）放在一起做。

## 目标

安装包、安装程序、开始菜单、任务栏和窗口标题栏都用新的绿底图标；安装程序的欢迎页、完成页有绿色左侧图，各步骤页头右边有标志。

## 用户会怎么用

- 双击安装包：安装程序窗口和文件图标是绿底图标；欢迎页左边是写着 ScienceScope 和中英文介绍的绿色竖图；之后每一步页头右边是墨色标志。
- 装完后，桌面快捷方式、开始菜单、任务栏和窗口左上角都是绿底图标，16px 的小尺寸也看得清圆环和星星。

## 要做的

1. **图标**：`tools/package/windows.js` 生成的打包配置里，`bundle.icon` 改为 `tools/package/brand/icon.ico`（已生成，含 16、20、24、32、40、48、64、256 八个尺寸）；`src-tauri/tauri.conf.json` 的开发配置同样改过去。`tools/package/build-native.ps1` 不再调用旧线的 `scripts/windows/prepare-icon.ps1`（旧线脚本本身不动，R5 时随旧线删除）。
2. **安装程序**：`bundle.windows.nsis` 加 `installerIcon`（同一个 .ico）、`headerImage`（`tools/package/brand/installer-header.bmp`，150×57）和 `sidebarImage`（`tools/package/brand/installer-sidebar.bmp`，164×314）。两张都是 24 位 BMP，由 `node tools/brand/render.mjs` 从 `tools/brand/` 的源文件生成，不要手改。
3. **核对**：在 Windows 上确认任务栏和标题栏的图标是新图标（Tauri 的窗口图标取自 bundle 图标；如果不是，再看是否需要在 `src-tauri` 里显式设置），安装程序在 100% 和 125% 缩放下左侧图和页头图没有被拉伸或裁切。
4. **文档**：`product/FEATURES.md` 打包一节写一句图标和安装图的来源；`log/IMPLEMENTATION_LOG.md` 一行。

## 可以改的

`tools/package/windows.js`、`tools/package/build-native.ps1`、`src-tauri/tauri.conf.json`、必要时 `src-tauri/src/` 里设置窗口图标的地方、相关测试、上面两份文档。

## 不做的

- 不改图标和安装图本身（要改先跟 Claude 说，源文件在 `tools/brand/`）。
- 不动 `app/ui/`（应用里的插画和关于页 Claude 已接好）。
- 不动旧线和 `<预览安装目录>` 及其数据（覆盖安装按 R6a-6 的安排）。

## 完成标准

- 干净检出 `npm run check` 全部通过（含 Windows 测试）。
- 用单独的测试产品名打一个包并安装：截图安装程序欢迎页、任意一步的页头、桌面快捷方式和任务栏图标，各 100% 和 125%。
- 报告里写明窗口图标是否需要额外设置。

## 交付

- 分支：`codex/b1-brand-packaging-20261019`，从集成分支最新提交开始（或并进 R6a-6 的分支，报告里写明）。报告不超过 15 行，给出远程分支与 SHA。不建 PR、不合并。
