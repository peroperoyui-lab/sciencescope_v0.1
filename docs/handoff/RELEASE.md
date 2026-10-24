# Windows 更新通道与发布

更新通道使用 GitHub Releases，当前仅提供 Windows x64。R6b 提供原生检查、签名校验、安装和重开能力，以及本地发布材料脚本；更新提示、按钮、设置开关和进度界面由 Claude 接入。本次代码仍为 `1.0.0-alpha.0`，尚未创建或上传 Release。升级演练结论和耗时另记验收报告。

## 一次发布

1. **选定版本。** 在发布工作区运行 `npm run package -- --version 1.0.0-alpha.1`，脚本会同步 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`，以及锁文件的根版本。没有 `--version` 时，三处不一致会在构建前停止。只改版本会复用生产依赖缓存；依赖或 npm 配置改变会使缓存失效。R6b 的演练改版本只在隔离工作区进行，正常提交保持 alpha.0。
2. **准备签名环境并打包。** 首次生成 updater 密钥时，用现有 Tauri CLI：`node node_modules/@tauri-apps/cli/tauri.js signer generate -w "<更新私钥目录>\updater.key"`。该目录在仓库外，私钥和密码另行备份；公钥写入 `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`。现有密钥继续使用，不为每次发布重新生成。按下一节仅向当前构建子进程传入签名环境，再运行第 1 步的命令。
3. **核对签名产物。** `bundle.createUpdaterArtifacts=true` 让 Tauri 在打包时完成 updater 签名。`.sciencescope-local/dist/` 应同时出现 NSIS `.exe` 与同名 `.exe.sig`，两者必须来自同一次构建。副本、改名和上传之后仍需保持安装包字节不变。此签名供 updater 验证，Authenticode 代码签名另等用户证书；当前 Windows SmartScreen 可能显示「未知发布者」或「Windows 已保护你的电脑」。签名步骤及产物格式见 [Tauri 官方 updater 文档](https://v2.tauri.app/plugin/updater/)。
4. **生成本地发布材料。** 例如：

   ```powershell
   node tools/package/release.js --artifact "<安装包.exe>" --previous-version "1.0.0-alpha.0" --output ".sciencescope-local/dist"
   ```

   默认读取同名 `.exe.sig`；可用 `--signature` 指定。`--previous-version` 读取对应 `v<版本>` Git 标签的实施记录；没有该标签时改用 `--since <上次发布的提交或标签>`。两者都未指定时尝试最近的 `v*` 标签，无标签按首次发布取完整实施记录。脚本比较 `docs/log/IMPLEMENTATION_LOG.md`，生成 `latest.json`（`version`、`notes`、`pub_date`、`platforms.windows-x86_64.url/signature`）及 `发布说明.md` 草稿。默认下载地址为 `https://github.com/peroperoyui-lab/sciencescope_v0.1/releases/download/v<版本>/<安装包名>`；草稿经发布者核对后使用。
5. **由用户或获得授权的发布者发布。** 在 `peroperoyui-lab/sciencescope_v0.1` 创建相应 `v<版本>` Release，上传安装包、同名 `.sig` 与 `latest.json`。alpha 版本不勾选 pre-release，使 `releases/latest` 能指向该发布。脚本只生成本地材料，不上传、不创建 Release。
6. **在已安装旧版的电脑复核。** 正式清单地址是 `https://github.com/peroperoyui-lab/sciencescope_v0.1/releases/latest/download/latest.json`。检查版本、说明与时间；同意更新后核对下载、验签、同目录覆盖、自动重开，以及对话、资料、设置和凭据。数据库有待执行迁移时，迁移前备份应出现在 `data/backups/`。完整标准见 [R6b 任务书](../plans/tasks/R6b_updates_upgrade.md)。

## 签名环境只传给当前构建进程

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

安装先完成下载并验证 updater 签名，再调用现有宿主关闭通道，等待后台任务、SQLite 写入及 WAL/SHM 清理。下载中断、签名不匹配或清单不可达时保留当前版本并返回错误，可再次手动检查。Windows 安装使用已固定的 `tauri-plugin-updater =2.10.1`；其 NSIS 调用包含 `/P /UPDATE /R /ARGS …`，由安装程序在原位置更新并重开应用；不另加 process 插件。覆盖清理仅针对程序文件，`data/` 保留。参数与退出行为已对照 [2.10.1 官方源码](https://github.com/tauri-apps/plugins-workspace/blob/updater-v2.10.1/plugins/updater/src/updater.rs)；组件按 [Apache-2.0 OR MIT](https://github.com/tauri-apps/plugins-workspace/blob/updater-v2.10.1/Cargo.toml) 双许可使用。该版本的 Windows 安装调用未检查 `ShellExecuteW` 返回值；系统策略若阻止安装程序启动，应用可能已退出，需要手动重开当前版本后重试。

## 本地升级演练与最低配置

演练使用隔离目录和 `SCIENCESCOPE_BUILD_VARIANT=installtest`，产品名为 `ScienceScope Install Test`。该变量同样只放进上面的构建子进程。分别构建 alpha.1、alpha.2；本机更新服务提供 alpha.2 清单、安装包与签名，`release.js --url "http://127.0.0.1:<端口>/<安装包名>"` 可生成本机下载地址。仅在演练应用进程设置 `SCIENCESCOPE_UPDATE_ENDPOINT=http://127.0.0.1:<端口>/latest.json`；正常默认正式 GitHub 地址。清单和下载地址只允许 HTTPS 或 `http://127.0.0.1`。

安装前硬性要求 Windows 10 22H2（build 19045）及更新的 x64 系统。缺 AVX2、内存低于 8 GiB 或安装盘空闲不足 5 GiB 会列出影响，让用户继续或取消：前两项关闭向量检索，关键词检索仍可用；空间不足时资料和 Python 环境可能装不下。提示随安装语言切换中文或英文。静默、被动及更新模式只写检查日志，系统/架构硬性要求仍会拒绝；日志位于当前进程 `$TEMP\<产品名>-install-check.log`。硬拒绝退出码 1633，用户取消为 1602。

只有 installtest 构建接受 `/SCIENCESCOPE_TEST_BUILD=19044`、`/SCIENCESCOPE_TEST_X64=0`、`/SCIENCESCOPE_TEST_AVX2=0`、`/SCIENCESCOPE_TEST_MEMORY=4096`、`/SCIENCESCOPE_TEST_FREE=4096` 模拟参数；内存和空间单位为 MiB。正式构建不编译这些参数。演练 A/B、断流/签名修改/不可达失败路径，以及低内存继续和旧系统拒绝的截图与原始结果留在 `.sciencescope-local/temp/r6b/`，验收完成后另填报告。
