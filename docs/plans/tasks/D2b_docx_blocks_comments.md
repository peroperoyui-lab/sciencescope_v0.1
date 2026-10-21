# D2b docx 读写正式版：增删段落、批注，真实稿件验收

- 起草：Claude，2026-10-21。依据：`architecture/EDITING_DESK.md` §3.2、§3.4 第 3 条、§8（`PATCH …/blocks` 的 `inserted`、`removed`）、§10 D2、§11 第 1–3 行。接在 D2a 之后；做完 D2 结束，D3 会话服务接着用这里的接口。
- 执行：Sol（Windows，需要 Word 和 WPS）；审阅：Claude。约 2 小时，一步交付；超出就停下汇报。

## 目标

写回器支持编辑台的全部正文操作：改段落、在某段后插入新段落（回车拆段就是改一段加插一段）、删除段落；批注能读全（含回复和是否已解决）、新建、改文字、删除。之后用 E0b 缺的英文期刊稿和学位论文补完真实稿件验收。

## 用户会怎么用

- 用户在一段中间按回车，把它拆成两段，保存后用 Word 打开：两段格式和原来那段一样，其余内容不变。
- 用户删掉一整段，段里原有的批注范围和书签没有变成孤儿，Word 不报错。
- 用户在编辑台批注栏里改了自己之前的批注、删了一条 AI 的批注；同事在 Word 里回复过的批注，编辑台里能看到回复和「已解决」，但不能在编辑台里回复（alpha 只读）。

## 要做的

1. **插入段落**（`write.js`）：`writeDocx` 的输入加 `inserted: [{ after: <块 id>, id: <新块 id>, inlines, like?: <块 id> }]`。新段落的 `w:pPr` 照抄 `like`（默认 `after` 那段），文字段的 `w:rPr` 继承规则同改段落。生成新的 `w14:paraId`（8 位十六进制，小于 `0x80000000`，在整个包里不重复，含 `comments.xml` 的段落）和 `w14:textId`（文档声明了 `w14` 命名空间时才写）；返回新块 id 到 paraId 的对应，块 id 用 `p:<paraId>`。`after` 为特殊值 `^` 时插在正文最前。插入只能在同一层级（正文、同一个表格单元格）。
2. **删除段落**：输入加 `removed: [<块 id>]`。被删段落里的成对标记（批注的 `commentRangeStart`/`End`/`Reference`、`w:bookmarkStart`/`End`）移到后一个保留的段落开头（没有就移到前一个的末尾），不跟着删；`w:sectPr` 在段落属性里的段（分节符）不能删，返回错误 `DOCX_SECTION_BREAK`；表格单元格里最后一个段落不能删，返回 `DOCX_LAST_CELL_PARAGRAPH`。错误时整次写回不生效。
3. **读批注**（`comments.js`、`read.js`）：每条批注读出 `id`、作者、缩写、日期、纯文本、锚定的块 id 和起止内联位置（范围标记在哪两个内联项之间），以及 `commentsExtended.xml` 的回复关系（`w15:paraIdParent`）和 `done`。没有 `commentsExtended.xml` 时都当顶层、未解决。
4. **改、删批注**：`writeDocx` 的 `options.comments` 支持 `{op:'add'|'edit'|'delete', ...}`。`edit` 只换批注正文文字（保留第一个段落的 `w:pPr` 和第一个文字段的 `w:rPr`，正文变成一个段落）；`delete` 删掉 `comments.xml` 里那条、正文里同 id 的三个标记，以及 `commentsExtended.xml`、`commentsIds.xml`、`commentsExtensible.xml` 里按 paraId 或 durableId 对应的条目；有回复的批注删除时回复一起删（Word 的行为）。新建时作者和缩写由调用方传入（用户显示名，或「ScienceScope · <角色名>」）。
5. **测试**（合成样例用代码生成）：拆段（改一段加插一段）后两段 `w:pPr` 相同、其余字节相同；新 paraId 不重复；在表格单元格里插段；删一段后它的批注范围和书签移到下一段且 Word 结构合法；删分节符段和单元格最后一段返回错误且不写；读出带回复和已解决的批注；改一条批注文字；删一条有回复的批注后 `comments*.xml` 里都没有它和回复，正文没有残留标记。
6. **真实稿件验收**（§11 第 1–2 行，补 E0b 缺的）：从 `<用户文献库>` 挑一份英文期刊稿和一份中文学位论文（100 页左右），加上 E0b-1 的带域和大量公式的稿件，**复制**到 `.sciencescope-local/temp/desk-d2/samples/`，不改原文件，不进仓库。每份：读入 → 改一句（中文稿改中文句子）→ 拆一段 → 删一段 → 加一条批注、改一条已有批注（没有就先在 Word 里加一条带回复的）→ 写回。解压比较：`document.xml` 只有动过的段落有差异，其余部件只有批注相关部件变化。Word 和 WPS 各打开一次，截图记录有无修复提示；含域的稿件在 Word 里 F9 后目录和交叉引用正确；带修订的稿件接受、拒绝仍可用。学位论文记录读入和写回耗时。

## 可以改的

`app/services/desk/docx/` 及其测试、`docs/architecture/EDITING_DESK.md`（§3.3 加一行 D2 结果、§3.4 第 3 条按实际行为改）、`docs/product/FEATURES.md`、`docs/log/IMPLEMENTATION_LOG.md`（不超过 5 行）。

## 不做的

- 不改 `app/ui/`，不接会话和路由（D3）。
- 不做批注回复和改「已解决」状态（alpha 只读）、不做表格行列增删、不做 AI 修改导出成 Word 修订。
- 不把用户稿件、截图或解压结果提交进仓库。
- 不动 `<预览安装目录>` 及其数据。

## 完成标准

- 干净检出 `npm run check` 全部通过（含 Windows 测试）。
- 第 5 条的测试都在。
- 三份真实稿件逐项有结论：字节差异只在动过的段落和批注部件；Word、WPS 都无修复提示；域更新正确；修订可接受、拒绝。任何一项不通过就停下，写清稿件、部件和原因。报告写进 `.sciencescope-local/temp/desk-d2/D2b.md`，附截图路径。

## 交付

- 分支：`codex/d2b-docx-blocks-comments-YYYYMMDD`，从集成分支最新提交开始。报告不超过 15 行，给出远程分支与 SHA、三份稿件的结论、学位论文的读写耗时。不建 PR、不合并。
