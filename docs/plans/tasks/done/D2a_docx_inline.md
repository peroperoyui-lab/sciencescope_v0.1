# D2a docx 读写正式版：段内文字和格式

- 起草：Claude，2026-10-21。依据：`architecture/EDITING_DESK.md` §3.2、§3.4、§3.3 E0b 结果里「D2 要补的」、§10 D2、§11 第 1–3 行。接在 E0b-1 原型（`app/services/desk/docx/`）之后；块的增删和批注是 D2b。
- 执行：Sol（Windows，需要 Word 和 WPS）；审阅：Claude。约 2 小时，一步交付；超出就停下汇报。

## 目标

Word 存过的真实稿件里，绝大多数段落都能在编辑台里改字：含制表符、换行、超链接、内容控件的段落不再整段只读，加粗等格式识别正确，公式、域、链接在块的纯文本里有可读的文字（比较和检索用）。写回规则不变：只重写改过的段落，其余字节不动。

## 用户会怎么用

- 用户打开一篇 Word 改过多次的论文。以前带超链接或段内换行的段落只能整段删除，现在可以改其中的字；链接本身保持是链接。
- 一段文字用了「取消加粗」（`w:b w:val="0"`），编辑器里不再显示成加粗。
- 比较两版时，公式和引文域显示为它们的文字（如「(Zhang, 2024)」），不再是一串占位符。

## 要做的

1. **拆开混合文字段**（`read.js`、`write.js`）：
   - 现状：`w:r` 里只要有 `w:rPr`、`w:t` 以外的子元素，整段 `w:r` 就是原子节点。
   - 改为：段内的 `w:tab`、`w:br`、`w:cr`、`w:noBreakHyphen`、`w:softHyphen`、`w:sym` 成为原子节点（`tab`、`break`、`symbol` 等），前后的 `w:t` 是可编辑文字，都带同一个 `run`；`w:lastRenderedPageBreak` 不成为内联项（它是排版缓存）。写回：一个原文字段的所有部分都没变就照抄原文；有变就按顺序重新生成这个字段（同一个 `w:rPr`，`w:t` 和原子节点交替），`w:lastRenderedPageBreak` 丢弃。其他未知子元素（`w:object`、`w:ruby`、`mc:AlternateContent` 等）仍让整段成为原子节点。
2. **超链接和段内容器**：
   - `w:hyperlink`、`w:smartTag`、`w:customXml` 以及行内 `w:sdt`（其 `w:sdtContent` 里的文字段）：里面的文字段照第 1 条可编辑，内联项带 `wrap: <ref>` 指回容器；写回时连续的同一 `wrap` 内联项放回原容器的开、闭标签之间（开标签和 `w:sdtPr` 原样照抄）；容器里的文字全删光时整个容器一起删。
   - 例外：`w:sdtPr` 里有 `w:citation`、`w:bibliography`，或 `w:tag`/`w:alias` 含 CSL、Mendeley、Citavi、EndNote 字样的，是引文控件，整体当 `field` 原子节点，不拆。
3. **格式标记**：`marks` 统一为 `b`、`i`、`u`、`sup`、`sub` 五种（与 ProseMirror schema 一致）。`w:b`、`w:i` 的 `w:val` 为 `0`、`false`、`off` 时是关闭；`w:u` 的 `w:val="none"` 是关闭；`w:vertAlign` 的 `superscript`/`subscript` 转成 `sup`/`sub`。只看直接格式，不展开字符样式（`w:rStyle`），在 `FEATURES.md` 写明。改了文字的段落继承原 `w:rPr`，不按 `marks` 重写格式；`marks` 变了的内联项（用户加粗或取消加粗）在继承的 `w:rPr` 上增删对应元素。
4. **显示文字**（`display`，块的 `text` 投影用它，取代现在的 `\uFFFC`）：域取缓存结果（`separate` 和 `end` 之间的 `w:t`，`w:fldSimple` 里的 `w:t`）；公式取 `m:t` 拼接；`tab` 为 `\t`，`break` 为 `\n`；图片、文本框、脚注引用、书签、批注标记、已有修订仍用占位符 `\uFFFC`（已删除的修订文字不进投影）。原子节点保留 `display` 字段，界面直接用。
5. **公式显示**：核实 `omml2mathml` 的许可证（读仓库或 npm 包里的许可文本），结论写进报告和 `EDITING_DESK.md` §9 那一行；本任务不引入它，公式的 `display` 用第 4 条的线性文字。
6. **测试**（合成样例用代码生成）：每种拆开的情况一个往返测试——改带 `w:tab` 段里的字后制表符仍在、其余字节相同；改超链接里的字后链接目标不变；改普通内容控件里的字；引文控件仍是原子节点；`w:b w:val="0"` 不算加粗；给一段文字加粗和取消加粗；`text` 投影里有域缓存结果和公式文字。另测 4000 段合成稿的读入和写回各一次耗时（写进报告，读入不超过 E0b 审阅后的 0.1 秒量级的五倍）。

## 可以改的

`app/services/desk/docx/` 及其测试、`docs/architecture/EDITING_DESK.md`（§3.2 块结构的字段说明、§9 omml2mathml 一行）、`docs/product/FEATURES.md`、`docs/log/IMPLEMENTATION_LOG.md`（不超过 5 行）。

## 不做的

- 不做新段落、删除段落、批注修改（D2b）。
- 不改 `app/ui/`，不接会话和路由（D3）。
- 不展开字符样式，不做表格结构编辑，不做公式编辑。
- 不动 `<预览安装目录>` 及其数据。

## 完成标准

- 干净检出 `npm run check` 全部通过（含 Windows 测试）。
- 第 6 条的测试都在。
- 用 E0b-1 的三份中文稿件副本（`.sciencescope-local/temp/desk-e0/samples/`）各改一处含超链接或段内换行的段落，写回后 Word 和 WPS 都无修复提示；解压比较只有改动段落有差异。

## 交付

- 分支：`codex/d2a-docx-inline-YYYYMMDD`，从集成分支最新提交开始。报告不超过 15 行，给出远程分支与 SHA、三份稿件结论、4000 段耗时、omml2mathml 许可证结论。不建 PR、不合并。
