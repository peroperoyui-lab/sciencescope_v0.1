# 编辑台调研（1.0.0-alpha）

- 作者：Claude，2026-10-18。依据：`plans/IDEAS.md`「写作与编辑工作台」「编辑台」，`reviews/REVIEW_2026-10-18.md` §3，`product/VISION.md`，`product/FEATURES.md` 2.7–2.9，`decisions/DECISIONS.md` 2026-10-18 条，`architecture/CORE_MODEL.md` §4、§4a。
- 事实附来源编号（见第 7 节）；没有来源、由我推出的结论标「推断」。许可证和功能以调研当天的页面为准，引入前再核对。

## 1. 结论与推荐

1. **DOCX：自己做一个"语义投影 + 原位回写"的编辑器，不引入整套 Office。** 正文用 ProseMirror（MIT）编辑，每个段落记住它在 `document.xml` 里的原始节点；保存时只重写改过的段落，其余 XML（样式、域、公式、图片、页眉页脚）原样保留。批注直接读写 Word 原生的 `comments.xml`。版式视图继续用已有的 docx-preview。理由：完整的浏览器 Office 不是 AGPL（SuperDoc、ONLYOFFICE）就是商业或云服务（CKEditor、Tiptap 转换、Syncfusion），pandoc 自己说明复杂格式的转换有损。
2. **先花 1–2 天试一下 eigenpal docx-editor**（核心 Apache-2.0，也是"未改内容原样保存"的思路）。如果它的免费部分能在 Preact 里挂载、批注可用，就直接用它替代第 1 条的自研部分；它的批注和修订可能属于 Pro 许可，资料互相矛盾，必须先核实。
3. **TeX：CodeMirror 6 源码编辑（已在依赖里）+ 应用内批注；PDF 只预览。** 编译做成可选项：先找用户机器上已有的 TeX Live 或 MiKTeX，没有的话提供 Tectonic（MIT，单个可执行文件）作为按需下载，输出放在 `data/` 下。不用 Overleaf、SwiftLaTeX（AGPL）、lang-tex 和 texlab（GPL）。
4. **版本与分支：存在 SQLite（版本图）加 `data/` 下的原件副本，不用 git。** 现有 `manuscript_versions` 增加父版本、层级和分支标签即可画版本图。
5. **对比：两层对齐。** 先按段落、句子对齐（Intl.Segmenter 的句粒度加 jsdiff 的 `diffArrays`），再在配对的句子内部做词级比较。这样一处改动不会让后文全部变红。jsdiff 和 Intl.Segmenter 都已在用。
6. **AI 改写：划选 → 指令框 → 共用的文档编辑工具 → 结果直接写入，同时以修订标记显示，可逐处撤回。** 这是 Cursor、Google Docs、Notion 的共同模式，也符合原则 3。
7. **来源绑定复用 schema 1 引用对象**（`CORE_MODEL.md` §4a），加一层"绑定"记录，结构参照 W3C PROV 的实体、活动、执行者。
8. **放到 alpha 之后**：公式的可视化编辑（alpha 只保留和显示）、把 AI 改动导出成 Word 修订、分支合并、TeX 的 SyncTeX 双向跳转、选中图表重跑脚本。

## 2. 需求拆解

| 需求 | 必须做到 | 难点 | 建议阶段 |
|---|---|---|---|
| 入口和布局 | 与工作站同级；顶部可折叠功能区、正文、右侧侧栏、底部信息栏 | 纯界面工作 | alpha |
| DOCX 编辑 | 打开、改正文、保存后 Word 和 WPS 正常打开，未改的部分不变 | 往返保真；中文字体（`w:eastAsia`）；域代码；已有的修订 | alpha（正文、标题、列表、表格文字） |
| TeX 编辑 | 源码编辑、高亮、保存；PDF 预览 | 编译环境体积和离线 | alpha 编辑；编译可选 |
| 分级版本和分支 | 版本图窗口；节点是版本，箭头是派生；元数据可编辑；保存后自动生成新版本和对比 | 分支模型；和现有文稿版本合并 | alpha（派生和分支；合并以后做） |
| 并排对比 | 同格式两个版本并排；旧版多出的淡暗红，新版多出的淡黄；只标真正的改动 | 句子对齐、移动的段落 | alpha |
| 句级修改记录 | 每处改动能看到谁改的、何时、改前改后 | 编辑中的变更集和历史版本衔接 | alpha |
| 划选后 AI 改写 | 划选自动弹出指令框；右键才是二级菜单 | 定位稳定（文档变化后锚点仍对得上） | alpha |
| 来源绑定 | 数字、图表记录来源文件、脚本、数据；右键查看和跳转；用户可自己绑定 | 锚点放在哪里（文件内还是只在 `data/`） | alpha（文本片段）；重跑脚本以后做 |
| 批注 | docx 用原生批注；tex 只在应用内可见 | docx 批注锚点和段落改写的配合 | alpha |
| 公式 | Word 用 OMML，LaTeX 用原生写法 | OMML 显示和编辑 | alpha 显示；编辑以后做 |

约束（`AGENTS.md`）：自有文件只放 `data/`，用户要求时才改项目文件夹里的文档；角色共用工具；中文分句；普通电脑；宽松许可证；控制安装体积（现约 9,700 个文件）。

## 3. 候选方案对比

### 3.1 DOCX 往返编辑

| 方案 | 许可证 | 往返保真 | 体积 / 离线 | 维护（2026） | 结论 |
|---|---|---|---|---|---|
| SuperDoc | **AGPL-3.0**，另售商业许可 [1][2] | 自称浏览器内编辑渲染 DOCX，支持修订模式、批注、Yjs 协作，ProseMirror 内核 [2][3]；公式、脚注、域在资料里没提到 | `superdoc.min.js` 压缩后约 1.5 MB [3] | 很活跃，30 天 500 多个 PR [2] | 功能最接近，但 AGPL 会要求整个应用按 AGPL 发布，**不用** |
| eigenpal docx-editor | 仓库 Apache-2.0，`packages/pro`、`packages/editor-api` 为 EigenPal Pro 许可 [4]；另一页称"完全免费" [5]，**矛盾，需核实** | 自称"无损往返，未改内容和不支持的 OOXML 原样保存" [4]；修订（作者归属、逐条接受拒绝）、批注线程 [5]；公式和脚注没提到 | 未说明 | 很新（约 3 个月），提交频繁 [6] | **先做 1–2 天试验**；只有 React、Vue 适配器 [4]，要看核心能否直接挂到 Preact |
| ONLYOFFICE Docs / 桌面版 | **AGPL-3.0 加附加条款**（衍生版本须在"关于"里注明 ONLYOFFICE）[7] | 完整的 Office 级保真 | Windows 桌面版安装包约 300–370 MB [8] | 活跃 | 体积和许可证都不合适；可以作为"在外部程序打开"的推荐工具 |
| Collabora / LibreOffice | MPL 系（推断） | 高，但读入再写回会改写 XML（推断） | 整套办公软件，当前 25.8.3 [9] | 活跃 | 只做可选的"转 PDF" |
| Univer Docs、CKEditor 5、Tiptap 转换、Syncfusion | Univer 的 DOCX 导入导出在 `@univerjs-pro` 包里且需要转换后端 [10]；CKEditor 导入 Word 是商业功能，文件发往其云服务 [11]；Tiptap 转换是 Pro 扩展，偏服务器端 [12]；Syncfusion 是商业许可，社区许可要求年收入低于 100 万美元等 [13] | — | 需服务器、云或授权 | 活跃 | 都不符合本地优先或开源分发，不用 |
| pandoc 往返 | GPL（推断，pandoc 是独立程序） | 官方说明：比 pandoc Markdown 表达力强的格式转换"可以预期是有损的"；只保留结构，不保留页边距等格式；`--track-changes=all` 可读入修订和批注 [14]；修订里的批注会丢失（2024 年的问题报告）[15] | 独立程序 | 活跃 | 不做编辑往返；可用于"把 Markdown 差异导出成带修订的 Word"（pandiff 的做法 [16]） |
| mammoth（已在用） | BSD-2（推断） | 只生成语义化 HTML，忽略样式；批注默认忽略、可映射；支持脚注 [17] | 小 | 维护中 | 继续用于提取文字，不能写回 |
| docx-preview（已在用） | Apache-2.0 [18] | 只渲染不编辑 | 小，依赖 jszip [18] | 单人维护 [18] | 继续做版式视图 |
| docx（dolanmiu） | MIT [19] | 主要用于生成和打补丁（`patchDocument`）；9.8 加入公式入口，9.8.1 加入 `latexToMath`（LaTeX 转可编辑 Word 公式）；支持批注回复、已解决状态、修订、脚注 [20] | 纯 JS | 活跃，9.8.1 于 9 月发布 [20] | **可用作写回辅助**：生成新的批注、公式 XML 片段 |

**小结**：没有既宽松许可、又完整往返、又离线的成熟编辑器。最稳的是只回写改过的段落（4.2 节），复杂对象作为原子节点原样保留，保真靠"不碰"。

### 3.2 LaTeX 编辑与编译

| 方案 | 许可证 | 作用 | 体积 / Windows / 离线 | 维护 | 结论 |
|---|---|---|---|---|---|
| CodeMirror 6 + `@codemirror/legacy-modes` 的 stex 模式 | MIT（已在依赖） | 源码编辑、高亮 | 已随包 | 活跃；Overleaf 的源码编辑器也是 CodeMirror 6 [21] | **采用**；补全用自带 autocomplete 和一份命令表 |
| lang-tex | **GPL-3.0-or-later** [22] | CM6 的 TeX 语法和 MathJax 片段 | 小 | 0.0.3 | 不用 |
| Overleaf 社区版 | **AGPL-3.0**；修订（track changes）属 Server Pro [23] | 整套在线编辑器 | Docker，基础镜像数 GB [23] | 活跃 | 不用代码，只参考交互 |
| texlab（LSP） | **GPL-3.0** [24] | 补全、构建、正向搜索；Rust；有 Windows 预编译版，支持 Tectonic [24] | 独立进程 | 活跃 | 作为独立进程调用在许可上可以讨论，alpha 不需要 |
| Tectonic | MIT [25] | 单个可执行文件，按需下载 TeX 支持文件 [26]；有 `--only-cached`（只用本地缓存）、`--bundle`（指定包）、`--synctex` [27] | Windows 用 PowerShell 脚本下载 exe [26]；体积约数十 MB（推断，未核实） | 0.17 文档在 docs.rs [26] | **首选的可选编译器**；缓存目录指向 `data/` 需验证 |
| MiKTeX、TeX Live | MiKTeX 有自己的复制条款 [28] | 缺包时可自动安装，可设"先问我/总是/从不"[28] | 用户自己安装 | 活跃 | 用户已装就用 |
| SwiftLaTeX（WASM） | **AGPL-3.0**，最后推送 2024-06 [29] | 浏览器里跑 TeX 引擎 | — | 停滞 | 不用 |
| synctex-js | MIT [30] | 解析 SyncTeX，PDF 与源码互相定位 | 纯 JS | 1.0.0，更新少 | 以后做双向跳转时用；pdf.js 已在依赖 |
| latexdiff | **GPL**，Perl 脚本 [31] | 生成带修订标记的 tex | 需 Perl | 老牌 | 只作为用户可选的外部工具，不随包 |

### 3.3 富文本框架（句级编辑、内联 AI、修订）

| 方案 | 许可证 | 修订 / 建议模式 | 与 Preact | 结论 |
|---|---|---|---|---|
| ProseMirror | MIT（推断；配套的 prosemirror-changeset 为 MIT [32]） | `prosemirror-changeset` 把一串编辑压成插入和删除区间，可带作者、时间等任意数据 [32]；`@handlewithcare/prosemirror-suggest-changes`（MIT [33]）提供 insertion / deletion / modification 三种标记和逐条接受、撤回的接口 [34] | 不依赖框架，在 Preact 组件里用 ref 挂一个 DOM 节点即可（推断，与 Tiptap 原生 JS 用法一致） | **采用** |
| Tiptap | 核心编辑器和扩展 MIT；AI、批注、文档历史属付费平台 [35] | 修订在付费的 Review 产品里 [35] | 支持纯 JS，用 `@tiptap/core` + `@tiptap/pm` [36] | 可只用 MIT 部分；直接用 ProseMirror 少一层 |
| Lexical | MIT，Meta 维护，0.52.0（2026-09-28）[37] | 没有现成的修订 | 框架无关，但生态多是 React [37] | 不选 |
| BlockNote | 核心 **MPL-2.0**；`xl-` 包（含 DOCX 导出、AI）**GPL-3.0** 或商业 [38][39] | — | 依赖 React（推断） | 不选：关键功能是 GPL |

### 3.4 版本图与差异

| 方案 | 许可证 | 要点 | 结论 |
|---|---|---|---|
| jsdiff（`diff` 9.0.0，已在用） | 见仓库 LICENSE（BSD-3，推断）[40] | 有 `diffWords`、`diffSentences`、`diffArrays`；`diffWords` 默认用正则分词，可传入 `Intl.Segmenter` [40] | **继续用**；句子对齐用 `diffArrays` 比较句子序列 |
| Intl.Segmenter | 浏览器和 Node 内置 | 句粒度能按日文"。"断句，并能识别常见英文缩写 [41]；中文"！？"的表现资料未写，需测 | **采用**；现有 `comparison.js` 已用词粒度 |
| diff-match-patch | Apache-2.0（推断，未取到原页） | 语义清理（`diff_cleanupSemantic`）能把零碎差异合并成可读块 | 可选，用于句内清理 |
| isomorphic-git | MIT（推断） | 合并只支持 diff3 能自动解决的情况，冲突时抛错；找到多个合并基点会失败（旧版文档）[42] | 不用：版本是二进制 docx，git 合并帮不上；SQLite 版本图更简单 |
| Overleaf 历史 | 商业服务 | 线性历史，可给版本打标签、选起止点比较、恢复单个文件或整个项目；完整历史和修订是付费功能 [43][44] | 参考"标签 + 区间比较"交互；没有分支 |
| Draftable | 商业，每用户每年 129 美元起；Windows 桌面版，并排对比 [45] | 并排高亮 | 参考并排交互 |

### 3.5 来源绑定可参考的做法

- **Quarto**：正文写行内代码 `` `{python} radius` ``，渲染时取计算结果，建议只放简单值 [46]。借鉴：正文数字与计算结果绑定。
- **Jupyter Book / MyST-NB（glue）**：给笔记本输出起名，在正文里按名插入 [47]。借鉴：具名输出作为稳定 id。
- **Manubot**：稿件在 git 里，按 DOI、PMID 引用，用 OpenTimestamps 给输出打时间戳，BSD-3 [48]。借鉴：引用以标识符为准。
- **Stencila**：记录哪些文字由 AI 生成、哪些由人写 [49]。借鉴：绑定里记作者是人还是哪个 AI 角色。
- **W3C PROV-O**：实体、活动、执行者，关系 wasGeneratedBy、used、wasDerivedFrom、wasAttributedTo [50]。借鉴：绑定结构的骨架。

### 3.6 内联 AI 改写的交互

- **Cursor（Cmd/Ctrl+K）**：选区下方弹出指令条；结果以绿增红删的差异显示，接受前不生效；可逐块接受或拒绝；Esc 关闭；只做单次精确修改，多轮讨论去聊天面板 [51]。
- **Google Docs（Gemini）**：浮动条上点"优化"，选改写、缩短、扩写、更正式、更随意、列要点、总结；在文档里逐条接受，或全部接受、全部拒绝 [52]。
- **Notion AI**："用 AI 编辑"后输入指令；保留、丢弃或重做 [53]。
- **Word Copilot**：点选区旁的图标 → 修改 → 写指令 → 保留、丢弃或重新生成，铅笔图标改指令 [54]。

共同点：就近弹出输入框，结果以差异显示在原位，用户逐处决定。ScienceScope 按原则 3 改为"直接写入、以修订标记显示、逐处可撤回"。

## 4. 推荐架构草图

### 4.1 文档模型

- **编辑会话**：打开一个文件（项目文件夹里的 docx/tex，或 `data/` 里的版本原件）形成一个编辑会话，会话内撤销和重做（与导图一致，`DECISIONS.md` 2026-10-07）。
- **统一的块结构**：两种格式都投影成"段落块"列表，每块有稳定 id、纯文本、句子切分结果和格式化内容。差异、AI 改写、来源绑定、批注都只认这层，所以一套界面能同时用于 docx 和 tex。
  - docx：块 = `w:p`；内联节点 = 文字段（加粗、斜体、上下标、字体）、**原子节点**（公式 `m:oMath`、图片 `w:drawing`、域 `w:fldChar … w:instrText`（含 Zotero、EndNote 引文）、脚注引用、书签），原子节点不可在正文里拆开编辑，只能整体移动或删除。表格：单元格里的段落可以编辑，表格结构不可改（alpha）。
  - tex：块 = 空行分隔的段落；编辑在 CodeMirror 源码里，块只用于对比、绑定和批注定位。

### 4.2 docx 进出

1. **读入**：jszip 解开文件；用 DOM 解析 `word/document.xml`、`comments.xml`、`styles.xml`；为每个 `w:p` 记下它在原 XML 里的路径和原始字节的哈希。
2. **编辑**：ProseMirror 文档节点上带 `ooxmlRef`（指回原节点）。用户和 AI 的改动都经过 ProseMirror 事务；prosemirror-changeset 实时累积"改了哪些区间"。
3. **写回**：只把 `ooxmlRef` 对应的、内容变了的段落重新序列化：没变的文字段原样复制，改动的文字段继承相邻文字段的 `w:rPr`（中文段落要保留 `w:eastAsia` 字体，推断这是最容易出错的地方）。其他部件（页眉页脚、`numbering.xml`、媒体、自定义 XML）字节不变。批注写入 `comments.xml`，正文放 `commentRangeStart` / `commentRangeEnd` / `commentReference`，三者共用一个 id [55]；新批注的 XML 片段可以用 docx（dolanmiu）的批注支持生成 [20]。
4. **修订的处理**：文件里已有的 `w:ins` / `w:del` 作为只读的原子区间保留并显示（alpha）；把 AI 改动导出成 Word 修订放到以后。
5. **公式**：OMML 用 omml2mathml（微软 XSL 的 JS 移植，浏览器和 Node 都能用，许可证页面未写，需核实 [56]）转 MathML 显示；WebView2 基于 Chromium，能显示 MathML Core（推断，需在目标机器上确认）。以后编辑公式：显示 LaTeX 输入框，用 docx 的 `latexToMath` [20] 生成新 OMML。
6. **写到哪里**：用户点保存才写回原文件（"用户要求时才改他的文档"）；写之前先把旧文件复制成版本图里的一个版本（`data/projects/<p>/versions/…`），所以原件永远可以找回。

### 4.3 tex 进出

- 直接读写文本；`workspace` 的文本操作（`replace` 的 `find → with`）就够用，AI 改写走同一个接口。
- 应用内批注和来源绑定**不写进 tex 文件**，存在 SQLite，用引文锚点（`quote.exact/prefix/suffix` 加段落号）定位；文件在应用外被改时，用 `quote` 重新定位，找不到就标为"失去锚点"，不猜。
- 编译（可选）：`tectonic --synctex -o <data/temp/build/<会话>> main.tex`，输出和日志都放 `data/` 下，不写项目文件夹；PDF 用现有 pdf.js 预览。

### 4.4 版本、分支与版本图

- 沿用 `version_groups` / `manuscript_versions`（迁移 015–016），新加一个迁移：
  - `manuscript_versions.parent_ids`（JSON 数组，一个父版本是派生，两个是合并）、`tier`（如：草稿、内部审阅、投稿、修回、终稿，用户可改名）、`branch`（分支标签）、`label`（类似 Overleaf 的标签 [43]）。
  - 边由 `parent_ids` 推出，不另建表；右键箭头显示这条边的对比摘要和备注（存在子版本的说明里）。
- "上一版改动后自动生成新版本"：编辑台保存时，如果内容哈希和最新版本不同，就新建一个版本，父版本是打开时的那一版；这样从旧版本打开再保存，自然形成分支。
- 版本图窗口：原生二级窗口（沿用 R4-5c 的窗口机制），节点按时间纵向、分支横向排开；布局可以复用导图的布局代码，或者用简单的"泳道"算法（推断，几十个节点不需要图布局库）。
- 编辑会话里的细粒度改动记在 `revisions`，退出会话时合成一个版本；`resource_snapshots` 继续管其他工作区资源。

### 4.5 差异算法（同格式两个版本）

1. 两边都切成块，再用 `Intl.Segmenter('zh', {granularity: 'sentence'})` 切句。
2. **句子对齐**：把句子归一化（去多余空白、统一全半角标点）后算哈希，用 `diffArrays` 对齐句子序列；相同的句子直接配对。
3. **相似配对**：剩下的未配对句子，在相邻窗口内按字符二元组的相似度配对（阈值约 0.5，推断，需在真实稿件上调）；配上的算"修改"，配不上的算"新增"或"删除"。
4. **句内比较**：配对句子内部用词粒度（现有 `compareText`），可选用 diff-match-patch 的语义清理把零碎改动并成块。
5. **移动检测**（以后）：被删除的句子如果在别处原样出现，标为"移动"而不是一删一增。
6. 显示：左旧右新，按句子对齐行；旧版多出的淡暗红，新版多出的淡黄，颜色走设计令牌。改动列表在侧栏，可跳到下一处。
- 一处改动最多影响一句；`changeSummary` 改为按句子配对生成，秘书写版本说明也更省 token（推断）。

### 4.6 AI 改写流程

1. 用户划选 → 选区旁弹出指令框（常用项：润色、精简、更正式、改成英文、检查数据）；右键才弹出二级菜单（来源、批注、绑定）。
2. 界面把 `{文档 id, 块 id, 选区的 quote 锚点, 指令}` 交给当前对话的主专家（或编辑台秘书），用的是**所有角色共用的工具**，例如新增工作区资源 `manuscript`，操作 `replace`（`anchor` + `with`）、`comment`、`bind`。
3. 工具调用直接修改编辑会话，改动以 suggest-changes 的插入、删除标记显示，带角色名和时间；用户可逐处撤回或全部保留。离开会话时生成版本（原则 3：直接生效，留历史）。
4. 专家用 `workspace_read` 分页读整篇稿件和资料，不加长度上限（原则 4）。

### 4.7 来源绑定的数据结构

```json
{
  "id": "bnd_…",
  "documentId": "<版本组或文件>", "versionId": "<绑定时的版本>",
  "anchor": { "block": "p_0123", "quote": { "exact": "12.4%", "prefix": "增长了", "suffix": "，显著" } },
  "kind": "number | figure | table | claim | text",
  "value": "12.4%",
  "sources": [ { "schema": 1, "kind": "project-file", "projectId": "…", "path": "data/raw.csv" },
               { "schema": 1, "kind": "chunk", "sourceId": "…", "location": { "page": 4 } } ],
  "derivation": { "script": { "schema": 1, "kind": "script", "path": "analysis/fit.py" },
                  "command": "…", "inputs": ["…"], "outputs": ["…"], "messageId": "…" },
  "note": "一句话说明含义",
  "attributedTo": "user | agent:<参与者 id>", "createdAt": "…"
}
```

- 对应 PROV：`value` 是实体，`derivation` 是活动（used = inputs，wasGeneratedBy = 这次运行），`attributedTo` 是执行者 [50]。
- 存放：新表 `manuscript_bindings`（迁移）；`sources`、`script` 都是 schema 1 引用对象，跳转复用日志和版本说明的打开逻辑。
- 锚点只放 `data/`，不往用户文件写隐藏标记；换版本时用 `quote` 重新定位，找不到就提示重新绑定。docx 书签锚点由用户决定（第 6 节）。

### 4.8 复用现有资源

版本图节点和元数据沿用 `versions` 资源与 `version_groups` / `manuscript_versions`，版本说明继续由秘书整理；句内比较沿用 `app/services/versions/comparison.js` 的 `compareText`，`changeSummary` 改成按句子配对后继续给秘书用；来源绑定、批注关联和跳转用 `app/core/references.js` 的 schema 1 引用；划选弹框复用 R4-2 的 `mark-selection.js`；会话内修订和恢复用 `revisions`、`resource_snapshots`、`workspace_versions`；版式视图、PDF 和 tex 编辑用现有的 docx-preview、pdf.js、CodeMirror；版本图窗口用全局助手的原生二级窗口机制。

## 5. 分阶段建议

| 阶段 | 内容 | 估计 |
|---|---|---|
| E0 试验（先做） | ① eigenpal 在 Preact 里挂载并往返 3 份真实稿件；② 自研原位回写的最小原型（改一段、保存、比较 XML）；③ 句子对齐在两份真实修订稿上的效果。按结果在 ①② 中选一 | 2–3 天 |
| E1（alpha） | 编辑台入口和布局；docx 正文、标题、列表、表格文字编辑，原子节点保留；docx 原生批注读写；tex 源码编辑和应用内批注；保存即生成版本 | 3–4 个任务书 |
| E2（alpha） | 版本图窗口（派生、分支、层级、标签、元数据）；两层对齐的并排对比 | 2 个任务书 |
| E3（alpha） | 划选 → 指令框 → 共用工具改写，修订标记显示和撤回；来源绑定（文本片段、右键查看、跳转、用户手动绑定） | 2–3 个任务书 |
| alpha 之后 | 公式编辑；AI 改动导出为 Word 修订；分支合并；Tectonic 下载和 SyncTeX；图表重跑脚本；移动检测；表格结构编辑 | — |

E1–E3 都要拆成多个任务书；docx 写回风险最大，先于界面细节完成。

## 6. 风险与待验证

| 风险 | 怎么验证 |
|---|---|
| docx 写回后 Word / WPS 报"内容有问题"，或改动段落丢失中文字体 | 3 份真实稿件（中文学位论文、英文期刊稿、带 Zotero 引文和大量公式的稿件）：打开 → 改一句 → 保存；解压比较，除改动段落外所有部件字节相同，改动段落的 `w:rFonts`（`w:eastAsia`）与相邻文字段一致；Word 和 WPS 各打开一次，不出现修复提示 |
| 引文域（Zotero、EndNote）、已有修订和批注被破坏 | 改动含引文的段落后在 Word 里用 Zotero 刷新，引文仍能识别；带修订和批注的稿件往返后仍可接受、拒绝，批注不成孤儿 |
| eigenpal 的许可证范围和 Preact 兼容 | 读仓库 LICENSE 和 `packages/pro` 的许可文本；只挂载框架无关的核心，不行再试 preact/compat；记录包体积和启动时间 |
| omml2mathml 许可证和公式显示 | 读仓库 LICENSE；用矩阵、分段函数、多行对齐公式在 WebView2 里截图对比 Word |
| 中文句子对齐的效果 | 同一篇论文的两版（改句、删段、插段、调换段落）跑对比，人工检查误标；测"！？……"和引号内句号的断句 |
| 长稿件性能 | 8 GB 内存的 Windows 机器上打开 100 页 docx，记录打开、输入、保存和对比耗时 |
| Tectonic 的缓存位置、中文、离线和下载源 | 把缓存目录设到 `data/`（查其环境变量或配置）；编译 xeCJK + Windows 中文字体的文档；断网后用 `--only-cached` 再编译；包默认从海外下载（推断），需找镜像或预置，没有镜像时在报告里写明 |
| 来源绑定锚点在多轮改写后失效 | 绑定 20 处数字，连续 10 次 AI 改写加一次外部编辑，统计仍能定位的比例 |
| 是否往用户 docx 里写书签作锚点 | 交给用户决定：书签更稳，但会在用户文件里留下 ScienceScope 的痕迹 |

## 7. 参考资料

1. SuperDoc README：https://cdn.jsdelivr.net/npm/superdoc@2.11.0/README.md
2. SuperDoc 项目概况：https://www.sourcepulse.org/projects/24793521
3. SuperDoc AGENTS.md：https://cdn.jsdelivr.net/npm/superdoc@1.45.0/AGENTS.md
4. eigenpal docx-editor 仓库：https://github.com/eigenpal/docx-editor
5. eigenpal docx-editor 介绍页：https://www.everydev.ai/tools/docx-editor
6. eigenpal docx-editor 项目概况：https://www.sourcepulse.org/projects/30074480
7. ONLYOFFICE Docs 9.4 许可更新：https://www.it-connect.tech/onlyoffice-docs-9-4-drops-the-20-connection-limit-and-updates-its-open-source-license/
8. ONLYOFFICE 桌面版 Windows 包体积：https://wapt.tranquil.it/store/en/details/tis-onlyoffice-desktop_9.1.0.168-11_x86_windows_6.1_PROD.wapt
9. LibreOffice 下载页：https://www.libreoffice.org/download/download-libreoffice/
10. Univer Docs 导入导出：https://docs.univer.ai/guides/docs/features/import-export
11. CKEditor 5 Import from Word：https://unpkg.com/@ckeditor/ckeditor5-import-word@48.3.0/README.md
12. Tiptap 转换：https://tiptap.dev/product/conversion
13. Syncfusion 社区许可：https://www.syncfusion.com/sales/communitylicense
14. pandoc 手册：https://pandoc.org/MANUAL.html
15. pandoc 问题 9833：https://github.com/jgm/pandoc/issues/9833
16. pandiff 生成 Word 修订：https://slhck.info/software/2026/01/14/pandiff-word-track-changes-markdown.html
17. mammoth README：https://cdn.jsdelivr.net/npm/mammoth@1.13.0/README.md
18. docx-preview 包信息：https://depscope.dev/pkg/npm/docx-preview
19. docx（dolanmiu）概况：https://gittrend.io/repo/dolanmiu/docx
20. docx（dolanmiu）发布记录：https://github.com/dolanmiu/docx/releases
21. Overleaf 新源码编辑器：https://www.overleaf.com/blog/towards-the-future-a-new-source-editor
22. lang-tex：https://npmjs.com/package/lang-tex
23. Overleaf 社区版许可和自托管：https://openapps.pro/apps/overleaf
24. texlab README：https://tug.ctan.org/support/texlab/README.md
25. Tectonic crate 信息：https://lib.rs/crates/tectonic
26. Tectonic 安装文档：https://docs.rs/crate/tectonic/0.17.0/source/docs/src/getting-started/install.md
27. Tectonic v1 命令行参考：https://docs.rs/crate/tectonic/0.17.0/source/docs/src/ref/v1cli.md
28. MiKTeX 安装说明：https://miktex.org/howto/install-miktex
29. SwiftLaTeX 项目信息：https://awesome.ecosyste.ms/api/v1/projects/github.com%2Fswiftlatex%2Fswiftlatex
30. synctex-js：https://www.npmjs.com/package/synctex-js
31. latexdiff CTAN 公告：https://www.ctan.org/ctan-ann/id/mailman.4641.1355843680.2390.ctan-ann@dante.de
32. prosemirror-changeset README：https://cdn.jsdelivr.net/npm/prosemirror-changeset@2.4.1/README.md
33. prosemirror-suggest-changes 包信息：https://www.jsdelivr.com/package/npm/@handlewithcare/prosemirror-suggest-changes
34. prosemirror-suggest-changes README：https://cdn.jsdelivr.net/npm/@handlewithcare/prosemirror-suggest-changes@0.1.8/README.md
35. Tiptap 开源与平台：https://tiptap.dev/open-source-to-platform
36. Tiptap 原生 JS 安装：https://tiptap.dev/docs/editor/getting-started/install/vanilla-javascript.md
37. Lexical 包信息：https://openapps.pro/packages/lexical
38. BlockNote core README：https://unpkg.com/@blocknote/core@0.52.1/README.md
39. BlockNote DOCX 导出：https://www.blocknotejs.org/docs/features/export/docx
40. jsdiff README：https://cdn.jsdelivr.net/npm/diff@9.0.0/README.md
41. Intl.Segmenter 分句：https://lingo.dev/en/javascript-i18n/split-text-into-sentences
42. isomorphic-git merge 文档：https://isomorphic-git.org/docs/en/0.70.7/merge
43. Overleaf 历史与版本：https://docs.overleaf.com/writing-and-editing/history-and-versioning
44. Overleaf 付费功能：https://docs.overleaf.com/getting-started/free-and-premium-plans/premium-features
45. Draftable 价格：https://www.draftable.com/pricing
46. Quarto 行内代码：https://quarto.org/docs/computations/inline-code.html
47. Jupyter Book 输出插入：https://Jupyterbook.org/content/executable/output-insert.html
48. Manubot：https://pypi.org/project/manubot
49. Stencila 介绍：https://www.dragonfly.co.nz/news/2024-11-29-stencila
50. PROV-O 词条：https://www.casrai.org/dictionary/term/prov-o
51. Cursor Cmd+K 内联编辑：https://freeacademy.ai/es/lessons/inline-editing-cmd-k
52. Google Docs 用 Gemini 写作：https://support.google.com/docs/answer/13951448?hl=en
53. Notion AI 写文档：https://www.notion.com/help/guides/notion-ai-for-docs
54. Word Copilot 改写选中文字：https://insider.microsoft365.com/en-us/blog/revamp-and-refine-selected-text-using-draft-with-copilot-in-word
55. Open XML 插入批注：https://learn.microsoft.com/en-us/office/open-xml/word/how-to-insert-a-comment-into-a-word-processing-document
56. omml2mathml README：https://cdn.jsdelivr.net/npm/omml2mathml@1.3.0/README.md
