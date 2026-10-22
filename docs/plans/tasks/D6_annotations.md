# D6 批注与索引：数据、接口、锚点和专家工具

- 起草：Claude，2026-10-22。依据：`architecture/EDITING_DESK.md` §2 场景 5、6，§6（批注与索引，索引即原「来源绑定」），§12；`DECISIONS.md` 2026-10-22「编辑台第三版」（一个「批注与索引」入口，增删改查含专家的；标记的文字还剩一个字就保留，最后一个字删掉时一起删除，撤销一起恢复）；D2b 的 docx 批注读写（`docx/comments-read.js`、`comment-edit.js`、`writeDocx` 的 `comments`）；D3a/D3b 的会话和修改记录；D5 的 manuscript 工具（这次补上 D5 留下的 `comment`、`bind`、`unbind`）。
- 执行：Sol（Windows）；审阅：Claude。约 3 小时，一步交付；超出就停下汇报。

## 目标

1. 批注和索引能增删改查，人和专家都能加，记下是谁加的。
2. 它们跟着文字走：改字时范围自动收缩伸长；标记的文字全删掉时这条一起删除，撤回那次修改时一起恢复。
3. 外部修改过的文稿重新打开时，按原文重新定位；找不到就删除并记下来，不猜。
4. docx 的批注存回 Word 的批注（导师在 Word 里能看到）；索引和 tex、md、pdf 的批注只存在 ScienceScope 里。

## 用户会怎么用

- 用户划选"1,284"加索引：选 `data/firms_clean.csv` 和 `analysis/count.py`，写"去重后的企业数"。之后在「批注与索引」里看到这条：说明、来源、记录者。
- 主专家整理关键数字的来源，调 `workspace_edit manuscript bind` 加了 5 条索引；侧栏里标着「主专家」。
- 用户删掉一段带批注的文字：批注跟着删除，底部提示"删掉的文字带走了 1 条批注"；点撤销，文字和批注一起回来。
- 用户在 Word 里改了论文再回来：编辑台导入外部版本，索引按原文重新找到位置；有一条的原文已被删掉，这条被删除，并出现在这次修改记录里。
- 用户按 Ctrl+S 保存 docx：Word 打开能看到新加的批注；索引不进 docx。

## 要做的

1. **数据**（新迁移 029）：
   - `manuscript_bindings`（索引）照 §6.1，另加 `block_from`、`block_to`（块内 UTF-16 偏移）。`quote_json` 为 `{exact,prefix,suffix}`，前后各取 32 个字。
   - `manuscript_comments`（tex、md、pdf 的批注）照 §6.3，同样加 `block_from`、`block_to`。docx 的批注不进这张表，读写都走 D2b（批注本身在文稿里，范围由 `comment-start`、`comment-end` 原子标出）。
   - 两张表都按版本组（`group_id`）存，记最后一次定位所在的版本（`version_id`）。
2. **统一的读写**（`app/services/desk/` 新文件，比如 `annotations.js`）：对外只有「批注」和「索引」两种，格式差别藏在里面。
   - 列表：`GET /api/desk/sessions/:id/annotations` → `{ items:[{ id, type:'comment'|'index', blockId, from, to, quote, text|{kind,value,sources,derivation,note}, author:{id,name}, createdAt, updatedAt, replies?, resolved? }] }`，按文稿顺序。docx 批注从会话里的当前文稿读（D2b 的 `readComments`），id 用 `docx:<批注 id>`；其余用表里的 id。
   - 新建：`POST /api/desk/sessions/:id/annotations { type, blockId, from, to, ... }`。docx 批注作为会话修改记一条（op `comment`，进 `desk_changes`，可撤回），保存时由 `writeDocx` 写进 `comments.xml`；索引和其余格式的批注写表。`from === to` 返回 `DESK_EMPTY_RANGE`。
   - 修改、删除：`PATCH`、`DELETE /api/desk/annotations/:id`（索引改说明、来源、kind、value；批注改正文；tex/md/pdf 批注可 `resolved`、回复 `parentId`）。docx 批注的修改、删除同样记会话修改。
   - 每次变化发 `desk.annotations.changed { sessionId, ids }`。
3. **跟着文字走**（服务端是正本；界面里的 ProseMirror 标记是 U5 的事）：
   - 每次块内容变化（`updateBlocks`、`updateText`、专家的 `replace`、撤回）后，对这一块里的索引和非 docx 批注，用块旧文字到新文字的字符级比较（`diff` 包）把 `from/to` 映射过去：范围内删字收缩，范围内插字伸长，范围外的改动只平移。
   - 映射后范围为空（标记的字全删了），或整块被删除：删除这条，在这次修改记录里存下被删的条目（`desk_changes` 加一列 `annotations_json`，迁移 029 一起加）；撤回这次修改时按原样放回。修改接口的返回和 `desk.changed` 里带 `removedAnnotations: n`，界面据此弹提示。
   - docx 批注的范围本来就是块里的原子，删字时不动原子；范围里的文字全删时，把这对原子和批注一起删（同样记进修改，撤回一起恢复）。
4. **重新定位**（打开会话时，以及导入外部版本后）：先按 `blockId` 和 `from/to` 核对 `quote.exact`；对不上就在全文里找 `quote.exact`，多处命中时用 `prefix`、`suffix` 选，唯一命中就更新 `blockId/from/to/version_id`；找不到或仍有多处，删除这条，记一条修改（op `annotation-lost`，可撤回）。tex、md 的块 id 只在会话内稳定，所以这两种格式每次打开都按原文重新定位。
5. **专家工具**（补 D5 留下的三个 op，进 `workspace_edit resource="manuscript"`）：
   - `comment {block, quote, text}`：`quote` 必须在块的读出文字里唯一，规则同 `replace` 的 `find`（`TEXT_NOT_FOUND`、`TEXT_AMBIGUOUS`）；范围不能切开原子记号。
   - `bind {block, quote, kind, value?, sources, note?}`：`sources` 是 schema 1 引用对象数组（项目文件、资料、条目、消息），至少一个。
   - `unbind {id}`、`uncomment {id}`：只能删自己加的，删别人的返回 `DESK_NOT_AUTHOR`（用户在界面里可以删任何一条）。
   - `workspace_read target="manuscript"` 的每块加 `annotations: [{id,type,quote,summary}]`（`summary` 为批注前 60 字或索引的 `value · note`）。
   - 提示词补一句：数字、图表、结论有来源时用 `bind` 记下；范围外的问题用 `comment`。
6. **测试**（合成文件用代码生成）：
   - docx：加批注 → 保存 → `comments.xml` 有这条且 Word 能打开（照 D2b 的结构校验）；删掉批注范围里全部文字 → 批注随之删除 → 撤回这次修改 → 批注回来。
   - 索引：在 tex 一段里加索引 → 范围内删两个字（收缩）、范围前插字（平移）→ 删光范围内文字（删除并记修改）→ 撤回（恢复）；docx 同样一遍。
   - 重新定位：项目文件在外面改过（段落前后挪动），重新打开后索引按原文找到新位置；原文删掉的那条被删除并有 `annotation-lost` 记录；多处命中时用前后文选对。
   - 工具：专家 `bind`、`comment` 带作者；`quote` 找不到 / 不唯一；删别人的条目被拒；`workspace_read` 带摘要。
   - 列表顺序、`desk.annotations.changed` 事件、`DESK_EMPTY_RANGE`。

## 可以改的

`app/services/desk/`（可加文件）、`app/server/routes/desk.js`、迁移目录（029 及测试）、`app/core/context.js`（只加一句提示）、及各自测试；`docs/architecture/EDITING_DESK.md`（§6、§8 按实际行为改）、`docs/product/FEATURES.md`、`docs/log/IMPLEMENTATION_LOG.md`（不超过 5 行）。

## 不做的

- 不改 `app/ui/`（侧栏和标记是 U5）。
- 不做 docx 批注的回复和解决（alpha 之后），不把索引写进 docx。
- 不新增依赖。
- 不动 `<预览安装目录>` 及其数据，不把稿件、截图提交进仓库。

## 完成标准

- 干净检出 `npm run check` 全部通过（含 Windows 测试）。
- 第 6 条的测试都在。
- 真实稿件：在 D2b 学位论文副本上，用接口加 3 条批注、5 条索引，再删掉其中一条批注的全部文字并撤回；保存后用 Word（或 WPS）打开，3 条批注都在、没有修复提示。然后在 Word 里改动前面几段再保存，回到编辑台重新打开，报告 8 条里重新定位成功几条、删除几条，人工核对位置对不对。稿件只放 `.sciencescope-local/temp/desk-d6/`。

## 交付

- 分支：`codex/d6-annotations-YYYYMMDD`，从 `main` 最新提交开始。报告不超过 15 行，给出远程分支与 SHA、真实稿件的结论。不建 PR、不合并。
