# 编辑台设计（1.0.0-alpha）

- 起草：Claude，2026-10-18。状态：**设计稿**，第 12 节五条 2026-10-19 所有者都按推荐；E0 试验后按第 3.3 节的规则定稿。
- **编辑台不进知识库**（所有者 2026-10-19）：文稿、版本、修改记录、批注和来源绑定都存在编辑台自己的表里，不成为知识库图的节点或边；绑定可以引用知识库里的资料和条目，反过来不行。项目文件夹里的文稿文件只按普通文件建文件级索引，不整理卡片、不抽实体（见 `architecture/KNOWLEDGE_BASE.md` §1a）。
- 依据：`research/EDITING_DESK_RESEARCH.md`（下称"调研"）；`plans/IDEAS.md`「写作与编辑工作台」「编辑台」（所有者原话）；`decisions/DECISIONS.md` 2026-10-18 三条（alpha 含编辑台；正式发布前不保证数据兼容；自有文件不放进用户的项目文件夹）；`architecture/CORE_MODEL.md` §4、§4a；`architecture/DATA_AND_ROLES.md`；`design/DESIGN_SYSTEM.md`。
- 文中"现有"指 2026-10-18 代码里已有的行为，已对照 `app/services/versions/`、`app/core/workspace/`、`app/services/tools.js`、迁移 015/016 等核实。

## 1. 目标与范围

编辑台是和工作站同级的页面，用于研究主流程之后修改论文和附录。核心是句级修改：用户或 AI 改一句，马上看到改了什么、谁改的，并能单独撤回。它不替代 Word、WPS 或 LaTeX 编辑器，版式和最后的格式校正仍在那些工具里完成。

**alpha 做：** ① 编辑项目文件夹里 `.docx` 和 `.tex` 的正文、标题、列表和表格单元格文字，保存后 Word 和 WPS 正常打开，未改部分原样保留；② `.pdf` 只预览（现有 pdf.js）；③ 分级版本和分支、版本图窗口；④ 同格式两版并排对比，按段落和句子对齐；⑤ 划选改写，AI 用共用工具直接修改，修订标记逐处可撤回；⑥ 来源绑定，右键查看并跳转，用户可自己绑定；⑦ 批注：docx 用 Word 原生批注，tex 只在应用内可见；⑧ 公式和图片只显示，往返原样保留；⑨ tex 编译可选，没有引擎时编辑照常。

**alpha 不做：** 公式编辑；AI 改动导出成 Word 修订；分支合并；SyncTeX；选中图表重跑脚本；移动段落检测；表格结构编辑；docx 批注回复和"已解决"的写入（只读显示）；Markdown（继续用笔记和预览）。见第 10 节"alpha 之后"。

## 2. 用户怎么用

**场景 1：从对话进入。** 初稿成形后，主专家调用 `desk_suggest`，对话底部出现横条"要进入编辑台吗？"，带「接续当前对话」和「开新分支进入」。前者让编辑台绑定当前会议；后者用现有的 `POST /api/meetings/:id/fork`（`parent_meeting_id` / `fork_message_id`）从最新消息分出新会议再绑定，原对话停在初稿为止。进入后主专家整理关键数字的来源绑定，结果出现在右侧"来源"栏。直接点左栏「编辑台」进入时，绑定该项目最近使用的会议，没有就新建。

**场景 2：改论文里的一句话。** 用户在左栏点 `thesis.docx`，第一次打开时文件被复制成版本图里的 v1（存在 `data/`）。划选"结果表明该方法显著优于基线"，选区旁弹出指令框（润色、精简、更正式、译成英文、核对数据，或自己写"语气缓和些，补上样本量"）。主专家的改动直接写进正文：删掉的字淡暗红加删除线，新加的字淡黄，旁边标"主专家 · 14:02"。用户撤回其中一处，其余点「保留」，按 Ctrl+S 写回项目文件夹里的 `thesis.docx`。

**场景 3：并排比较。** 在版本列表勾选 v3 和 v5 点「比较」，中间变成左旧右新两栏，按句子对齐成行；改过的句子在句内标出增删的词，整句增删的行另一侧留空；有「上一处」「下一处」和改动计数。一处改动只影响它所在的句子。

**场景 4：分支和版本图。** 导师要一版 8000 字的投稿稿。用户在版本图窗口（项目文件夹预览框顶部和编辑台右侧栏各有一个按钮）右键 v5 →「从这一版开始编辑」，改完关闭，得到父版本为 v5 的新版本；v5 已有子版本，所以它自动成为"分支 1"，用户改名"期刊投稿"、层级选"投稿"。节点是版本，箭头是派生；点节点在右侧信息栏改元数据，右键箭头看改动摘要或打开比较；搜索框按标签、标题、备注和修改指令过滤。

**场景 5：来源绑定。** 用户划选"1,284"，右键 →「绑定来源」，选 `data/firms_clean.csv` 和 `analysis/count.py`，写"去重后的企业数"。之后右键这个数字 →「含义与来源」，看到说明、来源和记录者，点脚本就在文件预览里打开。专家通过工具做同样的事。

**场景 6：批注。** 划选后右键 →「添加批注」。docx 的批注保存时写进 `comments.xml`，导师在 Word 侧边能看到；tex 的批注存在 `data/`，只在 ScienceScope 里可见。AI 也能加批注。

**场景 7：tex 与可选编译。** 打开 `chapters/method.tex`，中间是高亮的源码编辑器，划选改写、批注、绑定与 docx 相同。检测到 TeX Live、MiKTeX 或已下载的 Tectonic 时「编译」可用，输出放 `data/temp/`，右侧预览 PDF；没有引擎时按钮停用，i 提示说明怎么安装。

## 3. 架构

### 3.1 模块位置

后端在 `app/services/desk/`：`index.js`（会话）、`docx/read.js`、`docx/write.js`、`docx/comments.js`、`tex.js`、`compare.js`、`bindings.js`、`compile.js`；路由 `app/server/routes/desk.js`。界面在 `app/ui/components/desk-*.js`，编辑器依赖打进 `app/ui/readers/editor-vendor.js`。

### 3.2 文档模型

两种格式都投影成同一个**块列表**，差异、AI 改写、来源绑定和批注只认这一层，界面因此一套代码对两种格式。

```js
// 块（服务端是正本，浏览器只是视图）
{ id: 'p:3A1F09C2',            // docx 优先用 w14:paraId；没有时用 "b:<序号>"，只在会话内稳定
  kind: 'paragraph' | 'heading' | 'list-item' | 'table-cell' | 'opaque',
  level: 2, style: 'Heading2',  // 显示用
  inlines: [
    { text: '结果表明', marks: ['b'], run: 12, wrap: 2 }, // run 指回原文字段；wrap 可选，指回段内容器
    { atom: 'tab', ref: 6, display: '\t', run: 12, wrap: 2 }, // 同一文字段里的原子字符保留 run
    { atom: 'math', ref: 7, display: 'x2' },             // D2a 取 m:t 的线性文字，原 XML 整体保留
    { atom: 'field', ref: 8, display: '(Zhang, 2024)' },   // 域只显示缓存结果，含 Zotero/EndNote 引文
    { atom: 'image' | 'footnote' | 'bookmark' | 'comment-start' | 'comment-end' | 'ins' | 'del', ref: 9, display: '\uFFFC' } ],
  text: '结果表明…' }           // 纯文本投影逐项取 text ?? display，供比较和检索
```

- **docx：** 块是 `w:body` 下的每个 `w:p`，含表格单元格和块级内容控件（`w:sdt`）里的段落。已有修订（`w:ins`/`w:del`）、公式（`m:oMath`）、图片（`w:drawing`/`w:pict`）、域（`w:fldSimple`、`w:fldChar … w:instrText`）、脚注引用、书签、批注范围标记、含文本框的对象都是原子节点：可以整体删除，不能拆开改。整段都不支持时块标为 `opaque`，只读。
- **D2a 字段约定：** 文字的 `marks` 只含 `b/i/u/sup/sub`，只读直接格式、不展开字符样式；改字继承原 `w:rPr`，改标记才修改对应元素。混合文字段的文字和 `tab/break/symbol` 共享 `run`；`lastRenderedPageBreak` 不进入内联项，文字段改动时移除。`wrap` 指向超链接、smartTag、customXml 或普通行内内容控件，嵌套容器通过父引用保留；引文控件仍为 `field` 原子。原子 `display` 为域缓存、公式线性文字、制表符或换行，图片等其余类型用占位符，删除的修订文字不进入投影。完整未改的文字段和容器照抄 XML。
- **浏览器编辑器：** docx 用 ProseMirror。schema 只有段落、标题、列表项、表格单元格四种块节点，五种标记（加粗、斜体、下划线、上标、下标），一个不可编辑的 `atom` 内联节点；块节点带 `id`。版式视图仍用现有 docx-preview。
- **tex：** CodeMirror 6（state、view、language 和 `stex` 模式已在依赖，另加 `@codemirror/commands`）。块是空行分隔的段落，只用于比较、批注、绑定和修订标记定位；分隔空白原样保留，块拼回去就是原文。
- **同步：** 服务端会话持有块列表和递增的 `seq`，是正本。浏览器停止输入 800 毫秒后，把改过的块（docx）或整份文本（tex）连同 `baseSeq` 发给服务端，服务端记修改、`seq` 加一、广播 `desk.changed`。AI 的修改走同一入口。冲突按块处理：用户在同一块有未发出的修改时先等它提交；之后 AI 的 `find` 找不到就返回 `TEXT_NOT_FOUND`，模型重读再改，用户的字不被覆盖。

### 3.3 E0 试验和之后的决定规则

E0 是第一步，约 2–3 天，报告放 `.sciencescope-local/temp/desk-e0/`：① eigenpal docx-editor：读 LICENSE 和 `packages/pro` 的许可文本，把框架无关的核心挂进 Preact（不行再试 `preact/compat`），量体积和首屏时间，3 份真实稿件往返；② 自研回写最小原型（`docx/read.js`、`write.js`），同样 3 份稿件、同样的第 11 节检查；③ 句子对齐：同一论文的两个真实修订稿跑第 4.4 节算法，人工检查误标。

**E0a 结果（2026-10-20，Claude）：不采用 eigenpal。** 第 ① 条不满足：修订和批注在 `@docx-editor.dev/pro`，服务端编辑 API 在 `editor-api`，两者都是 EigenPal Pro 评估许可，禁止生产使用和分发；不装 Pro 时编辑器只保留批注、不能显示或新建。第 ④ 条在公开许可下也不满足（无界面编辑只能用 `editor-api`）。第 ②③ 条按规则不再测。走自研方案，E0b 由 Sol 做。报告在 `.sciencescope-local/temp/desk-e0/E0a_eigenpal.md`。

**E0b 结果（2026-10-20，Sol 做、Claude 审）：自研路线可行，定稿。** 原型在 `app/services/desk/docx/`（读、写、追加批注）和 `app/services/desk/compare.js`（两层对齐）。三份中文稿改一句、加批注后 Word 和 WPS 都无修复提示，中文字体和未改内容保留；目录、REF 域和已有修订用带 188 个公式的受控副本验证了 F9 更新、接受和拒绝。英文稿和学位论文样本缺，在 alpha 前用真实论文走场景 1–7 时补测。审阅时把读入改成线性（4000 段从 3.5 秒降到 0.1 秒）。D2 要补的：含 `w:lastRenderedPageBreak`、`w:tab`、`w:br` 的文字段和 `w:hyperlink`、行内 `w:sdt` 现在整段当原子节点，Word 存过的稿件里很常见，要拆成「文字 + 原子」才能编辑；`w:b w:val="0"` 这类关闭标记要识别。D4 要补的：切句时块之间加段落分隔，避免没有句号的标题和下一段并成一句；空档很大时相似配对的二维表要限内存。

**决定规则：** eigenpal 同时满足四条才采用：① 用到的包都是 Apache-2.0 或 MIT，编辑和批注不依赖 Pro 包；② 能挂进 Preact，不必打包整个 React；③ 3 份稿件全部通过第 11 节检查；④ 文档模型能在 Node 里无 DOM 运行。第 ④ 条最关键：AI 在界面没打开时也要能改文档，只能在浏览器里工作的编辑器意味着服务端另有一套写回器，两套模型迟早不一致。任何一条不满足就用自研方案；自研原型也通不过检查时，停下向用户报告，不降低标准。

### 3.4 docx 往返

1. **读入**：jszip 解包；`saxes`（ISC）流式解析 `word/document.xml`，记下每个块级 `w:p`、每个 `w:r` 及其 `w:rPr`、每个原子节点在原字符串里的起止位置。不建 DOM，不重新序列化。`comments.xml` 同样解析。
2. **写回**：只重新生成内容变了的块。`w:pPr`、没变的文字段、原子节点原文照抄；改动的文字生成新 `w:r`，`w:rPr` 继承改动起点所在的原文字段（段首时继承后一个），中文的 `w:rFonts w:eastAsia` 因此不丢；文字用 `<w:t xml:space="preserve">`。块之间的字节（`w:sectPr`、表格结构等）原样拼接。其他部件（样式、编号、页眉页脚、媒体、`settings.xml`）字节不变，只有新增批注时改 `comments.xml`、`[Content_Types].xml` 和 `document.xml.rels`。
3. **批注**：新批注写入 `comments.xml`（没有就创建并登记），正文插入 id 相同的 `w:commentRangeStart`、`w:commentRangeEnd` 和 `w:commentReference`；作者是用户显示名，AI 写"ScienceScope · <角色名>"。已有批注可改文字、删除；回复和解决状态（`commentsExtended.xml`）只读。
4. **显示**：OMML 用 omml2mathml 转 MathML（许可证 E0 核实，不合适就显示公式的线性文字）；图片按关系 id 从包里取字节。

### 3.5 文件放在哪里

用户的文件（如 `thesis.docx`）在项目文件夹里，只在用户保存时写入；ScienceScope 不在项目文件夹里放任何自己的东西（书签、隐藏标记、侧车文件都不写）。自有数据都在 `data/`：

```
data/projects/<目录>/
  versions/<组 id>/v<号>-<版本 id>/<原文件名>           版本原件（现有结构，不变）
  versions/<组 id>/v<号>-<版本 id>/<原文件名>.notes.md  版本说明，也是版本图里"边的备注"（现有）
  desk/<会话 id>/<原文件名>                             会话工作副本，空闲 2 秒自动写一次
data/temp/desk-build/<会话 id>/                         tex 编译输出和日志
data/tools/tectonic/<版本>/                              按需下载的 Tectonic 和它的缓存
data/sciencescope.sqlite                                会话、修改记录、绑定、tex 批注（第 4.1 节）
```

工作副本是真实的 docx 或 tex 文件，崩溃后或离开应用也能打开；会话关闭生成版本后删除。

**外部修改：** 打开和保存前比较项目文件的哈希与该组最新版本的 `content_hash`。不同就说明文件在外面被改过（Word，或 `write_file`），先把它导入成新版本（`origin='external'`）；会话里有未保存的修改时让用户选「以外部版本为准重新打开」或「保留我的修改另存为分支」，不悄悄覆盖。

## 4. 版本与分支

### 4.1 数据模型（新迁移）

写设计时迁移最高编号是 020（`020-input-images.js`），A2-2 占 021、知识库占 022，023 后来给了项目文件索引（KB-2a）；编辑台实现时取目录里实际最高号加一。发布前不需兼容旧数据，但现有版本组保留：`parent_id` 取现有 `baseline_id`。

```sql
ALTER TABLE version_groups ADD COLUMN source_path TEXT;        -- 项目文件夹内的相对路径；只在 data/ 里的组为 NULL
ALTER TABLE version_groups ADD COLUMN format TEXT NOT NULL DEFAULT 'other';  -- docx | tex | pdf | other
ALTER TABLE manuscript_versions ADD COLUMN parent_id TEXT REFERENCES manuscript_versions(id);
ALTER TABLE manuscript_versions ADD COLUMN branch TEXT NOT NULL DEFAULT '';  -- 空串表示主线
ALTER TABLE manuscript_versions ADD COLUMN tier TEXT NOT NULL DEFAULT '';    -- 层级名，取自设置 desk.tiers
ALTER TABLE manuscript_versions ADD COLUMN label TEXT NOT NULL DEFAULT '';   -- 用户标签，如"给导师 10-20"
ALTER TABLE manuscript_versions ADD COLUMN title TEXT NOT NULL DEFAULT '';   -- 空时按文件名显示
ALTER TABLE manuscript_versions ADD COLUMN origin TEXT NOT NULL DEFAULT 'import'; -- import | desk | external | save-as-new
ALTER TABLE manuscript_versions ADD COLUMN content_hash TEXT;
ALTER TABLE manuscript_versions ADD COLUMN session_id TEXT;
UPDATE manuscript_versions SET parent_id = baseline_id;

CREATE TABLE desk_sessions (
  id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES version_groups(id),
  base_version_id TEXT NOT NULL REFERENCES manuscript_versions(id),
  meeting_id TEXT REFERENCES meetings(id),         -- 绑定的会议（接续或分支）
  status TEXT NOT NULL DEFAULT 'open',             -- open | closed
  seq INTEGER NOT NULL DEFAULT 0, saved_seq INTEGER NOT NULL DEFAULT 0,  -- 写回项目文件时的 seq
  result_version_id TEXT REFERENCES manuscript_versions(id),
  created_at TEXT NOT NULL, closed_at TEXT);
CREATE TABLE desk_changes (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES desk_sessions(id),
  version_id TEXT REFERENCES manuscript_versions(id),  -- 会话关闭后填入生成的版本
  seq INTEGER NOT NULL, block_id TEXT NOT NULL,
  op TEXT NOT NULL,                                -- edit | insert-block | remove-block | comment
  before_json TEXT, after_json TEXT,               -- 块的 inlines，前后各一份
  actor_id TEXT, meeting_id TEXT, turn_id TEXT, instruction TEXT NOT NULL DEFAULT '',
  settled INTEGER NOT NULL DEFAULT 0,              -- 用户点了"保留"，不再显示标记
  undone_by TEXT, created_at TEXT NOT NULL);
CREATE INDEX desk_changes_session ON desk_changes(session_id, seq);
CREATE TABLE manuscript_bindings (...);            -- 第 6 节
CREATE TABLE manuscript_comments (...);            -- tex 批注，第 6.3 节
```

层级名在设置 `desk.tiers`，默认 `["草稿","内部审阅","投稿","修回","终稿"]`，可改名增删，改名时同步更新版本。另加设置 `features.editingDesk`（现在没有功能开关机制，这是第一个），默认 `false`，alpha 必需任务验收后改为 `true`，之前不显示入口。

### 4.2 版本什么时候生成

- **第一次打开项目文件**：建版本组（`source_path`、`format`），文件复制成 v1（`origin='import'`）。
- **会话关闭时**（离开编辑台、切换文档、关闭应用）：工作副本哈希与打开时的版本不同就生成一个版本，父版本是 `base_version_id`，`origin='desk'`，本次的 `desk_changes` 填上 `version_id`。对应 IDEAS 的"退出时保留历史版本"。
- **「存为版本」**：随时手动生成，可填标签和层级，之后的修改以它为父。
- **保存（Ctrl+S）**：只把工作副本写回项目文件，不生成版本。

**分支：** 父版本已有子版本时，新版本自动成为"分支 n"，用户可改名；同一分支上继续则继承分支名。从旧版本打开后保存到项目文件时先问一次：「写回项目文件（文件当前对应 v7，v7 仍在版本图里）」或「只存为版本」。底部信息栏始终写明项目文件对应哪个版本。

**版本说明：** 编辑台生成的版本不自动让秘书写说明（现在一份要十几万 token），只自动做第 4.4 节的比较，并把本次修改记录列为"实际文件变化"；用户可以手动加备注，或点「请秘书整理」走现有 `POST /api/versions/:id/organize`。导入的版本仍按 `auto_version_notes`。

### 4.3 版本图与历史版本

- 版本图由 `parent_id` 推出，不另建边表；节点按分支分列（泳道）、按时间纵排，自写布局，不用图布局库。
- 文稿不走工作区的 `revisions` / `resource_snapshots`：那套机制存前后全文文本，不适合二进制 docx。文稿的历史就是版本图加 `desk_changes`；版本说明仍是现有 `versions` 文本资源，照旧留修订和历史版本，`workspace_versions` 不变。
- 撤销重做只在本次打开的编辑期间有效（`DECISIONS.md` 2026-10-07）：编辑器自带撤销管连续输入，`desk_changes` 管逐处撤回。

### 4.4 比较算法

现有 `compareText` 把两份全文按词整体比较，插入一段就会让后文配对错位。新增 `desk/compare.js` 的 `alignVersions(left, right)`，两版先转成块列表（PDF 仍用提取文字）：

1. **段落对齐**：块文字归一化（NFKC 统一全半角、合并空白、原子节点用原文哈希占位），jsdiff `diffArrays` 对齐块序列，相同的直接配对。
2. **句子对齐**：两个配对之间剩下的块合并，用 `Intl.Segmenter('zh', { granularity: 'sentence' })` 切句，再用 `diffArrays` 按归一化句子对齐，拆段、合段也能对上。
3. **相似配对**：仍未配对的句子在同一空档里按字符二元组 Dice 系数配对，阈值 0.4（E0b-2：一份稿件的受控修订里 0.4 / 0.5 / 0.6 漏配 0 / 1 / 1 处，都无错配；D4 用更多稿件再确认）；配上算"修改"，否则算"新增"或"删除"。
4. **句内比较**：配对句子用现有 `compareText`（词粒度）标出增删。
5. **输出**：按行返回 `{ type: 'same'|'changed'|'added'|'removed', left, right, parts, leftBlock, rightBlock }`；改动列表和新的 `changeSummary` 都由它生成，秘书读起来更短。

**中文：** 句粒度按"。！？"断句；E0 专门测"……"、引号内句号和"；"，结果出来前不加自定义规则。归一化只用于配对，显示的永远是原文。

## 5. AI 改写流程

1. **划选**：选区旁弹出指令框（沿用 `mark-selection.js` 的定位）；右键才弹出二级菜单（含义与来源、绑定来源、添加批注）。
2. **发出**：`POST /api/desk/sessions/:id/rewrite` `{ blockId, quote, instruction }`。服务端在绑定的会议里发一条用户消息，研究输入附一条标记（schema 1 引用，`kind: 'version'`，带 `location.paragraph` 和 `quote`）；时间线里收成一行"编辑请求"，对话记录保持真实。
3. **改写**：主专家用共用工具 `workspace_edit` 直接改文稿，界面经 `desk.changed` 收到后，按修改记录的前后内容做词级比较，画出修订标记。
4. **撤回与保留**：撤回走 `workspace_undo`，规则同工作区撤销：块的当前内容等于该记录的 `after` 才能撤回，否则提示先撤回之后的修改。「保留」只是不再显示标记。

**工具**（加进 `app/services/tools.js` 的现有工具，所有角色都有）：

| 调用                                   | 参数与作用                                                                                                                                                                                                                                                                   |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspace_read target="manuscript"`   | `scope=<项目 id>` 列出文稿；`key=<项目 id>/<组 id>`，`offset`/`limit` 按块分页，可加 `version`；返回块 id、文字、原子节点占位、批注和绑定摘要、`remaining`                                                                                                                   |
| `workspace_edit resource="manuscript"` | `replace {block, find, with}`（`find` 在块内须唯一，否则 `TEXT_NOT_FOUND`/`AMBIGUOUS`）；`insertBlock {after, text}`（继承 `after` 段的 `w:pPr`）；`removeBlock {block}`；`comment {block, quote, text}`；`bind`、`unbind`；`save {to: "project"\|"version", label?, tier?}` |
| `workspace_undo`                       | `revisionId` 可以是 `chg_…`                                                                                                                                                                                                                                                  |
| `desk_suggest`（新）                   | `{reason, document?}`，弹出进入编辑台的横条                                                                                                                                                                                                                                  |

没有打开的会话时，`workspace_edit manuscript` 为最新版本开一个后台会话，修改进工作副本，用户下次打开时看到标记。AI 修改只动 `data/` 里的工作副本，不触发批准；写项目文件只有 `save {to:"project"}`，"请求批准"模式下和 `write_file` 一样先问用户。

**提示词要点**（不加硬限制）：文稿在编辑台打开时用 `workspace_edit manuscript`，不用 `edit_file` 改 docx/tex；只改划选范围，范围外的问题写批注或在回答里说；`find` 取足够长的原文；不动公式、引文、图片；涉及数字时检查绑定；回答只说改了什么和为什么。秘书和全局助手用同一套工具（原则 2、3），按用户要求找版本、比较、整理修改记录、加批注，不主动改正文；会议里被 @ 的专家同样可用。

## 6. 来源绑定

### 6.1 数据

```sql
CREATE TABLE manuscript_bindings (
  id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES version_groups(id),
  version_id TEXT REFERENCES manuscript_versions(id),  -- 绑定时所在的版本
  block_id TEXT NOT NULL, quote_json TEXT NOT NULL,    -- {exact, prefix, suffix}
  kind TEXT NOT NULL,           -- number | figure | table | claim | text
  value TEXT NOT NULL DEFAULT '',
  sources_json TEXT NOT NULL DEFAULT '[]',             -- schema 1 引用对象数组
  derivation_json TEXT,         -- {script, command, inputs[], outputs[], messageId}，引用都是 schema 1
  note TEXT NOT NULL DEFAULT '',
  attributed_to TEXT NOT NULL,  -- 参与者 id，人或 AI
  status TEXT NOT NULL DEFAULT 'anchored',             -- anchored | lost
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
```

结构对应 W3C PROV：`value` 是实体，`derivation` 是生成它的活动（`inputs` 是 used，`script` 是活动的计划），`attributed_to` 是执行者。`sources` 和 `script` 直接用 `app/core/references.js` 的 schema 1 引用对象（`project-file`、`script`、`source`、`chunk`、`item`、`message`），跳转复用日志和版本说明现有的打开逻辑，不增加新的引用格式。

### 6.2 锚点

锚点只放 `data/`。定位：先在 `block_id` 的块里找 `quote.exact`，用 `prefix`、`suffix` 消歧；块 id 失效（新版本、外部修改）时在全文里同样查找；唯一命中就更新 `block_id`、`version_id`，否则标 `lost`，提示"失去位置，请重新绑定"，不猜。每生成一个新版本，对该组全部绑定重新定位一次。

### 6.3 界面与 tex 批注

- 有绑定的文字下有细点线。右键 →「含义与来源」显示说明、来源（文件名、页码或行号）、生成脚本和记录者，点任一项在文件预览里打开并定位。
- 划选后右键 →「绑定来源」，可选项目文件、资料库资料或条目、某条消息，写一句说明。右侧"来源"栏列出全部绑定，`lost` 排在前面。
- tex 批注存 `manuscript_comments`（`id, group_id, version_id, block_id, quote_json, author_id, text, parent_id, resolved, created_at, updated_at`），锚点规则与绑定相同；因为只在应用内，支持回复和解决。

## 7. 界面

细节在界面任务里按设计系统定，这里只定结构。

- **入口：** 左栏上部，与「工作站」同级的「编辑台」。工作站左下角的文件版本管理撤掉，导图向左拉伸占它的位置。
- **布局：** 顶部一行可折叠功能区（保存、撤销重做、加粗斜体上下标、标题级别、批注、绑定、比较、版本图、tex 编译）。左栏上半是文件列表（项目文件夹里的 docx、tex、pdf，加只在 `data/` 里的版本组），下半是大纲和当前分支的版本列表。中间正文。右侧栏四个标签：批注、修改（本次会话的修改记录，逐条撤回或保留）、来源、对话（绑定会议）。底部信息栏：文件名、当前版本（"v7 · 期刊投稿 · 投稿"）、保存状态（"已写回项目文件"/"有修改未写回"）、字数。右上角悬浮秘书按钮，点开是这个会议的秘书对话。
- **版本图窗口：** 原生二级窗口，沿用全局助手窗口的机制（`src-tauri/src/main.rs`）；浏览器开发环境里是应用内大浮层。左图、右信息栏、顶部搜索。
- **比较视图：** 在中间展开，两栏同步滚动、按行对齐；旧版多出的淡暗红、新版多出的淡黄（比引用标记暗），作为两个新令牌进 `tokens.json`。现有 `version-diff.js` 改用同一比较结果。
- **文字：** 状态只写结果和下一步（"项目文件在外部被修改：重新打开或另存为分支"），解释放 i 提示；新文字都要有英文条目。

## 8. 接口

新路由在 `app/server/routes/desk.js`，版本相关的放现有版本路由，都需要口令。

| 方法与路径                                                                                                     | 作用                                                                        |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `GET /api/desk/documents?projectId=`                                                                           | 编辑台文件列表：项目文件夹里可编辑和可预览的文件，加版本组                  |
| `POST /api/desk/documents`                                                                                     | `{ projectId, path }` 登记项目文件（建组和 v1），或 `{ versionId }`         |
| `POST /api/desk/enter`                                                                                         | `{ meetingId, mode: 'continue' \| 'branch' }`，返回编辑台要绑定的会议       |
| `POST /api/desk/sessions`                                                                                      | `{ groupId, versionId?, meetingId }` 打开会话，返回块列表、修改、批注、绑定 |
| `GET /api/desk/sessions/:id`                                                                                   | 重连时读取会话                                                              |
| `PATCH /api/desk/sessions/:id/blocks`、`PUT …/text`                                                            | docx `{ baseSeq, blocks, inserted, removed }`；tex `{ baseSeq, text }`      |
| `POST /api/desk/sessions/:id/rewrite`                                                                          | 划选改写，第 5 节                                                           |
| `POST /api/desk/sessions/:id/save`                                                                             | `{ to: 'project' \| 'version', label?, tier? }`                             |
| `POST /api/desk/sessions/:id/close`                                                                            | 关闭会话，按需生成版本                                                      |
| `POST /api/desk/changes/:id/undo`、`POST /api/desk/sessions/:id/settle`                                        | 撤回一处；保留（`{ ids }` 或全部）                                          |
| `GET/POST /api/desk/sessions/:id/comments`、`PATCH/DELETE /api/desk/comments/:id`                              | 批注（docx 写进工作副本，tex 写进表）                                       |
| `GET/POST /api/desk/bindings?groupId=`、`PATCH/DELETE /api/desk/bindings/:id`                                  | 来源绑定                                                                    |
| `GET /api/desk/sessions/:id/media/:ref`                                                                        | docx 里的图片字节                                                           |
| `GET /api/desk/tex/engines`、`POST /api/desk/tex/tectonic`、`POST /api/desk/sessions/:id/compile`、`GET …/pdf` | 检测引擎、下载 Tectonic、编译、读输出 PDF                                   |
| `GET /api/version-groups/:id/graph`、`PATCH /api/versions/:id`                                                 | 版本图（节点含说明前 200 字和修改指令）；改标题、层级、标签、分支名         |
| `GET /api/versions/:id/compare?baseline=`                                                                      | 现有接口，返回值改为第 4.4 节的对齐行；允许跨分支比较同组任意两版           |

事件：`desk.changed`（`sessionId, seq, blocks 或 text, changeIds`）、`desk.session`（opened、closed）、`desk.suggested`（横条）、现有的 `versions.changed`。

## 9. 依赖与许可证

| 库                                                                         | 用途                                  | 许可证                                                           | 体积                                   | 状态                                               |
| -------------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------- | -------------------------------------- | -------------------------------------------------- |
| prosemirror-model、-state、-view、-transform、-commands、-keymap、-history | docx 正文编辑                         | MIT                                                              | 合计压缩后约 150–200 KB（推断，E0 量） | 新增                                               |
| `@codemirror/commands`                                                     | tex 编辑的撤销和按键                  | MIT                                                              | 数十 KB（推断）                        | 新增；state、view、language、legacy-modes 已在依赖 |
| saxes                                                                      | 服务端 XML 流式解析，带位置           | ISC                                                              | 约 50 KB，依赖 xmlchars（MIT）         | 新增                                               |
| 已有：jszip、diff、docx-preview、pdfjs-dist、mammoth                       | 解包、比较、版式视图、PDF、文字提取   | MIT/GPLv3 双许可（按 MIT）、BSD-3、Apache-2.0、Apache-2.0、BSD-2 | 已随包                                 | 不变                                               |
| omml2mathml 1.3.0（scienceai/npm）                                          | OMML 公式显示                         | Apache-2.0，2026-10-21 已读[仓库 LICENSE 全文](https://github.com/scienceai/omml2mathml/blob/master/LICENSE) | 小                                     | D2a 未引入；当前显示 `m:t` 拼接的线性文字             |
| eigenpal docx-editor                                                       | 只在通过第 3.3 节规则时替代自研编辑器 | 核心 Apache-2.0；`packages/pro` 为 EigenPal Pro 许可，**需核实** | 未知                                   | E0 试验                                            |
| Tectonic                                                                   | 可选的 tex 编译器                     | MIT                                                              | 单个可执行文件，数十 MB（推断，E0 量） | 不随包，按需下载                                   |

**不用：** SuperDoc、ONLYOFFICE、Overleaf、SwiftLaTeX（AGPL）；lang-tex、texlab、latexdiff、BlockNote 的 `xl-` 包（GPL）；CKEditor、Tiptap 转换、Syncfusion、Univer Pro（商业或云）；pandoc 不做编辑往返。

**Tectonic：** 先找用户已装的 TeX Live 或 MiKTeX（PATH 和常见安装位置里的 `xelatex`、`lualatex`、`pdflatex`、`latexmk`）。下载的 Tectonic 放 `data/tools/tectonic/<版本>/`，缓存用环境变量 `TECTONIC_CACHE_DIR` 指向 `data/tools/tectonic/cache/`（E0 核实该变量在 Windows 上的行为），随 `data/` 走、卸载可删。程序和支持包默认从海外下载，暂无已知镜像，用到时在报告写明；alpha 是否提供见第 12 节。编译命令形如 `tectonic --outdir <data/temp/desk-build/<会话>> main.tex`，工作目录是项目文件夹（`\input` 能找到章节），输出不进项目文件夹。

## 10. 分阶段与任务拆分

每个任务书约 1–2 小时，超时就停下报告。D 是 Sol（后端、原生），U 是 Claude（界面）。**A** 表示 alpha 必需。

| 顺序     | 任务                                                                          | 谁     | 完成标准                                                                            |
| -------- | ----------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------- |
| E0a ✅   | eigenpal 试验（2026-10-20：不采用，见第 3.3 节）                              | Claude | 第 3.3 节四条逐条有结论                                                             |
| E0b ✅   | 自研回写原型、句子对齐试验（2026-10-20：自研可行）                            | Sol    | 3 份稿件过第 11 节检查；对齐误标清单；报告定路线                                    |
| D1 **A** | 新迁移、版本图后端、`PATCH /api/versions/:id`、`graph`                        | Sol    | 迁移测试；建分支、改层级、读图的功能测试                                            |
| D2 **A** | `desk/docx/` 读、写、批注                                                     | Sol    | 合成样例覆盖公式、域、图片、表格、修订、批注；改一段其余字节相同；`w:eastAsia` 继承 |
| D3 **A** | 会话服务：块更新、工作副本、修改记录、撤回、保存、外部修改、关闭生成版本、tex | Sol    | 打开 → 改 → 撤回 → 保存 → 关闭，docx 和 tex 各一                                    |
| U1 **A** | 页面骨架、入口、左栏、底部栏、`features.editingDesk`，撤掉工作站版本管理      | Claude | 100%、125% 截图；开关关闭时无入口                                                   |
| U2 **A** | ProseMirror 编辑器、原子节点、块同步、Ctrl+S                                  | Claude | 浏览器测试：改字保存后重开一致                                                      |
| D4 **A** | 两层对齐，比较接口返回对齐行，`changeSummary` 按句                            | Sol    | 插段、删段、拆段、改句测试；一处改动只标一句                                        |
| U3 **A** | 比较视图，`version-diff.js` 改用新结果，两个颜色令牌                          | Claude | 截图；上一处、下一处可用                                                            |
| D5 **A** | `manuscript` 读写、`chg_` 撤回、`desk_suggest`、提示词                        | Sol    | 脚本运行时测试；`deepseek-v4.1-flash` 真跑一次，报请求数和 token                    |
| U4 **A** | 指令框、右键菜单、修订标记、撤回和保留                                        | Claude | 场景 2 浏览器测试；全新安装加服务商后真跑一次                                       |
| D6 **A** | 绑定和 tex 批注的表、服务、接口、重新定位                                     | Sol    | 新版本后绑定仍定位；找不到标 `lost`                                                 |
| U5 **A** | 批注栏、来源栏、含义与来源菜单、绑定选择框                                    | Claude | 场景 5、6 浏览器测试                                                                |
| U6 **A** | CodeMirror tex 编辑、PDF 预览、编译按钮                                       | Claude | 编辑保存 tex；无引擎时按钮停用有提示                                                |
| D7 **A** | 引擎检测、编译，输出放 `data/temp/`                                           | Sol    | Windows 上 MiKTeX 编译 xeCJK 样例                                                   |
| D8 **A** | 版本图原生二级窗口                                                            | Sol    | 原生验收：开关、记住大小、主窗口不锁定                                              |
| U7 **A** | 版本图内容：泳道图、信息栏、搜索、右键比较                                    | Claude | 场景 4 走通                                                                         |
| U8 **A** | 进入横条（接续或分支）、秘书悬浮按钮                                          | Claude | 场景 1 走通，分支后原对话不变                                                       |
| D9       | Tectonic 按需下载                                                             | Sol    | 视第 12 节第 4 条                                                                   |

A 任务完成后，在 Windows 候选安装包上用真实论文走完场景 1–7，再打开 `features.editingDesk`；`product/FEATURES.md` 随每个任务更新。

**alpha 之后：** 公式编辑（LaTeX 输入，用 docx 包（dolanmiu，MIT）的 `latexToMath` 生成 OMML）；AI 修改导出成 Word 修订；分支合并（第二个父版本）；SyncTeX 双向跳转（synctex-js，MIT）；选中图表重跑脚本；移动段落检测；表格结构编辑；docx 批注回复和解决；写作时浮现相关资料片段。

## 11. 风险与验证

| 风险                                                 | 验证                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 写回后 Word / WPS 出现修复提示，或改动段落丢中文字体 | 三份真实论文（中文学位论文、英文期刊稿、带 Zotero 引文和大量公式的稿件），各做打开 → 改一句 → 加批注 → 保存。解压比较：`document.xml` 除改动段落外字节相同，批注相关部件只多出批注内容，其余部件字节相同；改动段落的 `w:rFonts` 与相邻文字段一致。Word 和 WPS 各打开一次，**都不出现修复提示**。稿件放 `.sciencescope-local/temp/`，不进仓库。 |
| 引文域和已有修订被破坏                               | 改含引文的段落后用 Zotero 刷新，引文仍能识别；带修订的稿件往返后仍能接受、拒绝，批注不成孤儿。                                                                                                                                                                                                                                                 |
| 长稿件性能                                           | 8 GB 内存的 Windows 机器打开 100 页 docx，记录打开、输入延迟、保存和比较耗时。                                                                                                                                                                                                                                                                 |
| 中文对齐误标                                         | 同一论文两版（改句、删段、插段、调换段落）人工检查；测"……"、引号内句号、"；"。                                                                                                                                                                                                                                                                 |
| 用户和 AI 同时改一段                                 | 测试：用户有未发出的修改时 AI 改同一块，用户的字不丢，AI 重读后再改。                                                                                                                                                                                                                                                                          |
| 绑定失效                                             | 绑 20 处数字，10 次 AI 改写加一次 Word 外部修改，统计仍能定位的比例；失效的标 `lost`，没有错绑。                                                                                                                                                                                                                                               |
| 外部修改被覆盖                                       | 会话中在 Word 改文件再保存：先导入外部版本，两份都在版本图里。                                                                                                                                                                                                                                                                                 |
| 许可证不合适（eigenpal、omml2mathml）                | E0 读许可证原文，不合适走第 3.3 节和第 3.4 节第 5 条的退路。                                                                                                                                                                                                                                                                                   |
| Tectonic 缓存和离线                                  | 确认缓存在 `data/`；断网后 `--only-cached` 再编译一次。                                                                                                                                                                                                                                                                                        |

## 12. 用户的决定（2026-10-19：五条都按推荐）

1. **划选改写用多少对话上下文。** 完整会议历史最准但每次改一句也要十几万 token；窄上下文只给纪要、选区前后两段、文档大纲和指令，模型需要时自己用 `workspace_read` 翻会议。**建议窄上下文**，消息仍记进会议，保证记录真实。
2. **什么时候生成版本。** **建议**会话关闭时自动生成一个，加上随时手动「存为版本」；每次 Ctrl+S 都生成版本会让版本图很快挤满。
3. **是否往用户的 docx 里写书签作为绑定锚点。** 书签更稳，但会在用户文件里留下 ScienceScope 的痕迹。**建议不写**，锚点只放 `data/`，靠引文重新定位，失效时提示重新绑定。
4. **alpha 是否提供 Tectonic 下载。** 下载和支持包都来自海外，暂无已知镜像。**建议 alpha 只用用户已装的 TeX Live 或 MiKTeX**，Tectonic 下载放到 alpha 之后，除非你需要在没有 TeX 的机器上编译。
5. **多文件的 LaTeX 论文怎么算版本。** **建议 alpha 每个 `.tex` 文件单独成一个版本组**（`main.tex` 和各章分别有版本图），编译仍用整个项目文件夹；以后再考虑把一组文件作为一个版本。
