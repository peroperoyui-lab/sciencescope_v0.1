# T04 · 文档解析器与阅读器（PDF / DOCX / MD / LaTeX / 纯文本）

共同规则见 `docs/tasks/RB_COMMON.md`。

## 目标
用成熟工具读取并显示研究文件，解析结果进入研究资料库检索；显示放在现有右侧"文件预览与标记"栏（`desktop/file-preview.mjs`），标记和定位沿用已有功能。

## 第 1 部分：解析器（后端）
1. `scripts/research-base/parsers/pdf.mjs`：使用 `pdfjs-dist`（Node 下的 legacy build），逐页调用 `getTextContent`，
   按行和段落合并文字项，输出 `blocks`：`{kind, text, page, section?, anchor:{page, quote:{exact,prefix,suffix}, rects:[[x,y,w,h]…]}}`。
   - 用字号或粗体推断标题，形成章节路径；参考文献部分标为 `reference`；页眉页脚（多页重复出现的行）去掉。
   - `metadata`：PDF info 中的 Title / Author；在第一页找 DOI（`10.\d{4,9}/…`）和 arXiv ID。
   - 扫描件（几乎没有文字）抛出 `ParserUnsupported('这是扫描件，未提取文字（OCR 尚未提供）。')`。
2. `scripts/research-base/parsers/docx.mjs`：使用 `mammoth` 的 `convertToHtml`，按 h1–h6 形成章节路径，表格整块保留，
   `metadata.title` 取 docProps 或第一个标题。
3. 在 `parsers/index.mjs` 中用 `registerParser` 登记。
4. 测试 `tests/research-parsers.test.mjs`：在测试里用 pdf-lib（MIT，devDependency）或提交一个很小的 PDF / DOCX 夹具（< 50 KB，放在 `tests/fixtures/`）。
   断言：页码正确、章节路径、DOI 识别、扫描件被标为 unsupported、中文可检索（通过 `createResearchBase` 端到端）。

## 第 2 部分：阅读器（前端）
在预览栏中按类型选择显示方式，全部经过 DOMPurify：
- PDF：`pdfjs-dist` 的 `web/pdf_viewer`（PDFViewer + EventBus + FindController + 文字层），支持缩放、跳页，`open(resourceId, {page, highlight})` 可定位到页并高亮引文。
  已有的文件标记要能用在 PDF 文字层上：划选后弹出的标记小窗保持不变，annotation 的 `location` 写成 `{page, quote, rects}`。
- DOCX：默认用 mammoth 生成的 HTML（便于标记）；可以切换到 `docx-preview` 查看原始版式（只读，不标记）。
- Markdown：marked + KaTeX（`$…$`、`$$…$$`）+ highlight.js。
- LaTeX：两个页签——"源码"（CodeMirror 6 只读，`@codemirror/legacy-modes` 的 stex 模式）和"公式"（用 KaTeX 渲染解析器保留的公式块，并按章节排列）。
- 纯文本 / 代码：CodeMirror 6 只读；CSV：表格（前 500 行）。
- **聊天回答中的公式**：在 `desktop/markdown.mjs` 的渲染流程里加入 KaTeX（行内 `$…$`、块级 `$$…$$`、`\(…\)`、`\[…\]`），不能破坏代码块和已有的 DOMPurify 白名单。
- 预览栏上方显示解析状态（已解析 / 部分 / 不支持 / 失败 + 原因），提供"重新解析"（`POST /api/research/sources/ingest`）。

## 验收
- `npm test` 全部通过；`marks-ui`、`research-input-ui`、`chat-ui` smoke 通过。
- 新 smoke `scripts/viewer-ui-smoke.mjs`：打开 PDF 定位到第 2 页并高亮；在 PDF 文字上添加标记；Markdown 公式渲染；LaTeX 两个页签；聊天回答里的公式渲染。
- 浅色和深色截图：PDF、DOCX、LaTeX（公式页签）、带公式的聊天回答。

## 不做
OCR、EPUB、GROBID 之类的外部服务、编辑原件。

## 界面状态（2026-09-25 补充）
- 文件预览遇到尚不能提取文本的格式时，只显示"文件名 · 格式"和"打开原件"按钮，不再显示"尚未提取"之类的提示。
  解析器完成后直接显示正文并支持选中标记；不要恢复说明性文字，需要说明时用"i"提示。
