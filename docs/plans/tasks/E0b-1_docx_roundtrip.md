# E0b-1 docx 原位回写原型

- 起草：Claude，2026-10-20。依据：`architecture/EDITING_DESK.md`（已定稿）§3.2–3.4、§11 第 1–2 行、§10 E0b；E0a 结论（§3.3：eigenpal 许可证不合适，不采用，走自研）。
- 执行：Sol（Windows，需要 Word 和 WPS）；审阅：Claude。约 2 小时，一步交付；超出就停下汇报。

## 目标

证明「只重写改过的段落，其余字节不动」在真实论文上可行：读入 docx 得到块列表，改一句、加一条批注，写回后 Word 和 WPS 都不出现修复提示，中文字体不丢，引文域和已有修订完好。结果决定编辑台 D2 的写法；不通过时停下报告，不降低标准。

## 用户会怎么用

本任务没有界面。以后在编辑台里，用户或专家改了论文里的一句话、加了一条批注，保存后用 Word 打开，除了那一句和那条批注，文件和原来一模一样。

## 要做的

1. **读入**（`app/services/desk/docx/read.js`）：jszip 解包；用 `saxes`（ISC，从 npmmirror 装，写进 `package.json`）流式解析 `word/document.xml`，按 §3.2 的块结构输出块列表：每个块级 `w:p`（含表格单元格和块级 `w:sdt` 里的段落）、每个 `w:r` 及其 `w:rPr`、每个原子节点（`w:ins`/`w:del`、`m:oMath`、`w:drawing`/`w:pict`、`w:fldSimple`、`w:fldChar … w:instrText`、脚注引用、书签、批注范围标记、文本框）在原字符串里的起止位置。不建 DOM，不重新序列化。块 id 用 `w14:paraId`，没有时用 `b:<序号>`。`comments.xml` 同样读出。
2. **写回**（`app/services/desk/docx/write.js`）：输入原包和「块 id → 新的内联列表」，只重新生成这些块：`w:pPr`、没变的文字段和原子节点原文照抄；改动的文字生成新 `w:r`，`w:rPr` 继承改动起点所在的原文字段（段首时继承后一个）；文字用 `<w:t xml:space="preserve">`。块之间的字节原样拼接。其他部件字节不变。
3. **批注**：新批注写进 `comments.xml`（没有就创建，并登记到 `[Content_Types].xml` 和 `document.xml.rels`），正文插入 id 相同的 `w:commentRangeStart`、`w:commentRangeEnd`、`w:commentReference`；作者是传入的名字。只做新建，不做修改、删除和回复。
4. **合成样例测试**（`app/services/desk/docx/*.test.js`，样例用代码生成，放 `.sciencescope-local/temp`）：公式、域、图片、表格、已有修订、已有批注、中文 `w:eastAsia` 各覆盖一次；改一段后其余 `document.xml` 字节相同、其他部件字节相同；改动段落的 `w:rFonts` 与相邻字段一致；加批注后批注部件只多出新批注。
5. **真实稿件检查**（§11 第 1–2 行）：三份稿件——中文学位论文、英文期刊稿、带 Zotero 引文和大量公式的稿件——从用户的文献库 `<用户文献库>` 里自己挑（用户 2026-10-20 同意，随你测试），**复制**到工作区的 `.sciencescope-local/temp/desk-e0/samples/`，不改原文件，不进仓库。库里找不到某一类（例如带 Zotero 域的 docx）时，用最接近的稿件并在报告里写明缺了什么。每份：读入 → 改一句（含中文的稿件改中文句子；Zotero 那份改含引文的段落）→ 加一条批注 → 写回。解压比较并记录字节差异；Word 和 WPS 各打开一次，截图记录有无修复提示；Zotero 稿件在 Word 里刷新引文仍能识别；带修订的稿件接受、拒绝仍可用，批注不成孤儿。

## 可以改的

`app/services/desk/docx/`（新）及其测试、`package.json` / `package-lock.json`（只加 `saxes`）、`docs/log/IMPLEMENTATION_LOG.md`（不超过 5 行）。

## 不做的

- 不改 `app/ui/`，不接路由、会话、版本图（D1–D3），不做 tex。
- 不用 docx（dolanmiu）、mammoth、pandoc 做写回。
- 不把用户稿件、截图或解压结果提交进仓库。
- 不动 `<预览安装目录>` 及其数据。

## 完成标准

- 干净检出 `npm run check` 全部通过（含 Windows 测试）。
- 三份真实稿件逐项有结论：字节差异只在改动段落和批注部件；Word、WPS 都无修复提示；`w:eastAsia` 保留；Zotero 刷新正常；修订可接受、拒绝。任何一项不通过就停下，写清失败的稿件、部件和原因。
- 报告写进 `.sciencescope-local/temp/desk-e0/E0b-1.md`，附截图路径。

## 交付

- 分支：`codex/e0b-1-docx-roundtrip-YYYYMMDD`，从集成分支最新提交开始。报告不超过 15 行，给出远程分支与 SHA、三份稿件的结论、`saxes` 版本和许可证。不建 PR、不合并。
