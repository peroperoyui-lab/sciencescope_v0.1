# T22 · 阶段 B：Windows 安装包、数据目录、签名、更新与开源发布准备

- 下达：Claude，2026-10-03。执行：Sol（Windows 原生）。通用约定见 `QUEUE.md`、`RB_COMMON.md`。
- 前置：第 1–4 批已合并。对应 ROADMAP「B · 安装、数据生命周期、签名与升级」。
- 交付：可分多个分支 `codex/t22-<主题>-YYYYMMDD`，每个子项单独交付、单独审阅（见文末"分步"）。不开 PR、不合并。
- 平台优先级（用户 2026-10-03）：**只承诺 Windows x64**。Linux 能顺手保持可运行即可（Claude 的云端环境是 Linux），不作为验收项；macOS 暂不做（没有 Mac 设备）。
- 开源、不混淆。目标是用户能从打了标签的提交，对上安装包里的源码。

## 现状（已在代码中核实）

- Tauri 外壳 `src-tauri/src/main.rs` 约 700 行，只负责窗口与原生接口。业务在 Node 宿主（`scripts/desktop-api.mjs` 等）与 DSH 中。
- 外壳通过环境变量 `SCIENCESCOPE_NODE`、`SCIENCESCOPE_HOST_SCRIPT` 找 Node 与宿主脚本，没有时不启动宿主；`tauri.conf.json` 中 `bundle.active` 为 `false`。
- 数据根 `defaultRoot` 是仓库目录（`scripts/prepare-desktop.mjs`），数据都在 `<仓库>/.sciencescope-local/` 下。
- 带平台原生代码的依赖：`onnxruntime-node`、`sqlite-vec`、`sharp`（经 `@huggingface/transformers` 间接引入）、`node-addon-system`；uv 路径在 `.sciencescope-local/runtimes/uv/uv.exe`；向量模型 e5-small 在 `models/`。
- 平台判断分散在约 10 个产品模块中（`workbench-api`、`python-env/environments`、`desktop-api`、`system-fonts`、`research-base/model-assets`、`workspace-folders`、`runtime-dsh/session-env|web-host|protected-paths|credential-isolation`）。
- 仓库**没有 LICENSE 文件**。依赖许可扫描：以 MIT / Apache-2.0 为主，DSH 为 MIT；有 2 个 LGPL-3.0（疑为 sharp 的 libvips），字体为 OFL。

## 要做的

### 1. 运行时随包
- Node 运行时作为外壳的附带程序（Tauri sidecar 或 resources），版本与开发环境一致；宿主脚本、`node_modules`（只含生产依赖与 Windows x64 原生模块）、uv 一并进安装包。
- 外壳改为从安装目录定位 Node 与宿主脚本；开发模式仍可用环境变量覆盖。
- 核实 `sharp` 是否真的会被调用；不需要就在打包时排除，同时去掉 LGPL 组件。
- 向量模型：列出安装包体积（含与不含模型），**由用户决定**是随包还是首次使用时下载（下载要带校验和、可断点续传、可离线手动导入）。

### 2. 数据目录
- 安装版数据根改为 `%LOCALAPPDATA%\ScienceScope\`（或 Tauri 的 app data 目录），安装目录视为只读；开发版保持现状。
- 首次启动时，如检测到旧的开发版数据目录，提示用户是否迁移（复制、校验，原件保留），不自动移动。
- 受保护路径表（T21）跟随新数据根；T16（更改数据目录）的接口要与此一致。
- 卸载默认保留研究数据，提供"同时删除数据"的显式选项。

### 3. 平台模块
- 新建 `scripts/platform.mjs`（或同类位置），收拢：shell 选择（pwsh / bash）、可执行文件名（`.exe`、`Scripts/python.exe` 与 `bin/python`）、权限设置（ACL / chmod）、字体枚举、文件夹选择、用户数据目录。
- 产品模块改为调用平台模块，不再直接判断 `process.platform`。行为不变，现有测试全部通过；能在 Linux 上跑的测试继续能跑。

### 4. 安装包
- Tauri NSIS：可选安装位置、开始菜单与桌面快捷方式、正式窗口标题（替换"ScienceScope · 桌面开发版"）、应用图标；发布者显示 peroperoyui。
- DevTools 关闭、浏览器右键菜单关闭（已有要求），候选包上复验。
- 退出时宿主拥有的进程树全部结束（按 AGENTS.md：观察到子进程 PID 消失）。

### 5. 签名
- Windows Authenticode：主程序、安装器、随包的 `node.exe`、`uv.exe` 和所有 `.node` 原生模块都要签名。
- **需要用户提供证书或签名服务**（OV/EV 证书或 Azure Trusted Signing）。在此之前签名验收保持 BLOCKED，其余工作照常进行。
- 签名脚本从环境变量或系统证书库读取凭据，不写进仓库与日志。

### 6. 更新
- Tauri updater + GitHub Releases 的 alpha 通道。updater 签名私钥只放在用户本机或 CI 密钥库，公钥进仓库。
- 数据迁移：数据库升级前做一致性备份，迁移带版本号，失败可回滚到备份；文件迁移留恢复记录。
- 升级演练：alpha.1 → alpha.2，用一份有代表性的测试数据（不用用户唯一的数据库），核对数据完整。复用 Dot 的 `scripts/rehearsal/`（如已交付），否则自行编写同类脚本。

### 7. 开源发布准备
- 增加 `LICENSE`。**许可证由用户决定**（建议 MIT 或 Apache-2.0，均与依赖兼容）。
- 构建时生成 `THIRD_PARTY_NOTICES`（依赖名、版本、许可证、版权声明），随安装包分发。
- README 增加：构建步骤、系统要求、数据位置、署名（发布者 peroperoyui；Codex 为 AI 辅助开发，Claude（Anthropic）为 AI 辅助审阅与开发）。
- 可选：GitHub Actions 工作流，Windows 上构建并跑 `npm test`，Linux 上跑 `npm test`。签名步骤在证书到位前跳过。

## 验收（在候选安装包上，不是开发服务器）

- 全新 Windows 用户账户上安装、首次启动、配置服务商、完成一次真实对话、讨论、资料库检索、Python 环境创建；退出后没有残留进程。
- 从开发版数据迁移一次；卸载（保留数据）后重装，数据仍在。
- alpha.1 → alpha.2 更新演练通过，数据完整。
- 签名：证书到位后，`signtool verify` 对所有可执行文件和原生模块通过；之前标 BLOCKED。
- `npm test` 与现有 smoke 全部通过；新增平台模块测试。
- 文档：SYSTEM_SPEC（安装、数据目录、更新、签名小节）、ROADMAP 阶段 B、DESKTOP_IMPLEMENTATION；截图：安装向导、首次启动、更新提示（浅色 / 深色、中文 / 英文）。

## 分步（每步单独交付、单独审阅）

1. 平台模块收拢（纯重构，不改行为）。
2. 运行时随包与数据目录（含开发版数据迁移）。
3. NSIS 安装包与进程树退出验收。
4. 更新与升级演练。
5. LICENSE / 第三方声明 / README。
6. 签名（等证书）。

## 需要用户决定

- 许可证：MIT 还是 Apache-2.0。
- 向量模型随包，还是首次使用时下载。
- 正式产品名与窗口标题（默认 "ScienceScope"）。
- 签名证书或签名服务。
