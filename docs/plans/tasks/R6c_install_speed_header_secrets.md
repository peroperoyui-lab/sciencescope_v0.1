# R6c 安装和更新提速，服务商 header 改存凭据

- 起草：Claude，2026-10-24。依据：
  - 用户 2026-10-24 同意 Sol 下一步做这两件；
  - R6b 演练记录（`handoff/RELEASE.md`）：在 USB 机械盘上，全新安装 457 秒，更新重开 904 秒，覆盖安装 1418 秒，程序约 1.35 万个文件；
  - `ROADMAP.md` P4 一行（安装和更新耗时）；
  - R5 审阅时发现服务商自定义 header 以明文存在 `settings.json` 和修订历史里（`app/services/export/sanitize.js` 列出的位置）；
  - MCP 已有的做法：`app/services/mcp/config.js`，值存进凭据，配置里只留 `{ keyRef }`。
- 执行：Sol（Windows）；审阅：Claude。约 3 小时，两段各自提交，一次交付；超出就停下汇报。

## 目标

1. 在同一块盘上，更新一次在 3 分钟内完成，全新安装和覆盖安装各在 4 分钟内完成。
2. 服务商的自定义 header 值和 API 密钥一样，只存在 `data/secret/credentials.yaml` 里；设置文件、修订历史和历史版本里不再有明文。

## 用户会怎么用

- 用户点「更新并重启」，一两分钟后程序重开，看到的是新版本。不会出现等了十几分钟、以为卡住的情况。
- 用户给某个服务商加了 `X-Api-Key: …` 这样的 header，保存后照常能用。之后打开设置文件或导出数据，都看不到这个值。
- 已经存过明文 header 的老数据，升级后第一次启动时自动搬进凭据，用户什么都不用做。

## 要做的

### 第一段：安装和更新提速

1. **先量后改**：用 R6b 的 alpha.2 测试包，分别量全新安装、覆盖安装、更新三种情况，各记下以下几项，作为基线：
   - 文件数、字节数；
   - 各阶段耗时：预安装钩子的删除、解压写入、安装后的步骤；
   - Windows Defender 实时扫描占了多少时间。可以用 `Get-MpPerformanceReport`，或在临时排除测试目录后对比；排除项测完要撤掉，正式方案不能依赖用户关掉杀毒软件。
   - 报告列出文件数最多的 20 个包，以及它们是不是原生模块。
2. **减少文件数**，按效果从大到小选做，目标总文件数 3,000 以内：
   - 纯 JS 的依赖和 `app/` 自己的代码，用已有的 `esbuild` 打成少数几个文件，只在打包时做，开发时照旧直接跑源码。带 `.node` 文件的原生模块（`onnxruntime-node`、`sqlite-vec`、`@napi-rs/canvas` 等）和运行时要按路径读取的资源（pdf.js 的 worker、字体、KaTeX、模型清单等）保留为文件，加载路径改对。
   - 裁剪规则（`tools/package/prune.js`）再收紧：去掉运行时用不到的平台二进制、示例、测试、文档。
   - 如果打包后某个功能跑不通，宁可这个包不打进 bundle，也不要改功能代码去迁就；报告里列出没打进去的包和原因。
3. **覆盖和更新时少做无用功**：
   - 预安装钩子现在会删掉整个 `node_modules` 和 `app`，再重新写入。改为删除旧版本有、新版本没有的文件，再覆盖写入。安装程序里放一份新版本的文件清单，按清单删。
   - `data/` 照旧不碰。
4. **shell 守护程序在打包时编译好**：R6b 的 `windows-shell-job.cs` 改为打包时编译成 exe，放进 `runtime/`，运行时优先用它。找不到时才现场编译，编译失败再退回 `taskkill`（审阅时补的后备路径保留）。
5. **验收**：在同一块盘上重量第 1 条的三种情况，报告给出前后对照表；R6b 的演练 A（更新）至少重跑一次，确认数据不变、能对话。

### 第二段：服务商 header 改存凭据

6. **保存**：服务商的 `headers` 按 MCP 的做法处理。
   - 保存时，每个值存进凭据，`keyRef` 用 `provider.<服务商 id>.headers.<名称>`，配置里只留 `{ keyRef }`。
   - 传进来的值已经是 `{ keyRef }` 时原样保留。
   - 删掉一个 header 或删掉服务商时，对应的凭据一起删除。
7. **使用**：发请求和获取模型列表（`discoverModels`）时，从凭据解出值；凭据缺失时报「请重新填写 <服务商> 的 <名称>」。
8. **接口**：读取设置和服务商时，`headers` 返回 `{ 名称: { keyRef } }`，不返回值。设置页的 header 编辑由 Claude 改成和 MCP 页一样的「已保存，可替换」样式。在 Claude 改完之前，现有的文本框照旧能提交明文，后端照第 6 条处理。
9. **老数据**：启动时检查 `settings.json`，里面还有明文 header 的，搬进凭据并改成 `{ keyRef }`。在同一个事务里，用 `export/sanitize.js` 的规则把 `revisions` 和 `resource_snapshots` 里的这些旧值替换成 `<已移除>`，相关哈希重算；表行数不变，这一步之前先备份数据库。正式版之前允许这样改历史数据（用户 2026-10-18）。只处理 header，不处理其他字段。

## 可以改的

- 第一段：`tools/package/`（包括新的打包脚本）、`src-tauri/installer-hooks.nsh`、`app/services/builtin-tools/windows-shell-job.js`（只为第 4 条）、为打包修正资源加载路径所需的最少改动（列在报告里）。
- 第二段：`app/services/providers.js`、`app/core/workspace/resources/settings.js`、`app/services/export/sanitize.js`（只抽出可复用的部分）、启动时迁移所在的模块、相关路由。
- 两段都可以改：各自的测试；`docs/product/FEATURES.md`、`docs/handoff/RELEASE.md`、`docs/log/IMPLEMENTATION_LOG.md`（不超过 5 行）。

## 不做的

- 不加新依赖。
- 不改界面：设置页 header 的显示由 Claude 做。
- 不改 Defender 或系统设置作为方案。
- 不改 main 上的版本号，不建 Release。
- 不动 `<预览安装目录>` 及其数据、备份。不提交真实数据、私钥、个人路径或截图。

## 完成标准

- 干净检出 `npm ci` 后 `npm run check` 全部通过（含 Windows 测试），`cargo test` 通过。
- 第一段：
  - 前后对照表达到目标，或者写明差在哪里、下一步该怎么做；
  - 打包后的安装版能启动、对话、检索、解析 PDF 和 docx、编译 TeX、运行 shell、导出，每样冒烟一次。
- 第二段，测试覆盖：
  - 保存后 `settings.json` 里没有明文；
  - 请求时 header 带上了正确的值；
  - 删掉 header 后凭据也删了；
  - 老数据搬迁后，`settings.json`、`revisions`、`resource_snapshots` 里都搜不到假值，表行数不变，备份存在；
  - 凭据缺失时报错文案正确。

## 交付

分支 `codex/r6c-install-speed-YYYYMMDD`，从 `main` 最新提交开始。两段各自提交。报告不超过 15 行，写明：

- 远程分支和 SHA；
- 前后对照表（文件数、三种安装耗时、Defender 占比）；
- 没打进 bundle 的包和原因；
- 第二段测试结果。

不建 PR，不合并。
