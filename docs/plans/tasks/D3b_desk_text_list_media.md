# D3b 编辑台：tex 和 md 会话、文件列表、docx 图片

- 起草：Claude，2026-10-22。依据：`architecture/EDITING_DESK.md` §3.2「tex」「Markdown」「同步」、§3.5、§4.2、§8；D3a 的会话服务（`app/services/desk/`，审阅时加了迁移 027 `version_groups.source_hash/source_version_id`）；U1 已做好的编辑台窗口（`app/ui/components/desk*.js`，现在左栏自己逐层读项目文件夹）。原 D3b 拆成两步：本任务做 tex、md 会话、文件列表和 docx 图片；进入编辑台（`/api/desk/enter`）和 `desk.focus` 留给 D3c。
- 执行：Sol（Windows）；审阅：Claude。约 2 小时，一步交付；超出就停下汇报。

## 目标

1. tex 和 md 文稿能像 docx 一样开会话编辑：按块记修改、逐处撤回、空闲写工作副本、写回项目文件、关闭时生成版本，项目文件在外面改过时不覆盖。
2. 编辑台左栏有一个接口拿到这个项目里能打开的全部文稿和它们的版本信息。
3. 编辑台能显示 docx 里的图片。

## 用户会怎么用

- 用户在编辑台左栏看到 `thesis.docx v7`、`chapters/method.tex v3`、`notes/outline.md`（还没登记，没有版本号）、`refs/Ragin_2008.pdf`，以及只在应用里的「答辩稿 v3」。
- 用户打开 `method.tex` 改了两段、删了一段，撤回其中一处；按 Ctrl+S 写回，TeX 编辑器里打开内容一致，没改的部分逐字节相同；关闭编辑台留下 v4。
- 用户在 VS Code 里改了 `outline.md` 再回编辑台：外面这版先导入成新版本再打开，不覆盖。
- 用户打开带插图的 `thesis.docx`，正文里看到图片；Word 里的 EMF 图显示成占位框（浏览器画不了），不报错。

## 要做的

1. **登记 tex 和 md**（`registerDocument`）：接受 `.tex`、`.md`、`.markdown`。版本组 `format` 分别为 `tex`、`md`（`versions/storage.js` 的格式映射一起加上 `md`）。其余照 D3a：同一路径只有一个组，记 `source_path`、`source_hash`、`source_version_id`。
2. **文本会话**（tex 和 md 共用；新文件可放 `app/services/desk/text.js`）：
   - 原文按 UTF-8 读入，保留原换行（CRLF 或 LF）和文件末尾换行；不是合法 UTF-8 时返回 `DESK_ENCODING`，中文提示。
   - 块是空行分隔的段落（连续空行和空白算分隔，原样保留在块之间），块拼回去逐字节等于原文。块 `kind` 只用于显示：md 的 `#` 标题行、tex 的 `\section` 等记为 `heading` 并给 `level`，其余 `paragraph`；md 的围栏代码块（```）整体算一块，中间的空行不切开。块 id `t:<n>`，会话内递增分配，不复用。
   - `openSession` 返回 `{ session, blocks, text, changes }`，`blocks` 每项 `{ id, kind, level, text }`。
   - **新接口** `PUT /api/desk/sessions/:id/text { baseSeq, text }`：`baseSeq` 必须等于当前 `seq`，否则 409 `DESK_CONFLICT`，带当前全文和 `seq`。新全文切块后和旧块列表对齐（`diff` 包的 `diffArrays` 按块文字配对，同一空档里剩下的块按位置当作修改），每个变化的块一条 `desk_changes`：`edit`、`insert-block`、`remove-block`，`before_json`、`after_json` 存块文字（插删另存前一块 id，撤回时放回原处）。`seq` 加一，发 `desk.changed`。全文没变时不记录、不加 `seq`。
   - 撤回、保留、保存、关闭、外部修改、重启恢复都走 D3a 的同一套（撤回条件同样是块当前内容等于这条记录的 `after`）。工作副本是真实的 `.tex`、`.md` 文件，空闲 2 秒写一次。
   - D3a 的 `PATCH …/blocks` 对文本会话返回 `DESK_FORMAT`；`PUT …/text` 对 docx 会话也返回 `DESK_FORMAT`。
3. **文件列表** `GET /api/desk/documents?projectId=`：
   - 返回 `{ files: [...], groups: [...], truncated }`。`files` 是项目文件夹里扩展名为 docx、tex、md、markdown、pdf 的文件，按路径排序，每项 `{ path, name, format, size, mtime, group }`，`group` 为已登记的版本组摘要 `{ id, latest: { id, number, branch, tier }, sourceVersionId }`，未登记为 `null`。`groups` 是没有 `source_path` 的版本组（只在 `data/` 里），同样带 `latest`。
   - 递归读项目文件夹（`project-files.js` 的根），跳过以 `.` 开头的文件夹、`node_modules`；项目用自带文件夹时另跳过 ScienceScope 自己的 `workbench`、`notes`、`minutes`、`versions`、`desk`（同 `knowledge/project-index.js` 的 `ownFolders`，加上 `desk`）。找到 2000 个文稿就停，`truncated: true`。读不了的子文件夹跳过，不让整个请求失败。
   - 只读，不登记、不导入、不建会话。
4. **docx 图片** `GET /api/desk/sessions/:id/media/:ref`：`ref` 是块里 `image` 原子的 `ref`。从会话的原始包里按关系找到图片部件，返回原字节和 `content-type`（png、jpeg、gif、bmp、webp、svg 照常；emf、wmf、tiff 等也原样返回各自类型，界面自己决定显示占位）。原子里有多张图时取第一张；找不到返回 404 `DESK_MEDIA_NOT_FOUND`。块列表里的 `image` 原子加 `media: true`（能取到图片时），界面据此决定要不要请求。
5. **测试**（合成文件用代码生成）：
   - tex：登记两次只有一个组；打开 → 改一段、插一段、删一段 → 撤回删段（放回原处）→ 写回项目文件后和预期全文逐字节相等，CRLF 文件仍是 CRLF → 关闭生成父子版本；`baseSeq` 落后返回 `DESK_CONFLICT`；全文不变不加 `seq`。
   - md：围栏代码块里有空行时仍是一块；标题行给 `level`；改一个块后其余原文逐字节不变。
   - 外部修改：md 在外面改过后打开导入成 `external` 版本；连续两次写回项目文件不误报（D3a 审阅时补的规则对文本会话同样成立）。
   - 非 UTF-8 文件返回 `DESK_ENCODING`。
   - 文件列表：自带文件夹里的 `notes/`、`versions/` 不列出；外部文件夹里同名文件夹照常列出；已登记文件带 `group.latest.number`；只在 `data/` 里的组出现在 `groups`；超过上限时 `truncated`（测试里把上限做成可注入）。
   - 图片：合成一个带 png 图片的 docx，`media` 返回同样字节和 `image/png`；不存在的 `ref` 返回 404。

## 可以改的

`app/services/desk/`（可加文件）、`app/server/routes/desk.js`、`app/services/versions/storage.js`（只加 `md` 格式）及各自测试；`docs/architecture/EDITING_DESK.md`（§3.2、§8 按实际行为改）、`docs/product/FEATURES.md`、`docs/log/IMPLEMENTATION_LOG.md`（不超过 5 行）。

## 不做的

- 不改 `app/ui/`（编辑器和左栏换用新接口是 U2 的事），不改 `features.editingDesk`。
- 不做 `/api/desk/enter`、`desk.focus`（D3c），不做批注和索引（D6），不做比较（D4），不做 tex 编译（D7）。
- 不新增依赖（`diff`、`jszip` 已有）。
- 不动 `<预览安装目录>` 及其数据，不把稿件、截图提交进仓库。

## 完成标准

- 干净检出 `npm run check` 全部通过（含 Windows 测试）。
- 第 5 条的测试都在。
- 用一份真实的中文 tex 论文章节（含公式、表格）和一份真实 md 笔记各走一遍：登记 → 改两段、删一段 → 撤回一处 → 写回项目文件 → 关闭生成版本；写回的文件用原来的编辑器打开正常，没改的部分逐字节相同。用 D2b 的学位论文测一次文件列表在你的真实项目文件夹上的耗时和条数，以及一张图片的 `media` 耗时。稿件只放 `.sciencescope-local/temp/desk-d3b/`。

## 交付

- 分支：`codex/d3b-desk-text-list-media-YYYYMMDD`，从 `main` 最新提交开始。报告不超过 15 行，给出远程分支与 SHA、两份稿件的结论和三项耗时。不建 PR、不合并。
