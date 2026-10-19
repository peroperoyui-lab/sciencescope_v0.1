# C2 看图工具：专家能看 PDF 页面、公式和图片

- 起草：Claude，2026-10-19。依据：`plans/C_PERMISSIONS_RUNTIME.md` §3、§7；`decisions/DECISIONS.md` 2026-10-19 看图验收一条；复盘 `reviews/REVIEW_2026-10-18.md` C 组第 11 条。
- 执行：Sol（Windows）；审阅：Claude。约 2 小时，一步交付；超出就停下汇报。

## 目标

1. 使用支持图片的模型时，专家能自己调用「看图」，看工作文件夹里的图片、PDF 某一页，或页面上的一块（例如一个公式）。
2. 模型不支持图片时，工具给一句可读的话，不报错。

## 用户会怎么用

- 用户问「S3 第 4 页的公式 (7) 是什么意思」：专家调用看图看第 4 页，必要时再放大公式那一块，然后解释。时间线里这一步写「查看图片 · S3 第 4 页」，点开能看到它看的那张图（细节界面由 Claude 做）。
- 用不支持图片的模型时，专家调用后收到「当前模型不能看图，请换支持图片的模型」，回答里照实告诉用户。

## 要做的

1. **工具 `view_image`**（加进 `TOOL_SPECS`，所有角色共用）：参数 `{ path?, sourceId?, page?, region? }`。
   - `path`：工作文件夹里的图片（png、jpg、webp、gif）或 PDF；`sourceId`：资料库里的资料，读它保存的原件。
   - `page` 从 1 开始，只对 PDF 有效，缺省为 1。`region` 是页面上的比例坐标 `{ x, y, w, h }`（0–1），放大时按原分辨率裁切再缩放。
   - 工具说明写清什么时候用：文字里公式、图表、表格缺失或乱码时。
2. **画图**：PDF 用 `pdfjs-dist`（已装）加 `@napi-rs/canvas`（MIT）在宿主里画成 PNG，长边不超过 1600 像素；图片文件按原样缩放到同一上限。`@napi-rs/canvas` 现在只是 `pdfjs-dist` 的可选依赖，改成项目的正式依赖，从 npmmirror 装。
3. **工具结果带图片**：运行接口（`app/runtime/port.js`）里工具结果可以是 `{ text, images: [{ data, mimeType }] }`；`app/runtime/pi/tools.js` 把它转成 pi 的 `TextContent` 加 `ImageContent`，其他工具照旧。脚本运行时同样能收到图片，测试要用。
   - 时间线和数据库只存一张缩略图的路径（放数据目录，和交付物缩略图同类位置），不把原图 base64 写进数据库。结果里给界面一个 `preview` 字段。
4. **不支持图片的模型**：按模型目录里该模型的 `input` 是否含 `image` 判断，A2-1 已在 `app/runtime/pi/runtime.js` 里这样判断（`supportsImages`），复用它；不支持时由运行时把图片换成「用户会怎么用」里那句话，工具本身不用知道模型。
5. **打包**：Windows 安装包要带上 `@napi-rs/canvas-win32-x64-msvc`，在打好的包里实际跑一次看图确认。
6. **文档**：`docs/product/FEATURES.md` 工具一节；`docs/log/IMPLEMENTATION_LOG.md` 不超过 5 行。

## 可以改的

`app/services/tools.js`、`app/services/builtin-tools/`（新文件 `view-image.js`）、`app/runtime/port.js`、`app/runtime/pi/tools.js`、`app/runtime/scripted.js`、`package.json`、`package-lock.json`、打包配置（`src-tauri/` 和打包脚本中与依赖清单相关的部分）、相关测试、`docs/product/FEATURES.md`、`docs/log/IMPLEMENTATION_LOG.md`。

## 不做的

- 不改 `app/ui/`；时间线里的图片细节由 Claude 做。
- 不做 OCR，不改 PDF 解析器的文字提取。
- 不动 `<预览安装目录>` 及其数据。

## 完成标准

- 干净检出 `npm run check` 全部通过（含 Windows 测试）。
- 功能测试：脚本模型调用 `view_image` 看测试 PDF 第 1 页和一块区域，运行时收到 PNG 图片内容且长边不超过 1600；不支持图片的模型收到那句话。
- 真实模型：OpenCode Go `deepseek-v4.1-flash`（支持图片，用户 2026-10-19 指定）读一篇含公式的 PDF，问一个公式，确认调用了看图且回答引用了公式内容。报告请求数和 token。
- 打好的 Windows 包里看图能用（报告里写一句）。

## 交付

- 分支：`codex/c2-view-image-YYYYMMDD`，从集成分支最新提交开始。报告不超过 15 行，给出远程分支与 SHA，写明 `preview` 字段的格式。不建 PR、不合并。
