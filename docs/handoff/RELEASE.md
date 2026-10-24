# Windows 更新通道与发布

更新通道使用 GitHub Releases，当前仅提供 Windows x64。R6b 提供原生检查、签名校验、安装和重开能力，以及本地发布材料脚本；更新提示、按钮、设置开关和进度界面由 Claude 接入。本次代码仍为 `1.0.0-alpha.0`，尚未创建或上传 Release。升级演练结论、耗时和待发布事项见本文末尾。

## 一次发布

1. **选定版本。** 确定本次版本，例如 `1.0.0-alpha.1`；在第 2 步准备签名环境后再执行 `npm run package -- --version 1.0.0-alpha.1`。脚本会同步 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`，以及锁文件的根版本。没有 `--version` 时，三处不一致会在构建前停止。先按锁文件安装开发依赖；R6c 从它们只读选择实际生产依赖，每次重建暂存 bundle，复用已校验的 Node/uv 下载和 Rust 编译缓存。演练改版本只在隔离工作区进行，正常提交保持 alpha.0。
2. **准备签名环境并打包。** 首次生成 updater 密钥时，由受控子进程调用现有 Tauri CLI 的 `signer generate`，将密钥写到 `<更新私钥目录>\updater.key`；按下一节处理输出，成功后只读取 `.pub` 文件核对公钥，再写入 `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`。该目录在仓库外，私钥和密码另行备份。现有密钥继续使用，不为每次发布重新生成。仅向当前构建子进程传入签名环境，再运行第 1 步的命令。
3. **核对签名产物。** `bundle.createUpdaterArtifacts=true` 让 Tauri 在打包时完成 updater 签名。`.sciencescope-local/dist/` 应同时出现 NSIS `.exe` 与同名 `.exe.sig`，两者必须来自同一次构建。副本、改名和上传之后仍需保持安装包字节不变。此签名供 updater 验证，Authenticode 代码签名另等用户证书；当前 Windows SmartScreen 可能显示「未知发布者」或「Windows 已保护你的电脑」。签名步骤及产物格式见 [Tauri 官方 updater 文档](https://v2.tauri.app/plugin/updater/)。
4. **生成本地发布材料。** 例如：

   ```powershell
   node tools/package/release.js --artifact "<安装包.exe>" --previous-version "1.0.0-alpha.0" --output ".sciencescope-local/dist"
   ```

   默认读取同名 `.exe.sig`；可用 `--signature` 指定。`--previous-version` 读取对应 `v<版本>` Git 标签的实施记录；没有该标签时改用 `--since <上次发布的提交或标签>`。两者都未指定时尝试最近的 `v*` 标签，无标签按首次发布取完整实施记录。脚本比较 `docs/log/IMPLEMENTATION_LOG.md`，生成 `latest.json`（`version`、`notes`、`pub_date`、`platforms.windows-x86_64.url/signature`）及 `发布说明.md` 草稿。默认下载地址为 `https://github.com/peroperoyui-lab/sciencescope_v0.1/releases/download/v<版本>/<安装包名>`；草稿经发布者核对后使用。
5. **由用户或获得授权的发布者发布。** 在 `peroperoyui-lab/sciencescope_v0.1` 创建相应 `v<版本>` Release，上传安装包、同名 `.sig` 与 `latest.json`。alpha 版本不勾选 pre-release，使 `releases/latest` 能指向该发布。脚本只生成本地材料，不上传、不创建 Release。
6. **在已安装旧版的电脑复核。** 正式清单地址是 `https://github.com/peroperoyui-lab/sciencescope_v0.1/releases/latest/download/latest.json`。检查版本、说明与时间；同意更新后核对下载、验签、同目录覆盖、自动重开，以及对话、资料、设置和凭据。数据库有待执行迁移时，迁移前备份应出现在 `data/backups/`。完整标准见 [R6b 任务书](../plans/tasks/done/R6b_updates_upgrade.md)。

## 签名环境只传给当前构建进程

**首次生成密钥时的输出处理：** Tauri CLI 可能向标准输出打印私钥。不要直接在会留终端记录的会话中执行生成命令，也不要使用 `tee`、转录或把 stdout/stderr 重定向到日志。用 `spawnSync` 等受控子进程捕获 stdout 和 stderr，完成后丢弃这两份输出；失败时只报告退出码，不打印返回对象、标准输出或标准错误。生成成功后，只读取 `<更新私钥目录>\updater.key.pub` 核对和复制公钥，不读取私钥作为检查输出。密码通过受控输入提供，不写进可留档的命令或脚本。

下面从仓库根目录启动单独的 npm 构建子进程；父终端、用户级和系统级环境均不写入密钥。`<更新私钥目录>` 是占位符，真实目录和密码不得写进仓库、报告或日志。示例版本仅用于获授权的发布工作区。

```powershell
$taskBuild = New-Object System.Diagnostics.ProcessStartInfo
$taskBuild.FileName = (Get-Command node.exe).Source
$taskBuild.WorkingDirectory = (Get-Location).Path
$taskNpm = Join-Path (Get-Location).Path 'node_modules/npm/bin/npm-cli.js'
$taskBuild.Arguments = '"' + $taskNpm + '" run package -- --version 1.0.0-alpha.1'
$taskBuild.UseShellExecute = $false
$taskBuild.EnvironmentVariables['TAURI_SIGNING_PRIVATE_KEY'] = '<更新私钥目录>\updater.key'
$taskPassword = Read-Host 'Updater key password' -AsSecureString
$taskBuild.EnvironmentVariables['TAURI_SIGNING_PRIVATE_KEY_PASSWORD'] = [System.Net.NetworkCredential]::new('', $taskPassword).Password
try {
    $taskProcess = [System.Diagnostics.Process]::Start($taskBuild)
    $taskProcess.WaitForExit()
    if ($taskProcess.ExitCode -ne 0) { throw "Packaging failed ($($taskProcess.ExitCode))." }
} finally {
    $taskBuild.EnvironmentVariables.Remove('TAURI_SIGNING_PRIVATE_KEY')
    $taskBuild.EnvironmentVariables.Remove('TAURI_SIGNING_PRIVATE_KEY_PASSWORD')
    $taskPassword.Dispose()
}
```

私钥丢失时，先从离线备份恢复相同密钥及密码。备份也丢失，已安装版本无法验证用新密钥签发的后续更新，需要生成新密钥、更新公钥、重新打包并让用户手动覆盖安装，保留 `data/`。私钥泄露时立即停止使用该密钥发布，生成替代密钥，撤下受影响的更新材料并通知用户；更换公钥的安装包通过可信的手动分发交付。公钥与 `.sig` 是公开验证材料，私钥和密码始终留在 `<更新私钥目录>` 及其受控备份。

## 原生接口、关闭与重开

`app/ui/native-update.js` 不包含界面，提供 `supported()`、`check()`、`install(onProgress)`；仅原生主窗口受支持。`check()` 返回 `{available,version,notes,date}`，手动检查不受间隔限制，也不写 `lastCheckedAt`。`updates.autoCheck` 默认 `true`；每次启动会判断是否距上次自动尝试满 24 小时，自动尝试在联网前保存 `updates.lastCheckedAt`，成功、无更新或失败都占用这次间隔。没有定时强制安装。

Claude 接界面时监听原生事件 `update:available`（与 `check()` 返回的四字段相同）、`update:error`（`{code,message}`）及 `update:progress`（`{phase,downloaded,total}`；阶段为 `downloading`、`verified`、`stopping`、`installing`，`total` 未知时为 `null`）。事件使用 Tauri 支持的冒号命名，并通过 `emit_to("main", …)` 只发送给主窗口；点号事件名无法注册。`install(onProgress)` 先注册进度监听再调用安装命令，监听注册失败也会返回带 `code` 的错误。

安装先完成下载并验证 updater 签名，再调用现有宿主关闭通道，等待后台任务、SQLite 写入及 WAL/SHM 清理。下载中断、签名不匹配或清单不可达时保留当前版本并返回错误，可再次手动检查。Windows 安装使用已固定的 `tauri-plugin-updater =2.10.1`；其 NSIS 调用包含 `/P /UPDATE /R /ARGS …`，ScienceScope 最后追加 `/D=<当前可执行文件所在目录>`，明确使用当前安装位置，不依赖注册表或上次安装的默认目录，由安装程序覆盖后重开应用；不另加 process 插件。覆盖清理仅针对程序文件，`data/` 保留。参数与退出行为已对照 [2.10.1 官方源码](https://github.com/tauri-apps/plugins-workspace/blob/updater-v2.10.1/plugins/updater/src/updater.rs)；组件按 [Apache-2.0 OR MIT](https://github.com/tauri-apps/plugins-workspace/blob/updater-v2.10.1/Cargo.toml) 双许可使用。该版本的 Windows 安装调用未检查 `ShellExecuteW` 返回值；系统策略若阻止安装程序启动，应用可能已退出，需要手动重开当前版本后重试。

## 本地升级演练与最低配置

演练使用隔离目录和 `SCIENCESCOPE_BUILD_VARIANT=installtest`，产品名为 `ScienceScope Install Test`。该变量同样只放进上面的构建子进程。分别构建 alpha.1、alpha.2；本机更新服务提供 alpha.2 清单、安装包与签名，`release.js --url "http://127.0.0.1:<端口>/<安装包名>"` 可生成本机下载地址。仅在演练应用进程设置 `SCIENCESCOPE_UPDATE_ENDPOINT=http://127.0.0.1:<端口>/latest.json`；正常默认正式 GitHub 地址。清单和下载地址只允许 HTTPS 或 `http://127.0.0.1`。

安装前硬性要求 Windows 10 22H2（build 19045）及更新的 x64 系统。缺 AVX2、内存低于 8 GiB 或安装盘空闲不足 5 GiB 会列出影响，让用户继续或取消：前两项关闭向量检索，关键词检索仍可用；空间不足时资料和 Python 环境可能装不下。提示随安装语言切换中文或英文。静默、被动及更新模式只写检查日志，系统/架构硬性要求仍会拒绝；日志位于当前进程 `$TEMP\<产品名>-install-check.log`。硬拒绝退出码 1633，用户取消为 1602。

只有 installtest 构建接受 `/SCIENCESCOPE_TEST_BUILD=19044`、`/SCIENCESCOPE_TEST_X64=0`、`/SCIENCESCOPE_TEST_AVX2=0`、`/SCIENCESCOPE_TEST_MEMORY=4096`、`/SCIENCESCOPE_TEST_FREE=4096` 模拟参数；内存和空间单位为 MiB。正式构建不编译这些参数。演练 A/B、断流/签名修改/不可达失败路径，以及低内存继续和旧系统拒绝的截图与原始结果留在 `.sciencescope-local/temp/r6b/`；结论如下。

## R6b 本轮验收记录（2026-10-24）

以下均在隔离测试产品完成；证据根目录为 `.sciencescope-local/temp/r6b/`。尚未发布 Release。包体积按 MiB，时间为实测墙钟时间。

| 项目 | 结果 | 耗时 | 证据文件 |
| --- | --- | --- | --- |
| alpha.1 构建 | 94.58 MiB，签名齐全 | 187.230 秒 | `package-1.0.0-alpha.1.json` |
| alpha.2 更新演练包 | 94.56 MiB，签名齐全 | 212.943 秒 | `before-shell-fix/package-alpha2.json` |
| alpha.2 最终包，含 shell 修复 | 94.58 MiB，99,172,234 字节，签名齐全 | 314.162 秒 | `package-1.0.0-alpha.2.json` |
| R6a-6 源码旧包 | 92.98 MiB，供 B 演练 | 1474.944 秒 | `package-old-r6a6.json` |
| A：alpha.1 全新安装 | 通过 | 457.253 秒 | `install-a-fresh.json` |
| A：更新至 alpha.2 并重开 | 通过 | 904.237 秒 | `a-rehearsal.json` |
| A：正常卸载及隔离清理 | exit 0，注册项移除；测试数据另显式清理后目录移除 | 73.089 秒 | `uninstall-a.json` |
| 最低配置交互 | 4096 MiB 提示后继续成功；build 19044 拒绝、退出码 1633 | 943.852 / 4.385 秒 | `installer-native-acceptance-summary.json` |
| B：旧包全新安装 | 后续旧版原生启动通过；辅助脚本失败，NSIS exit unknown | wrapper 925.007 秒 | `b-rehearsal-first-helper-failure.json` |
| B：最终 alpha.2 覆盖 | exit 0，安装后的 shell 修复文件逐字节核对通过 | NSIS 1418.037 秒；wrapper 1419.135 秒 | `b-rehearsal.json` |
| B：新原生启动、迁移及关闭 | schema 22 → 29，通过 | 10.534 秒 | `b-rehearsal.json` |
| B：数据及备份核对 | 原记录保留，新增状态符合启动/迁移预期 | 0.536 秒 | `b-upgrade-preserved.json` |
| B：原生对话及关键词检索 | 合成 SSE 回答及检索命中通过 | 9.535 秒 | `b-rehearsal.json` |
| B：过新版拒绝并截图/关闭 | schema 999 拒绝，副本和原 B 数据哈希保持 | 175.956 秒，含隐藏窗口夹具恢复 | `b-too-new-capture-recovery.json` |
| B：正常卸载及隔离清理 | exit 0，目录、注册项、进程均清理 | 68.864 秒 | `uninstall-b.json` |

A 核对内部/外部项目、分支对话、资料、实体、稿件批注、记忆、技能、MCP 和假凭据；前后各 24 个数据文件、1 个外部文件、70 张表，逐文件哈希、行数及 SQLite 物理文件哈希均一致（按约定排除 logs/webview）。三类失败后数据也一致：断流、签名修改、地址不可达分别返回可重试错误，宿主仍可响应。自动检查首次一次、重启跳过；升级退出清理 WAL/SHM。升级后合成 SSE 对话成功：本地 mock 1 请求、合成 42 tokens，真实模型请求 0。最低配置截图是原生 100% 窗口捕获，系统缩放未改。

三次失败的原生接口消息通过验收脚本放入现有提示组件截图，更新交互界面仍由 Claude 接入：

| 场景 | 返回消息 | 耗时 | 100% 截图 |
| --- | --- | --- | --- |
| 下载断流 | 更新下载未完成，当前版本没有改动。请检查网络后重试。 | 8.696 秒 | `screenshots/a-interrupted-100.png` |
| 签名被改 | 更新包签名校验未通过，当前版本没有改动。请重新检查并下载更新。 | 9.233 秒 | `screenshots/a-bad-signature-100.png` |
| 清单不可达 | 检查更新未完成，当前版本没有改动。请检查网络后重试。 | 21.722 秒 | `screenshots/a-unreachable-100.png` |

包的 SHA-256：alpha.1 为 `3d29fcf05c1918e1335fee20f5c42a953d8fcdf3a21a728fbce8a3518a8072df`；A 使用的 alpha.2 为 `3957794c3df16cb777ff9b27d6ec739b1a19ec6ad99c89e8b8ecd4c70c8dc860`；含 shell 修复的最终 alpha.2 为 `36119acfe07883eae051c7bb1ec1e312e1367df58aaf862f8dab68bced4b4b39`。最终包位于 `.sciencescope-local/dist/ScienceScope Install Test_1.0.0-alpha.2_x64-setup.exe`，本地清单和发布说明草稿在证据目录 `release-final/`。

旧包由 R6a-6 的 `2c3029f7fed7261d58bbc1afec109fd2915f39fa` 源码和其锁文件独立构建，应用与原生代码保持该版本；仅构建环境辅助脚本适配本机 Windows SDK 路径。旧包 SHA-256 为 `5f0cc570ad0b572c000e7b669fa88d588e3674ab432aca7112497bad966418f4`。旧包首次安装的辅助脚本在安装后的 `Get-FileHash` 调用失败，留下 925.007 秒的 wrapper 时间，NSIS 退出码未采集，记为 unknown；后续核对注册项、程序文件及旧版原生启动，并从安装版生成 schema 22 的基准数据。原失败、恢复耗时和中间包覆盖记录均保留。

B 的 23–29 号迁移依次完成，`backups/` 中 v22 副本与基准相符；原有表记录及原件、外部文件和假凭据保留。新启动增加卡片整理参与者 1 条、修订 1 条、事件 2 条、位置 3 条和跳过的后台任务 3 条，以及 `agents/actor_card_builder.md`。这些增量逐项验证，严格零增量对照的差异另存 `b-upgrade-strict.json`。旧版尚无编辑台批注表，当前批注保留由 A 覆盖。B 首次打开旧库前先覆盖过一个未含 shell 修复的中间包，耗时 291.740 秒；未启动该中间版本，数据库仍是 22，随后使用最终包覆盖并首次迁移。

B 旧版数据生成 10.089 秒、旧版原生启动及关闭 13.026 秒、基准清单 0.169 秒；首次安装辅助脚本失败后的恢复墙钟时间为 342.739 秒，含调查，实际恢复重跑 24.367 秒。过新库探测的 `windowsHide:true` 使首次错误窗口隐藏，显示该测试进程拥有的窗口后捕获并正常点击确定；程序显示「数据由更新版本的 ScienceScope 写入，请先升级程序再打开。」及英文。该窗口实际 DPI 120（125%），截图名 `screenshots/b-data-too-new.png`，没有标作 100%。A 三类失败和两项最低配置截图为 100%。对照脚本改为读取隔离数据库副本，避免只读探测留下空 WAL/SHM，原库物理哈希同时核对。

A/B 正式验收各 1 次本地脚本化 SSE 对话，合计 2 请求、输入 48 / 输出 36 / 总计 84 **合成 tokens**；真实模型请求及真实 tokens 均为 0。两次演练关闭后都无所属残留进程，WAL/SHM 已清理；测试产品正常卸载后才显式删除隔离测试数据，未改变默认保留数据的卸载行为。`b-rehearsal.json` 最终 `ok:true`，完整执行记录与截图留在证据目录。用户现有预览安装、数据及备份未操作。

发现与修复：点号事件名被 Tauri 拒绝，改为冒号并限制主窗口，13 项 Rust 测试通过；Git 日志 LF 与工作树 CRLF 导致发布说明全量误入，统一换行后只保留新增条目；NSIS System 寄存器大小写混用，修正后实测内存与 Windows 查询同为 32175 MiB；alpha.2 并行复制出现 EBUSY，串行重打解决。原失败材料及发布清单 `release-a/before-fix/` 保留。

完整检查两轮均在 103 项通过后卡在既有 shell 超时用例：父 shell 已退出，子 Node 仍持有输出管道，`taskkill` 已找不到父进程，工具等待 `close`。原始 0.2 秒调用连续 20 次未复现；同类后台子进程能受控复现。原现场保留于 `shell-timeout-handoff.md`、`clean-check-timeout-hang.json`、`clean-check-second-timeout-hang.json` 及同名日志。调查期间排除该用例的运行已主动停止，未作为完整检查通过的依据。

用户随后授权扩展 shell 白名单并延长约一小时，修复独立提交 `ea061346a2f0e5b8a4f6bf2781a6f915badafa5f`：复用原生外壳的 Windows Job API 做法，由系统 .NET 编译器生成独立守护程序，供不依赖桌面宿主的 Node 工具使用，没有新增 npm/Cargo 依赖。命令挂起创建、归入 Job 后才恢复；超时或取消时终止整棵树，确认成员归零后关闭输出；正常完成解除 kill-on-close，保留重定向后台进程。显式继承句柄列表避免 CLR 附加句柄使输出不能结束。原 0.2 秒超时值及 Linux 进程组路径不变。定向 6/6、父 Job 下 6/6、旧实现正常后台对照 1/1、独立双层调用均通过，相关记录为 `shell-job-test-final-2.log`、`shell-job-nested-test.log`、`shell-job-legacy-background-test.log`、`independent-nested-runshell/report.json`。

在干净检出 `ea061346`、独立 `npm ci` 后，最终完整 `npm run check` 通过格式、lint、types 和全部 **463/463** 测试，失败/取消/跳过均为 0，进程退出码 0，测试阶段耗时 **1789.700 秒**。其中 Windows NSIS 覆盖清理、最低配置模拟及 shell 回归均执行。日志为 `clean-check-after-shell-fix.log`；`cargo test` **13/13**，0 忽略，记录为 `cargo-test.log`。此前中断或卡住的检查保留原结果，没有替代或计入最终通过数。

A 演练使用 shell 修复前的签名包，更新原生代码与最终版本相同；该包、签名和清单保留在 `before-shell-fix/`。最终 alpha.2 已包含独立 shell 修复，B 在打开旧数据库前使用最终包覆盖。

依赖复用官方 updater 2.10.1（Apache-2.0 OR MIT），来源见上文；构建使用国内 npm 镜像、rsproxy 及本地缓存。原始截图在证据目录 `screenshots/`，不入 Git；私钥、密码与个人绝对路径不写入本记录。

正式发布前仍需 Claude 接更新提示、按钮、进度和设置开关，发布者审核说明并创建/上传 Release。Authenticode 等用户提供证书；当前安装器可能触发 SmartScreen 的「未知发布者」或「Windows 已保护你的电脑」提示。私钥及密码保存在仓库外 `<更新私钥目录>` 并应另行备份；丢失且无备份时，需要用户手动覆盖安装使用新公钥的版本。此次未创建 PR、未合并、未发布 Release。
## R6c Windows 验收记录（2026-10-24）

第一段在改动前重测 R6b 原测试包，使用同一块 USB 机械盘、同一测试产品；现有预览安装及其数据、备份均不动。主版本仍为 alpha.0，演练包临时使用 alpha.1/alpha.2，不创建 Release。

| 项目 | 原 R6b 包 | R6c 包 |
| --- | ---: | ---: |
| 程序文件数 | 13,487 | 3,191 |
| 程序字节数 | 400,095,347 | 334,167,748 |
| 全新安装 | 215.073 秒 | 54.598 秒 |
| 覆盖安装 | 377.568 秒 | 72.631 秒 |
| 更新并重开 | 323.105 秒 | 109.056 秒 |

程序统计排除 `data/`，包含主程序、运行时、资源、许可与卸载器；暂存目录 3,185 个文件，安装完成为 3,191 个。文件数减少 76.34%，仍比 3,000 目标多 **191 个（6.37%）**：保留原生及路径资源、npm 动态命令行依赖和完整许可。下一步可单独核对 npm 动态依赖闭包与 transformers 延迟入口，继续打包可合并的 JS 文件；本轮保留这些已验证功能与许可。

最终全新安装的 NSIS 标记：预安装阶段 0.078 秒，解压写入 53.375 秒；完整安装器 54.598 秒，达到 240 秒目标。最终安装版再次正常启动、加载原生桥接和 reader 资源，启动 12.593 秒，未调用模型，关闭后所属进程与 WAL/SHM 清理。

最终同版覆盖安装 72.631 秒，达到 240 秒目标。清理程序检查清单 3,190 项，内部用时 0.588 秒，没有过期文件需要删除；NSIS 预安装共 2.297 秒，其中清理子进程含 PowerShell 启动为 2.141 秒，解压写入 69.062 秒。安装前后全部 **317 个数据文件**的 SHA-256 及 SQLite 物理文件 SHA-256 一致，证据 `after/overlay-data-preserved.json`。

最终 A 演练从原 alpha.1 更新至最终 alpha.2 并重开为 **109.056 秒**，达到 180 秒目标。清理旧包 10,363 个过期文件，内部 16.888 秒，含 PowerShell 启动 18.484 秒；此前预处理 0.110 秒，解压写入 80.531 秒。更新后程序同样为 3,191 文件、334,167,748 字节，和全新安装一致。详细标记及清理计数见 `after/optimized-phase-summary.json`。

A 的断流、签名不匹配、清单不可达及恢复重试均通过；数据、外部文件和 SQLite 物理哈希保持，更新后新进程对话通过，WAL/SHM 清理。对话使用本地模拟模型 **1 次请求、42 个合成 tokens**，与真实 flash 用量分开；原包对照 A 同样是 1 次模拟请求。最终记录为 `after/a-rehearsal.json`，根目录同名文件是原包基线。A、B 测试安装均正常卸载、显式清理隔离数据，目录及注册项移除；不涉及用户预览目录。

基线覆盖安装外部观察到删除约 118.526 秒、写入约 256.700 秒、收尾约 1.388 秒；这些是文件系统变化观测区间。测量时系统已有 Defender 实时保护为关闭状态且无 MsMpEng 进程，未更改系统设置或添加排除项；观察到扫描占用为零。原始基线、各阶段和包清单保留在工作区忽略目录 `.sciencescope-local/temp/r6c/`。

第一段实现与验证：

- `tools/package/bundle.js` 使用既有 esbuild 合并纯 JS 依赖，应用入口保留原路径，浏览器 reader 的 vendor 仅在产物中打包；界面组件、样式和文案保持。第二段仅同步 `settings.browser.test.js` 的 header 返回引用契约断言。
- `npm` 和 `esbuild` 保留命令行及动态模块路径；`pdfjs-dist` 保留 worker、字体和解码资源；`sqlite-vec`、`onnxruntime-node/common`、`@napi-rs/canvas`、`@huggingface/transformers` 及其平台依赖保留原生加载与模型路径。`trash` 保留资源定位，pi-ai 的 Bedrock 延迟入口保留动态加载路径；其余静态依赖进入共享 chunk。完整许可与第三方声明保留。
- `program-manifest.js`、`cleanup-program.ps1` 和 NSIS 钩子按清单只删过期文件；兼容旧包无清单、长路径和目录链接，数据与用户文件保留。`shell-job.js` 打包时预编译守护程序，运行时保留既有后备路径。
- 定向包装测试 6/6、Windows 清单与真实 NSIS 测试 3/3 通过；暂存宿主、PDF/DOCX 解析、检索、布局/比较/向量 worker、预编译 shell、导出和 npm 离线执行通过。NSIS 阶段日志的追加模式原先覆盖文件头，补上写前移到文件末尾，实际安装钩子测试 2/2 通过。

基线文件数最多的 20 个包（按包自身路径计数，嵌套包独立计数）：

| 包 | 文件数 | 字节数 | 包自身含原生模块 |
| --- | ---: | ---: | --- |
| highlight.js | 1558 | 5278203 | 否 |
| openai | 794 | 3294156 | 否 |
| typebox | 693 | 868357 | 否 |
| underscore | 496 | 611127 | 否 |
| @huggingface/transformers | 457 | 8829425 | 否 |
| @smithy/core | 408 | 1309221 | 否 |
| @anthropic-ai/sdk | 392 | 1841480 | 否 |
| pdfjs-dist | 388 | 16156370 | 否 |
| hono | 384 | 905559 | 否 |
| npm | 297 | 2102561 | 否 |
| ajv | 294 | 709496 | 否 |
| zod | 259 | 2313596 | 否 |
| @babel/runtime | 248 | 246948 | 否 |
| @earendil-works/pi-ai | 236 | 1766962 | 否 |
| @codemirror/legacy-modes | 209 | 1883592 | 否 |
| cytoscape | 193 | 5390804 | 否 |
| @modelcontextprotocol/sdk | 178 | 1673058 | 否 |
| yaml | 154 | 585425 | 否 |
| json-schema-to-ts | 134 | 20639 | 否 |
| @aws-sdk/core | 127 | 375462 | 否 |

第二段实现与授权补充：

- `providers.js`、新增 `provider-settings.js` 保存/解析/删除 header 凭据；`catalog.js` 与 `requests.js` 每次使用时解析引用，缺失提示重新填写。工作区资源由应用和 CLI 在组合入口注入，编辑、外部文件读取、撤回及快照恢复共用，因而涉及 `app.js`、`cli.js`、`core/index.js`、`workspace.js`、`snapshots.js` 的最小接线；运行时执行仍接收原始参数，只有持久化副本脱敏。
- 新增 `provider-header-migration.js`：数据库先备份，四表同事务处理并重算哈希。隔离夹具清理 `revisions` 2 行、`resource_snapshots` 2 行、`tool_calls` 1 行、`events` 2 行；后两表合计 **3 行**，各表行数及其他字段不变。末表故障后的回滚、重跑与假值检索通过。
- 明文曾存在的位置：`settings.json` 的 providers.headers；`revisions.before_text/after_text`、`resource_snapshots.content_text`；`tool_calls.args_json/result_json`、`events.payload_json` 中的 settings workspace_edit 记录；运行时会话中的对应 assistant 工具参数，以及匹配 `toolCallId` 的 toolResult.details 与 content JSON 文本。迁移按明确路径处理，普通文本和其他设置保持。
- 新增 `provider-session-migration.js`：先备份原文件至 `data/backups/provider-header-sessions-YYYY-MM-DD/<会话 id>-<原文 SHA-256>.json`，再逐文件临时写入、改名。参数夹具 2 文件/3 值，details 与 content 夹具各 1 文件/1 值，合计 **4 文件/5 值**；跨日重跑复用原备份，已清理文件跳过，其他字节、行数和字段顺序保持。
- 无法解析的 content 夹具保留原文：`runtime/pi/sessions/result-content.json`，`toolCallId=matched`，共 1 处。实际启动把计数、相对备份路径和无法解析项写入 `data/logs/provider-header-migration.log`，不记录值。这里的计数均来自假夹具，未迁移用户预览数据；数据库与会话备份按授权保留迁移前原件。
- header 保存/请求/模型发现/删除/缺失错误、同会话更新凭据、CLI 与工作区路径测试通过；旧会话参数/结果专项及设置浏览器契约 2/2 通过，独立只读审阅通过。新增结果测试初轮的共享对象预期错误已纠正，原始日志保留；完整检查与安装版结果见最终验收数据。
- 设置页“已保存，可替换”的 header 编辑由 Claude 后续接入；本轮保留现有输入框提交明文的兼容路径，读取接口只返回 `{ keyRef }`，没有修改界面组件、样式或文案。

新增源文件均为项目实现；复用现有 esbuild（MIT）及既有 Windows Job 守护源码，未添加依赖、复制新的第三方实现或改动界面实现。所有截图、夹具、构建产物和原始日志均留忽略目录，公开记录只用相对路径。

完整检查中的发现与处理：

- 导出重名测试的两次导出跨过系统分钟边界，第二次得到新的时间名，原 `(2)` 断言失败。只在该测试固定 Date、保留真实计时器，重名断言原样通过；定向 1/1，33.601 秒。没有修改导出行为。
- 首轮验收辅助脚本的 PATH 省略本机正常使用的 PowerShell 7，改走 PowerShell 5。正常后台进程用例在当前代码 6.148 秒失败、基线 `162f393` 同样 6.184 秒失败，PS7 1.400 秒通过。时序记录表明 PS5 主进程约 1.093 秒已退出，但 stdout 被后台进程持有，直到原有超时触发才关闭；PS7 正常释放。此为基线已有的 PS5 兼容问题，未调大超时或更改 shell。第二轮完整检查使用本机 PS7 环境；PS5 定位与三组日志保留在 `shell-background-compare/` 交 Claude。

安装版功能验收（证据 `installed-smoke.json`）：

- 从全新测试安装的设置页添加兼容服务商；模型列表返回 37 个模型，实际 header 值只在凭据文件中，公共设置返回引用。真实 OpenCode Go `deepseek-v4.1-flash` 对话并调用 shell 成功，共 **2 次模型请求、11,845 tokens**（输入 11,717，输出 128）；模型发现另 1 次 HTTP 请求，未算入模型请求。计数代理只记录用量与 header 匹配布尔值。
- 中文路径 PDF/DOCX 导入、解析及项目内关键词检索命中第 1 页；中文 XeLaTeX 编译 9.417 秒，项目文件哈希和目录清单保持不变；完整导出 94 个文件。窗口关闭后宿主 exit 0，全部所属进程退出，WAL/SHM 清理，页面无未捕获错误。没有更改用户预览安装。
- 初轮检索夹具漏传 `projectId`，修正为项目范围后命中；初轮 TeX 使用了 pdflatex，刷新已安装引擎列表后取得 XeLaTeX 并编译成功。两次失败原始记录分别保留在 `installed-smoke-before-project-scope.json`、`installed-smoke-before-tex-refresh.json`，恢复验收没有重复付费请求，也没有修改检索或 TeX 产品代码。
- 原生截图位于 `screenshots/r6c-{fresh,provider,chat-shell,library}-native-{100,125}.png`；100%/125% 使用 WebView2 的逻辑尺寸和设备缩放模拟，系统显示设置保持。最终阶段日志修正版与功能验收安装版的应用及共享 chunks 共 498 个文件逐项 SHA-256 一致，证明文件为 `installed-payload-equivalence.json`。

最终安装器为测试产品 `ScienceScope Install Test_1.0.0-alpha.2_x64-setup.exe`，位于工作区忽略目录 `.sciencescope-local/dist/`，**92,089,708 字节**，SHA-256 **`ef005fec7c51000ebe8b1d948103a269a321d2da1a0f59c35cb7836eab33faad`**，对应 `.sig` 已生成；原 R6b 对照包为 99,172,234 字节，SHA-256 `36119acfe07883eae051c7bb1ec1e312e1367df58aaf862f8dab68bced4b4b39`。Rust 离线 `cargo test` 为 **13/13**，没有失败或忽略项，日志 `cargo-test-final.log`。

干净检出独立执行国内源 `npm ci` 后，最终在源码 `210e60b45b41bedaa703822aa4740b341cff4cef` 上运行 `npm run check`：**474/474 通过，0 失败、0 跳过**，含 Windows 测试；完整命令 2,045.416 秒，测试部分 2,010.712 秒。证据 `clean-check-final.json`、`clean-check-final.log`。首轮 **472/474** 的结果和日志保留在 `clean-check-first-ps5.*`，上述日期测试及 PS5 环境原因均已分别说明；最终源码之后只有交付文档变动。
