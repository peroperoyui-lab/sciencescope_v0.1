# R6a 预览安装包（用户首测）

- 起草：Claude，2026-10-12。依据：用户 2026-10-12 决定不用 Dot，全部在本地 H 盘完成；先出一个能安装的预览包，由 Codex 安装到 H 盘指定路径，用户自己接入 API 跑全流程，作为第一手用户反馈。
- 执行：Sol（Windows，本地 H 盘）；审阅：Claude。分两步交付，各自可合并：
  - **6a-1 新核心成为默认、运行时随包**
  - **6a-2 安装包与安装验收**
- 每步约 2 小时，超出就停下汇报。
- 参考：旧线时期的 `docs/archive/legacy/tasks/T22_packaging_and_release.md`。那份针对旧宿主，这里只取适用于新核心的部分。

## 目标

做出一个 Windows x64 安装包。在一台机器上能做到：
- 选择安装位置（例如 `<预览安装目录>`）并安装；
- 首次启动进入欢迎页；
- 在设置里接入自己的服务商（OpenAI 兼容地址、密钥、自定义请求头、获取模型列表）；
- 跑完整的研究流程；
- 退出后不留进程；
- 覆盖安装、卸载后数据都还在。

**这次不做**：自动更新、升级演练、签名、旧数据导入、删除旧线。这些放到用户首测之后（R5、R6b）。

## 6a-1 新核心成为默认、运行时随包

1. **默认启动新核心**：
   - 原生外壳不设环境变量时启动 `app/main.js`；旧宿主只在开发时用 `SCIENCESCOPE_APP=legacy` 启动。旧线代码先不删（R5 删）。
   - 窗口标题改为"ScienceScope"（去掉"桌面开发版"）；图标用正式图标。
2. **运行时随包**（Tauri resources 或 sidecar，二选一，写明理由）：
   - Node 运行时，版本与开发环境一致（现为 22.22.2）；
   - `app/`；
   - 只含生产依赖的 `node_modules`，带 Windows x64 原生模块：`onnxruntime-node`、`sqlite-vec`、DSH 等；
   - `uv.exe`；
   - `python/builtin.*` 清单、`models/default-embedding.json`。
   - 外壳从安装目录找到这些文件；开发时仍可用环境变量覆盖。
   - 核实 `sharp` 等间接依赖是否真的会用到，用不到就不打进包。
   - 向量模型不随包，首次开启时下载（已有，默认官方源）。
   - Python 本体不随包，由 uv 首次需要时下载。
3. **数据目录**（原则 1，`docs/architecture/DATA_AND_ROLES.md`）：
   - 安装目录下 `data/` 放全部用户数据，`app/` 等放程序；覆盖安装只替换程序，不动 `data/`。
   - 日志写在 `data/logs/`，用户反馈时可以打包发送。
   - 开发版的数据目录不变。
4. **Python 本体的下载源**（用户 2026-10-12："默认官方，设置里给可选项"）：
   - uv 下载 CPython 默认走官方源（python-build-standalone 的 GitHub 发布页）。
   - 设置"运行环境"页的 Python 一节加"Python 下载源"：官方（默认）/ 国内镜像 / 自定义。
   - 国内镜像要先确认地址可用、文件一致（例如 npmmirror 的 python-build-standalone 二进制镜像），确认不了就只给"官方"和"自定义"。
   - 通过 uv 的 `UV_PYTHON_INSTALL_MIRROR` 生效，只放进 uv 子进程的环境。
5. **构建命令**：`npm run package` 一条命令出安装包，产物放 `.sciencescope-local/dist/`。版本号用 `1.0.0-alpha.0`；如果 NSIS 不接受预发布版本号，改用 `0.9.0` 并在报告里说明。

## 6a-2 安装包与安装验收

1. **NSIS 安装包**：
   - 按当前用户安装，不需要管理员权限；
   - 安装位置可选，默认 `%LOCALAPPDATA%\ScienceScope`；
   - 开始菜单和桌面快捷方式；
   - 发布者显示 peroperoyui；
   - 包内带 `LICENSE`（MIT）和自动生成的 `THIRD_PARTY_NOTICES`（依赖名、版本、许可证）。
2. **卸载**：默认保留 `data/`；另有"同时删除我的数据"的选项，默认不勾选。
3. **未签名**：这次不签名。安装时 Windows SmartScreen 会提示"未知发布者"，在首测指南里写明怎么继续。
4. **退出**：关闭窗口后结束整个进程树（Node、DSH、uv、Python 子进程），沿用 L1 的做法。
5. **首测指南**：照 `docs/handoff/PREVIEW_TEST.md` 的结构，补上安装、数据位置、日志位置三节的实际路径和截图。

## 可以改的

- `src-tauri/`（默认启动、资源打包、NSIS 配置、标题图标、退出清理）；
- `package.json`（`package` 脚本）、构建脚本（放 `tools/` 或 `scripts/package/`，不放旧线的 `scripts/` 根下与旧代码混在一起）；
- `app/main.js`、`app/core/paths.js`（定位安装目录与 `data/`）；
- `app/services/python/`（Python 下载源）、设置资源与设置页 Python 一节；
- `docs/handoff/PREVIEW_TEST.md`（补实际路径）、`archive/legacy/SYSTEM_SPEC_2026-10-18.md`（安装与数据目录一节）、`log/IMPLEMENTATION_LOG.md`（每步不超过 5 行）。

## 不做的

- 自动更新、升级演练、签名（R6b）；旧数据导入、删除旧线（R5）；平台模块的整体重构。
- 不随包附带向量模型和 Python 本体。
- 开发机下载依赖仍走国内镜像（`AGENTS.md`）；产品里的默认源是官方源。

## 完成标准（在安装包上，不是开发服务器）

由 Sol / Codex 在本机完成：

1. 运行 `npm run package` 出安装包。
2. 安装到 H 盘指定路径，例如 `<预览安装目录>`。
3. 首次启动，打开的是新界面；窗口标题为"ScienceScope"。
4. 在设置里添加 OpenCode Go 服务商，并获取模型列表。
5. 跑一遍简短冒烟：
   - 发一条消息；
   - 进行一次有序讨论；
   - 导入一篇 PDF 并检索；
   - 创建内置 Python 环境；
   - 一个两三轮的自动化目标；
   - 导入两版稿件。
   - 用真实 `deepseek-v4.1-flash`，报告请求数和 token。
6. 退出后确认没有残留进程。
7. 覆盖安装同一个包，数据还在。
8. 卸载（保留数据）后重装，数据还在。

另外：
- 每个关键页面在 100% / 125% 缩放下截一张图。
- 报告写明安装包大小、安装后占用空间、首次启动耗时。
- 开发仓库里每步都在干净检出上跑 `npm run check` 通过。

然后把安装包路径和补全后的首测指南交给用户。

## 交付

- 分支：`codex/r6a-1-runtime-bundle-20261012`、`codex/r6a-2-installer-20261012`（6a-2 基于 6a-1）。
- 安装包不进 Git，放 `.sciencescope-local/dist/`，报告写明路径和 SHA-256。
- 每步报告不超过 15 行，给出远程分支与 SHA。
- 不建 PR、不合并。
