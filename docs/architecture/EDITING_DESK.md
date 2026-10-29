# 编辑台设计（1.0.0-alpha）

- 起草：Claude，2026-10-18。状态：**设计稿**，第 12 节五条 2026-10-19 所有者都按推荐；E0 试验后按第 3.3 节的规则定稿。**2026-10-22 第二版**（所有者）：编辑台是独立的系统窗口；Markdown 加进来；tex 内置实时渲染和公式编辑，不依赖装 TeX；版本分叉树改成从上往下的侧栏，编辑台和工作站都有按钮；划选弹 Office 式浮动工具条，右键菜单单独设计；点聊天里引用的标记跳到编辑台。见第 12 节第二组。**同日第三版**（所有者看设计稿后）：正文像 Word 一样正常编辑，不显示修订标记，谁改的只在后台记录；批注和索引（原"来源绑定"）合成一个入口，标记的文字全部删掉才删除，撤销一起恢复；比较改成左右两页并排，差异在存版本时后台算好。见第 12 节第三组。
- **编辑台不进知识库**（所有者 2026-10-19）：文稿、版本、修改记录、批注和来源绑定都存在编辑台自己的表里，不成为知识库图的节点或边；绑定可以引用知识库里的资料和条目，反过来不行。项目文件夹里的文稿文件只按普通文件建文件级索引，不整理卡片、不抽实体（见 `architecture/KNOWLEDGE_BASE.md` §1a）。
- 依据：`research/EDITING_DESK_RESEARCH.md`（下称"调研"）；`plans/IDEAS.md`「写作与编辑工作台」「编辑台」（所有者原话）；`decisions/DECISIONS.md` 2026-10-18 三条（alpha 含编辑台；正式发布前不保证数据兼容；自有文件不放进用户的项目文件夹）；`architecture/CORE_MODEL.md` §4、§4a；`architecture/DATA_AND_ROLES.md`；`design/DESIGN_SYSTEM.md`。
- 文中"现有"指 2026-10-18 代码里已有的行为，已对照 `app/services/versions/`、`app/core/workspace/`、`app/services/tools.js`、迁移 015/016 等核实。

## 1. 目标与范围

编辑台是和工作站同级的页面，用于研究主流程之后修改论文和附录。核心是句级修改：用户或 AI 改一句，马上看到改了什么、谁改的，并能单独撤回。它不替代 Word、WPS 或 LaTeX 编辑器，版式和最后的格式校正仍在那些工具里完成。

**alpha 做：** ① 编辑项目文件夹里 `.docx` 的正文、标题、列表和表格单元格文字（主要功能），保存后 Word 和 WPS 正常打开，未改部分原样保留；② `.md` 和 `.tex` 可显示和编辑，「渲染 / 源码」两种视图切换：md 两种视图都能改，tex 像 Overleaf 那样左边源码、右边实时渲染，公式可以可视化编辑，不依赖用户装 TeX；③ `.pdf` 只阅览（现有 pdf.js），可以划选标记和批注，不能改；④ 分级版本和分支，版本分叉树侧栏；⑤ 同格式两版左右两页并排对比（像 Word 的并排查看），旧版删掉的标红、新版加的标淡黄，差异在存版本时后台算好；⑥ 划选弹出浮动工具条：格式、改写、引用到对话、批注、索引；正文像 Word 一样正常编辑，不显示修订标记，你和 AI 的每处修改都在后台记下是谁改的；⑦ 索引（原"来源绑定"）：把一段文字连到数据、脚本、资料、条目或消息，右键查看并跳转；⑧ 批注与索引一个入口，新增、查看、修改、删除，专家的也在里面；docx 批注用 Word 原生批注，tex、md、pdf 的只在应用内可见；⑨ docx 的公式和图片只显示，往返原样保留；⑩ 用户装了 TeX 时可编译出真正的 PDF。

**alpha 不做：** docx 公式编辑（tex 的公式编辑要做）；AI 改动导出成 Word 修订；分支合并；SyncTeX；选中图表重跑脚本；移动段落检测；表格结构编辑；docx 批注回复和"已解决"的写入（只读显示）；类似 WPS AI 的边写边改（alpha 之后，所有者 2026-10-22 提出）。见第 10 节"alpha 之后"。

## 2. 用户怎么用

**场景 1：从对话进入。** 初稿成形后，主专家调用 `desk_suggest`，对话底部出现横条"要进入编辑台吗？"，带「接续当前对话」和「开新分支进入」。前者让编辑台绑定当前会议；后者用现有的 `POST /api/meetings/:id/fork`（`parent_meeting_id` / `fork_message_id`）从最新消息分出新会议再绑定，原对话停在初稿为止。进入后主专家整理关键数字的来源绑定，结果出现在右侧"来源"栏。直接点左栏「编辑台」进入时，绑定该项目最近使用的会议，没有就新建。

**场景 2：改论文里的一句话。** 用户在左栏点 `thesis.docx`，第一次打开时文件被复制成版本图里的 v1（存在 `data/`）。划选"结果表明该方法显著优于基线"，选区旁弹出指令框（润色、精简、更正式、译成英文、核对数据，或自己写"语气缓和些，补上样本量"）。主专家的改动直接写进正文，不加修订标记；窗口底部弹一条"主专家改写了 3.2 节 1 句"，可以「看改了什么」（打开比较定位到这处）或「撤销」。用户觉得可以，按 Ctrl+S 写回项目文件夹里的 `thesis.docx`。

**场景 3：并排比较。** 在版本树里右键 v5 →「和正在编辑的 v7 比较」，中间变成左右两页，像 Word 的并排查看：左边 v5、右边 v7，各按原版式排，同步滚动；v5 里被删掉的字标红，v7 里新加的字和改过格式的字标淡黄；整段删掉的位置在右页留一根红色细竖线；有「上一处」「下一处」和删、增、格式三种计数。

**场景 4：分支和版本分叉树。** 导师要一版 8000 字的投稿稿。用户点编辑台底栏的「版本树」按钮（工作站页面也有同一个按钮），右侧栏展开这份文稿的分叉树：从上往下长，样式和研究框架导图一致。右键 v5 →「从这一版开始编辑」，改完关闭，得到父版本为 v5 的新版本；v5 已有子版本，所以它自动另起一枝"分支 1"，用户改名"期刊投稿"、层级选"投稿"。节点是版本，连线是派生；点节点在侧栏下半改元数据，右键连线看改动摘要或打开比较；顶部搜索框按标签、标题、备注和修改指令过滤。

**场景 5：索引。** 用户划选"1,284"，右键 →「添加索引」，选 `data/firms_clean.csv` 和 `analysis/count.py`，写"去重后的企业数"。之后右键这个数字 →「查看索引」，右侧「批注与索引」展开这条：说明、来源和记录者，点脚本就在文件预览里打开。专家通过工具做同样的事。

**场景 6：批注。** 划选后右键 →「添加批注」，或在右侧「批注与索引」里写。批注和索引都能查看、修改、删除，按类型和作者筛选，专家加的也在这里。docx 的批注保存时写进 `comments.xml`，导师在 Word 侧边能看到；tex、md、pdf 的批注存在 `data/`，只在 ScienceScope 里可见。用户删掉一段带批注的文字：只要标记的文字还剩一个字，批注就在；最后一个字删掉时批注一起删掉，Ctrl+Z 把文字和批注一起恢复。

**场景 7：tex。** 打开 `chapters/method.tex`，默认左右两栏：左边高亮源码，右边实时渲染（章节、列表、引用、表格和公式），两边滚动联动；顶部可切成只看源码或只看渲染。点渲染里的公式弹出公式编辑框，可视化地改，改完写回源码。划选改写、批注、绑定与 docx 相同。应用内渲染不求和 PDF 逐像素一致；检测到 TeX Live、MiKTeX 时「编译 PDF」可用，输出放 `data/temp/`，在渲染栏位置预览 PDF；没有引擎时按钮停用，i 提示说明怎么安装。

**场景 8：Markdown。** 打开 `notes/outline.md`，默认渲染视图，可以像普通文档一样直接改（标题、列表、加粗、链接、代码、公式）；切到源码视图改原文。保存写回原文件，渲染视图不改动用户没碰过的写法（列表符号、空行）。

**场景 9：从对话跳到编辑台。** 对话里引用过文稿某一句的标记，点一下就把编辑台窗口调到前面，打开那份文稿并滚到那句，短暂高亮。

## 3. 架构

### 3.1 模块位置

后端在 `app/services/desk/`：`index.js`（会话）、`docx/read.js`、`docx/write.js`、`docx/comments.js`、`tex.js`、`markdown.js`、`compare.js`、`bindings.js`、`compile.js`；路由 `app/server/routes/desk.js`。界面在 `app/ui/components/desk*.js`，独立窗口用 `index.html?surface=desk` 加载（U1 定，不另建入口页），`app/ui/desk-window.js` 负责打开窗口和把文稿交给已开的窗口；编辑器依赖和阅读器一起打进 `app/ui/readers/vendor.js`（U2 定：只有一个浏览器包，按需加载）。原生窗口沿用全局助手窗口的机制（`src-tauri/src/main.rs`，标签 `secondary-desk`，所有项目共用一个）。

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
- **tex：** CodeMirror 6（state、view、language 和 `stex` 模式已在依赖，另加 `@codemirror/commands`）。块是空行分隔的段落，只用于比较、批注、绑定和修订标记定位；分隔空白原样保留，块拼回去就是原文。渲染栏在浏览器里把源码转成 HTML：常用结构（章节、列表、强调、引用和标签、表格、图片占位、`\input` 的章节）加 KaTeX 渲染公式，不认识的宏显示原文并淡色标出；块和渲染元素一一对应，滚动联动和渲染里的划选都按块定位。公式编辑框用 MathLive（可视化编辑，输出 LaTeX）。渲染库在 E1 试验里选定（第 10 节）。
- **Markdown：** 源码视图用 CodeMirror；渲染视图用 ProseMirror，块是顶层段落、标题、列表（列表项单独记）、引文、代码块、公式块，表格和 HTML 原样保留只读。写回时只重新生成改过的块，其余原文照抄，避免改写用户的格式习惯。公式用 KaTeX 显示。U6b 的做法见下面「U6b md 渲染视图」。
- **同步：** 服务端会话持有块列表和递增的 `seq`，是正本。浏览器停止输入 800 毫秒后，把改过的块（docx）或整份文本（tex）连同 `baseSeq` 发给服务端，服务端记修改、`seq` 加一、广播 `desk.changed`。AI 的修改走同一入口。冲突按块处理：用户在同一块有未发出的修改时先等它提交；之后 AI 的 `find` 找不到就返回 `TEXT_NOT_FOUND`，模型重读再改，用户的字不被覆盖。

**D3b 服务现状：** tex、md 共用 UTF-8 文本会话，按空行切块，Markdown 围栏内的空行不切块；显示块为 `{id:'t:<n>',kind,level,text}`，序号在会话内递增、不复用。保留 BOM、CRLF/LF、分隔空白和末尾换行；修改记录中的文字切片包含相邻分隔空白，使撤回与重启能逐字节恢复。全文提交用 `diffArrays` 配对相同块、同一空档按位置配对修改；必须使用当前 `baseSeq`，全文相同时不增序号。空闲写、撤回/保留、保存和版本均复用 D3a。非 UTF-8 返回 `DESK_ENCODING`。界面（U2）提交全文时要原样带回 BOM 和换行：CodeMirror 按文件的换行设 `lineSeparator`，否则 CRLF 文件每块都会记成修改；用户自己加或去掉 BOM 时，逐处撤回可能多留或少一个 BOM（审阅时随机测试发现，界面不提供这种操作，不处理）。DOCX 图片原子有可读取的嵌入图片时带 `media:true`，按原始包关系读第一张图片；包括 EMF 等浏览器不支持的格式，界面决定占位。

**U2 界面现状：** `app/ui/readers/desk-editor.js` 是两个编辑器：docx 用 ProseMirror（段落节点带 `id/kind/level/style/section/like`，表格 table>row>cell 按会话返回的 `cell:{table,row,cell}` 分组，跨段落的域是不可编辑的块，内联原子保留 `atom/ref/run/wrap`，文字的 run 和超链接等外层用 `origin` 标记带着），md/tex 用 CodeMirror（按文件换行设 `lineSeparator`，BOM 单独记，提交时加回）。纯逻辑在 `app/ui/desk-blocks.js`：两边按同一规范比较（标记顺序 b,i,u,sup,sub，去掉空文字和 `media`，同 run 同标记的相邻文字合并），没改的段落不提交；新段落的 `after` 取同一单元格或正文里的前一段，`like` 取分出来的那段，普通段落没有时取最近的普通段落（避免标题后回车又成标题、分节符被复制）。`app/ui/desk-session.js` 是同步控制：停 0.8 秒提交一次、同时只有一个请求，返回的新 id 回填到编辑器；`DESK_CONFLICT` 时拉会话，冲突段落用服务器的，其他没提交的修改保留后重发；序号跳过（别人写过）或事件序号更大时也拉一次会话合并；服务器拒绝的修改（如删分节符）提示后回到服务器内容。编辑器里另有三条保护：新段落和重复 id 自动给临时 id（`n:<k>`）；书签和批注范围随文字删掉时放回原处；删表格单元格、分节符段落、跨段落的域的操作直接不生效。打开时 `DESK_EXTERNAL_CHANGE` 的 `details` 带 `sessionId`，界面据此关闭旧会话重开或继续旧会话。历史版本标签仍走只读阅读器；同一文稿只有一个会话，以项目文件为准。

**U3 比较现状：** `app/ui/components/version-compare.js` 是编辑台和工作站版本树的比较对话框（`version-compare-dialog.js`）共用的组件，读 `GET /api/versions/:id/diff?baseline=`（左页是 baseline）。纯逻辑在 `app/ui/desk-compare.js`：成对段落里沿两边相同的文字同步走，把位置相接的删和增合成一处（hunk），格式范围和增叠在一起时并进那一处；连着几段只有一边有算一处，删掉的段落在右页前一段末尾留缺口；没有改动时按段落一一配对。页面用 `readers/desk-compare-page.js` 直接画 DOM（不进 ProseMirror），原子和编辑器共用 `readers/desk-atoms.js`；diff 的 docx 块补了 `cell`（`model.js` 的 `cellPlace`，和会话共用）以便画表格。同步滚动是分段线性映射：每对段落的顶和底各一个对应点，中间按比例拉伸，以视口上三分之一处为准；程序设的滚动位置记下来，回来的滚动事件不再反推。

**U4 界面现状：** 选区的帮手在 `app/ui/components/desk-assist.js`（`useDeskAssist`，desk.js 把它挂在画布上），纯逻辑在 `app/ui/desk-assist.js`（句子范围、md/tex 块的位置、对话标记、修改记录合成一段一段的改动、按中文词的前后对照，有 node 测试）。编辑器加了 `selection()`（docx 带 blockId 和段内偏移，md/tex 是去掉 BOM 后的文件偏移）、`selectSentence()`、`caretAt(x,y)`、`reveal()` 和闪一下的高亮。md/tex 的选区按 `app/shared/text-blocks.js`（从 `services/desk/text.js` 挪出来，前后端共用；静态服务现在提供整个 `app/shared/`）数到第几块，再对上会话的块 id。改写走 `POST /api/desk/sessions/:id/rewrite`；没绑对话时先 `POST /api/desk/enter {mode:'continue'}` 绑到项目最新的对话（没有就新建「编辑台」），再重发（接续时和左栏一样跳过归档、临时、附属和全局助手的对话，免得绑到「文献版本整理」）。专家的修改从 `desk.changed` 事件里认（事件的 actorId 不是用户），`state.deskEdits` 每个会话留最近 20 条；提示条的「撤销」按 changeIds 倒序逐条 `POST /api/desk/changes/:id/undo`。等待中的提示条看这次发言的 `turn.ended`，没改正文或失败时提示一句并收起。对话里的标记带 version 引用，点击先 `POST /api/desk/focus`，结果经 localStorage 交给编辑台窗口（60 秒内有效），编辑台打开对应标签后选中并高亮这句；位置变了或原文没了时提示。调试时发现并修了一个老问题：提交后的回调里又记了新事件时，新事件会先发出去，事件流按序号去重会把前一个（如 `turn.ended`）丢掉；现在提交回调期间新加的回调排在后面（`core/db/database.js`）。

**U5 界面现状：** 「批注与索引」侧栏在 `app/ui/components/desk-notes.js`（`useDeskNotes`，desk.js 把卡片列表放进右侧栏，索引选择框挂在窗口上、不在画布里），索引选择框是 `components/desk-index-picker.js`（项目文件按文件夹浏览、资料库的资料和条目、对话消息搜索，至少选一项，可写说明）。编辑器里的标记在 `readers/desk-notes.js`：docx 的索引是 ProseMirror mark `index`（不向外延伸、不排斥别的 mark、不从粘贴里解析），Word 批注按会话里的 comment-start/comment-end 原子之间画装饰（原子带 `comment` 即批注 id，`documentResponse` 补的）；md/tex 的批注和索引都是 CodeMirror 状态字段里的范围，随改动映射，范围变空就去掉，`invertedEffects` 让撤销把被改动碰到的范围按原样放回。每次同步（PATCH blocks / PUT text）带上编辑器里的范围 `annotations`（docx `{id,blockId,from,to}`，md/tex `{id,block,from,to}`，block 是第几块），服务端规则见 §6.2。服务端列表变了（`desk.annotations.changed`）就重读，本地没有未发出的修改时才把范围放回编辑器，否则稍后重试；会话从服务端重取段落时保留页上的索引。回复和已解决的 md/tex 批注不画标记。删字带走条目时提示「删掉的文字带走了 N 条批注」，可撤销（回复不计）。

**U6b md 渲染视图：** md 默认打开渲染视图，直接在页面上编辑；源码和页面是同一会话里的两个视图，切换不重开。源码编辑器始终是文字、撤销历史和批注范围的唯一记录，页面（`readers/md-page.js`）只是它的另一种样子。读：`app/ui/md-blocks.js` 用和只读视图相同的 marked 读出顶层块，每块记它的源码文字、前面的空行和逐字的位置对照（字面相同的一一对应，转义、实体、公式、图片按整段对应）。写：页面每次修改后比较前后的顶层节点，没变的块照抄原文，变了的块重新写成 Markdown，先不转义、读回来不一样再转义，仍不一样时把强调边上的全角标点移到记号外（中文标点紧挨 `**` 时 CommonMark 不认）；写法记号（`__` 还是 `**`、`*` 还是 `-` 列表、链接原写法、代码围栏）照旧；改过的列表只重写改过的项。新文字和旧文字逐字比较，只把差别作为一条普通修改写进源码，所以同段别处的批注不受影响，连续打字合成一步撤销。源码从别处变了（源码视图、撤销、服务端）就重新读，只替换文字变了的块。批注和索引按位置对照画在页面上，选区、定位、浮动工具条、右键菜单都换算成文件位置后走原来的接口。点公式用 U6a 的公式编辑框；功能区加粗、斜体、项目符号、编号、公式在页面上生效，源码视图里加粗、斜体给选中文字套 `**`、`*`。图片从项目文件夹读（相对 md 文件的路径，网址不加载），表格、HTML、链接定义只读，提示去源码改。

**U6c PDF 批注与索引：** 项目里的 PDF 打开时建只读会话（D6 已支持），正文字节不变。会话按资料库同样的读法把 PDF 分成块（行拼段、去页眉页码、NFKC、去中文间空格和行尾连字符），pdf.js 文字层是原始文字项，两边去掉空白和连字符后逐字比较（`app/ui/pdf-text.js`）：划选的字在本页的块里找，多处相同时比前后各 24 个字的上下文；跨段、落在页眉页码上的划选提示「在同一段里划选」。已定位的批注和索引反过来在文字层里找到位置，画成垫在文字层下面的框（`readers/pdf-notes.js`，按页面百分比定位，pdf.js 重画某页文字层时跟着重画）；批注浅黄底加下划线，索引点线，当前条目加深。点框亮出右栏卡片，卡片「定位」翻到那一页并滚到字上。浮动工具条和右键菜单只有批注、索引、引用到对话（右键多一个复制），没有格式和改写；功能区「阅览」里批注、索引、引用到对话可用。关文稿时不问写回。顺带修了 pdf.js 页面被全局 `box-sizing: border-box` 压窄、文字层整体偏右约 2% 的问题（所有 PDF 预览都受益）。PDF 自带目录进大纲、设计稿里单独的「标记」标签页未做。

**U6a tex 界面：** tex 打开时默认「并排」：左边 CodeMirror 源码，右边 `readers/tex-split.js` 画的页面，视图（源码/并排/渲染）在同一会话里切换，不重开编辑器。页面由 `app/ui/tex-render.js` 把源码转成块（标题、段落、列表、浮动体、表格、公式、定理、参考文献、脚注），每块记源码起止；停止输入 150 毫秒后整篇重算，HTML 没变的块沿用原来的元素，公式按 LaTeX 和宏缓存 KaTeX 结果。不认识的命令按原样淡色显示。编号按文稿算：有 `\chapter` 时节、式、表按章编号（中文稿式号写作 (3-1)），两遍处理让 `\ref`、`\eqref`、`\cite` 指向后文；`\cite` 在文稿自带 thebibliography 时显示编号，否则把 `ragin2008` 写成「Ragin, 2008」。两栏滚动按块的上下沿分段线性对应，谁最后被滚动或点击谁带着另一边走。点页面里的单行公式弹出 MathLive 编辑框（`components/desk-formula.js`），应用时只替换公式这一段源码，两端的 `\label` 和空白原样留下，是一条普通修改；多行公式（align 等）点了跳到源码。「编译 PDF」先写回项目文件，再调 D7 的接口；主文件不唯一时问用哪个（这次打开期间记住）；成功的 PDF 盖在页面一栏上，可以切回实时渲染；失败时页面右下角列出错误，点行号跳到源码。没找到 TeX 时按钮停用，旁边「未装 TeX」标签的提示说怎么装。

### 3.3 E0 试验和之后的决定规则

E0 是第一步，约 2–3 天，报告放 `.sciencescope-local/temp/desk-e0/`：① eigenpal docx-editor：读 LICENSE 和 `packages/pro` 的许可文本，把框架无关的核心挂进 Preact（不行再试 `preact/compat`），量体积和首屏时间，3 份真实稿件往返；② 自研回写最小原型（`docx/read.js`、`write.js`），同样 3 份稿件、同样的第 11 节检查；③ 句子对齐：同一论文的两个真实修订稿跑第 4.4 节算法，人工检查误标。

**E0a 结果（2026-10-20，Claude）：不采用 eigenpal。** 第 ① 条不满足：修订和批注在 `@docx-editor.dev/pro`，服务端编辑 API 在 `editor-api`，两者都是 EigenPal Pro 评估许可，禁止生产使用和分发；不装 Pro 时编辑器只保留批注、不能显示或新建。第 ④ 条在公开许可下也不满足（无界面编辑只能用 `editor-api`）。第 ②③ 条按规则不再测。走自研方案，E0b 由 Sol 做。报告在 `.sciencescope-local/temp/desk-e0/E0a_eigenpal.md`。

**E0b 结果（2026-10-20，Sol 做、Claude 审）：自研路线可行，定稿。** 原型在 `app/services/desk/docx/`（读、写、追加批注）和 `app/services/desk/compare.js`（两层对齐）。三份中文稿改一句、加批注后 Word 和 WPS 都无修复提示，中文字体和未改内容保留；目录、REF 域和已有修订用带 188 个公式的受控副本验证了 F9 更新、接受和拒绝。英文稿和学位论文样本缺，在 alpha 前用真实论文走场景 1–7 时补测。审阅时把读入改成线性（4000 段从 3.5 秒降到 0.1 秒）。D2 要补的：含 `w:lastRenderedPageBreak`、`w:tab`、`w:br` 的文字段和 `w:hyperlink`、行内 `w:sdt` 现在整段当原子节点，Word 存过的稿件里很常见，要拆成「文字 + 原子」才能编辑；`w:b w:val="0"` 这类关闭标记要识别。D4 要补的：切句时块之间加段落分隔，避免没有句号的标题和下一段并成一句；空档很大时相似配对的二维表要限内存。

**D2 结果（2026-10-21，Sol）：** 段内格式、拆段与增删段落、批注读写及回复链保留已完成；英文期刊、博士论文和含 188 个公式的受控稿在 Word/WPS 往返通过，含真实加粗/取消加粗、F9、接受/拒绝修订；博士论文 7,932 块读入 516.63 ms、写回 1,371.66 ms，详见本地 `temp/desk-d2/D2b.md`。

**决定规则：** eigenpal 同时满足四条才采用：① 用到的包都是 Apache-2.0 或 MIT，编辑和批注不依赖 Pro 包；② 能挂进 Preact，不必打包整个 React；③ 3 份稿件全部通过第 11 节检查；④ 文档模型能在 Node 里无 DOM 运行。第 ④ 条最关键：AI 在界面没打开时也要能改文档，只能在浏览器里工作的编辑器意味着服务端另有一套写回器，两套模型迟早不一致。任何一条不满足就用自研方案；自研原型也通不过检查时，停下向用户报告，不降低标准。

### 3.4 docx 往返

1. **读入**：jszip 解包；`saxes`（ISC）流式解析 `word/document.xml`，记下每个块级 `w:p`、每个 `w:r` 及其 `w:rPr`、每个原子节点在原字符串里的起止位置。不建 DOM，不重新序列化。`comments.xml` 同样解析。
2. **写回**：只重新生成内容变了的块。`w:pPr`、没变的文字段、原子节点原文照抄；改动的文字生成新 `w:r`，`w:rPr` 继承改动起点所在的原文字段（段首时继承后一个），中文的 `w:rFonts w:eastAsia` 因此不丢；文字用 `<w:t xml:space="preserve">`。块之间的字节（`w:sectPr`、表格结构等）原样拼接。其他部件（样式、编号、页眉页脚、媒体、`settings.xml`）字节不变，只有新增批注时改 `comments.xml`、`[Content_Types].xml` 和 `document.xml.rels`。
3. **批注**：读取 id、作者、缩写、日期、纯文本、块及内联边界、回复父 id 和解决状态；线程按批注最后一个段落的 paraId 对应 `commentsExtended.xml`，无扩展时按顶层未解决处理。新批注写入 `comments.xml`（没有就创建并登记），正文插入同 id 的范围和引用标记；作者、缩写由调用方传入。修改文字时合为一段，保留首段/首文字段格式和线程身份；删除时连同回复、正文标记以及 `commentsExtended.xml`、`commentsIds.xml`、`commentsExtensible.xml` 对应项一起删除。回复和解决状态只读；删正文段落则把书签和批注标记移至后一个保留段落开头，无后段时放前段末尾。
4. **显示**：OMML 用 omml2mathml 转 MathML（许可证 E0 核实，不合适就显示公式的线性文字）；图片按关系 id 从包里取字节。

### 3.5 文件放在哪里

用户的文件（如 `thesis.docx`）在项目文件夹里，只在用户保存时写入；ScienceScope 不在项目文件夹里放任何自己的东西（书签、隐藏标记、侧车文件都不写）。自有数据都在 `data/`：

```
data/projects/<目录>/
  versions/<组 id>/v<号>-<版本 id>/<原文件名>           版本原件（现有结构，不变）
  versions/<组 id>/v<号>-<版本 id>/<原文件名>.notes.md  版本说明，也是版本图里"边的备注"（现有）
  desk/<会话 id>/<原文件名>                             会话工作副本，空闲 2 秒自动写一次
  desk/<会话 id>/.state/source.docx、checkpoint.json      会话初始包与已落盘序号（D3a）
data/temp/desk-build/<会话 id>/work/                    TeX 本次编译输出、日志与中间文件
data/temp/desk-build/<会话 id>/last-success.pdf          最近一次成功的 PDF，失败时保留
data/sciencescope.sqlite                                会话、修改记录、绑定、tex 批注（第 4.1 节）
```

工作副本是真实的 docx 或 tex 文件，崩溃后或离开应用也能打开；会话关闭生成版本后删除。

D7 编译读取项目文件夹里已保存的源文件，工作目录是主文件所在的文件夹（和 TeXworks、Overleaf 一样，`\input`、`\include` 按主文件位置找；搜索路径只加这个文件夹，不递归整个项目，项目里的旧副本不会被误用）；构建产物只写入上述临时目录。关闭会话会结束其编译进程树并删除构建目录，启动时清理没有对应打开会话的旧目录。打开会话的成功 PDF 可在重启后继续读取。

D3a 已接通 docx 会话。修改先经 D2 的结构校验，再在一个 SQLite 事务中记逐块修改和递增序号；空闲 2 秒集中写一次 ZIP，保存、关闭会话和正常退出会先写掉未落盘修改。工作副本与检查点均用临时文件加改名；初始包保留整个会话的内联引用和无 paraId 段落的稳定编号，重启读取工作副本后由修改记录恢复已确认的修改。原稿和所有侧车状态分开。

**外部修改：** 打开和保存前比较项目文件的哈希与 ScienceScope 上次看到或写回的哈希（`version_groups.source_hash`，迁移 027；同时记 `source_version_id`，即项目文件从哪个版本来）。写回项目文件不生成版本，所以不能拿最新版本的 `content_hash` 比。不同就说明文件在外面被改过（Word，或 `write_file`），先把它导入成新版本（`origin='external'`）；会话里有未保存的修改时让用户选「以外部版本为准重新打开」或「保留我的修改另存为分支」，不悄悄覆盖。

迁移 027 的外部判定也用于 tex、md 会话；文件被删除或无法读取时返回 `DESK_SOURCE_UNAVAILABLE`，工作副本保留。文本会话的初始文件为 `.state/source.tex` 或 `.state/source.md`，工作副本沿用原文件名。

## 4. 版本与分支

### 4.1 数据模型（新迁移）

D10 的迁移 030 在 `manuscript_versions` 新增 `description TEXT NOT NULL DEFAULT ''`（版本描述）和 `is_key INTEGER NOT NULL DEFAULT 0`（重点）。旧版本默认描述为空、不是重点，现有短标签 `label` 保留。对外字段统一为 `description` 和布尔值 `key`。

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
- **显式关闭会话时**（D3a 的 `closeSession`）：工作副本哈希与当前基础版本不同就生成一个版本，父版本是 `base_version_id`，`origin='desk'`，记 `session_id` 和 `result_version_id`，尚未归档的修改记录填上 `version_id`；无变化时仅关闭。随后删除工作副本目录，不写回项目文件。应用正常退出只先落盘，保留 open 会话供重启恢复。
- **「存为版本」**：随时手动生成，可填标签和层级，之后的修改以它为父。
- **保存（Ctrl+S）**：检查外部修改后，把工作副本原子写回项目文件，`saved_seq=seq`，不生成版本。项目文件对应版本（`source_version_id`）不是会话基础版本时返回 `DESK_SAVE_CONFIRM`，明确带 `confirm:true` 才写回；写回后项目文件就对应这个会话，之后不再问。会话「存为版本」时，若项目文件正对应原基础版本，改为对应新版本。

**分支：** 父版本已有子版本时，新版本自动成为"分支 n"，用户可改名；同一分支上继续则继承分支名。从旧版本打开后保存到项目文件时先问一次：「写回项目文件（文件当前对应 v7，v7 仍在版本图里）」或「只存为版本」。底部信息栏始终写明项目文件对应哪个版本。

**版本说明：** 编辑台生成的版本不自动让秘书写说明；D3a 保存修改记录，第 4.4 节的比较待 D4 接入。用户可以手动加备注，或点「请秘书整理」走现有 `POST /api/versions/:id/organize`。导入的版本仍按 `auto_version_notes`。

### 4.3 版本图与历史版本

- 版本分叉树由 `parent_id` 推出，不另建边表；从上往下长，根是 v1，每个分支另起一枝，样式沿用研究框架导图（节点卡片、连线、折叠），自写布局，不用图布局库。入口是编辑台底栏的「版本树」按钮和工作站页面的同一按钮，都在右侧栏打开；侧栏可拉宽，节点多时可折叠分支。
- 文稿不走工作区的 `revisions` / `resource_snapshots`：那套机制存前后全文文本，不适合二进制 docx。文稿的历史就是版本图加 `desk_changes`；版本说明仍是现有 `versions` 文本资源，照旧留修订和历史版本，`workspace_versions` 不变。
- 撤销重做只在本次打开的编辑期间有效（`DECISIONS.md` 2026-10-07）：编辑器自带撤销管连续输入（含批注和索引的锚点），`desk_changes` 记下每处修改是谁做的，供比较、版本说明和撤销 AI 的修改用。

### 4.4 比较算法

比较按 Word 并排查看的样子显示，不做逐句对齐的行视图（所有者 2026-10-22）。D4 的 `desk/diff.js` 提供 `diffVersions(old, new)`，两版先转成块列表（DOCX 带 inlines，tex/md 按文本块，PDF 用现有提取文字）：

1. **段落配对**：块文字归一化（NFKC、合并空白、首尾去空白；原子用类型与原 XML 的 SHA-256 占位，不用 display），jsdiff `diffArrays` 配相同块；同一空档按字符二元组 Dice 保序加权配对，阈值 0.4。空档旧块数 × 新块数超过 250000 时全部记删增并返回 `limited:true`；拆合段保留最相似的一段，其余记删增，不检测移动。
2. **段内比较**：复用 `compareText` 中文词粒度；位置为原文 UTF-16 偏移。仅在不变文字上比较 `b/i/u/sup/sub`，连续同样的前后标记算一处；`kind/style/level` 改变记覆盖整块的格式项，tex/md/pdf 只比较 kind/level。
3. **输出**：`algorithm:1`、`status:ready|unchanged`、按块序号的 pairs、旧版 deleted、新版 inserted/format、整段删除位置 removedAt（after 为新版前块序号，开头 -1）、counts 和 limited。连续删增、整段删增各算一处；相同文稿各数组为空。旧 `/compare`、`alignVersions` 和版本说明的 `changeSummary` 保持原行为。
4. **什么时候算**：所有有父版本的新版本在提交成功后排队，包括关闭/保存会话、外部修改、另存和带基线导入；单 worker 串行，不等待计算才返回版本。迁移 028 的 `version_diffs(baseline_id,version_id,algorithm,diff_json,created_at)` 同时缓存父子与任意版本对，复合主键两列均引用 manuscript_versions；旧 algorithm 重算覆盖。失败只记日志，下一次请求重算；退出终止 worker、丢弃未完成任务。缓存只存差异，接口仍从不可变原件读取块。

**中文：** 词粒度沿用 `compareText` 的中文切分。归一化只用于配对，显示的永远是原文。

## 5. AI 改写流程

1. **划选**：选区上方弹出浮动工具条，参照 Office 的浮动工具栏：第一行格式（加粗、斜体、下划线、上下标、标题级别；PDF 没有），第二行是「改写」输入框和常用指令（润色、精简、更正式、译成英文、核对数据），旁边「引用到对话」（同现在对话里的划选标记）、「批注」「绑定来源」。工具条在鼠标离开后淡出，不挡正文。
   **右键菜单**分组：剪切、复制、粘贴 │ 改写…、引用到对话 │ 添加批注、绑定来源、含义与来源（有绑定时） │ 查看这句的修改记录、在版本树里定位。没有选区时作用于光标所在的句子。
2. **发出**：`POST /api/desk/sessions/:id/rewrite` `{ blockId, quote, instruction }`。服务端在绑定的会议里发一条用户消息，研究输入附一条标记（schema 1 引用，`kind: 'version'`，带 `location.paragraph` 和 `quote`）；时间线里收成一行"编辑请求"，对话记录保持真实。
3. **改写**：主专家用共用工具 `workspace_edit` 直接改文稿，界面经 `desk.changed` 收到后把新内容放进编辑器，不画修订标记；底部弹提示"主专家改写了 3.2 节 1 句"，带「看改了什么」（打开比较并定位）和「撤销」。
4. **撤销**：提示里的「撤销」和右键「这句的修改记录」里的撤销都走 `workspace_undo`，规则同工作区撤销：块的当前内容等于该记录的 `after` 才能撤回，否则提示先撤回之后的修改。用户自己的输入照常用 Ctrl+Z。

**工具**（加进 `app/services/tools.js` 的现有工具，所有角色都有）：

| 调用                                   | 参数与作用                                                                                                                                                                                                                                                                                |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspace_read target="manuscript"`   | `scope=<项目 id>` 列出文稿；`key=<项目 id>/<组 id>` 或 `…/path:<相对路径>`，未登记的先登记。`offset` 默认 0、`limit` 默认 40 最多 200，`version` 读历史版本；返回块 id、种类、标题级别、文字、原子记号和 `remaining`；D6 为每块补 `annotations` 摘要，见 §6。                             |
| `workspace_edit resource="manuscript"` | `replace {block, find, with}`（`find` 在块内须唯一，否则 `TEXT_NOT_FOUND`/`TEXT_AMBIGUOUS`）；`insertBlock {after, text}`（段 id 或 `^`，继承段落格式）；`removeBlock {block}`；`save {to: "project"\|"version", label?, tier?}`。D6 补 `comment`、`bind`、`uncomment`、`unbind`，见 §6。 |
| `workspace_undo`                       | `revisionId` 可以是 `chg_…`                                                                                                                                                                                                                                                               |
| `desk_suggest`                         | `{reason, document?}`，document 是文稿 key；持久记录 `desk.suggested {meetingId,reason,key:null或文稿key}`，同会议 10 分钟只记一次，返回 `{suggested:true}`。横条由 U8 接入。                                                                                                             |

没有打开的会话时，`workspace_edit manuscript` 为最新版本开一个绑定当前会议的后台会话，修改进工作副本，用户下次打开接上同一会话。DOCX 复用 `updateBlocks`，tex/md 复用 `updateText`；每处修改记录专家、会议、轮次和触发消息前 200 字。AI 修改只动 `data/` 里的工作副本，不触发批准；写项目文件只有 `save {to:"project"}`，"请求批准"模式下卡片列出路径和基础版本号，复用 `write_file` 的项目级始终允许规则。拒绝不改项目文件；外部修改与保存确认原样回给模型，不自动确认。

D5 原子记号为 `⟦类型:ref⟧`，域和公式还带显示文字，例如 `⟦field:8 (Zhang, 2024)⟧`；替换必须逐个按原顺序保留，否则 `DESK_ATOM_CHANGED`。替换文字沿用起始字符的格式，其他原有行内内容保留。工具成功返回 `{revisionIds:['chg_…'],seq,block:{id,kind,level,text}}`；删除或保存时 block 为 null，保存另带 version（写回项目时为 null）。工具错误返回 `{code,error,...details}`，找不到/不唯一时含当前 block；撤回冲突保留 `DESK_UNDO_BLOCKED`。

**提示词要点**（不加硬限制）：文稿用 `workspace_edit manuscript`，不用 `edit_file` 改 docx/tex/md；只改划选或用户指定的范围，范围外的问题用 `comment` 留批注；`find` 取足够长且唯一的原文；原子记号及顺序原样保留；回答只说改了什么和为什么。秘书和全局助手用同一套工具（原则 2、3），按用户要求读、比较、存版本，不主动改正文；会议里被 @ 的专家同样可用。数字、图表和结论有来源时用 `bind` 记下。

## 6. 批注与索引（索引即原"来源绑定"）

### 6.1 数据

```sql
CREATE TABLE manuscript_bindings (
  id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES version_groups(id),
  version_id TEXT REFERENCES manuscript_versions(id),  -- 最后一次定位的版本
  block_id TEXT NOT NULL, block_from INTEGER NOT NULL, block_to INTEGER NOT NULL,
  quote_json TEXT NOT NULL,    -- {exact, prefix, suffix}，前后各 32 个字符
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

D6 的迁移 029 已建 `manuscript_bindings`、`manuscript_comments`（同样有 `block_from/block_to` 和 `status`），并给 `desk_changes` 加 `annotations_json`，存这一处修改引起的 `{before,after}` 标注快照。DOCX 批注由原件和会话记录投影，不进批注表；新增、改正文、删除批注记 `op:'comment'`，写回复用 D2b。索引及其他格式批注记 `op:'annotation'`。新增 DOCX 范围标记先使用会话内可重放的原子，存盘写为标准 Word 批注范围，批注、索引及文字共用撤回栈。

偏移是块的显示文字中的 UTF-16 位置；批注起止和引用标记占 0 个字符，公式、域和图片保留原来的显示文字或对象字符。工具读出的 `⟦类型:ref⟧` 记号由服务端转换成这个范围，切开记号返回 `DESK_ATOM_CHANGED`。PDF 可建立只读标注会话，正文保持原件字节；tex/md/pdf 的批注支持 `parentId` 回复和 `resolved`，DOCX 的回复和解决留到后续。

DOCX 批注 id 为 `docx:<版本组 id>:<Word 批注编号>`，其他标注用全局 id。Word 保存时会重编号，重新打开后列表返回新的编号；作者用批注段落标识匹配，兼容旧记录时只接受唯一的作者/正文/分钟级时间匹配。外来批注的作者保留原名字，无法对应参与者时 id 为 null。

### 6.2 锚点

**编辑时（所有者 2026-10-22）：** 批注和索引在编辑器里是跟着文字走的标记（ProseMirror mark），删字、插字时范围自动收缩、伸长；**标记的文字只要还剩一个字就保留，最后一个字删掉时批注或索引一起删除**；撤销把文字和批注、索引一起恢复（同一个撤销栈）。删除时底部提示"删掉的文字带走了 1 条索引"，可以撤销。AI 的修改同样遵守这条规则。

**存盘时：** 锚点放 `data/`（docx 的批注另写进 Word 批注范围），记 `block_id`、块内起止和 `quote`。打开时先按 `block_id` 和起止定位，对不上（外部修改过）时在全文里找 `quote.exact`，多处命中用 `prefix`、`suffix` 消歧；唯一命中就更新，找不到或仍有多处时删除，并记可撤回的 `annotation-lost` 修改。tex/md 每次新建会话都按原文重找。修改记录的 `annotations` 保存标注快照，原文删光时与文字一起恢复；原文比较复用 jsdiff `diffChars`，按仍保留的原字符映射，范围内的插字随范围伸长。`annotation-lost` 的撤回只恢复原标注快照和引用，状态为 `lost`，正文保持外部版本；重开后仍保留。列表以 `status: anchored|lost` 告知界面，lost 显示「需重新定位」，旧偏移只作为记录，不能用于高亮。用户对 lost 条目 PATCH `{blockId,from,to}` 后恢复 anchored；再次打开时原文唯一命中也自动恢复。DOCX 的 lost 批注由原件和会话历史恢复，保存时不写入 `comments.xml`，重新定位后才重建原生范围和批注。

**编辑器带范围（U5 补的后端）：** D6 只按文字差异映射范围，编辑器里删字后再撤销时，服务端已经删了条目，撤销回来的文字带不回它；md/tex 拆段时范围也会丢。现在同步请求可带 `annotations`：块被这次修改碰到时，编辑器给的范围（仍在块内、非空）优先于文字映射。这一会话里因改字删掉的条目，编辑器又送回它的范围、且那里的文字和删掉时的 `quote.exact` 一样时，按原 id 恢复（记一条 `{before:null,after}` 的标注快照）；明确删除的条目不会因此回来，换了别的字也不回来。DOCX 批注没有单独的范围，看段落里送回的 comment-start/end 原子。碰到的段落里，不属于任何现存条目的 Word 批注原子在保存前去掉，不会写出孤立的 `commentRange`。修改返回多了 `removed:[{id,type,parentId?}]`。`desk.changed` 另带 `ops`（与 changeIds 一一对应），界面据此只把改字的修改算作专家改写。

### 6.3 界面与 tex 批注

- 一个入口：右侧栏「批注与索引」，筛选全部 / 批注 / 索引和作者；每条可以定位、编辑、删除；顶部可以直接给当前选区写新批注，也能改成索引。专家用工具加的批注和索引同样在这里，标出是谁。
- 批注的文字浅黄底加下划线，索引的文字下有细点线。右键 →「查看索引」在栏里展开说明、来源（文件名、页码或行号）、生成脚本和记录者，点任一项在文件预览里打开并定位。
- 划选后右键 →「添加索引」，可选项目文件、资料库资料或条目、某条消息，写一句说明。
- tex、md、pdf 的批注存 `manuscript_comments`（`id, group_id, version_id, block_id, quote_json, author_id, text, parent_id, resolved, created_at, updated_at`），锚点规则与索引相同；因为只在应用内，支持回复和解决。

D6 工具已接入 `workspace_edit manuscript`：`comment {block,quote,text}`、`bind {block,quote,kind,value?,sources,note?}`、`uncomment {id}`、`unbind {id}`。引用文字必须唯一且不切开原子；索引至少有一个 schema 1 来源。专家删除别人添加的条目返回 `DESK_NOT_AUTHOR`，用户接口可删除任意条目。`workspace_read manuscript` 每块仅附已定位的 `annotations:[{id,type,quote,summary}]`，批注摘要取前 60 字，索引为 `value · note`；历史读取仅列对应版本的标注。提示词引导专家为数字、图表和结论记来源，范围外问题用批注。

## 7. 界面

细节在界面任务里按设计系统定，这里只定结构。

- **窗口：** 编辑台是独立、非模态的系统窗口，所有项目共用 `secondary-desk`。原生数据目录的 `desk-window.json` 保存还原时的外框位置/大小、显示器原点、缩放及最大化状态；停止移动/缩放 350ms 后写，关闭时立即写。恢复按目标显示器缩放换算，超出显示器时回主屏居中并限制在工作区。再次调用 `open_secondary_window` 先恢复最小化、显示并取得焦点，再发 `desk-open`；主窗口关闭仍一并关闭副窗口。主窗口留在对话，两边可以并排或放两块屏幕；浏览器开发环境为新标签页。
- **入口：** 主窗口左栏「工作站」下面的「编辑台」，点了打开或切到编辑台窗口；对话里的文稿标记、项目文件夹预览框的「在编辑台打开」、进入横条也都打开它并定位。工作站左下角的文件版本管理撤掉，导图向左拉伸占它的位置。
- **布局：** 参照 Office 365 网页版。顶部一行可折叠功能区（保存、撤销重做、加粗斜体上下标、标题级别、批注、索引、比较、tex/md 的视图切换和「编译 PDF」）。左栏上半是文件列表（项目文件夹里的 docx、tex、md、pdf，加只在 `data/` 里的版本组），下半是大纲。中间正文。右侧栏标签：批注与索引、对话（绑定会议）；版本树也在右侧栏打开。底部信息栏：文件名、当前版本（"v7 · 期刊投稿 · 投稿"）、保存状态（"已写回项目文件"/"有修改未写回"）、字数、「版本树」按钮。右上角悬浮秘书按钮，点开是这个会议的秘书对话。
- **版本树：** 右侧栏，见第 4.3 节；工作站页面的按钮打开同一个侧栏组件。
- **比较视图：** 在中间展开成左右两页（像 Word 的并排查看），各按原版式排，默认同步滚动；旧版删掉的字标红（`diff-del`、`diff-del-ink`），新版新加的字和格式改动标淡黄（`diff-ins`）。现有 `version-diff.js` 改用同一比较结果。编辑时不显示这些颜色。
- **文字：** 状态只写结果和下一步（"项目文件在外部被修改：重新打开或另存为分支"），解释放 i 提示；新文字都要有英文条目。

## 8. 接口

新路由在 `app/server/routes/desk.js`，版本相关的放现有版本路由，都需要口令。

D3c：`POST /api/desk/enter {projectId,meetingId?,mode:'continue'|'branch',atMessageId?}` 返回 `{meeting:{id,title,parentMeetingId},mode,created,sessionIds}`。接续指定对话或选未归档、最近活动的项目对话；无对话时以用户和主专家为成员新建“编辑台”，工作文件夹沿用项目默认。分支沿用 fork，省略消息取最新一条；空对话报 `DESK_BRANCH_EMPTY`，跨项目报 `DESK_MEETING_PROJECT`。改绑本项目打开的会话，旧修改归属不变；之后用户修改默认归属所绑定对话，明确传入的 actor 归属保留。已有同组会话再次打开时传 meetingId 也会改绑。进入会 touch 并发 `desk.entered {projectId,meetingId,mode}`，不触发回答。

`POST /api/desk/focus {reference}` 接受 schema 1 的 project-file 或 version 引用；location 至少带 blockId 或 quote.exact，可含 characters 和 quote 前后文。在打开的工作副本中定位，无会话时自动打开；旧版引用也定位当前文稿。返回及 `desk.focus` 事件均为 `{projectId,path,groupId,sessionId,versionId,status:'exact'|'moved'|'missing',blockId?,from?,to?}`，versionId 保留所引版本（项目文件引用取会话基础版本），missing 不带范围。复用 D6 relocate；tex/md 的块编号跨会话不稳定，始终用原文及前后文消歧。仅有块 id 时定位整块。点击标记跳转和高亮已由 U4 接入，进入横条由 U8 接入。

D4：`GET /api/versions/:id/diff?baseline=` 返回 `{baseline:{id,number,branch},version:{id,number,branch},format,old:{blocks},new:{blocks},diff}`。省略 baseline 取父版本，无父返回 `{status:'first'}`；跨分支可比，跨组报 `INVALID_BASELINE`。不支持或解析失败时 old/new 为 null、diff 为 `{status:'originals-only'}`。有缓存复用差异，无缓存排队计算后保存。

D6 已提供统一标注接口：`GET/POST /api/desk/sessions/:id/annotations`、`PATCH/DELETE /api/desk/annotations/:id`。GET 返回 `{items}`，按块顺序、起始位置排序；共同字段为 `id,type,status,blockId,from,to,quote,author:{id,name},createdAt,updatedAt`。批注另含 `text,parentId?,resolved?`；索引另含 `kind,value,sources,derivation,note,status`。导入的跨段 Word 批注另有 `endBlockId`。POST 接受 `{type,blockId,from,to,...}`，空范围返回 `DESK_EMPTY_RANGE`；PATCH 按类型修改正文、说明和来源等，DELETE 删除条目。修改返回 `{seq,inserted,removedAnnotations,item}`，删除时 item 为 null；DOCX 的全局 id 已含组 id，服务端据此定位或打开会话。旧设计中的独立 comments/bindings 路由由这组统一接口取代。

标注变化发送持久事件 `desk.annotations.changed {sessionId,ids}`；文字修改与 `desk.changed` 都增加 `removedAnnotations` 计数。增删标注不单独询问批准；Word 批注随已有 `save to=project` 的批准一起写回。

D5：`POST /api/desk/sessions/:id/rewrite {blockId,quote,instruction}` 沿用会议发送流程；quote 接受文字或 `{exact,prefix?,suffix?}`。未绑定会议返回 `DESK_MEETING_REQUIRED`。空闲返回 `{messageId,turnId}`（已开始发言，不等待回答）；忙时排队返回 `{messageId:null,turnId:null,queued:true,itemId}`。消息正文是指令，研究输入 marks 的 reference 为 schema 1 / kind version / 基础版本 id，location 带从 1 开始的 paragraph、blockId、quote；mark 同时含 quote、manuscriptKey，供上下文编译为 annotation，排队发送后沿用既有事件通知。

`workspace_read manuscript` 列表返回 `{documents:[{key,name,format,versionNumber,sessionId}],truncated}`；块读取返回 `{groupId,versionId,sessionId,seq,blocks,remaining}`，块为 `{id,kind,level,text}`。历史读取 sessionId 为 null、seq 为 0；默认优先读会话未保存内容，否则读最新版本。

D10：传 `workspace_read {target:'manuscript',key:'<projectId>/<groupId>',versions:true}` 返回 `{groupId,versions}`，每项为 `{number,id,branch,tier,title,description,key,parentId,origin,createdAt}`，按版本号从新到旧；这条读取不打开编辑会话。工具说明提示「重点版本是用户标出的关键版本，比较时优先考虑」。专家只读这些元数据；`workspace_edit manuscript` 的 `args` 含 `description` 或 `key` 时返回 `VERSION_METADATA_READ_ONLY`，未提供的操作仍返回 `UNKNOWN_OP`。

`GET /api/versions` 的版本项、`GET /api/versions/:id` 的 `version`、版本图节点都返回 `description` 和布尔值 `key`。`PATCH /api/versions/:id` 只更新传入字段：描述先 trim，最多 2,000 个 Unicode 字符，超长返回 `VERSION_DESCRIPTION_TOO_LONG`；非文本描述或非布尔重点（含 null）返回 `INVALID_VERSION_METADATA`。与 title/label/tier/branch 在同一事务提交，失败一起回滚。沿用 `catalog.changed()` 发出的 `versions.changed` 事件：描述改变时 `action:'marked'`，否则重点改变时 `action:'key-changed'`；同时改变只发一条 marked 事件。

D3a 已实现下表中的登记、开会话、重连、PATCH blocks、撤回、保留、保存和关闭八个接口，D3c 补齐进入与定位，其余未注明的接口仍为后续设计。登记仅收 `{projectId,path}` 并返回版本组；开会话/重连返回 `{session,blocks,changes}`（不含批注和绑定接口）。修改返回 `{seq,inserted}`，其中 inserted 是客户端 id 到 `p:<paraId>` 的映射；`writeDocx` 的插入项支持预分配的 `paraId`。冲突错误为 HTTP 409 的 `{code,message,details}`：`DESK_CONFLICT` 的 details 含 `seq,blockIds,blocks`（已删除块为 `{id,removed:true}`）；`DESK_EXTERNAL_CHANGE` 含 `versionId`，`DESK_SAVE_CONFIRM` 含 `versionId,versionNumber`。保存支持 `confirm?`，保留支持 `{ids?}`。服务调用的 actor 可传 `actorId,meetingId,turnId,instruction`；HTTP 修改统一记为用户。

D3b 增加 `GET documents`、`PUT sessions/:id/text` 和 `GET sessions/:id/media/:ref`。登记接受 docx/tex/md/markdown，后两种均记格式 md。文本会话响应额外含 `text`；全文冲突的 `details` 为 `{seq,text}`，格式不符返回 `DESK_FORMAT`。文件列表返回 `{files,groups,truncated}`：文件含 `path,name,format,size,mtime,group`，mtime 为 ISO 时间；group 摘要含 `id,latest:{id,number,branch,tier},sourceVersionId`；仅在数据目录的组另含 name、format。递归跳过隐藏目录和 node_modules，自带项目根另跳过 workbench/notes/minutes/versions/desk，达到 2000 个文稿返回 truncated，读取失败的子目录跳过。列表只读。图片接口返回原字节和原 MIME，缺失为 404 `DESK_MEDIA_NOT_FOUND`。

| 方法与路径                                                                        | 作用                                                                                                            |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `GET /api/desk/documents?projectId=`                                              | 编辑台文件列表：项目文件夹里可编辑和可预览的文件，加版本组                                                      |
| `POST /api/desk/documents`                                                        | `{ projectId, path }` 登记项目文件（建组和 v1），或 `{ versionId }`                                             |
| `POST /api/desk/enter`                                                            | `{ projectId, meetingId?, mode, atMessageId? }`，返回会议、created、sessionIds                                  |
| `POST /api/desk/sessions`                                                         | `{ groupId, versionId?, meetingId }` 打开会话，返回块列表、修改、批注、绑定                                     |
| `GET /api/desk/sessions/:id`                                                      | 重连时读取会话                                                                                                  |
| `PATCH /api/desk/sessions/:id/blocks`、`PUT …/text`                               | docx `{ baseSeq, blocks, inserted, removed }`；tex `{ baseSeq, text }`                                          |
| `POST /api/desk/sessions/:id/rewrite`                                             | 划选改写，第 5 节                                                                                               |
| `POST /api/desk/sessions/:id/save`                                                | `{ to: 'project' \| 'version', label?, tier? }`                                                                 |
| `POST /api/desk/sessions/:id/close`                                               | 关闭会话，按需生成版本                                                                                          |
| `POST /api/desk/changes/:id/undo`、`POST /api/desk/sessions/:id/settle`           | 撤回一处；保留（`{ ids }` 或全部）                                                                              |
| `GET/POST /api/desk/sessions/:id/comments`、`PATCH/DELETE /api/desk/comments/:id` | 批注（docx 写进工作副本，tex 写进表）                                                                           |
| `GET/POST /api/desk/bindings?groupId=`、`PATCH/DELETE /api/desk/bindings/:id`     | 来源绑定                                                                                                        |
| `GET /api/desk/sessions/:id/media/:ref`                                           | docx 里的图片字节                                                                                               |
| `GET /api/desk/tex/engines[?refresh=1]`                                           | 已安装引擎的 id/path/distribution/version，以及 latexmk/biber/bibtex 路径；进程内缓存，refresh 重新检测         |
| `POST /api/desk/sessions/:id/compile {root?}`                                     | 返回 status/root/engine/durationMs/pdf/errors/warnings/unsaved/logTail；desk.compiled 事件携带 sessionId/status |
| `GET /api/desk/sessions/:id/pdf`                                                  | 最近一次成功的 PDF，application/pdf、no-store；没有成功产物返回 404                                             |
| `GET /api/version-groups/:id/graph`、`PATCH /api/versions/:id`                    | 版本图（节点含说明前 200 字、修改指令、description、key）；改标题、层级、标签、分支名、描述、重点               |
| `GET /api/versions/:id/compare?baseline=`                                         | 现有接口，返回值改为第 4.4 节的对齐行；允许跨分支比较同组任意两版                                               |

事件：docx、tex、md 共用 `desk.changed {sessionId,seq,blockIds,changeIds}`；`desk.session` 为 `{sessionId,state:'open'|'closed'}`，空闲写入失败时另发瞬时 `{sessionId,state:'save-error',message}`，可重试保存。保留不改正文和 seq，也发 `desk.changed`；继续使用现有 `versions.changed`。D5 已记录 `desk.suggested {meetingId,reason,key}`；D3c 已接入 `desk.entered` 与 `desk.focus`，载荷见本节接口说明。

## 9. 依赖与许可证

| 库                                                                         | 用途                                  | 许可证                                                                                                       | 体积                                           | 状态                                               |
| -------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- | -------------------------------------------------- |
| prosemirror-model、-state、-view、-transform、-commands、-keymap、-history | docx 正文编辑                         | MIT                                                                                                          | 合计压缩后约 150–200 KB（推断，E0 量）         | 新增                                               |
| `@codemirror/commands`                                                     | tex 编辑的撤销和按键                  | MIT                                                                                                          | 数十 KB（推断）                                | 新增；state、view、language、legacy-modes 已在依赖 |
| saxes                                                                      | 服务端 XML 流式解析，带位置           | ISC                                                                                                          | 约 50 KB，依赖 xmlchars（MIT）                 | 新增                                               |
| 已有：jszip、diff、docx-preview、pdfjs-dist、mammoth                       | 解包、比较、版式视图、PDF、文字提取   | MIT/GPLv3 双许可（按 MIT）、BSD-3、Apache-2.0、Apache-2.0、BSD-2                                             | 已随包                                         | 不变                                               |
| omml2mathml 1.3.0（scienceai/npm）                                         | OMML 公式显示                         | Apache-2.0，2026-10-21 已读[仓库 LICENSE 全文](https://github.com/scienceai/omml2mathml/blob/master/LICENSE) | 小                                             | D2a 未引入；当前显示 `m:t` 拼接的线性文字          |
| eigenpal docx-editor                                                       | 只在通过第 3.3 节规则时替代自研编辑器 | 核心 Apache-2.0；`packages/pro` 为 EigenPal Pro 许可，**需核实**                                             | 未知                                           | E0 试验                                            |
| Tectonic                                                                   | 可选的 tex 编译器                     | MIT                                                                                                          | 单个可执行文件，数十 MB（推断，E0 量）         | D9（alpha 之后）；D7 不下载或随包分发              |
| KaTeX                                                                      | tex、md 渲染里的公式                  | MIT                                                                                                          | 约 300 KB 加字体（推断）                       | 已用（markdown 已在用；tex 渲染 U6a）              |
| LaTeX.js 或自写转换                                                        | tex 渲染栏的结构                      | 自写（`app/ui/tex-render.js`）；LaTeX.js 不维护且约 14 MB，不用                                              | 未知                                           | U6a 定：自写                                       |
| MathLive                                                                   | tex 公式可视化编辑框                  | MIT（0.111.0，2026-09-30）                                                                                   | `mathlive.min.mjs` 824 KB，字体用 KaTeX 已有的 | U6a 新增，点公式时才加载                           |
| marked（已用）加自写块转换；prosemirror-schema-list                        | md 渲染视图（读写和列表编辑）         | MIT（schema-list 1.5.1，2025-03）                                                                            | 小                                             | U6b：不用 prosemirror-markdown，读法和只读视图一致 |

**不用：** SuperDoc、ONLYOFFICE、Overleaf、SwiftLaTeX（AGPL）；lang-tex、texlab、latexdiff、BlockNote 的 `xl-` 包（GPL）；CKEditor、Tiptap 转换、Syncfusion、Univer Pro（商业或云）；pandoc 不做编辑往返。

**TeX 编译（D7）：** alpha 只调用已装的 MiKTeX 或 TeX Live，搜索 PATH 和常见安装目录，TeX Live 多个年份选最新。`desk.tex.engine` 默认为 `auto`；显式设置优先，其后是文稿首部的 `% !TEX program`、主文件宏包，缺少所选引擎时按 xelatex/lualatex/pdflatex 选择已安装者。主文件依次按请求的项目相对 `root`、首部 `% !TEX root`、自身 documentclass、唯一直接引用者选取；无法唯一确定返回 `DESK_TEX_ROOT` 和候选列表。

有 latexmk 时使用其多轮编译，无 latexmk 时按 aux/bcf 选择 bibtex/biber，再运行两遍引擎。子进程使用 nonstopmode、file-line-error、halt-on-error、no-shell-escape；MiKTeX 引擎加 `--disable-installer`，安装开关的环境覆盖只传给子进程，不修改用户配置。总编译时限 120 秒，超时结束进程树；同会话重复编译返回 `DESK_TEX_BUSY`。`unsaved` 列出本项目尚未写回的文稿；`pdf` 表示是否有可读的成功产物，失败时可仍为 true。错误给出相对文件路径、行号和说明，日志只返回末 40 行。Tectonic 下载留到 D9，本轮没有该接口或依赖。

## 10. 分阶段与任务拆分

每个任务书约 1–2 小时，超时就停下报告。D 是 Sol（后端、原生），U 是 Claude（界面）。**A** 表示 alpha 必需。

| 顺序     | 任务                                                                                                                | 谁     | 完成标准                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------- |
| E0a ✅   | eigenpal 试验（2026-10-20：不采用，见第 3.3 节）                                                                    | Claude | 第 3.3 节四条逐条有结论                                                             |
| E0b ✅   | 自研回写原型、句子对齐试验（2026-10-20：自研可行）                                                                  | Sol    | 3 份稿件过第 11 节检查；对齐误标清单；报告定路线                                    |
| D1 **A** | 新迁移、版本图后端、`PATCH /api/versions/:id`、`graph`                                                              | Sol    | 迁移测试；建分支、改层级、读图的功能测试                                            |
| D2 **A** | `desk/docx/` 读、写、批注                                                                                           | Sol    | 合成样例覆盖公式、域、图片、表格、修订、批注；改一段其余字节相同；`w:eastAsia` 继承 |
| D3a ✅   | 会话服务（docx）：块更新、工作副本、修改记录、撤回、保存、外部修改、关闭生成版本                                    | Sol    | 打开 → 改 → 撤回 → 保存 → 关闭                                                      |
| D3b ✅   | tex、md 会话（块拆分、按块记修改）、编辑台文件列表、docx 图片字节                                                   | Sol    | tex、md 各走一遍打开 → 改 → 撤回 → 保存 → 关闭                                      |
| D3c ✅   | `/api/desk/enter`（接续或分支）、`desk.focus`（与 D8 一起）                                                         | Sol    | 场景 1、9 的后端测试                                                                |
| E1 **A** | tex 渲染与公式编辑试验：LaTeX.js 对比自写转换、KaTeX、MathLive；md 往返                                             | Claude | 三份真实 tex（含中文、公式、表格）渲染对照截图，选定方案；md 改一处其余原文不变     |
| U0 **A** | 编辑台设计稿：窗口布局、docx、tex、md、pdf、比较、版本树、浮动工具条、右键菜单（2026-10-22 已出，画廊「编辑台」组） | Claude | 所有者认可                                                                          |
| U1 ✅    | 窗口骨架、入口、左栏、底部栏、文稿标签、`features.editingDesk`，撤掉工作站版本管理                                  | Claude | 100%、125% 截图；开关关闭时无入口                                                   |
| U2 ✅    | ProseMirror 编辑器、原子节点、块同步、Ctrl+S                                                                        | Claude | 浏览器测试：改字保存后重开一致                                                      |
| D4 ✅    | `diffVersions`：段落配对加段内词级比较和格式改动；生成版本时后台算好存进版本，任意两版现算缓存                      | Sol    | 插段、删段、拆段、改词、改格式测试；生成版本后 `diff_json` 存在                     |
| U3 ✅    | 比较视图：左右两页并排、同步滚动、上一处下一处，`version-diff.js` 改用新结果（该页 2026-10-29 删除，比较改在版本树里）                                        | Claude | 截图；上一处、下一处可用                                                            |
| D5 ✅    | `manuscript` 读写、`chg_` 撤回、`desk_suggest`、提示词                                                              | Sol    | 脚本运行时测试；`deepseek-v4.1-flash` 真跑一次，报请求数和 token                    |
| U4 ✅    | 浮动工具条、右键菜单、AI 修改后的提示条（看改了什么、撤销）、对话标记跳转                                           | Claude | 场景 2、9 浏览器测试；全新安装加服务商后真跑一次                                    |
| D6 ✅    | 批注和索引的表、服务、接口（增删改查，含专家的）、打开时重新定位，原文删光时删除                                    | Sol    | 外部修改后仍定位；原文删掉后这条被删除并记进版本说明                                |
| U5 ✅    | 「批注与索引」侧栏、批注和索引跟着文字走的标记（全删才删、撤销一起恢复）、查看索引菜单、索引选择框                  | Claude | 场景 5、6 浏览器测试；删字和撤销的锚点测试                                          |
| U6 ✅    | U6a ✅ tex 源码加实时渲染、公式编辑框、编译按钮；U6b ✅ md 渲染视图直接编辑；U6c ✅ PDF 批注、索引、引用到对话      | Claude | 场景 7、8 浏览器测试；无引擎时编译按钮停用有提示                                    |
| D7 ✅    | 已装引擎检测、编译、错误与成功 PDF；输出放 `data/temp/desk-build/`                                                  | Sol    | Windows MiKTeX 中文、多文件参考文献、错误定位、缺包无弹窗和目录无产物通过           |
| D8 ✅    | 编辑台原生窗口：U1 已加 `desk` 窗口和 `desk-open` 事件，D8 补记住大小和位置、`desk.focus` 调到前面                  | Sol    | 原生验收：开关、记住大小和位置、主窗口不锁定、点标记能切过去                        |
| U7 ✅    | 版本分叉树侧栏：从上往下的树、信息栏、筛选、右键比较、从旧版开始编辑；右键「标记」「重点」（D10）；工作站入口随 P3  | Claude | 场景 4 走通                                                                         |
| U8 ✅    | 进入横条（接续或分支）、秘书悬浮按钮、右侧栏「对话」                                                                | Claude | 场景 1 走通，分支后原对话不变                                                       |
| D9       | Tectonic 按需下载                                                                                                   | Sol    | 视第 12 节第 4 条                                                                   |

**U7 补充（Yui 2026-10-25）：** 版本树右键菜单加「标记」和「重点」。标记给这个版本写一段描述，显示在节点和信息栏里，搜索也按它过滤；重点把版本标成重点版本，节点用着重色，比较的版本选择里也排在前面、带同样的颜色。专家能读到这两项（读版本列表的工具返回描述和是否重点），比如「和重点版本 v5 比较」。D10 已用迁移 030 独立保存 description 和 is_key，label 不动；PATCH 接受这两项，workspace_read manuscript 的 versions 参数提供只读版本列表。

**U7 完成情况（2026-10-26）：** 版本树在右侧栏（底栏和「审阅 → 版本树」打开，和「批注与索引」切换），布局在 `app/ui/version-layout.js`：行是代数，和父版本同分支的子版本留在父版本那一列，其他子版本另起一列，分支名标签点一下收起成「分支名 · N 版」。当前版本到 v1 的路径加深。节点上是版本号、名称、日期和来源（外部修改虚线框），终稿和其他层级用左边色条。筛选框按标题、标签、备注、修改指令筛，不匹配的变淡。详情：改名、层级、分支、来自、派生、修改指令，「从这一版开始编辑」（关掉当前会话，以这一版为底重开，存版本时长出分支）和「和 vN 比较」（U3 比较视图）。右键菜单另有打开（只读）、删除这一版（有后续版本或正在打开时停用并说明原因，删前确认）。D10 合并后（2026-10-27）详情有「标记」框、右键有「标记…」「设为重点」；有标记的节点第二行显示标记，重点节点实心星加浅着重底色，比较栏选版本时重点版排前。还没有：节点上的操作人和改动数、分支改名、另存为文件或覆盖项目文件、工作站入口（随 P3 工作站改版）。

**U8 完成情况（2026-10-28）：** 进入横条在 `app/ui/components/desk-entry.js`（对话页输入框上方），读 `GET /api/desk/suggestion?meetingId=`：返回这段对话最近一次 `desk.suggested`，之后从这段对话或它的分支进入过就返回 null；文稿 key 解析成项目文件路径。关掉只记在本机 localStorage（按提议的 seq）。右侧栏「对话」是 `components/desk-chat.js`（复用 Message 和 Composer，Composer 加 `slim`），秘书按钮在正文右上角，打开现有 SecretaryPanel（SidePanel 加返回箭头）。绑定的对话：本窗口收到的最近一次 `desk.entered`（`state.deskBindings`）优先，否则取当前会话的 meetingId；之后在本窗口打开的文稿带上这段对话。后端补了一条：新会话没指定对话时，取这个项目最近一次 `desk.entered` 的对话（未归档），所以先在主窗口进入、编辑台后打开也能接上。「引用到对话」不再提示回主窗口，改为切到「对话」。编辑台窗口里的 `openDesk`/`focusDesk` 直接交给本窗口。画廊卡片 PageDeskChat、DeskChatStates（画廊第 32 版）。还没有：「来源」栏，秘书面板头部不带对话名。

A 任务完成后，在 Windows 候选安装包上用真实论文走完场景 1–9。2026-10-29 Yui 提前让编辑台转正（去掉 `features.editingDesk` 开关），场景 1–9 的 Windows 实测仍要做；`product/FEATURES.md` 随每个任务更新。

**alpha 之后：** docx 公式编辑（LaTeX 输入，用 docx 包（dolanmiu，MIT）的 `latexToMath` 生成 OMML）；AI 修改导出成 Word 修订；分支合并（第二个父版本）；SyncTeX 双向跳转（synctex-js，MIT）；选中图表重跑脚本；移动段落检测；表格结构编辑；docx 批注回复和解决；写作时浮现相关资料片段。

## 11. 风险与验证

| 风险                                                 | 验证                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 写回后 Word / WPS 出现修复提示，或改动段落丢中文字体 | 三份真实论文（中文学位论文、英文期刊稿、带 Zotero 引文和大量公式的稿件），各做打开 → 改一句 → 加批注 → 保存。解压比较：`document.xml` 除改动段落外字节相同，批注相关部件只多出批注内容，其余部件字节相同；改动段落的 `w:rFonts` 与相邻文字段一致。Word 和 WPS 各打开一次，**都不出现修复提示**。稿件放 `.sciencescope-local/temp/`，不进仓库。 |
| 引文域和已有修订被破坏                               | 改含引文的段落后用 Zotero 刷新，引文仍能识别；带修订的稿件往返后仍能接受、拒绝，批注不成孤儿。                                                                                                                                                                                                                                                 |
| 长稿件性能                                           | 8 GB 内存的 Windows 机器打开 100 页 docx，记录打开、输入延迟、保存和比较耗时。                                                                                                                                                                                                                                                                 |
| 中文对齐误标                                         | 同一论文两版（改句、删段、插段、调换段落）人工检查；测"……"、引号内句号、"；"。                                                                                                                                                                                                                                                                 |
| tex 应用内渲染和真实 PDF 差太多                      | E1 用三份真实 tex 对照渲染栏和 TeX 编译结果截图；不认识的宏显示原文，不猜                                                                                                                                                                                                                                                                      |
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

**第二组（2026-10-22，所有者）**

6. 编辑台是独立的系统窗口，入口在主窗口左栏「工作站」下面；点对话里引用的标记跳到编辑台窗口并定位。
7. 版本分叉树是编辑台里的一个按钮（底栏），工作站页面也加同一个按钮；打开成右侧栏，树从上往下分叉，样式参照研究框架导图。
8. tex 内置：像 Overleaf 那样的富公式编辑器，基本功能不依赖装 TeX。md 和 tex 都能在渲染和源码之间切换。之后加类似 WPS AI 的实时修改（带批注和修订标记）。
9. 划选弹出的功能条参照 Office 套件；右键菜单要单独设计。四种文件都能划选标记、引用到对话；PDF 只能标记和批注，不能改。

**第三组（2026-10-22，所有者看 U0 设计稿后）**

10. 比较不做逐句对齐的行视图：左右两页正常显示文稿，左旧右新，像 Word 并排查看；差异在旧版保存、退出生成版本时后台算好；旧版删掉的标红，新版加的内容和格式标淡黄。
11. 编辑默认像 Word 一样，不把增删改都高亮、不给删掉的字划线；专家或模型的修改只在后台记录。
12. 新增批注入口：新增、修改、查看、删除批注和索引，包括专家的。被标记的文字直到最后一个字被删掉才删除对应批注或索引；撤销把文字和批注、索引一起撤回。
