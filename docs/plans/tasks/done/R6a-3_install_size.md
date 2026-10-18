# R6a-3 安装瘦身与安装耗时

- 起草：Claude，2026-10-13。来源：用户首测反馈"安装和卸载都够慢的"；R6a-2b 实测全新安装 8 分 9 秒，R6a-2 覆盖安装 23 分 23 秒、卸载后重装 7 分 48 秒。
- 执行：Sol（Windows，本地 H 盘）；审阅：Claude。约 2 小时，一步交付；超出就停下汇报。

## 原因（Claude 在 Linux 上量过，请在 Windows 上核实）

安装和卸载的耗时大致跟文件数成正比：
- 程序一共 30,677 个文件，其中约 3 万个在 `node_modules`。
- 安装器逐个写入这些文件，卸载器逐个删除；Windows Defender 还会逐个扫描。
- 覆盖安装更慢，可能是因为先跑旧卸载器删一遍，再装一遍。请核实。

Linux 上 `npm ci --omit=dev` 的结果：30,388 个文件，913 MB。按类型分：

| 内容 | 文件数 | 运行时是否用到 |
|---|---|---|
| 类型声明 `*.d.ts` / `*.d.mts` / `*.d.cts` 和 source map `*.map` | 13,931 | 不用 |
| TypeScript 源文件 `*.ts` / `*.mts` / `*.cts` | 1,251 | Node 22 默认不执行，需核实 DSH 不在运行时加载 `.ts` |
| `*.md`（许可文件和 `@deepseek-ai/*` 之外） | 约 500 | 不用 |
| `onnxruntime-web` | 704 个，141 MB | Node 版的检索库（`transformers.node.mjs`）只导入 `onnxruntime-node` 和 `onnxruntime-common`，自身已内联 web 版需要的部分；这个包在 Node 下不加载 |

去掉前三类后约剩 14,700 个文件；再去掉 `onnxruntime-web`，大约 1.4 万个文件、少 150 MB 以上。

## 要做的

1. **在打包脚本里裁剪 `node_modules`**：在 `tools/package/windows.js` 生成 `THIRD_PARTY_NOTICES` 之后、复制到 release 之前，删除 stage 里的：
   - 类型声明和 source map；
   - TypeScript 源文件。先在 DSH 里搜索是否有运行时加载 `.ts` 的代码（例如 `dsh-typert-loader`），有就只对其他包裁剪。
   - 许可、NOTICE、COPYING 文件之外的 `*.md`。`@deepseek-ai/*` 下的 `.md` 一律保留，可能是提示词或技能。
   - `onnxruntime-web` 整个包。
   - 规则写成一个小函数，放在 `tools/package/` 里，并写一个测试（参照 `notices.test.js`）。
   - 不按"看起来像测试 / 文档"的目录名删除，只按上面的规则删。
2. **验证裁剪不影响运行**：不必安装，直接用 release 目录里的 `runtime\node.exe app\main.js --data <临时目录>` 启动，在浏览器里走一遍：
   - 发一条消息（真实 flash）；
   - 导入一篇 PDF 并检索；
   - 开启本地语义检索，完成一次向量化和检索（验证 `onnxruntime-web` 确实用不到）；
   - 创建内置 Python 环境；
   - 打开 PDF / DOCX 预览。
3. **量安装耗时**：用户正在 `<预览安装目录>` 首测，**不要动这个安装和它的卸载记录**。
   - 测量用的包换一个产品名和 identifier，例如 "ScienceScope Install Test" / `org.sciencescope.installtest`，通过打包脚本的环境变量切换；默认值不变。
   - 装到 `<测试安装目录>`，裁剪前后各量一次：全新安装、覆盖安装、卸载。
   - 覆盖安装：确认是否会先运行旧卸载器，分别报告卸载和安装的时间。
   - 测完卸载干净（勾选删除数据），确认开始菜单和"应用和功能"里只剩用户那一份 ScienceScope。
   - 报告 H 盘是固态还是机械硬盘。
4. **报告**：
   - 裁剪前后的文件数、程序大小、安装包大小、三项耗时；
   - 剩余文件数最多的 10 个包。如果还有明显的大头（例如 DSH 的界面包 `dsh-client-ui-*`、`openai`、`@anthropic-ai/sdk`），列出来供下一步决定，这次不删。

## 可以改的

`tools/package/`（裁剪函数和测试、测试用产品名的环境变量）、`docs/handoff/PREVIEW_TEST.md`（安装耗时）、`DESKTOP_IMPLEMENTATION.md`（不超过 5 行）。

## 不做的

- 不打包成单文件（esbuild bundle、SEA），不删 DSH 的包，不改 `app/` 的代码。
- 不改 Windows Defender 或其他系统设置。
- 不重装、不卸载用户正在用的 `<预览安装目录>`。

## 完成标准

- 裁剪测试通过；干净检出 `npm run check` 通过。
- release 目录直接启动，第 2 步全部通过，真实 flash 报告请求数和 token。
- 文件数降到 1.5 万以下。安装耗时目标是全新安装减半；达不到就如实报告各部分耗时，不要硬凑。
- 新的正式包（产品名和 identifier 不变）放在 `.sciencescope-local/dist/`，报告大小和 SHA-256，但**不安装**；等用户首测告一段落再换。

## 交付

- 分支：`codex/r6a-3-install-size-20261013`，从集成分支最新提交开始。
- 报告不超过 15 行，给出远程分支与 SHA。
- 不建 PR、不合并。
