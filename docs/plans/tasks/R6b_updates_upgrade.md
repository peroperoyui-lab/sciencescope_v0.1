# R6b 更新通道、升级演练和最低配置检测

- 起草：Claude，2026-10-24。依据：
  - 用户 2026-10-24 同意 Sol 下一步做 R6b；
  - `ROADMAP.md` R6b 一行；
  - `DECISIONS.md` 2026-10-05「更新通道用 GitHub Releases alpha，首次发布前演练一次 alpha.1 → alpha.2 升级；安装时检测并写明最低配置」；
  - `architecture/RESEARCH_BASE.md` §3.3 最低配置表；
  - 现有的 `tools/package/windows.js`、`installer-hooks.nsh`（覆盖安装只删程序文件，`data\` 不动）、`app/services/research/semantic/model-assets.js`（已有 AVX2、内存、空闲空间检测）。
- 执行：Sol（Windows）；审阅：Claude。约 4 小时，一步交付；超出就停下汇报。

## 目标

1. 装好的 ScienceScope 能发现新版本，用户同意后下载、校验并安装。数据目录不动，装完自动重开。
2. 发布前在本机演练过两次升级：一次 alpha.1 → alpha.2 走更新通道，一次从旧预览包覆盖安装，都证明数据完好、迁移前有备份。
3. 电脑达不到最低配置时，安装时就说清楚差在哪、会少什么功能。

## 用户会怎么用

- 用户打开 ScienceScope，几秒后提示「有新版本 1.0.0-alpha.2」，可以查看更新说明。点「更新并重启」后看到下载进度，程序关闭，安装完自动重开；对话、资料和设置都在。提示和按钮由 Claude 做，这次只提供原生能力和接口。
- 断网、下载中断或签名不对时，用户看到「更新没有完成，当前版本没有改动」，程序照常可用。
- 内存只有 4 GB 的电脑运行安装包时，会弹出说明：「内存低于 8 GB，向量检索会关闭，只能按关键词检索。」可以选择继续安装或取消。系统低于 Windows 10 时直接不让装。

## 要做的

1. **版本号只有一处来源**：
   - `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 的版本必须一致。加一个打包前检查，不一致就停。
   - 打包脚本可以带 `--version` 参数，把三处一起改成指定版本，用于演练。
   - main 上的版本这次不动。
2. **更新通道（原生）**：
   - 用 `tauri-plugin-updater`。要用重启的话加 `tauri-plugin-process`。两个都是 MIT 或 Apache-2.0，版本写死；除此之外不加依赖。
   - 正式地址：`https://github.com/peroperoyui-lab/sciencescope_v0.1/releases/latest/download/latest.json`。alpha 发布不标 pre-release，这样 `latest` 能指到它。
   - 开发和演练时可以用环境变量 `SCIENCESCOPE_UPDATE_ENDPOINT` 换成本机地址。只认 `https`，或者 `http://127.0.0.1`。
   - 更新包签名用 Tauri 的 updater 密钥：
     - 公钥写进配置。
     - 私钥和密码只放在用户电脑上的仓库外目录，不进仓库，不进报告，不进日志。
     - 报告里写明私钥放在哪个目录（用 `<更新私钥目录>` 代替真实路径），以及丢了会怎样：已经装好的版本收不到后续更新，只能手动重装。
   - 安装前先按现有的 `HostProcess.shutdown` 关掉 Node 宿主，等数据库写完、WAL 清理掉，再交给安装程序。安装用 NSIS 的 passive 模式，安装位置不变，`data\` 不动。
   - Authenticode 代码签名不做，要等用户提供证书。报告里写明安装时 SmartScreen 会提示什么。
3. **给界面的接口**：
   - 新增 `app/ui/native-update.js`，不含任何界面元素，导出以下几项。不在原生窗口里时都返回「不支持」。
     - `check()` → `{ available, version, notes, date }`
     - `install(onProgress)`
     - `supported()`
   - 加对应的 capability 权限，只给主窗口。
   - 设置 `updates.autoCheck` 默认 `true`。打开后每天最多自动检查一次，上次检查时间记在设置里；手动检查不受这个限制。界面由 Claude 接。
4. **发布清单脚本**：`tools/package/release.js` 读打包产物和签名文件，生成 `latest.json`（版本、说明、时间、Windows x64 的下载地址和签名），以及一份 `发布说明.md` 草稿，从 `IMPLEMENTATION_LOG` 里取上次发布以来的条目。只在本地生成，不上传、不建 Release。
5. **最低配置检测（安装时）**：
   - 写进 `installer-hooks.nsh`，按 `RESEARCH_BASE.md` §3.3：
     - Windows 低于 10（build 19045）或不是 64 位：不让安装，写明原因。
     - 不支持 AVX2（`IsProcessorFeaturePresent(40)`）、内存低于 8 GB、安装盘空闲低于 5 GB：列出差在哪一项、会少什么功能（向量检索关闭，只能按关键词检索；空间不够时资料和 Python 环境可能装不下），用户可以选继续或取消。
   - 安装语言选英文时，提示也是英文。
   - 静默安装和更新安装时不弹窗，只写进安装日志。
6. **发布文档**：新建 `docs/handoff/RELEASE.md`，写一次发布的完整步骤：
   1. 改版本号；
   2. 打包；
   3. 签名；
   4. 生成 `latest.json`；
   5. 到 GitHub 建 Release、上传安装包、签名文件和 `latest.json`；
   6. 发布后核对一台已装旧版的电脑能收到更新。
   - 其中第 5 步由用户或用户授权的人做。
   - 再写清楚私钥丢了或泄露了怎么办。

## 演练（完成标准的一部分）

- **演练 A（更新通道）**：
  - 用测试产品名打 `1.0.0-alpha.1` 和 `1.0.0-alpha.2` 两个包。
  - 全新安装 alpha.1，造一份数据：内部和外部项目各一个，带分支的对话，全局和项目资料，实体，编辑台版本和批注，专家记忆，技能，MCP，服务商假密钥。
  - 本机起一个地址发 alpha.2 的 `latest.json`，在安装版里检查并安装。
  - 核对：版本变成 alpha.2；数据目录里每个文件的哈希一致（`logs/`、`webview/` 除外；数据库只比各表行数）；凭据还在；能对话。
  - 再测三种失败：下载中途断开、签名被改、地址打不开。三种都应该是当前版本不变、数据不变、能重试。
- **演练 B（旧数据覆盖安装）**：
  - 用 R6a-6 那一版的源码打测试产品包，全新安装后造数据，再用本分支的包覆盖安装。
  - 核对：迁移按顺序跑完；`backups/` 里有迁移前的数据库备份；各表行数符合迁移预期；能对话、能检索。
  - 数据库版本高于程序时拒绝打开，确认这条提示能看到。
- 演练一律用测试产品名和隔离目录。原始记录放 `.sciencescope-local/temp/r6b/`，不进仓库。

## 可以改的

- `src-tauri/`（Cargo 依赖只加上面两个插件、capabilities、更新相关代码）；
- `tools/package/`（包括新文件 `release.js`）；
- `app/ui/native-update.js`（新文件，无界面）；
- `app/core/workspace/resources/settings.js`（只加 `updates.autoCheck` 和上次检查时间）；
- `package.json`、`package-lock.json`（只为第 1 条）；
- 各自的测试；
- `docs/handoff/RELEASE.md`（新）、`docs/product/FEATURES.md`、`docs/decisions/DECISIONS.md`（一条）、`docs/log/IMPLEMENTATION_LOG.md`（不超过 5 行）。

## 不做的

- 不建 GitHub Release，不上传任何东西，不改仓库设置；发布由用户决定。
- 不做 Authenticode 签名，不做 macOS。
- 不做更新提示、设置里的开关和进度这些界面，由 Claude 做。
- 不改 main 上的版本号。
- 不动 `<预览安装目录>` 及其数据、备份。私钥、密码、个人路径不进仓库和报告。

## 完成标准

- 干净检出 `npm ci` 后 `npm run check` 全部通过（含 Windows 测试），`cargo test` 通过。
- 测试覆盖：
  - 版本不一致时检查会停；
  - `latest.json` 生成正确；
  - 更新地址只认 https 或 127.0.0.1；
  - 不在原生窗口时 `native-update.js` 返回不支持；
  - 自动检查每天最多一次。
- 演练 A、B 全部通过。报告给出每一步的耗时、安装包体积，以及三种失败下用户看到的话（100% 截图即可）。
- 最低配置提示：在虚拟机或用模拟参数，测一次「内存不足，继续安装」和一次「系统太旧，不让装」，截图。

## 交付

分支 `codex/r6b-updates-YYYYMMDD`，从 `main` 最新提交开始。报告不超过 15 行，写明：

- 远程分支和 SHA；
- 两次演练的结论和数字；
- 私钥存放方式（不写真实路径）；
- 还挡着正式发布的事项，比如签名证书。

不建 PR，不合并。
