# 实施记录

## 2026-10-26 U7 编辑台版本树（Claude）

- `app/ui/version-layout.js` 纯函数排版：行是代数；子版本里和父版本同分支的（没有就取第一个）留在父版本那一列，其他子版本各开新列；收起的分支不占列，在父版本旁画一个「分支名 · N 版」。node 测试 3 组（主线和两条分支的列行、收起后列数和计数、当前版本到 v1 的路径）。
- `components/version-tree.js` 读 `GET /api/version-groups/:id/graph`，`versionsVersion` 变了就重读。详情的层级用 ChoiceMenu；改名、层级走 `PATCH /api/versions/:id`。`description` 出现在图数据里（D10）时才显示「标记」框和「标记…」「设为重点」菜单项，所以 D10 合并不用再改界面结构。
- 「从这一版开始编辑」：桌面会话打开时如果已有打开的会话会直接返回它，所以先 `finish` 关掉当前会话，再给标签记 `from` 和 `restart`，`DeskDocument` 换 key 重开、带 `versionId`；会话开好后清掉 `from`，以后重开仍按项目文件。底栏版本号改按会话的 `baseVersionId` 显示，会话打开时重读（以前按最新版本，从旧版开始编辑时会显示错）。
- 浏览器测试 `desk-versions.browser.test.js`：外部修改成 v2、底栏打开树、改名加层级、筛选变淡、比较和退出、右键从 v1 开始编辑后底栏显示 `v1 · 主线 · 投稿`、存版本长出分支并收起展开、删除 v2、v1 有后续版本不能删。

## 2026-10-25 U6c 编辑台 PDF：批注、索引、引用到对话（Claude）

- 后端 D6 早已支持 PDF 只读标注会话，这次只做界面。PDF 打开时并行建会话；会话的块来自资料库的 PDF 解析（行拼段、去页眉页码、NFKC、去中文间空格和行尾连字符），pdf.js 文字层是原始文字项。`app/ui/pdf-text.js` 两边都去掉空白和连字符逐字比较，重复的词按前后 24 字上下文挑；node 测试 3 组（连字符、连字 ﬁ、中文间空格、页码不属任何块、跨段返回空）。
- `readers/pdf-notes.js` 提供和 docx 编辑器同名的 selection/reveal/notesAt/applyNotes/activate，`desk-notes.js`、`desk-assist.js` 把 PDF 当作按块定位的格式（和 docx 一样），工具条和右键菜单去掉格式、改写和剪切粘贴。标记是垫在文字层下的框，用页面百分比定位，`textlayerrendered` 时重画；点击按坐标查框。
- 发现 pdf.js 的 `.page` 被全局 `box-sizing: border-box` 压窄 18px，画布比文字层窄，划选高亮越往行尾越偏右（约 2%）；`document-readers.css` 给 `.pdfViewer .page` 改回 content-box，资料库等所有 PDF 预览都对齐了。
- 功能区「引用到对话」（阅览和审阅两处）接上了，以前是停用的占位；关 PDF 文稿时不再走写回询问。
- 浏览器测试 `desk-pdf.browser.test.js`：功能区加批注、右键加索引（选 data 文件）、双击选词后工具条只有三项并引用到对话、点标记亮卡片、第二页批注定位、关闭不问写回且 PDF 字节不变、重开标记还在。

## 2026-10-25 U6b 编辑台 md：渲染视图直接编辑（Claude）

- 没用 prosemirror-markdown：它要 markdown-it，读法会和只读视图（marked）不一样。`app/ui/md-blocks.js` 直接用 marked 的词法结果建 ProseMirror 块，每块记源码文字、前面的空白和逐字位置对照；全部顶层块拼回来和源码逐字相同。仓库里所有文档逐块读出再写回都和原文一致，随机编辑后写回也都能读回同样的内容（node 测试 4 组，另用随机编辑脚本跑过约 2700 次）。
- 写回只重写改过的块：先原样写、读回比较，不同再转义，再不同把强调边上的全角标点挪到记号外；比较时忽略写法（记号、链接写法、空白落在强调边上）。改过的列表保留没改的项原文。新旧文字用逐字差异写进 CodeMirror，同段别处的批注范围不受影响；userEvent 用 `input.type`，连续打字合成一步撤销。
- 页面 `readers/md-page.js` 不自带历史：Ctrl+Z 在源码上撤销，再按块重读页面，光标放到改动处。源码从别处变了（源码视图、服务端改写）也按块重读，只换文字变了的块。批注装饰只在真的变了时才派发事务，否则会抢在页面读到新选区之前把旧选区放回去（测试里 Shift+方向键丢一步就是这个）。
- `desk-document.js`：md 的源码和页面同时挂着，视图切换就地进行；选区、定位、复制粘贴、批注查询等命令在页面显示时转给页面。打开过程中切换的视图在挂好后补上；功能区在新文稿报状态前画按钮不再报错。新增依赖 prosemirror-schema-list 1.5.1（MIT）。
- 浏览器测试 `desk-md.browser.test.js`：加粗、打字、撤销重做、列表回车、公式编辑、页面加批注后源码里同一处有标记、保存后只有改过的三处不同、源码里加一项回到页面可见。原有 md 的三个测试先切到源码。

## 2026-10-25 U6a 编辑台 tex：实时渲染、公式编辑框、编译（Claude）

- 渲染没用 LaTeX.js（不再维护、包约 14 MB、宏包支持零散），自写了常用命令的转换 `app/ui/tex-render.js`：先把注释换成等长空白（位置不变），再按空行和块级命令切块，每块记源码起止；两遍处理，第一遍编号、收集 `\label` 和 thebibliography，第二遍解析引用。公式交给 KaTeX；align/gather 改成带星号的环境逐行加 `\tag`，这样 KaTeX 不会自己再编一套号。半截输入（没闭合的括号、没写 `\end` 的环境）只影响所在段落。node 测试 11 组。
- 渲染栏 `readers/tex-split.js`：按块复用元素，打字时不整页重画；滚动联动用块上下沿做分段线性对应，谁最后被滚动、点击或按键谁带头，避免两边互相回弹。tex 的视图切换不再重开编辑器（只有 md 的渲染视图还是另一个阅读器）。
- 公式编辑框 `components/desk-formula.js`：MathLive 0.111.0（MIT，2026-09-30），只多一个 `mathlive.min.mjs`，字体和 KaTeX 的 20 个 woff2 逐字节相同，直接指向 `/vendor/katex/fonts`，所以安装包只多 3 个文件；第一次点公式时才加载。写回只替换公式这一段，两端的 `\label` 和空白不动；没改就「应用」不产生修改。
- 编译：先走保存（带原有的确认和外部修改处理），再调 D7；章节文件的主文件不唯一时用 `ask` 让人选。PDF 必须在显示后再挂载，否则 pdf.js 按 0 宽度排版是一片空白。云端装了 texlive-latex-base 真编译一份英文稿：0.8–1.3 秒出 PDF，页面和 PDF 的结构一致。浏览器测试用假 TeX 测错误列表（`createApp` 加了只给测试用的 `deskOptions`）。
- 浏览器测试 `desk-tex.browser.test.js` 3 个：并排、打字、加粗、视图、滚动联动、点段落定位；公式编辑写回和撤销、模板、取消、插入新公式；编译先写回、错误列表跳行。U1 测试改成并排和带编号的大纲。
- 还没有：多行公式的可视化编辑、页面里的图片、SyncTeX 逐行对照、PDF 缩放按钮；md 渲染视图直接编辑是 U6b，PDF 标记是 U6c。

## 2026-10-25 SH1 PowerShell 5 后台输出（Codex，Claude 审）

- 原因：PS5 执行前已有一份可继承的 stdout 副本，经 native launcher 传给后台进程，后台不退出时管道一直不结束，前台要等到超时；PS7 的 Node 场景没有这份副本。
- 修复（`shell.js`、`windows-shell-job.cs`）：PS5 的 stdout/stderr 直接追加到工具输出文件，主 shell 退出就返回，后台继续写；无 Job 时停止改用内置 PS5 核验进程身份，先停根进程再复查后代，确认不了返回 `SHELL_STOP_FAILED`。PS7、Linux 和默认超时不变。
- 对照：PS5 Node 5.564→0.577 秒，Start-Process 5.285→0.508 秒，PS7 Node 0.778→0.664 秒；Windows 干净检出完整检查 503/503，安装版真实模型跑一次 shell 967 毫秒返回、后台继续输出。
- 遗留：PS7 重定向 Start-Process 的原有超时未改；无 Job 时首次快照前已退出的中间父进程仍追溯不到。

## 2026-10-25 U5A 编辑台批注与索引的 Windows 验收（Codex，Claude 修界面）

- Sol 在 main@675edbd 上验收，没改代码：Windows `npm run check` 521/521；Word 往返（改批注、加批注、跨段批注、删字撤销后保存）不提示修复、没有空批注，索引不进 Word；md 回复和已解决重开保留；原生窗口里预览、消息跳转、「查看索引」都通过。
- 真跑（`deepseek-v4.1-flash`，全新安装）：润色 3 次请求 21,943 token；专家加索引和批注 3 次请求 31,010 token；版本说明 2 次请求 13,886 token。
- Claude 修了交回的三处：中文 Word 的标题（样式 id 是「1」「2」）按 `styles.xml` 里的样式名、大纲级别和基于的样式认出来，进大纲；「看改了什么」弹窗打开时浮动工具条收起，弹窗里的点击和右键不再当成正文的；专家只加批注或索引时不再提示「改写了 N 段」（`desk.changed` 带上每条修改的 `ops`）。

## 2026-10-25 U5 编辑台批注与索引（Claude）

- 右侧栏「批注与索引」在 `components/desk-notes.js`，索引选择框 `components/desk-index-picker.js`（用现有的列表、分段按钮、标签和对话框拼的，画廊的设计稿等 Yui 看过截图再补）；编辑器里的标记在 `readers/desk-notes.js`，docx 的位置换算挪到 `readers/desk-positions.js`。新图标 `reply`。
- 「全删才删、撤销一起恢复」只靠 D6 做不到：服务端在撤销前就把条目删了，撤销回来的字带不回它；md 拆段时范围也会丢。于是补了一小段后端（Yui 同意由 Claude 改）：同步时带上编辑器里的范围，被碰到的块以编辑器为准；这一会话里因改字删掉的条目，送回的范围上文字和原来一样时按原 id 恢复；碰到的段落里没有条目的 Word 批注标记存盘前去掉。有 node 测试（`annotation-editor.test.js`）。
- md/tex 的标记是 CodeMirror 状态字段，撤销时用 `invertedEffects` 把被碰到的范围放回；docx 的索引是 ProseMirror mark，Word 批注按会话里的起止标记画。服务端列表变了重读，本地还有没发出去的修改时稍后再放标记，免得盖掉刚打的字。
- 测试时顺手修了几处：会话从服务端重取段落会冲掉页上的索引标记；`useDeskAssist` 的 effect 每次渲染都取消待读的选区，浮动工具条偶尔不出现；点对话框里的按钮后浮动工具条又冒出来；索引框文件列表只有一项时行被拉高。删字带走回复时不再把回复算进条数。
- 还没有：PDF 的批注和索引（U6）、@专家；Word 批注往返在 Windows 上的验收留给 Sol。

## 2026-10-25 U4 编辑台改写交互（Claude）

- 浮动工具条、右键菜单、专家修改提示条在 `components/desk-assist.js`，纯逻辑 `desk-assist.js` 有 node 测试；编辑器加了选区、句子、按坐标放光标、定位高亮。md/tex 的块切分挪到 `app/shared/text-blocks.js`，前后端共用。
- 进度放在底部提示条里（「专家正在改写…」可停止），不放在工具条上：工具条跟着选区走，选区一变就会消失。「看改了什么」先用对话框按词显示改前改后，不进比较视图（比较视图比的是两个版本，这时还没存版本）。
- 没绑对话时改写和引用自动绑到项目最新的对话，没有就新建「编辑台」对话。
- 修了一个老问题：提交后回调里记的新事件会先发出，事件流按序号去重把前一个丢掉，表现为发言失败（如没设置模型）时窗口收不到 `turn.ended`、一直显示在等。`core/db/database.js` 改成提交回调期间新加的回调排队，补了测试。
- 修了 D3c 的「接续对话」选错对话：项目里最近的对话可能是任务秘书的临时对话「文献版本整理」（导入版本后自动建的），改写请求会发给秘书。现在和左栏一样，跳过归档、临时、附属和全局助手的对话。
- 还没有：批注和索引（U5）、在版本树里定位（U7）；全新安装加服务商后的真跑留给 Sol。

## 2026-10-25 U3 编辑台并排比较（Claude）

- 新组件 `version-compare.js`（编辑台「审阅 → 比较」和工作台版本比较页共用），读 D4 的 `/diff` 结果；纯逻辑 `desk-compare.js` 有 node 测试，页面由 `readers/desk-compare-page.js` 直接画 DOM。
- Yui 加的需求：两页中缝放锁定/解锁按钮，代替设计稿比较栏里的「同步滚动」开关；设计稿 PageDeskCompare 同步改了（`build/desk/gen.py`），图标加了 lock、lock-open。
- 后端小改：diff 的 docx 块带 `cell`，和会话返回的一样（抽成 `model.js` 的 `cellPlace`）。原子的画法从 `desk-editor.js` 抽到 `desk-atoms.js`。
- 工作台版本比较页去掉了「统一差异」视图和页内说明卡片，改成页头的「版本说明」按钮转到说明页；`/compare` 接口暂留。
- 还没有：版本树里右键比较、和未存版本的草稿比较、比较页显示图片。

## 2026-10-24 U2 编辑台直接编辑（Claude）

- docx 用 ProseMirror 按页面编辑，md、tex 用 CodeMirror 编辑源码；依赖（prosemirror-model/state/view/transform/commands/keymap/history、@codemirror/commands，均锁定版本）打进现有的 `readers/vendor.js`。
- 段落和服务器块之间的转换、比较、提交内容和合并放在不依赖编辑器的 `desk-blocks.js`，同步控制在 `desk-session.js`，都有 node 测试；编辑器本体在 `readers/desk-editor.js`。
- 后端两处小改：docx 块返回 `cell:{table,row,cell}`（表格单元格的位置）和 `section:true`（分节符段落）；打开时 `DESK_EXTERNAL_CHANGE` 的 details 加 `sessionId`。界面的 `ApiError` 带上 `details`，事件目录加 `desk.changed`、`desk.session`。
- md 默认改成源码视图（渲染视图到 U6 才能编辑，现在是按会话内容显示的只读预览）；历史版本标签仍只读。
- 调试中发现：两次在同一个两秒内生成的 docx 字节完全相同（ZIP 时间精度），测试里的「外部修改」改成写不同内容。
- 还没有：段落样式、列表、Shift+Enter 换行、增删表格行列；切换标签会丢撤销历史（会话和修改都在）。

## 2026-10-24 R6c 审查合并（Claude）

- 服务商 header 改存引用后，旧的设置界面会把引用显示成 `[object Object]`，再保存一次就把这串字当成新值覆盖掉密钥。改成和 MCP 一样的逐行编辑：已保存的显示「已保存在密钥文件 · 更换」，原样回传引用；行编辑组件抽成 `secret-rows.js`，MCP 和服务商共用。浏览器测试补了「编辑后再保存，引用和密钥都不变」。
- 合并后云端检查 467 项通过（8 项仅限 Windows 跳过）。留给之后：文件数比目标多 191 个；Windows 自带 PowerShell 5 下后台进程占着输出、命令要等到超时才返回（基线就有）。

## 2026-10-24 R6c 安装提速与服务商 header 凭据（Codex）

- 第一段：纯 JS 依赖共享打包，原生与路径资源保留；安装按清单差集清理，shell Job 随包预编译。暂存功能冒烟与 Windows 清单删除测试通过；完整安装对照见 RELEASE。
- 第二段：服务商 header 值进入凭据，设置及未来工具记录只保留引用或移除标记；按用户授权清理四张历史表和旧运行时会话，先备份、保持行数及其他内容，支持中断后重跑。
- 验收查明导出重名测试依赖两次操作在同一分钟，改为只固定测试 Date；PS5 后台 stdout 持柄在基线同样复现，PS7 对照通过，超时时长和 shell 行为保持，定位材料交 Claude。
- 干净检出国内源 npm ci 后完整检查 474/474（含 Windows，零跳过），Rust 13/13；安装版功能通过，真实 flash 2 次请求、11,845 tokens。文件 13,487→3,191；新装/覆盖/更新重开 54.598/72.631/109.056 秒，A 数据保持与失败重试通过；文件数超目标 191，详见 RELEASE。

## 2026-10-24 设置页按设计稿实现（Claude）

- 设置改成居中弹窗，盖在原页面上，关掉回到原页；导航按设计稿分四组。所有改动立即生效，保存按钮全部去掉；文字框停一秒或离开时保存，关掉弹窗前没到一秒的输入也会保存。
- 补上之前没有入口的设置：导出全部数据、检查更新与更新提示、沿关系扩展、论文卡片模型、TeX 引擎、稿件分级改名、新对话默认执行方式（新设置 `approvals.defaultApproval`，输入框的默认执行方式跟它走）。
- Python 下载源按 Yui 的要求可以添加、修改、删除自己的源，保存前先试连（新接口 `POST /api/python/probe`，避免浏览器跨域）；连不上可以仍然保存。导出完成后打开文件夹走新接口 `POST /api/export/all/:jobId/open`，只开已完成的导出。
- 专家改为列表加详情页，主专家、秘书、助手共用详情页；删掉旧的 `settings-memory.js`。英文界面里「约 N 万字 / N 万 token」改成按千换算。
- 十二个浏览器测试按新界面改写；语义检索开关改为跟随设置立即切换，不等状态推送。

## 2026-10-24 设置页设计稿补齐（Claude，待用户审稿）

- 设置导航分四组：个人（通用、外观、快捷键）、研究协作（模型与服务商、专家、任务秘书、全局助手、执行与批准）、工具（工具、技能、MCP 服务器）、资料与环境（知识库与检索、编辑台、Python 环境、数据与备份），最后是关于。人格与记忆并进专家；总是允许的规则移到执行与批准；运行环境拆成知识库与检索、Python 环境、数据与备份。
- 新增十四张整页稿和一张更新提示卡，补上之前没有入口的设置：导出全部数据、检查更新、沿关系扩展、论文卡片、TeX 引擎、稿件分级。生成脚本 `docs/design/system/build/settings/gen.py`，导航共用 `settings/nav.py`。
- 执行与批准里的「新对话默认」执行方式目前后端写死为请求批准，实现时要加一个设置键。

## 2026-10-24 R6b 审查合并（Claude）

- shell 的 Job 守护程序第一次使用时，要用系统自带的 .NET 编译器现场编译。原来编译失败的话，所有命令都跑不了；现在编译失败时退回旧做法，用 `taskkill /T` 结束进程树，命令照样能跑。
- 发布说明脚本找上一个版本标签时，会把旧线留下的 `v0-prototype` 也当成版本，在带着这个标签的检出上测试会失败。改为只认 `v1.2.3` 这样的版本号，测试夹具也隔开了外层仓库的标签。云端检查 455 项通过，失败的就是这一项，修后单独重跑通过。
- 演练里更新要 15 分钟，覆盖安装要 23.6 分钟，太慢了，记进 P4：要减少安装文件数。另外两个改进也留到之后：守护程序在打包时就预先编译好；把更新提示接进界面。

## 2026-10-24 R6b 更新通道与升级演练（Codex）

- 增加原生更新桥接、24 小时自动检查、完整下载及签名校验后关闭宿主/WAL，再按当前安装目录更新重开；界面由 Claude 接入，提交版本保持 alpha.0。
- 打包检查并统一三处版本，新增本地发布清单/说明草稿；安装器提供双语最低配置提示，模拟参数只在测试产品启用。
- 完整检查发现已有 shell 父进程退出后遗留子进程，获授权后用 Windows Job 守护修复，正常后台行为保留，独立提交 ea06134；干净检出检查 463/463、原生测试 13/13、shell 定向 6/6 通过。
- A 通道升级与三种失败、B 旧数据迁移/备份及两项最低配置提示通过；数据、耗时、截图位置和夹具恢复见 [RELEASE 验收记录](../handoff/RELEASE.md)。私钥留仓库外，未创建 Release、未上传安装包，现有预览安装与数据不动。

## 2026-10-24 设计稿入库：主窗口统一外壳，补八张稿（Claude，2026-10-22 做）

- Yui 指出画廊没跟上：编辑台入口不在任何页面稿里，各页标题栏和左栏也不一致。新脚本 `build/shell/gen.py` 生成同一份标题栏（加窗口置顶，右侧写当前项目名）和左栏（工作站右边的简报按钮、工作站下面的编辑台入口、末尾全部对话、底部全局助手），换进所有主窗口整页稿；对话页头改成和应用一致（查找、项目置顶摘要 Alt S、任务秘书、⋯）。要在 `build/assemble.py` 之后运行。
- 新增 `TitleBar`、`PageHome`、`PageAllChats`、`PageWorkbench`（含版本树侧栏，导图向左拉伸）、`PageMap`、`PageJournal`、`ProjectSummary`、`AssistantWindow`。原计划的「文献版本」页不做，编辑台的版本树和比较已经覆盖。
- 删掉画廊里自动化的残留（Button、Callout、Composer、Menu、ModeMenu、Badge、PageChat）；样式表里的 `--auto` 类先留着。只改设计稿，没动应用代码，没跑测试。

## 2026-10-23 R5 审查合并（Claude）

- 修了 Sol 留下的标记界面问题：选中文字的监听原来随消息列表重新订阅，新消息刚渲染出来就被选中时，监听还拿着旧列表，所以找不到消息。现在只订阅一次，通过 ref 读最新状态；测试在下一次选择前，先等上一个弹窗关掉。
- 导出脱敏原来把每个 header 值都当成文本，在全库里替换。像 `anthropic-version: 2023-06-01`、`Accept: application/json` 这类 header，会把对话里所有同样的日期和类型名一起抹掉。现在 header 字段本身照旧一律替换；其他文本里只替换像令牌的值（至少 8 个字符，不含空格，不是日期、版本号或 MIME 类型），补了对应测试。

## 2026-10-24 R5 第二段：全量导出（Codex）

- 增加后台导出服务与开始/查询/取消接口；对话、项目、知识、专家、技能和设置生成MD/JSON/原件，SQLite通过VACUUM快照导出；进度节流、退出取消、未完成标记和重名序号已接通。
- 按用户决定替换服务商header和MCP明文header/env，包含当前、历史及事件副本；原库与行数不变，二次VACUUM清除旧页。假密钥逐文件、逐表核对，普通metadata与引用保留。
- 修复Windows流关闭/目录改名、长文件名扩展与UTF-8边界、图片原件根目录；专项8/8、lint/types通过。干净检出452通过、1个既有标记UI竞态失败、0跳过，具体诊断交Claude。
- 测试包93.50MiB，全新安装210秒；真实flash 1请求5739 tokens、安装版导出与退出通过。2万资料导出40083文件81.34MiB耗时22分56.6秒，检索P95 2.48ms；[审阅报告](../handoff/reports/R5.md)随分支提供全部结果。

## 2026-10-24 R5 第一段：删除旧线（Codex）

- 删除原型代码、测试、启动文件和两个DSH开发依赖；锁文件移除377项，保留依赖版本及下载地址不变。删除前main提交已记入DECISIONS。
- 原生统一NewAppLaunch，去掉旧宿主环境变量和分支，开发frontendDist指向app/ui；保留视觉基线、内置Python清单和历史文档。
- 裁剪测试通过，离线cargo test 6/6通过；旧路径剩余界面来源注释和合成测试路径列入报告，界面组件与样式不改。全量导出及最终检查另段交付。

## 2026-10-23 KB-2c 审查合并（Claude）

- 看了两段式扫描、后台队列、移动配对和「已编辑就两条都保留」的实现，和任务书一致，没有要改的代码。云端全量检查 442 通过、3 跳过、0 失败（2,000 个文件的测试在 Linux 上约 9.5 秒）。检索扩展按带向量重评结果默认开。任务书移到 done/，路线图同步。

## 2026-10-23 KB-2c 两段式项目文件扫描（Codex）

- 建档每500项一个事务，只写资料和文件名FTS；后台并发2单次读取完成哈希/副本，快照和解析一起提交，queued持久恢复。增加GET状态及每秒最多一次progress；UI仅登记该事件，无依赖或迁移。
- 首段唯一大小/时间戳移动保留ID；后台哈希匹配未编辑者合回旧ID，已编辑者保留双方及引用、旧条目转资料库副本。改绑目录重新核实、归档暂停/恢复、根不可读保留缺失记录；共享副本由显式cleanup回收。
- Windows混合20,000文件首段7.635秒、全程23分12秒，半程恢复10,000项且重复解析0；687次检索最长3.884毫秒。另100文件跨两次Node进程自动恢复、ID和完成事件不重、WAL/SHM清理；[审阅报告](../handoff/reports/KB-2c.md)随分支提交，原始材料留忽略目录kb-2c。第0条独立提交b8ea177。
- 首轮干净检出435/435；按main 6e19ada落实移动编辑保留并补10项回归，最终干净检出445/445（含Windows、0跳过）。最新20,000文件首段8.464秒、复制/解析0；预览安装未访问，远端模型请求及tokens均0。

## 2026-10-23 KB-2c 第 0 条：KB-7 带向量复测（Codex）

- 在 main e2b9750 上复用本机 multilingual-e5-small 跑原20题、每题12条；三组一般题均100%/100%，方法题不扩展10%/30%、B无/有处理均80%/100%，60次均hybrid，远端模型请求0。
- 按规则将 retrievalExpansion 默认改true，保留已有显式关闭；同步默认值回归及现状。原始评测留本地，结果随分支入库：[审阅报告](../handoff/reports/KB-2c.md)。本条单独提交，之后再实现扫描。

## 2026-10-23 KB-7 审查合并（Claude）

- 方法题前三没提升有两个原因：直接结果只有两三条时，四分之一上限按原结果数算出 0，图结果一条也加不进；查询命中方法实体时，用这个方法的论文仍排在综述之后。改为至少允许 1 条图结果，并把经实体找到的最强原文排在该实体之前。云端没有向量模型，只用关键词评测：方法题前三 10% → 80%，前 12 覆盖 10% → 100%，一般题不变；补了这条评测的回归测试。默认仍关，等 Sol 带向量模型重跑（并入 KB-2c 任务书第 0 条）。KB-2c 任务书已写。

## 2026-10-23 KB-7 图检索扩展（Codex）

- 加可重建邻接表、1/2 跳 PPR、原文与路径、四分之一配额和独立 300ms 降级；同候选池融合 B 留用，A 移出正式实现，settings/tool 贯通，无 UI、依赖或迁移改动。
- 固定 20 题五组对照，一般题前三/前12均100%/100%；方法题前三均10%，前12不扩展/A两组30%、B两组50%，故默认关闭。5万节点50万边，SQL一/两跳75.2/456.7ms，邻接缓存及预算过滤后最终复核55.2/102.8ms，初始化2.27s、保留堆增量约440MiB。
- 专项58/58、扩展9/9；干净检出首轮419/420，唯一长路径TeX夹具负切分修为整行79列折行，原断言不变，复跑420/420（含Windows、0跳过）。真实flash成功5请求43655 tokens，经kb_graph/read引用RDD原文（search图新增为无关旁支）；另夹具取消1请求用量未报、设置连接minimax-m3 1请求179 tokens。100%/125%截图及全部原始记录在忽略目录kb-7；PPR核对NetworkX（BSD-3-Clause），无复制代码。

## 2026-10-23 D7 审查合并（Claude）

- 在云端装了 TeX Live 真编译核对，修两处：主文件在子文件夹（如 `paper/main.tex`）时用 `\include` 会因为辅助文件目录建错而失败，搜索路径递归整个项目还可能用到项目里旧副本的章节，改为在主文件所在文件夹编译、搜索路径只加这个文件夹；TeX Live 日志 79 列折行把错误信息截成几个字，子进程设 `max_print_line=10000`（再大 bibtex 会出错），解析时也按 79 列重新接行，以防 MiKTeX 不读这个变量。
- 超时测试在容器里失败：被杀的孙进程成了没人回收的僵尸进程，测试改为把僵尸算作已结束。真编译 6 组（根目录、子文件夹带旧副本、错误定位，各有无 latexmk）都通过，项目文件夹不多文件。修后全量检查 407/3 跳过，1 条记忆页浏览器测试偶发页面报错（读到 null 的列表，与 D7 无关，单跑通过，留待修）。KB-7 任务书已写。

## 2026-10-23 D7 TeX 检测与编译（Codex）

- 新增引擎检测、主文件/引擎选择、编译与 PDF 接口；输出在独立构建目录，失败保留成功 PDF，关闭/启动清理；设置实际参与选择，UI 仅登记 desk.compiled，无新增依赖。
- 编译使用非交互、禁 shell escape 和 MiKTeX 禁自动安装参数/子进程环境；120 秒总时限结束进程树。真实 MiKTeX 长路径折行曾截断报错文件，已重组路径并补回归；假程序覆盖检测、两条编译路径、参考文献、超时、并发、PDF 与清理。
- 经用户同意，从清华镜像安装隔离的便携 MiKTeX/TeXworks；中文2.50秒、多文件编号引用4.71秒、直接引擎2.07秒；错命令0.91秒定位章节第3行，未安装chemfig约0.85秒报错、无安装弹窗且仍未安装，项目文件名/哈希均不变。专项10项、干净检出check409/409（含Windows、0跳过）通过；模型请求/token为0。参考官方MiKTeX/latexmk文档及配置读取实现，无复制第三方代码；材料在忽略目录desk-d7。

## 2026-10-23 D3c/D8 审查合并（Claude）

- 分支基于 9bbc1d6，变基到 c877827（只有实施记录冲突）。检查 396/3 跳过、0 失败。进入编辑台时挑最近对话，排除附属在别的对话下的子对话。
- 修 Sol 报的站点编辑竞态：表单按对象身份找要改的站点，设置重新载入后对象换了，保存就落空、仍是旧名称；删除站点同理。改为按名称和网址匹配，测试里在表单打开时强制重新载入设置，修复前稳定失败、修复后通过。D7 任务书已写（TeX 检测与编译）。

## 2026-10-23 D3c/D8 编辑台进入、引用定位与原生窗口（Codex）

- 新增 enter/focus 接口与两项事件，接续/分支及改绑复用会议和编辑会话；旧修改归属保留，文稿引用复用 D6 定位，TeX 跨会话重复编号按原文上下文消歧；界面只加 EVENT_TYPES。
- 原生窗口记录正常外框、显示器缩放和最大化；移动合并写入、越界居中、恢复最小化再置前；补编辑台窗口控制权限。实测发现外框直接传入内容区尺寸造成 16×9px 增长，已换算并加 Rust 回归；无新依赖或复制开源代码。
- 相关测试12/12、Rust6/6；开发构建100%/125%各10项原生检查通过，无残留进程，真实请求0。干净检出check两轮均398/399、0跳过（含Windows）：唯一失败为站点编辑，SiteForm用对象身份匹配，设置回填替换对象后保存仍发旧名称；单跑通过、受控复现成立，按UI白名单留Claude修，全检全过尚未满足；材料在忽略目录desk-d3c-d8。

## 2026-10-23 图谱筛选「只看未连接的」（Claude）

- 用户问孤立节点怎么显示：它们照常排进图里，第一次整体排列时绕在主图外圈，没有专门标记。图谱筛选加「只看未连接的」，只留没有任何关系的节点（按排布数据里的关系数），浏览器测试补一步。IDEAS 记下各页面初次进入教程、全局助手按用户的话改设置两条。

## 2026-10-22 D6 审查合并（Claude）

- D6 分支基于 e64e5b5，变基到 c2e6d31 后快进，服务端无代码改动（检查 392/3 跳过，唯一失败是下面这条已知不稳定测试，单跑通过）。
- 修 Sol 报的讨论框竞态：选人后光标原来在下一帧才放，正好落在下一次输入的全选和输入之间时会把全选折叠，新输入接在旧文字后面。改为选人时立刻写入并放光标。讨论浏览器测试连跑 10 次通过。
- D3c 与 D8 合成一份任务书（进入编辑台、跳到文稿位置、原生窗口记住位置并置前）。

## 2026-10-22 D6 丢失标注撤回补充（Codex）

- 按用户确认，撤回 annotation-lost 只恢复记录/引用并标 lost；重开保留，PATCH 新范围或原文再次唯一命中后回 anchored。DOCX lost 仅留历史，不写 comments.xml；未合并的029补非Word批注status列，工具块摘要排除未定位项，未改UI。
- 新增回归覆盖正文不变、持久恢复、手动/自动定位和Word保存；学位论文副本经Word删原文、撤回、重开、重新定位后再用Word核对通过；干净检出check 396/396、0跳过，含Windows，本次新增模型请求0；材料在忽略目录desk-d6。

## 2026-10-22 D6 批注与索引后端（Codex）

- 迁移029、统一 annotations CRUD、随文字移动/删除及同栈撤回；DOCX批注复用D2b写回，索引及其他格式批注仅存应用，PDF只读；原文重定位和 annotation-lost 记录，专家工具与摘要已接入，未改UI。
- Word 重编号并将时间取整到分钟：保留批注段落标识并匹配作者，已补回归；既有讨论 UI 的延迟光标回调覆盖新选区已受控复现，留 Claude 修。tools.js 仅补工具说明这一项白名单外接线；无新依赖，复用 JSZip（MIT）、jsdiff（BSD-3-Clause）。
- 真稿新增3批注/5索引，删光一条原文后随删、撤回恢复；Word普通打开共5条批注（含原有2条），外部插2段及11字符前缀后新增8/8定位成功、0删除。真实flash 5请求/37837 tokens/27.63 s。干净检出检查首轮393/394（上述UI竞态），原样复跑394/394、0跳过，含Windows；材料在忽略目录desk-d6。

## 2026-10-22 D5 审查合并与阶段复盘吸收（Claude）

- D5 分支基于 65e9a74，直接快进，无代码改动（检查 379/3 跳过）。留给 U4：改写接口在会议空闲时等 `turn.started`，这一轮始终没开始时请求会挂着，界面要有超时提示。
- 吸收外部阶段复盘（V01）：图谱后台排列完成和失败的事件原来没订阅，另补漏订阅的 `knowledge.changed`，加一项「界面处理的事件都已订阅」的检查；断线重连改用 `Last-Event-ID`，不再重放整段旧事件；搜索结果和证据链接带上消息 id，同一对话换目标会跟着走，较早的消息自动往前翻页（新浏览器测试）；知识侧栏的关系和历史能继续加载，悬停边按编号取证据（新接口 `GET /api/knowledge/edges/:id`）；MCP 工具名清洗或截断后加原名哈希，不再重名；三处文档矛盾已改。
- 没采纳或另排：长对话缓存回收、前端大组件拆分归 P4 和后续界面任务（编辑台 U2 时拆 `desk.js`）；`desk/storage.js` 原子写与工作区那份合并暂不做；导出范围归 R5。

## 2026-10-22 D5 专家改文稿后端（Codex）

- manuscript 工具复用 desk 会话、修改记录与撤回；原子按原样/原顺序保留，替换沿用起始格式，写回项目复用 C1 批准和始终允许规则。划选改写沿用会议队列，新增持久 desk.suggested 去重事件。
- app/app.js、server/server.js 仅补服务接线，core/references.js 仅加可选 blockId 类型；无新迁移、依赖或 UI 修改。复用现有 JSZip（MIT）与编辑台解析/写回代码，未复制外部代码。
- 相关测试10/10；干净检出 check 382/382（Windows全过、零跳过）。学位论文7932块真实 flash 四步通过：改一句4请求/34079 tokens/21.23 s，整节替换3处6/83754/31.34 s，撤回1处4/70228/19.27 s，存版本2/38126/14.35 s；合计16/226187（含缓存），另1次夹具提前取消、用量未报。D4比较1.713 s，只含最终2段变化；2256个原子 XML、未改段落 XML、项目原文件均保持原样；夹具两处汇总错误保留记录，同一已完成回答未重跑。

## 2026-10-22 D4 审查合并（Claude）

- 分支已基于 b11eb3e，直接快进，无代码改动。随机测试 2000 组（插段、删段、改字、改标记、改标题）：配对覆盖两版每一块且保序，配对块去掉删增范围后文字相同，范围都在块内。
- 留给 U3：有缓存时接口仍要在 worker 里解析两版取块（学位论文 1.7 秒），返回体含两版全部块；比较视图先显示加载状态，必要时再加只取差异的参数。原子哈希的十六进制字符参与 Dice，公式多的段落相似度略偏高，误配时再改。D5 任务书已写。

## 2026-10-22 D4 版本比较后端（Codex）

- 迁移 028 缓存版本对；块锚点与 Dice 保序配对，段内复用中文词比较，新增直接格式和原子 XML 差异；父版本后台串行预计算，任意版本比较复用缓存，退出取消 worker。
- 新 GET diff 提供两版块和 UTF-16 范围；旧 compare/版本说明不改。app/app.js 仅补退出接线，未改 UI；复用 jsdiff（BSD-3-Clause）、JSZip（MIT）及现有解析器，无新增依赖。
- 干净检出 check 377/377（Windows 全过、零跳过）；博士论文 7932 块比较 1.558 s、188487 B，删2/增1/格式1位置正确；经同意沿用 E0b-2 受控修订，比较 0.203 s、8658 B，误配 0/337，另检出副本实际取消的10处引文上标。缓存接口分别 1.690/0.228 s，均未超3秒；材料留在忽略目录 desk-d4，模型请求/token均0。

## 2026-10-22 D3b 审查合并（Claude）

- 分支已基于 f9e9b36，直接快进。随机测试 3000 组全文改写：切块拼回、记录重放、逐条撤回都逐字节还原；只有改写本身加或去 BOM 时撤回会多留或少一个 BOM（界面不会这样改，记入 EDITING_DESK §3.2）。
- 修两处：文件列表正好 2000 个文稿时误报 `truncated`；图片接口加 `nosniff` 和 `sandbox` 的 CSP（文稿里的 SVG 来自第三方，不能当页面运行）。各补一项断言。版本比较浏览器测试点击后改为等打开请求到达（以前偶发失败）。全量检查 358/3 跳过（失败的 1 项即这个偶发测试）。D4 任务书已写。

## 2026-10-22 D3b 文本会话、文件列表与图片（Codex）

- tex/md 共用 DOCX 的会话、记录、撤回和原子保存；全文按块对齐、保留 UTF-8/BOM/换行/空白，接入 PUT text、只读文稿列表和 DOCX 图片原字节接口，沿用迁移 027，无新增依赖。
- 补路由器 PUT 与全文请求不限长度两处必要接线；修正文档仍描述旧外部哈希判定的段落。未改界面、原稿或预览安装；自建 TeX/Markdown 验收样例经所有者同意，论文图片使用既有副本。
- 两份样例各 10 块，编辑/撤回/写回/留版本及 VS Code 打开通过；全文提交 TeX 30.26、MD 37.52 ms，139 份文稿列表 92.27 ms，论文 PNG 2.50 ms。相关测试 47/47，最终干净检出 check 362/362（Windows 全过、零跳过）；补验首段撤回 BOM 转移、首图缺失返回 404。

## 2026-10-22 D3a 审查合并（Claude）

- Sol 的分支基于 U1 之前的 main，移到 15a9f43 上（三份文档冲突）。修 Sol 报给所有者的误判：外部修改原来拿项目文件和最新版本的哈希比，可写回项目文件不生成版本，连续两次 Ctrl+S 第二次就报 `DESK_EXTERNAL_CHANGE`，重开时还会多导入一个假的外部版本。新迁移 027 给版本组记 `source_hash`、`source_version_id`（登记、导入外部版本、写回时更新；存为版本时跟着移），外部修改和「从旧版本写回要确认」都按它判断，确认一次后不再问；补一项测试。
- `writeDocx` 的 `inserted[].paraId` 改为在插段处直接取用，不再按调用顺序对位。

## 2026-10-22 补回改版中丢失的窗口小功能，第一批（Claude）

- Yui 请几个 Haiku 对比原型、旧桌面版、10-12 改版前新版和当前 main，回查报告 https://claude.ai/artifact/VxvRffJwPnRSfgxu2UP7J6 ，约 20 项没有决定就丢了。Yui 选先补第一批：输入框草稿按对话保存；客户端里屏蔽浏览器按键、右键菜单和误拖文件（`desktop-guard.js`，旧版 `desktop-behavior.mjs` 的做法）；F2 重命名；「查找当前对话」只在对话页可用；对话页头部恢复项目置顶摘要按钮和 `Alt+S`，摘要点外面关闭；「全部对话」行加对话菜单和置顶标记；新加窗口置顶（`appearance.alwaysOnTop`，权限 `core:window:allow-set-always-on-top`）。
- 审阅清单加「新页面自查」一节。浏览器测试 `window-features.browser.test.js`；`npm run check` 345 通过、3 个 Windows 专属跳过。F5、拖放和置顶要 Sol 在 Windows 上确认。

## 2026-10-22 编辑台 U1 窗口骨架（Claude）

- 新设置 `features.editingDesk`（第一个功能开关，默认关，设置→常规可开）。开着时左栏「工作站」下有「编辑台」，工作站页头和文件预览有「在编辑台打开」，工作站的文献版本管理撤掉；关着时界面和以前一样。
- 编辑台窗口：`?surface=desk` 加载同一个 `index.html`（不另建 `desk.html`），`app/ui/desk-window.js` 负责打开和把文稿交给已开的窗口（原生用 `desk-open` 事件，浏览器用 BroadcastChannel）。`main.rs` 加 `desk` 窗口：标签 `secondary-desk`，可带 `projectId` 和项目内 `path`，已开时发事件而不是新开；记住大小位置、原生验收仍归 D8。`cargo check` 通过（云端临时装 GTK 开发库、放占位图标，未提交）。
- 骨架按画廊「编辑台」组做：文稿标签、功能区、左栏文件与大纲、页面、右侧栏、底部信息栏。U1 只读显示（沿用现有阅读器），编辑等 U2，文件列表等 D3b 的接口后换掉。新测试 `desk.browser.test.js`；截图在项目文件 `screenshots/desk-u1/`。
- 顺手修一处回归：D2b 审阅时改的 `updateSettings` 不再返回保存结果，设置页点「保存并应用」后不显示「已保存并应用。」，现在恢复。

## 2026-10-22 编辑台设计稿 U0（Claude）

- 画廊新增「编辑台」组：`PageDesk`、`PageDeskVersions`、`PageDeskTex`、`PageDeskMarkdown`、`PageDeskPdf`、`PageDeskCompare`、`DeskEntry`、`DeskMenus`，由 `build/desk/gen.py` 生成。
- 所有者看稿后改了第二轮：正文不显示修订标记（AI 改完弹提示可撤销），右侧栏改成「批注与索引」，比较改成左右两页并排；设计文档 §1、§2、§4.4、§5、§6、§7、§10、§12 跟着改。
- `components.css` 加编辑台样式（窗口、功能区、页面、修订标记、浮动工具条、版本树、tex 两栏、公式编辑框、比较、PDF）；令牌加 `diff-ins`、`diff-del`、`diff-del-ink` 和 `font-serif`；图标加「编辑台」一组 25 个。等所有者认可。

## 2026-10-22 D3a DOCX 编辑会话（Codex）

- 从改写后的 main 实现登记、会话、逐块冲突、撤回/保留、空闲原子落盘、保存和关闭八个接口；复用 D2、版本服务和迁移 024，重启恢复稳定块标识；补验目录域后插段和项目改名后落盘。
- 外部修改按原文的最新版本哈希判定，重复保存/另存分支的误判按所有者回复留给 Claude；干净检出全检最终 353/354（Windows 全过），两轮均遇既有站点改名竞态，已复现设置刷新后对象引用失效，留给 Claude 修复；未改 UI 或预览安装。
- 英文期刊、博士论文完成全流程，Word 正常打开；论文 7,932 块，最终开会话/修改/空闲写/写回项目为 1,257.80/104.68/2,011.73/2,020.67 ms（不含 2 秒空闲等待）；验收与失败原记录均在本地 desk-d3。

## 2026-10-22 D2b 审查合并（Claude）

- Sol 的分支基于改写前的旧历史，审阅时移到新 `main` 上（只有本文件冲突）。修一处：删段时书签和批注标记一律移到相邻段，若调用方已把被删段的内容并进前一段（退格合并两段），标记会出现两次，Word 会报错；改为只移没被新内容带走的标记，另外同一个书签、批注、脚注、图片等对象出现在两个段落时整次写回报 `DOCX_DUPLICATE_ATOM`，补两项测试。
- 修 Sol 报告的竞态：设置保存要等服务器返回，刚切到项目数据库就点侧栏「知识库」会按旧范围打开全局知识库（记忆收件箱测试偶发失败）。`updateSettings` 改为先更新界面状态、按顺序保存、旧响应不覆盖新的，失败时重新读取；补一项拦住保存请求的浏览器测试。`npm run check` 344 通过、3 个 Windows 专属跳过。

## 2026-10-21 D2b DOCX 段落与批注（Codex）

- 增删/拆分段落、包内 paraId 分配、书签/批注标记迁移；读取批注范围、回复与解决状态，编辑保留格式和线程，级联删除扩展元数据；8 项新功能测试及原有 19 项往返测试通过，含旧批注缺少 paraId 时按顶层读取的回归。
- 英文期刊、博士论文（Word 重排 363 页、7,932 块）、188 公式受控稿在 Word/WPS 无修复提示，加粗/取消加粗、批注、F9、接受/拒绝修订通过；论文读/写 516.63/1,371.66 ms。两处验收脚本差异（书签脚注控制字符、WPS 批注尾 CR）已对照原稿定位，证据和截图在本地 `temp/desk-d2/`。

## 2026-10-21 仓库公开整理（Claude）

- 仓库公开。重写中英双语 README，配演示数据截图（`docs/images/readme/`）。文档里的本机路径换成 `<预览安装目录>`、`<工作区>`、`<用户文献库>` 等写法；删掉一张含私人信息的参考截图，清空设计稿 pptx 的修改人元数据；全历史扫过，没有真实密钥。
- 按 Yui 的决定改写 Git 历史：从所有提交里去掉那张截图，作者邮箱换成 GitHub noreply；提交编号全部改变，新旧对照见 `docs/log/COMMIT_MAP.txt`。集成分支并入 `main` 后删除，之后只留 `main` 和 Claude 的工作分支，Sol 的分支从 `main` 开始。

## 2026-10-21 D2a 审查合并（Claude）

- 合并 D2a。审阅时修一处：加粗、斜体、下划线、上下标原来追加在 `w:rPr` 末尾，`w:rPr` 是有序序列（ECMA-376 §17.3.2.28），例如 `w:b` 排在 `w:color` 后面时 Word 会报内容错误；改为按规范顺序插入，补测试。Sol 的真实稿件只验了改字，改格式写回还没在 Word 里打开过，放进 D2b 的真实稿件验收。

## 2026-10-21 D2a DOCX 段内文字与格式（Codex）

- 混合文字段和普通段内容器可编辑；保留原格式，按需改五种标记，域缓存与公式线性文字进入投影；复杂域跨链接边界保留完整标签，17 项新测试加原有 2 项往返测试通过。
- 三份 E0b 中文副本各改一处含换行段落，Word/WPS 无修复提示，仅目标段落变化；4000 段新进程单次读 59.56 ms、写 68.43 ms（含重新读入与 ZIP）。omml2mathml 1.3.0 已核实 Apache-2.0，本轮未引入；验收、干净检出检查及截图在本地 `temp/d2a/`。

## 2026-10-21 KB-6b 审查合并（Claude）

- 合并 KB-6b，代码未改。越出任务书范围的一处是 `semantic/vector-store.js`：实体对齐原来把 `1 - L2 距离` 当余弦相似度比较阈值，这是 KB-6a 的错，改成只在对齐路径上取 sqlite-vec 的真实余弦距离，检索排序不变，接受。Windows 复测 `layout` 667 毫秒（原 2.96 秒），KB-10a 的遗留项关闭。遗留：每篇输出约 1.1 万 token 大多是思考，之后可考虑卡片请求降低思考强度；三组漏合并留给人工合并。

## 2026-10-21 KB-10 知识库图视图（Claude）

- 知识库页加「表格 / 图」切换（只在全局知识库；设置 `appearance.knowledgeView`）。图用 Cytoscape.js 3.34.3（MIT，新依赖，`/vendor/cytoscape.js` 按需加载），不用 edgehandles、fcose、rbush：拖线、空间查询自己写。`knowledge-map.js` 管画布（按视野加载、1500 节点 / 5000 边上限、下层点阵、拖线），`components/knowledge-graph.js` 管中心与深度、筛选、右键菜单、关系菜单、合并对话框、悬停卡片、页内撤销（一个编辑会话）、重新排列。位置索引多返回 pinned（第 6 项）。
- 5 万节点 / 50 万边合成数据（云端无 GPU）：关系名全画时平移一帧 100–180 毫秒，改为边超过 300 条只给中心、选中、悬停的边写关系名，拖动时用快照，极小点画方块；之后平移中位数 16.7 毫秒。新测试 `knowledge-graph.browser.test.js`（设中心、深度、拖线、反向、撤销重做、Shift 多选合并、拖动钉住、筛选）。

## 2026-10-21 KB-6b 真实论文卡片校准（Codex）

- 本地中英各 5 篇及无文字层对照，保留三轮共 32 次尝试、582,712 已报告 token、折算 0.25277460 USD；最终 10 篇完成、扫描件 0 请求；抽查 20 条边，19 条引文直接支持，1 条关系成立但引文偏弱；1 次连接失败未报告用量。修复数组 variantOf 导致整篇重试、实体对齐误用 1-L2，余弦阈值 0.92→0.94；提示区分方法名和编号、综述描述和实际采用。
- 排除扫描件费用，按实测校准 7,000/11,000 token 与峰时单价，10 篇估算/已报告费用 1.931 倍；名称/向量回放 154/154，漏合并保留。Windows 5 万节点/50 万边 layout 667.03 ms、5,023,047 字节（原 2,955.33 ms）；检查与完整审计见本地 KB-6b 报告，未改 UI 或预览安装。

## 2026-10-21 KB-10a 审查合并（Claude）

- 合并 KB-10a（迁移 026、graphology 0.26.0 / forceatlas2 0.10.1，MIT）。唯一超标项 `layout` 接口（Windows 2.96 秒）：节点度数原来每个节点两条子查询，改成按 `kb_edges_from`、`kb_edges_to` 两个索引各分组统计一次再合并（自环按图论算 2）；同一 5 万节点、50 万边合成数据在云端从 1.5 秒降到 0.3–0.6 秒，Windows 待 Sol 下次顺带复测。check 313 过 / 3 跳过。

## 2026-10-21 KB-10a 节点位置与后台布局（Codex）

- 迁移 026；共享位置、worker 内 ForceAtlas2/Barnes-Hut、增量邻居布局、钉住与删除留空；接位置索引、viewport、拖动保存和异步重排四个接口，发言中暂停。全局范围复用 LITERATURE_KINDS 筛选项目文献，并含无项目资料及全部图条目/实体；未改 UI、检索和工具。
- graphology 0.26.0 / graphology-layout-forceatlas2 0.10.1（MIT），npmmirror 安装；5 万节点/50 万边全图 10.665 s，layout 2.955 s（超 1 s 目标 1.955 s），viewport 1500 节点 141.5 ms，局部新增 100 节点 462.0 ms；SQL 度数查询为主要耗时，按用户要求不调方案。功能、升级、干净检出检查见报告；0 真实请求，未触碰预览安装。

## 2026-10-21 全局知识库只收文献（Claude）

- 按所有者决定：知识库页的资料列表、计数和检索（关键词和混合检索）传 `knowledge=1`，范围是全局导入的资料加各项目的文献（新常量 `LITERATURE_KINDS`，卡片和派生层共用），项目里的数据、代码、文稿只在项目数据库。专家检索不变。KB-10a 任务书和 KNOWLEDGE_BASE §3.3 同步改。

## 2026-10-21 知识库 / 项目数据库范围（Claude）

- 按所有者决定（DECISIONS 2026-10-21）：范围菜单改为「知识库（所有项目共用）」和「项目数据库：<项目名>」。项目范围标题是「数据库」，只有文献与资料和「记忆 ▾」，不再显示实体、知识等标签，也不再查实体数。
- 侧栏「知识库」和外部资源的返回按钮打开上次停留的范围（新设置 `appearance.knowledgeScope`，默认 `global`）；在页面上切换范围时更新它。资料库和知识库浏览器测试改为先进全局、再切到项目。

## 2026-10-21 KB-6a 审查合并（Claude）

- 合并 KB-6a；审阅时把摘要段落排在方法、结果之前送给模型（补测试）。check 308 过 / 3 跳过。遗留：每篇资料留一个临时会议（界面已隐藏，不清理）；卡片发言算作「发言中」，记忆整理和向量索引会让路；对齐的同名查找每项扫全部同种实体，KB-7 一并加索引。

## 2026-10-21 KB-6a 论文卡片后台（Codex）

- 同一知识库队列接入无工具后台卡片、引文核对、同名/向量对齐；并发 2、前台让路、三次失败停止，支持模型回退、费用估算和手动重做。迁移 025 保存实体来源/证据、任务结果；固定 actor_card_builder，每篇一个可撤回 build，保留用户修改与共享实体。
- 复用后台运行器和 sqlite-vec；白名单外只补编号迁移、后台参与者参数及实体向量查询。脚本模型验证卡片/接口/撤回/重解析/重试/并发；干净检出完整检查见交付报告。0 真实模型请求，未改 UI、未触碰用户预览安装及数据。

## 2026-10-21 KB-9 知识库表格页与节点详情（Claude）

- 「数据库」页改成知识库页（画廊 PageKnowledge）：页头范围（当前项目 / 全局 / 外部资源）、标签（新增实体、代码，记忆收进菜单）、工具栏搜索、漏斗筛选、排序；资料、条目、实体都是列表行，单击开右侧节点详情（相连按关系和方向分组、证据页码、AI 标记、删关系可撤销、实体标签 / 编辑 / 删除 / 历史恢复）。全局知识库改为列出全部资料。
- 后端小改：`GET /api/knowledge/edges?ref=`（任意节点的相连边），实体列表 `sort`，资料 `contentStatus` 筛选和按关系数排序，条目带 `relations`；没有原件的资料预览显示段落（之前报错）。设置 → 工具补上 kb_graph、kb_write、research_write 的中文说明。
- 新测试 `knowledge.browser.test.js`；资料库和记忆测试改到新结构。表格 / 图切换等 KB-10 再显示。

## 2026-10-21 KB-4、KB-5 审查合并（Claude）

- 合并两个分支，代码未改；check 295 过 / 3 跳过。遗留：真实模型把软件版本写进方法别名、给实体写了原文没有的「商业软件」描述，工具说明里要补一句「实体说明只转述原文」，改提示词需真实模型复测；`kb_graph` 按名称找中心时每次读全部实体，KB-7 加索引；设置 → 工具页的知识库工具中文说明随 KB-9 加。

## 2026-10-21 KB-4 / KB-5 交付复审（Codex）

- 复核远端交付与原验收记录；补跑知识库工具、存储与接口 11 项通过。发现 HTTP 保存单对象证据后详情读取报错：兼容仅在 AI 工具入口；读取端兼容单对象、空值及缺失引用，保留原始历史。
- 新增 HTTP 新建、清空、缺失证据与历史恢复的完整回归；仅后端读取兼容，无新迁移、UI 或模型执行改动。最终干净检出 check 结果见交付报告，复审 0 真实模型请求。

## 2026-10-20 KB-5 知识库接口与编辑会话（Codex）

- 基于 KB-4：实体/边/标签/归属/图/版本/历史/后台状态接口接线；图复用工具实现，详情解析 AI 来源及段落/消息证据，资料列表返回关系数。会话逐次撤销/重做、冲突跳过、启动收尾，版本按记录净变化计数；无新迁移。
- 路由功能测试覆盖完整编辑闭环、合并一步撤销、AI 后改冲突、证据缺失与重启恢复；Windows 干净检出 check 285/285，0 失败/跳过（含两项 Windows 测试及 NSIS），材料在 `.sciencescope-local/temp/kb-5/`。未改 UI、工具行为或用户预览；0 真实模型请求。

## 2026-10-21 D1 审查合并（Claude）

- 合并 D1，代码未改。顺手修导图浏览器测试的老毛病：打开导图编辑窗口后点「历史版本」时工作站上还有两个同名按钮，改成只点编辑窗口顶栏里的。check 287 过 / 3 跳过。遗留：首版版本说明可能写「后续都以 v1 为基准」，属提示词质量问题，等有真实模型时再改。

## 2026-10-21 D1 版本图后端（Codex）

- 迁移 024 补版本图字段及 desk_sessions/desk_changes；统一导入和另存为的复制、编号、SHA-256，新增版本图、元数据、层级改名接口。层级改名按 5d0f56b 执行 SQLite 更新后保存设置、失败补偿，未扩展 workspace.edit。
- 保留比较基准独立选择、原件与版本说明历史；编辑台版本不被后续导入自动送去整理。白名单外仅 version-catalog.js 增加新列的公开映射；未改 UI。升级与版本服务 14 项通过；Windows 干净检出 `npm run check` 290/290、零跳过。flash 2 请求 / 10,423 tokens，基准与数字改动正确，首版说明误称后续都以 v1 为基准，留作说明质量问题。

## 2026-10-20 E0b-1、E0b-2 审查合并（Claude）

- 合并两个原型分支，编辑台定为自研路线（`EDITING_DESK.md` §3.3 记录结果和 D2、D4 要补的点）。修一处：docx 读入里按范围查子节点、查原子节点是逐个扫描，长稿件变成平方级；改成连续切片和映射表，4000 段读入 3.5 秒 → 0.1 秒。相似配对阈值定为 0.4。check 283 过 / 3 跳过。

## 2026-10-20 E0b-2 两版论文句子对齐试验（Codex）

- 新增 desk/compare 的段落锚点、中文切句和局部 Dice 配对，保留原文与块引用；复用 jsdiff 和 compareText，无新依赖，未接 UI/现有比较接口。五项测试通过；合入 Claude 侧栏修复、补回 KB-4 独立标题夹具，Windows 干净检出 `npm run check` 284/284、零跳过。
- 真实稿件的受控修订逐行核验：阈值 0.4/0.5/0.6 分别漏配 0/1/1 处（涉及 0/2/2 行），均无错配和后文连带标红；建议 D4 从 0.4 继续验证，原型默认仍为任务书的 0.5。断句观察及清单在 `.sciencescope-local/temp/desk-e0/E0b-2.md`，0 模型请求。

## 2026-10-20 E0b-1 docx 原位回写试验（Codex）

- 新增 desk/docx SAX 字符位置索引、局部段落回写和追加批注；saxes 精确锁定 6.0.0（ISC），沿用 JSZip，两项合成测试通过。合入 Claude 的侧栏等待修复，补回 KB-4 独立标题夹具以隔离合法引用回填；业务代码不变，Windows 干净检出 `npm run check` 281/281、零跳过。
- 三份本地中文稿在 Word/WPS 正常打开；目录、REF 和已有修订因原稿缺失，另用带 188 个公式的受控副本验证 F9、目录更新、接受/拒绝修订及批注锚点；英文稿和学位论文样本缺失。材料与截图在 `.sciencescope-local/temp/desk-e0/`，未接 UI/路由，0 模型请求。

## 2026-10-20 E0a eigenpal 试验与 E0b 任务书（Claude）

- eigenpal docx-editor 不采用：修订、批注和服务端编辑 API 在 EigenPal Pro 评估许可的包里（禁止生产使用和分发），按编辑台设计第 3.3 节规则走自研方案。报告 `.sciencescope-local/temp/desk-e0/E0a_eigenpal.md`。写了 E0b-1（docx 原位回写原型）和 E0b-2（句子对齐试验）任务书给 Sol，两份都需要用户提供真实稿件副本。

## 2026-10-20 P3 侧栏重做（Claude）

- 照画廊侧栏定稿（用户认可，保留工作站右边的简报按钮）重写 `sidebar.js`：知识库改名、行尾状态与活动时间、每项目 5 个加「还有 N 个」、全部对话行、底部全局助手；对话可拖到项目或用菜单「移到项目…」，提示条可撤销。新增 `POST /api/meetings/:id/move`（纪要和默认工作文件夹随行）。提示条支持操作按钮；菜单项可禁用；新消息刷新对话活动时间；待批准算作状态。标题栏和助手浮球换矢量标志。删掉不再使用的 `background-activity.js`。
- 新增侧栏功能测试；check 276 过 / 3 跳过。截图在项目文件 `screenshots/p3-sidebar/`。

## 2026-10-20 KB-4 知识库工具（Codex）

- 共用注册表接入 kb_graph/kb_write/research_write、实体读取与知识库历史；图结果轻量分页，文件夹边即时生成，批量逐项事务共享发言版本，工具说明引导有据写入且不触发批准。单条证据对象统一为数组，原文内容不加硬拦截。
- Windows 干净检出 check 281/281（0 失败/跳过，含 NSIS）；脚本专家写图、部分失败、撤回冲突与条目修订通过。真实 flash 用三篇公开 QCA 论文整理后撤回，3 实体/9 边逐条核对引文和页码，12 请求（1 次连接失败自动重试）/441,004 已报告 tokens，失败请求无用量。顺带修复 KB-3 测试随机复用被引标题、合法补边却断言引用不变的问题：新论文改用独立标题，保留模拟向量。资料、失败与审计在 `.sciencescope-local/temp/kb-4/`；未改 UI 或用户预览。

## 2026-10-20 R6a-6、KB-2a、KB-2b、KB-3 审查合并（Claude）

- 合并四个分支。修三处：项目自带文件夹里的 `workbench/`、`notes/`、`minutes/`、`versions/` 不再当项目文件扫描（原来计划、日志、编辑台版本会进知识库）；新导入或新扫描、类型还是「文件」的资料解析出参考文献段落或 DOI 时标为论文（原来项目里的 PDF 永远是「文件」，不会有相似边和卡片）；看图结果的预览名改成 `.png`，PDF 页面的截图不再误开 PDF 阅读器（R6a-6 报告）。
- 两万文件首扫 35 分钟，定为 KB-2c 以后提速。check 275 过 / 3 跳过。

## 2026-10-20 KB-3 派生关系与后台队列（Codex）

- 复用 kb_jobs、解析段落和 sqlite-vec：引用精确匹配并补边；相似关系阈值/每篇上限可设置，默认 0.85/3，新资料不挤掉已有边；设置变化后台全量重算相似边，引用边不动。内容增量、发言让路、重启恢复与三次失败后手动重试，派生层不进历史版本。
- 12 篇本地中英文论文复用已有模型：66 对相似度中位 0.8295、P90 0.9159，最终 11 条相似边；0 付费请求、0 下载。Windows 干净检出 check 275/275（含两项平台测试及 NSIS），材料在 `.sciencescope-local/temp/kb-3/REPORT.md`。未改 UI 或用户预览。

## 2026-10-20 KB-2b 移动、删除与副本清理（Codex）

- 基于 KB-2a：扫描按哈希识别移动并保留 ID/段落/边；消失的文件走共用资料删除服务，清理全文/向量/派生及 extracted 边，人工关系进可撤回版本，导入原件进回收站。
- 新增删除资料、项目副本占用与显式清理接口；清理与扫描串行，保留仍被引用的副本。Windows 干净检出 check 271/271；重启向量删除及真实回收通过；flash 3 请求 / 14,001 tokens。未改 UI 或用户预览；验证与接线见 `.sciencescope-local/temp/kb-2b/REPORT.md`。

## 2026-10-20 KB-2a 项目文件夹索引（Codex）

- 迁移 023 保存文件大小、修改时间与哈希；项目根目录访问和文件操作触发合并扫描，副本按哈希去重，复用解析/全文/向量索引，不支持或过大的文件保留名称和路径。
- 原件、预览和看图优先项目文件，丢失时读取副本；新增索引接口和文件状态。Windows 干净检出 check 269/269；真实 flash 3 请求 / 13,744 tokens。两万文件首扫 34 分 42 秒、未变重扫 0.832 秒，逐文件事务是主要瓶颈，分批方案待审阅。未改 UI 或用户预览；接线和验收见 `.sciencescope-local/temp/kb-2a/REPORT.md`。

## 2026-10-20 R6a-6 第三个预览包（Codex）

- 从 2c3029f 打包并覆盖用户预览；新备份 50,144 文件 / 1,781,644,543 字节核对一致，旧备份未动。全新/覆盖均 13,254 个程序文件，耗时 3 分 32.4 秒 / 4 分 57.4 秒；测试产品及数据已卸载。
- 干净 Windows 检出 check 267/267 通过，零失败/跳过；flash 26 请求 / 122,176 tokens。总是允许/删除后再询问、插入、并行专家和四技能交付通过；用户安装只做原数据核对和一次连接测试，设置未改，退出无残留。
- PDF 看图缩略图点击失败：PNG 保留 PDF 显示名使预览误选 PDF 阅读器；EXE/窗口已是纸色图标，桌面/任务栏仍显示旧绿底，疑为缓存。未改 app；100%/125% WebView2 缩放截图与系统 125% 图标截图、详细报告见 `.sciencescope-local/temp/r6a-6/`。

## 2026-10-20 X-UI 工具、技能、MCP 设置页（Claude）

- 设置 → 工具与环境 新增工具、技能、MCP 服务器三页；主专家、秘书、助手和专家设置可绑定技能；时间线显示「使用技能」「调用 服务器 · 工具」，批准卡片显示服务器和工具。
- 后端小改：技能列表加 `title`（`metadata.title`）和 `overrides`，`POST /api/skills/:name/open`；`/api/tools` 的 MCP 项加 `serverName`、`tool`；编辑服务器保持顺序，只改名或停用工具不重连。旧样式的复选框规则不再覆盖开关。
- 新测试 `app/ui/extensions.browser.test.js`；`npm run check` 266 过 / 3 跳过。

## 2026-10-20 X-UI 设计稿（Claude）

- 画廊新增设置 → 工具、技能、MCP 服务器三张整页示例（含添加服务器、粘贴配置对话框）和 Extensions 部件卡（专家绑定技能、时间线技能与 MCP 步骤、MCP 批准卡片、空状态）。新增图标 graduation-cap、server、clipboard-paste，样式 `.ss-kv`、`.ss-provider__error`。生成脚本 `docs/design/system/build/xui/`。等用户审。

## 2026-10-20 复盘整理文档（Claude）

- 路线图开头加 11 个板块的现状、设计和下一步；架构总纲、愿景、设计系统、首测指南、协作方式、想法清单、文档索引按现状更新。X1、X2 任务书移入 `done/`，`KNOWLEDGE_GRAPH.md` 归档。

## 2026-10-20 知识库规模方案并入设计（Claude）

- 用户采纳：检索枢纽降权、扇出截取、单次访问、路径去重；工具结果轻量、详情按需；图视图按视野加载（用户提出）、位置存库、后台 ForceAtlas2、拖动钉住、删除不补位。改 `KNOWLEDGE_BASE.md` §5、§6、§7a、§8、§10（新增 KB-10a）、§11，DECISIONS 一条。

## 2026-10-20 X0 内置基础技能（Claude）

- `app/resources/skills/` 换成四个技能：cite-sources、edit-workspace、deliver-files、python-analysis，删掉格式示例；技能测试改用 cite-sources，停用时停掉全部技能。真实模型验收放进 R6a-6。

## 2026-10-20 应用图标换回纸色底板（Claude）

- 安装程序左侧图同样改成纸色（绿色版 `installer-sidebar-green.html` 留在画廊）。按用户意见，`tools/brand/icon.svg` / `icon-small.svg` 改为纸色底板、细描边、墨色标志，重新生成 `tools/package/brand/icon.ico`；绿底稿改名 `icon-green*.svg`，画廊 AppIcon 卡片作备选保留。安装程序侧图未改。

## 2026-10-20 X1、X2 审查合并（Claude）

- 合并 X1 技能、X2 MCP。修三处：服务器 id 改为 `s`+8 位、工具名只留 `[A-Za-z0-9_-]` 并截到 64 字符（模型接口限制，SSE 测试覆盖带点的工具名）；npx 默认镜像改 npmmirror；Linux/macOS 关闭时结束整棵子进程树（原来孙进程会留下，测试在 Linux 失败）。check 264 通过 / 3 跳过。

## 2026-10-20 X2 MCP 接入（Codex）

- 基于未合并的 X1；官方 SDK 接通 stdio/HTTP/SSE、导入和凭据引用、动态工具、原始 Schema、图片与 C1 按服务器批准。随包 npm 补 npx，uvx 复用 uv；未改界面和用户预览。验证材料在 `.sciencescope-local/temp/x2/`。
- Windows 功能验证覆盖导入、脚本模型调用、跨会议共享服务器批准、停用、失败原因、断线重连及子进程树退出；干净检出 `npm run check` 264/264 通过、0 失败/跳过，含 Windows/NSIS。
- 全新隔离安装从设置添加 Go，flash 调用官方 Time MCP 成功：3 请求 / 8,295 tokens（连接测试 1 / 48），全部 HTTP 200；WebView2 100%/125% 截图已留，Node/uv/MCP/Python 退出无残留，随包 npx 11.6.2 可运行；测试产品及数据已卸载清理。

## 2026-10-19 X1 技能接入（Codex）

- 文件夹/ZIP 导入、内置复制、启停、技能目录、use_skill 与角色预载正文接入；新增技能及工具目录接口。后台纪要/记忆保持无工具，只预载绑定正文；界面只补英文。验证材料在 .sciencescope-local/temp/x1/。
- 干净检出 `npm run check` 261 通过、0 失败/跳过（首轮 NSIS 因无编译器跳过，指定本机构建工具后完整复验）；相关 16 项通过。包内示例技能已核对。
- 全新隔离安装 flash 验收：3 请求、7,562 tokens（连接测试 53），实际调用 use_skill 后按三行格式回答；WebView2 100%/125% 截图已留，退出无残留，测试产品及数据已卸载清理，用户预览未动。

## 2026-10-19 A2-2 删除自动化后端（Codex）

- 迁移 021 将旧自动化会议改为普通对话、移除旧目标与目标表；删除调度、工具、接口和目标批准联动，保留停止/关闭/重启取消批准。相关测试 14/14，干净 Windows 检出 check 241/241（零跳过，含两项 Windows 测试）；原生旧库副本 flash 普通回答通过（1 请求 / 3,187 tokens，连接探测另 1 / 167）。未改界面或用户预览；完整验证见 `.sciencescope-local/temp/a2-2/REPORT.md`。

> 新核心（`app/`，重建 R0 起）的开发与验收日志，最新在最上面。每次交付一条，不超过 5 行；细节放 `.sciencescope-local/temp`。
> 2026-10-05 之前旧原型时期的记录在 `archive/legacy/DESKTOP_IMPLEMENTATION_legacy.md`。

## 2026-10-20 KB-8 知识库设计稿（Claude）

- 画廊 v10 加三张整页（知识库表格、图、项目资料）和两张零件卡（KnowledgeGraph、KnowledgeChange）；新增 7 个节点种类色令牌 kg-、14 个图标和对应样式（ss-kind、ss-ai、ss-cite、ss-card、ss-rel、ss-graph、ss-tree-row--nested）。还没接进应用，等用户审。

## 2026-10-19 C 组界面（Claude）

- 批准卡片「总是允许」菜单、步骤里的规则说明、设置 → 运行环境的规则列表；看图步骤显示图片并可在预览打开；队列「现在插入」与插入标记；@ 多位并行的状态框测试。新增 `settings-approvals.js`、三个浏览器测试；截图在项目文件 `screenshots/group-c/`。

## 2026-10-19 B1 品牌打包（Codex）

- 打包与开发配置接入已批准的绿底ICO、NSIS右侧页头与等比侧图，停止调用旧线图标生成脚本；干净检出251/251及打包3/3通过，独立测试产品完成Windows实际100%/125%图标验收，窗口无需额外设置。材料见 `.sciencescope-local/temp/b1/`。

## 2026-10-19 C1 总是允许（Codex）

- 后端按项目/独立对话保存命令、文件夹和包范围；候选中英双语，最终工具结果保留规则 ID，设置串行追加防止覆盖。界面菜单留给 C1-UI。
- 真实 flash 两条 Python 命令共用一次批准，成功轮 3 请求 / 10,344 tokens；含连接探测和夹具失败共 7 请求 / 已报告 17,821 tokens（1 次取消无用量）。截图和完整记录见 `.sciencescope-local/temp/c1/`。
- Windows 干净检出 `npm run check`：253 通过、0 失败、0 跳过；新增测试的类型推断错误已修正，完整复查通过。

## 2026-10-19 KB-1 知识库存储（Codex）

- 迁移022增加实体/边/标签/归属、独立修订/版本及任务表；五处发言结束关闭知识版本，整组与单条恢复保留撤回前状态并跳过后续修改。实体接入FTS与384维向量，补link/code；干净检出检查256/256通过（含Windows），材料见 `.sciencescope-local/temp/kb-1/`，无界面和新模型工具。

## 2026-10-19 C2 看图工具（Codex）

- 新增共享 view_image：PDF 页与局部区域、图片裁切后发送 PNG；模型能力由运行时判断，记录只存预览路径。复用 pdfjs-dist（Apache-2.0）和 @napi-rs/canvas（MIT）；原文解析与界面未改，验收材料见 `.sciencescope-local/temp/c2/`。
- 干净检出 Windows `npm run check`：253 通过、0 失败、0 跳过。独立安装包包含 canvas 原生模块，真实 flash 看图验收共 7 请求 / 34,408 tokens（含连接测试），正确引用公式 (4)/(5)；100% / 125% 截图采用 WebView2 视口与 DPR 模拟。

## 2026-10-19 C3 运行中插入消息（Codex）

- 运行时通过 pi-agent-core 的 steer 接入当前发言；队列接口保留插入记录并调整未完成回答的顺序，重试与重建使用同一上下文顺序。已结束时普通发送，有序讨论保留排队；未改界面，材料见 `.sciencescope-local/temp/c3/`。
- 干净检出 Windows 检查 254 通过、0 失败、0 跳过；独立全新安装中真实 flash 按运行中追加的年份条件正确求和，共 4 请求 / 11,600 tokens（含连接测试）。截图为原生 WebView2 100% / 125% 视口与 DPR 模拟，关闭后进程全部退出。

## 2026-10-19 C4 多位提及并行回答（Codex）

- 工作模式多位提及先预留再并行，按共同前提和各自分段给上下文；原文持久保留，重试分段、后续恢复原文，共用停止信号。有序讨论与界面未改，材料见 `.sciencescope-local/temp/c4/`。
- 续写保留原触发边界，避免读入同轮其他回答；补分段、纪要、重试/续写与同时停止回归。干净检出 `npm run check` 254 通过，0 失败/跳过，含 Windows 测试。
- 隔离产品全新安装验收：flash 3 请求、10,809 tokens（含连接测试 50）；两专家请求起点相差 45ms、重叠 15.76s，实际输入各自分段。模型有额外展开和过度断言，原文保留在本地报告；WebView2 100%/125% 截图已留，退出无残留。

## 2026-10-19 对话页 B 组（Claude）

- 时间线：连续同类步骤合成一行（「运行了 6 条命令」），批准成为该步骤的状态（批准请求记录所属 `callId`），命令细节像终端。交付文件收成一行、点开是清单，正文按路径插图和文件链接（`workspace_present` 说明已补）。
- 设置加「对话行距」「侧栏字号」，对话正文统一行高和段距。有序讨论中发言的专家只占固定高度的状态框。日志详情点一下直接改纯文本，删掉「简述」页。
- 画廊新增 FileList、ExpertBox 卡片，更新 ActivityTimeline、ApprovalCard。检查 249 通过、2 个 Windows 专属跳过。截图在项目共享文件夹 `screenshots/group-b/`。

## 2026-10-19 A3 后端规则对齐（Codex）

- 纪要只存应用数据目录，旧导出列保留且停止读写；语义下载默认 ModelScope，已存来源不变；打包测试加入格式、lint 和统一检查。相关测试 16/16、干净检出 npm run check 255/255（零跳过，含 Windows 与 NSIS）；隔离原生纪要生成/编辑通过，真实 flash 1 次加服务商探测 1 次，共 948 tokens；完整验收记录见 `.sciencescope-local/temp/a3/`。

## 2026-10-19 美术资产（Claude）

- 用户认可设计画廊「品牌」组（图标用绿底）。`tools/brand/` 是图标和安装图的源文件，`render.mjs` 生成 `tools/package/brand/` 的 icon.ico（8 个尺寸）和两张 NSIS 位图；画廊卡片由 `docs/design/system/build/art.mjs` 从同一来源生成。
- 接进应用：欢迎页插画、设置里的「关于 ScienceScope」页（版本、署名、第三方声明、数据位置），新增 `about.browser.test.js`。截图在项目共享文件夹 `screenshots/brand/`。打包接入写成 B1 交给 Sol。

## 2026-10-19 A3 界面部分（Claude）

- 主输入框的模型菜单改为只选当前对话的模型（欢迎页选的随第一条消息存进新对话），新增 `model-choice.browser.test.js`；脚本运行时把模型传给测试脚本。删掉纪要设置里「同时保存为工作文件夹中的 Markdown 文件」和纪要窗口的导出错误；设置里「DSH 运行历史」改为「智能体运行会话」，去掉没有功能的「本地技能目录」。后端部分见 `plans/tasks/A3_doc_code_mismatches.md`。

## 2026-10-18 A2-1 review and merge (Claude)

- Merged `codex/a2-1-images-prompt-screenshot-20261018` (4dbc56c). Review: the meeting-reading sentence was added both to the default prompts and by context assembly, so Main saw it twice; kept only the context-assembly copy (edited prompts keep it too).
- Claude's UI: user messages show image thumbnails (open full size), file and mark chips above the bubble; Settings → 个人资料与常规 has 「截图时隐藏 ScienceScope 窗口」. Screenshots in the project folder `screenshots/a2-1/`.

## 2026-10-18 A2-1 image input and native screenshot (Codex)

- Image originals reuse library/originals with migration 020; message researchInput.materials exposes type/id/name/mimeType/bytes/url. Runtime send accepts images; unsupported models retain the text answer and record the readable reason in turns.error. Main/expert prompts discourage unsolicited meeting reads.
- Windows Snipping Tool supplies selection; capture_screenshot restores windows after capture/cancel/error. Stored composer.hideWindowOnScreenshot defaults true.
- Clean Windows checkout npm run check 250/250, zero skips; real flash 7 requests / 32,146 tokens. R6a-5 package overlaid on the user's preview in 321 s (9,697 files, data kept).

## 2026-10-18 Automation removed from the UI (Claude)

- User decision: execution mode is 请求批准 or 常规 only. Removed the 自动化 option, goal rounds input, `GoalPanel`, goal actions (`goal-actions.js` → `activity-actions.js`, failures only), `goal.changed` subscription and the `automation.browser.test.js`. Backend removal is brief A2-2 for Sol.

## 2026-10-18 Second-round test fixes (Claude)

- Compact activity view keeps cards waiting for approval; preambles render as Markdown; chat/project menus show 置顶 as an item; source detail wraps long text; file preview and materials panels use `SidePanel`. Old `meeting-tool.js` removed. Check 245 pass, 2 Windows-only skipped (`map.browser.test.js` still flaky on the base branch).

## 2026-10-17 Secretary and assistant panels (Claude)

- Both panels are `ss-panel` side panels (`side-panel.js`, splitter width in `appearance.panels`) whose conversation reuses the meeting `Message` (activity timeline, approval cards, status line) and a compact composer with execution mode (ask / auto only) and `ModelPicker` in override mode (`policy.model`).
- Secretary proposals are cards; old `assistant-message.js`, `assistant-model.js`, `secretary-model.js` removed. New `panels.browser.test.js` covers approval, 常规 and the remembered width. Linux check 244 pass, 2 Windows-only skipped.

## 2026-10-17 R6a-5 overlay cleanup (Codex)

- PREINSTALL removes only app/node_modules/runtime/python/models/reference, package.json/LICENSE/THIRD_PARTY_NOTICES and the main executable; skips new destinations, checks the running app before deletion and aborts on cleanup failure. Existing opt-in uninstall data removal is reused; app/ unchanged.
- Clean Windows checkout check 245/245, zero skips, including both Windows-only tests; packaging tests 3/3 include compiling/running the NSIS hook with Chinese data paths and retained user files.
- Installtest overlay 248.151 s, fresh 161.534 s: identical 9,697-file program manifests and SHA-256 values, 356.18 MiB; all 329 data files and two user files retained. Native project/connection pass, owned processes exit; two Go connection probes (minimax-m3) / 333 tokens.
- Formal package 95,429,910 bytes, product/version unchanged; PREVIEW_TEST section 1 updated. User preview and backup untouched; package SHA-256, cleanup and screenshots: `.sciencescope-local/temp/r6a-5/REPORT.md`.

## 2026-10-17 R6a-4 review (Claude)

- Merged Sol's second preview (`46539ee`, with R6a-3 pruning `94c4738`). Fresh install 9,697 files / 356 MiB, 164 s; overlay onto the user's preview 208 s but keeps the old dependency files (31,030 files), left for a follow-up installer cleanup.
- The user's pre-P1a OpenCode Go provider (hand-configured, one API format for all models) answered the connection test with HTTP 400. Added `POST /api/providers/:id/adopt-preset` and a "改用内置配置" hint on cards whose address matches a preset: the key moves to the preset, and the default model, memory model, expert definitions and meeting overrides follow when the preset has the model (otherwise they fall back to inheriting). Browser test covers it.

## 2026-10-17 R6a-4 second preview package (Codex)

- From 53cf686, cherry-picked R6a-3 5b8e8a1 as 94c4738; app/ unchanged. Formal 1.0.0-alpha.0: 95,426,967 bytes; fresh install 9,697 files / 356.18 MiB. Clean Windows check 244/244 (both Windows-only tests), packaging tests 2/2.
- Fresh install 163.966 s; quick add, thinking, reject/allow, normal execution, stop (196 ms) and saved 70% threshold pass. Test product removed with data in 68.84 s; native WebView 100%/125% viewport captures retained.
- Verified 48,152-file backup before 208.066 s user upgrade; 1 project / 7 meetings / 22 messages and settings unchanged, startup log clean, no residual processes. Old Go connection test HTTP 400/default model limits retained for Claude; overwrite leaves 31,030 program files including old dependencies.
- Real calls: 11 attempts / 30,204 reported tokens / 2 unknown (flash dialogue 9/30,038, Go preset probe minimax-m3 1/166, old-config probe 1/unknown). Package hash, screenshots, top-10 packages and fixture failures: `.sciencescope-local/temp/r6a-4/REPORT.md`; PREVIEW_TEST sections 1–2 updated.

## 2026-10-17 P1-UI step 2: models and providers settings (Claude)

- Settings → 模型与服务商 rebuilt from the gallery: preset quick add (key-only dialog, test and save), provider cards with test connection and a ⋯ menu (edit address and models, fetch model list again, update key, remove with confirmation), model table from `GET /api/models` (context, max output, thinking levels, limits source; collapses past 8), default model select, compaction slider (`context.compactPercent`). Custom-service form without capacity fields. Composer, secretary and assistant model menus and the context ring read the catalog; the ring warns at the compaction threshold. New shared `components/dialog.js` (`ss-scrim` / `ss-dialog`); `ChoiceMenu` takes group labels; menus scroll past 420px.
- Not built (no stored value or consumer): no-response timeout, per-model limit override and hiding. The secretary's model stays on the 任务秘书 page. Settings browser test rewritten for the preset flow; screenshots at 100% / 125% in `.sciencescope-local/temp/p1ui2/out`.
- Fixed a UI race that made the activity browser tests flaky under load (about 1 in 3 runs, also before this step): `useStore` subscribed in an effect, so events arriving between a new message's render and that effect (the first tool call, approval or retry) were never shown. It now re-reads the store when subscribing. `loadTurn` also keeps stream-reported turn state and activity instead of replacing them with an older snapshot. Secretary, assistant and discussion tests now use catalog models (hand-entered `efforts` and windows are no longer read).

## 2026-10-17 P1b segment 3: session compaction (Codex)

- Global context.compactPercent (80, range 50–95) feeds pi prepareRequest before every call; one same-model summary replaces older exchanges atomically, keeping the last two exchanges and current tool results intact. Compaction phase/activity and request purpose are emitted; failed summaries preserve the original and continue. No UI or meeting-record rewrite.
- References: pi-coding-agent 1.0.0 and OpenCode compaction (MIT), design adaptation without copied modules. Fixed double-counted tool details and missing auxiliary session routing (Go HTTP 400); related tests 10/10, clean Windows npm run check 243/243, zero skips. Real flash compacts estimated 556,506 → 3,791 tokens and retains checked decisions; fixed run 2 requests / 416,930 tokens. Segment total with failures/diagnostic: 7 attempts / 1,627,745 reported tokens / 2 unknown; all P1b: 25 / 1,698,018 / 4 unknown. Evidence and screenshots: `.sciencescope-local/temp/p1b/REPORT.md`.
- Review (Claude): UI wired — approval card in the timeline (Allow / Reject, folding into an "Allowed / Rejected / Cancelled" row), "Waiting for your approval" and "Compacting" status, a compaction row, the three-way execution mode stored as `policy.approval` (new meetings pass it on creation), and approval cards in secretary / assistant answers. `features.js` removed. One browser test covers reject → allow → compaction → switching to 常规. Linux `npm run check` 242 pass, 2 Windows-only.

## 2026-10-17 P1b segment 2: request approval (Codex)

- Shared tools.run approval covers shell, writes/edits outside data and package installs; policy defaults to ask, including legacy meetings. Persistent approval cards and POST decisions reuse tool/phase/goal events; rejection, stop, goal end, shutdown and restart leave no turn error. No UI changes or schema migration.
- Host-boundary integration covers foreground and background callers without changing the agent loop. app.js/server.js wire lifecycle and HTTP; file approval/execution share path resolution. Windows clean-checkout npm run check 239/239, zero skips; related approval/Python tests 6/6. Real flash rejects then approves script/write/run: 5 requests / 19,838 tokens, output 10, no turn errors. Initial missing-member test fixture corrected; evidence `.sciencescope-local/temp/p1b/SEGMENT2.md`.

## 2026-10-17 P1b segment 1: built-in host tools (Codex)

- Added shell/read_file/write_file/edit_file/list_files/grep_files/web_fetch through the shared tool service; meeting Python environment reaches the shell, Windows uses PowerShell, stop/timeout ends its process tree. Large output keeps both ends and saves the complete bytes under data/temp; file tools preserve the credential-path exclusion. No UI changes.
- Reference: pi-coding-agent 1.0.0 tools and shell/output handling (MIT), adapted design, no coding-agent dependency. Node glob and existing parse5 handle file search and readable external web content. Web search remains deferred in ROADMAP; approval and compaction follow in separate segments.
- Windows clean-checkout npm run check 236/236, zero skips; related tests 10/10. Real flash: 13 attempts / 50,435 reported tokens, two unknown-usage attempts; CSV script produced sum 10 and mean 2.5, UI stop settled in 122 ms with Python gone and turns.error null. PowerShell child exit codes fixed; obsolete-selector fixture failures retained. Evidence: `.sciencescope-local/temp/p1b/SEGMENT1.md`.

## 2026-10-17 P1a: pi runtime and provider contracts (Codex)

- Exact pi-ai / pi-agent-core 1.0.0 dependencies replace the new core's DSH subprocess bridge; DSH remains development-only for the frozen line. SDK Agent owns the loop; atomic transcripts, catalog capacities, key-only presets/model/test APIs, bounded cancellable request retries and metadata-only rotated logs are wired without UI edits.
- Migration 018 adds transactional phase/activity events; thinking/retry entries share the tool timeline. Stop reaches provider sockets, host tools and uv. Windows clean-checkout `npm run check`: 225/225, zero skips; related HTTP/runtime 9/9 and Python 3/3 pass. Failed HTTP metadata retains status/Retry-After before SDK error conversion; no-tools summaries explicitly request toolChoice none. Evidence: `.sciencescope-local/temp/p1a/REPORT.md`.
- Both presets connect and edit plans, both secretary confirmations and the assistant complete; real stop retains 26 characters in 194 ms, local offline attempts stop after three, HTTP 401 does not retry. All real checks: 27 attempts / 45,718 reported tokens, six unknown-usage attempts; three local connection attempts separate. Original transport and malformed-summary failures retained. No turn.error added: partial-answer error presentation remains with Claude.
- Production-only staging has no DSH: 9,384 dependency files / 228,121,163 bytes, versus R6a-3 14,501 / 314,232,253 using its same local pruning rules (not a packaging-code change); full stage 9,675 files / 360,349,270 bytes. No installer and no preview changes. SDK README/API composition (MIT), no copied agent-loop code; screenshots and full evidence stay in the ignored report directory.
- Review (Claude): the UI now follows the new events (status line phases, thinking and retry rows, `tool.updated`); migration 019 adds `turns.error`, so a failed partial answer keeps its text and shows the reason beside it, with "Open settings" for key errors. The `phases` flag is gone. One browser test covers retry → thinking → partial failure. Linux `npm run check` 224 pass, 2 Windows-only; no key in the cloud, so no paid run here. The map history test is flaky on both sides of the merge (two "历史版本" buttons), left for the P3 map redesign.

## 2026-10-16 P1-UI step 1: design system in the app, chat page and composer (Claude)

- Gallery approved by the user. `styles/tokens.css` and `lucide-icons.js` are generated by `docs/design/system/build/build.py`; `styles/components.css` is the single source of component styles (the gallery's `bundle.css` is now generated from it and untracked). Legacy form rules skip `ss-` controls so both coexist.
- Chat page and composer rebuilt on the components: message, activity timeline (one row per tool call, folds when done), status line (waiting, failed, stopped, max tokens), message menu, find bar; one send/stop button with Esc, execution mode, model and effort picker, context ring, attachments, outbox. Approval and phase status hidden behind `features.js`.
- Fixed a pre-existing race: opening a meeting replaced messages streamed during the load with the stale page, leaving an answer stuck as "generating". Chat font default 16 → 14.
- Linux `npm run check`: 211 pass, 2 Windows-only skipped. Screenshots light/dark at 100% and 125%: `.sciencescope-local/temp/p1ui/v3*`. Backend unchanged, so no paid-model run.

## 2026-10-16 P1a step 0: retained startup measurements (Codex)

- Added native/Node/core/Python/semantic/listen/first-paint timestamps, one retained JSON row per launch; no startup optimization or UI component changes. Native debug/no-bundle executable, isolated H-drive data: hot 4.749 / 4.614 / 4.646 s (mean 4.670 s); HTTP-to-paint 4.138–4.197 s. First new-data launch 9.862 s is not an OS-cold sample.
- User approved deferring three reboot-cold samples, process-scoped offline acceptance, and production staging instead of an installer. Measurements and original concurrent-I/O samples: `.sciencescope-local/temp/p1a/`; the user preview installation was not touched. Baseline and clean-checkout checks both 214/215: existing DSH initialization exceeded 30 s; concurrency alone is not established as its cause. P1a replaces that path.

## 2026-10-16 P2 design system gallery (Claude)

- Published the first gallery (https://claude.ai/artifact/6MCyAAbMK2kD5nTsAkZEgk): 85 tokens in a light and a dark theme, 12 type styles, 107 Lucide icons with Chinese meanings, 37 components with previews and guidelines, and four full-page mocks at 1536×900 (chat, library, inbox, settings).
- Sources in `docs/design/system/`; `build/build.py` regenerates the gallery runtime byte for byte. All 42 cards render without errors in both themes; contrast check lists only the documented exceptions.
- Overview, feedback mapping and open review points in `docs/design/DESIGN_SYSTEM.md`. Not in the app yet: P3 ports the styles and components page by page.

## 2026-10-13 R6a-3 production installer pruning (Codex; pending review)

- After complete notices, remove declarations/maps/TS, non-license Markdown outside DSH and onnxruntime-web; preserve DSH packages, prompts, JavaScript and all remaining licenses. Audited 246 DSH runtime exports and typert's compiled-JS loader; pruning/notices tests 2/2. Isolated installtest product/identifier is environment-selected; production defaults unchanged.
- Stage 30,677→14,783 files; 248.42 MiB removed. Direct release Node/Edge: flash 1/17,591 tokens, real PDF search, 94-passage vectorization/hybrid, PDF/DOCX preview, Python 3.14.7/77 cached packages and scientific imports pass. Python online metadata waited; offline cache preparation and fixture failures retained. Final clean checkout check 213/213, zero skips; initial DSH timeout retained.
- Official package 103.04 MiB, SHA-256 in PREVIEW_TEST, not installed. USB WD40EFRX HDD installtest: program 30,677→14,783 files / 687.32→438.81 MiB; fresh 458.536→209.187 s, same-version overlay 573.845→274.134 s (no old uninstaller), deletion/finish 297.115→127.829 s; initial cancelled-uninstall/recovery total retained separately. Test product/data/registration/shortcuts removed, user's installation unchanged. Evidence/top-ten packages: `.sciencescope-local/temp/r6a-3/REPORT.md`.

## 2026-10-13 R6a-2b reviewed installer repackage (Codex; merged by Claude)

- Rebuilt `e9b62d6` without product changes: 128.20 MiB, SHA-256 in PREVIEW_TEST; stage/release app and production dependencies match by path, size and hash, with no test files or listed development packages. Installed program: 687.32 MiB / 30,677 files; fresh install 8 min 9 s.
- Checked the uninstall data-deletion checkbox and verified data removal. Installed native welcome, flash answer (1 request / 15,641 tokens), custom Python URL clearing, official-source save, previous-log rotation and process/WAL/SHM cleanup passed. Deleted acceptance data, verified empty projects/meetings/providers and no credentials, then closed; installation left untouched afterwards.
- Independent fresh-install Windows `npm run check`: 213/213, zero skips (450 s); first check's five local DSH startup failures during concurrent build I/O retained. Acceptance fixtures also retained initial async-settings/PID-check failures; settings requests and process creation times now identify the verified state. Evidence, screenshots and the ten largest directories: `.sciencescope-local/temp/r6a-2b/REPORT.md`; R6a-1's initial unpaid startup timeout clarified below.
- Review (Claude): the Python settings form now appears only after the saved settings load, so a quick choice is no longer overwritten by the late backfill. Install time goes to R6a-3 (`plans/tasks/done/R6a-3_install_size.md`).

## 2026-10-13 R6a-2 preview installer (Codex; merged by Claude)

- Current-user NSIS installer with `LICENSE` and a generated `THIRD_PARTY_NOTICES` (production npm packages, Node, uv, native-library notices). The unchecked "delete application data" option now also removes `<install>\data` through an uninstall hook. Installer 128.22 MiB; program 687.3 MiB; acceptance data 2.28 GiB including Python caches.
- Installed app at `<预览安装目录>`, real flash: message, two experts with reviewer and adoption, Chinese PDF with citations, built-in Python environment via the bundled uv, two-round automation, two real manuscripts: 7 requests / 115,607 tokens (model discovery separate). Overlay install (23 min 23 s) and default uninstall keep data; reinstall (7 min 48 s) keeps all 13 checked file hashes. Python preparation reused local caches and the Tsinghua index; product defaults restored afterwards.
- Fixed a missing `catch` in Python settings initialisation found at shutdown, with a regression test. Windows clean checkout 213/213, no skips; notices test 1/1. Seven pages at 100% / 125%, no page errors, clean exit. Node's licence text came from GitHub (no mirror). Evidence: `.sciencescope-local/temp/r6a-2`.
- Review (Claude): packaging now mirrors each resource folder with `/MIR` (the old `/E` copy kept files deleted since earlier builds in the installer); the shell keeps the previous launch's log as `desktop-host.previous.log`; the Python download source has its own state, so clearing a custom address no longer switches back to official or saves an empty one. Overlay install time (23 min) goes to R6b.

## 2026-10-13 R6a-1 runtime bundle (Codex; merged by Claude)

- The native shell starts the new core by default; the legacy host needs `SCIENCESCOPE_APP=legacy`. Tauri resources carry checksum-verified Node 22.22.2 and uv 0.12.19, `app/`, production `node_modules`, the Python and model manifests; data and logs live in `<install>/data`. Parallel pre-copy, a dependency fingerprint and a local tool cache make `npm run package` repeatable. Installer `1.0.0-alpha.0`: 128.17 MiB; installed at `<预览安装目录>`: 706.5 MiB before research data.
- `sharp` stays (Transformers imports it statically); `esbuild` moved to production (the static server builds readers with it). Python download source: official or custom, passed only to uv; no domestic mirror offered because its files were not verified.
- Windows clean checkout at `e715dd6` with the bundled Node: 212/212, no skips; Rust launch tests 2/2. Installed app: welcome page, title, fonts, Python setting, Chinese project, exit with no leftover processes; first welcome 4.3 s. Real-model smoke and reinstall / uninstall checks follow in 6a-2. Evidence: `.sciencescope-local/temp/r6a-1`.
- Clarification of the original report's "Initial local DSH timeout retained": `node22-runtime.log` records the first local `runtime.runtime.test.js` fixture failing SDK initialization after 30 seconds while dependency installation was running. No paid provider was called; disk contention was only a hypothesis, not a proven cause. The independent diagnostic (`diagnose22.log`) and complete check passed afterwards; the timeout was not raised and the failed evidence was retained.
- Review (Claude): lockfile tarball URLs normalised to `registry.npmjs.org` (13 pointed at npmmirror and failed to install elsewhere; npm still rewrites them to the configured mirror). Remaining fixes go into 6a-2.

## 2026-10-12 R4-7d version-note inputs (Codex; pending review)

- Cause: earlier 19/28 requests repeatedly sent large comparison inputs and accumulated tool results; those real fixtures had empty maps and no human minutes, so neither explains their millions of tokens.
- Complete marked changes now carry old/new parser paragraph numbers and neighbouring context; unchanged ranges remain readable. Research context includes goals/todos, plan entries and map title paths, with metadata separate. Tools, template structure and UI remain unchanged.
- Related tests 6/6 pass. Final flash runs: 4 requests/254,935 tokens and 3/168,924; three sections and both named old quality checks pass, but the cost target is unmet and unchanged-context/table interpretation errors remain. A separate handwritten 9,871-character fixture used 2/47,230. All paid runs: 21/1,234,617, including one retained provider output-limit failure.
- Independent fresh-install Windows npm run check passes 212/212, zero skips (399s), at feature 33c676e; evidence and detailed limitations: .sciencescope-local/temp/r4-7d/REPORT.md.

## 2026-10-12 R4-7c version comparison and log files (Codex; pending review)

- Based on7b ce5dbf4. P09 compares complete parser text in same-group side/unified word views, jumps changes, opens originals and copies old bytes as a new numbered version. Parse failure keeps originals accessible; shared comparison also feeds7b.
- P12 restores brief/files/details tabs and two-column page; schema1 references live in log Markdown, migration017 adds rebuildable projection refreshed by reads/external edits/revisions/undo/history. Secretary workbench append accepts links; shared workspace tools document the format, user edits check revision; bilingual strings complete.
- Related DOCX/service/Edge paths pass, including copy preservation, failed parse opening, secretary history/undo/catalog rebuild, file opening and language changes. Real flash first log run failed JSON after automatic ECONNRESET retry (2/3,300), diagnostic run passed linked real PDF IDs and history (1/3,523); both retained. Native actual100%/125% screenshots and clean exit checked; desktop occlusion exposed invalid initial captures, replaced with owned-window PrintWindow. Independent fresh-install Windows check210/210, zero skips, at8365acd (385s); native links and old P09/P12 comparisons inspected; IME candidate commit unverified. Evidence temp/r4-7c.

## 2026-10-12 R4-7b version notes (Codex; pending review)

- Based on7a bb9d80d. Migration016 stores auto notes, secretary background meeting identity and schema1 links; import triggers complete word diff/context/template organization through R4-4 runner and shared tools, with user-edit revision checks and recoverable failure.
- P14 legacy Markdown/relationship/addition cards, full editing/history, baseline reorganization, original/MD opening and R4-2 quote snapshots; bilingual secretary template and minutes versions off/apply connected. Temporary background meetings excluded from human chat lists; existing Main tools test disables auto notes to isolate its original assertion.
- Related service/Edge paths pass. Real flash two independent auto runs:19/2,073,400 and28/4,670,314 (total47/6,743,714), three-section notes and unchanged originals. Retained quality defects: run1 mistook literal filename ellipsis for truncation; run2 missed a source-verified social/environment-stimulus change and overclaimed only one edit. Native actual100%/125% notes screenshots/exit/WAL/SHM pass, long links wrap and internal originals/notes resolve; independent clean-install Windows check206/206, zero skips; old exact summary-settings expectation now includes versions:off. Evidence temp/r4-7b; IME candidate commit unverified.

## 2026-10-12 R4-7a version storage and import (Codex; pending review)

- Migration015 stores version groups/records; ordered imports keep original bytes and paired notes inside owned project versions/, monotonic numbering survives deletion. Shared workspace tools read paged parser text and edit notes with revisions/history; preview, group rename and recycle-bin removal connected.
- Restored legacy workbench left column and P13 table, bilingual input/order controls. Unified schema1 references documented with a lossless R4-2 mark mapping; no mark storage changes. Model sources official/ModelScope/HF mirror/custom persist and reach downloads; checksum mismatch stops without fallback. ModelScope five-file hashes verified from its public catalog.
- Related service/Edge tests and actual100%/125% native import/preview/exit passed; independent clean-install Windows check passed202/202, zero skips. Six existing history-entry tests were updated to the already-built resource buttons after the sidebar restoration; all content/restore/delete assertions retained. Real flash shared version tools:5 requests/100,420 tokens, paged DOCX read/notes write and unchanged original verified; two preceding DSH startup failures made0 requests, retained. Automatic secretary notes/real manuscript acceptance belongs7b, comparison/log associations7c. Evidence temp/r4-7a; full IME candidate commit unverified.

## 2026-10-12 R4-6b automation UI (Codex; pending review)

- Restored legacy execution menu (Normal/Automation), editable per-goal turn setting, execution-state panel, sidebar badges and background chat navigation; goal/turn/outbox events drive updates without polling, English entries included. Based on 6a 83c8de1.
- Independent clean-install Windows check passed 196/196, zero skips, including Edge and real DSH/local-model contracts; fixed decorative checkmark polluting menu names. Native shutdown exposed a completed goal being overwritten by a cancelled final reply: preserve reported terminal state, with regression test; runner unchanged.
- Native actual 100%/125% panel/background screenshots, clean process/WAL/SHM exits and restart passed. Real flash: first 3-turn run 18 requests/367,439 tokens (original acceptance FAIL retained), post-fix new goal 17/351,832 (PASS); total 35/719,271, all HTTP 200. Evidence temp/r4-6b. Full IME candidate commit remains unverified.

## 2026-10-11 R4-6a automation core (Codex; pending review)

- Migration014 persists goals; conductor schedules ordinary turns, context assembly adds goal/delta, shared goal_update reports complete/blocked. Pause/resume/end, user round budget, queued input and restart recovery covered; runner unchanged. Existing round scheduling extracted without behaviour changes.
- Scripted10 paths and real DSH passed; independent clean-install Windows check192/192, zero skips (2026-10-12). Goal/activity HTTP snapshots and goal.changed support next UI step; no approval or old-line changes.
- Real flash:3-round CSV/Python/chart/log/history completion18 requests/375,931 tokens; pause→resume2 rounds10/195,332. Reused environment triggered2 background memory requests/12,126:total30/583,389, all200. Evidence temp/r4-6a/live; native UI belongs6b.

## 2026-10-08 R4-8b Python settings and selection (Codex; pending review)

- Restored P40 environment CRUD/manifests/import-export/default/mirror/cache controls and project/standalone creation choices; meeting workspace uses anchored selection menu. Status follows python.changed; English entries included. Based on8a547884e.
- Fixed stale option lists, late default responses overwriting user selection, and disk scan reading SQLite after shutdown; functional/browser coverage passes. Existing Delete English corrected; unknown detection/space stays loading. Independent clean-install Windows check182/182, zero skips; no native code changes.
- Real Edge selection→DSH/pandas/humanize sum66 passes:3 requests/54,387 tokens;8a full chart/install acceptance17/337,718. Screenshots/logs temp/r4-8b; full native IME candidate commit remains unverified.

## 2026-10-08 R4-8a Python service (Codex; pending review)

- Migration013 stores environments/manifests/locks/bindings/operations under dataPaths().python; uv owns managed interpreters, isolated config, shared cache and package resolution. Direct install tool records actor/reason/results; deletion resets bindings.
- Context assembly resolves environment; runner adds only env and frozen tool-target forwarding. DSH restarts on next-turn env change with the same session id/history; scripted tests and real DSH/local-model shell test pass. Independent clean-install Windows check181/181, zero skips.
- Real uv3.14.7 builtin ready:740,988,364 logical bytes/3,893,674 exclusive; cache755,694,822; interpreters61,719,682; second environment shares numpy inode(3links). Real flash CSV/pandas/chart delivery + humanize install/use passes:17 requests/337,718 tokens; evidence temp/r4-8a. UI remains8b.

## 2026-10-08 R4-2c marks (Codex; pending review)

- Shared nonmodal selection/popover supports Main/secretary/assistant ownership, cross-target quotes, edit/locate/remove/clear and persistent preview highlights; source/page/offset/text/note snapshots use migration012 input records, no new refs state or limits.
- Sent versions clear atomically; later edits survive acknowledgement and failed turns restore without replacing newer marks. Independent clean-install Windows check177/177, zero skips. Based on2b6fc96c4.
- Native PDF/two marks/real flash answer with page1/page2 evidence passes:2 requests,36,217 tokens; OS100%/125% selection/list screenshots and process/WAL/SHM cleanup pass. Evidence temp/r4-2c; IME full candidate commit not rerun.

## 2026-10-08 R4-2b file preview and readers (Codex; pending review)

- Original-byte preview routes share local authentication; PDF.js text layer/pages/highlights, DOCX readable/layout, readonly CodeMirror, Markdown/KaTeX and CSV counted projection use local dependencies. Citation locators reuse research parser; unknown labels retain text.
- Attachment/library/details/P46 open preview; deliverable and project-file context menus retain default open. Based on2a a1dbcd1; independent clean-install Windows check175/175, zero skips; real OS100%/125% preview/page/highlight and exit cleanup pass (extended dual-screen fixture corrected to display1).
- Paid requests/tokens:0 for reader-only change (2a PDF live evidence2/35196); screenshots/evidence temp/r4-2b. Mark interactions and combined real model acceptance remain2c.

## 2026-10-08 R4-2a attachments and sending (Codex; pending review)

- Migration012 persists material drafts/message snapshots/outbox input; originals reuse the library, all participants share context compilation, forks retain references; runner unchanged. Main/secretary/assistant share upload/paste/drop, reference picker, receipt and P46.
- Fixed assistant overview identity using assistant_state; delayed welcome navigation until accepted send and versioned cross-window draft updates preserve newer selections. Core message/outbox/fork plumbing extended minimally with functional coverage.
- Independent clean-install Windows check173/173, zero skips; semantic browser fixture now isolates its fake events from real hardware probing (original assertions retained). Real OpenCode Go flash PDF read/page-citation:2 requests,35,196 tokens. Screenshots/evidence temp/r4-2a; preview/marks remain2b/2c.

## 2026-10-08 R4-5c native assistant window and orb (Codex; pending review)

- New surfaces reuse the assistant transcript; native userbar/startup preferences open the existing panel/orb, browser retains its inline panel. Added exact secondary-window authorization, hide/focus and native targeted navigation.
- Real125%/100% six startup states, toggle/hide/draft/dimensions, OS drag/clamp and native navigation pass; two real DSH/local requests, captured process trees empty, clean WAL/SHM. Browser4/4 and Rust2/2; independent clean-install Windows check169/169, zero skips.
- Based on5b373011c; paid requests/tokens:0, local runtime fixture counted separately; screenshots/failed fixtures/evidence temp/r4-5c. Full OS IME candidate commit not verified.

## 2026-10-08 R4-5b global assistant meeting and shared panel (Codex; pending review)

- Migration011 keeps one global meeting and overview hash; context assembly supplies project/minutes/plans/map data, excluding temporary and private chats, with completion-only dedup and rebuild refresh.
- Shared tools retain assistant-attributed history; userbar panel reuses secretary messages/model/composer/outbox, with main-page links and hide preserving drafts/execution.
- Based on5a e77d580; independent clean-install Windows check168/168, zero skips (Edge and real DSH/local fixtures); related tests4/4, static checks pass. Paid requests/tokens:0; screenshots/evidence temp/r4-5b.

## 2026-10-08 R4-5a context assembly (Codex; pending review)

- Extracted membersOf, workFolderOf, selectedMessages and the context portions of prepareSession into context-assembly; app.js injects minutes, secretary follow-up and project brief.
- Runner460→293 lines retains session lifetime, streaming/tools, completion and interruption; eight constructor-only test updates preserve165 assertions.
- Clean-install Windows check165/165, zero skips (Edge and real DSH/local fixtures); fixed stale @-mention draft/cursor callbacks without changing assertions. Earlier SDK cold-start timeout retained, isolated test1/1. Paid requests/tokens:0; evidence ignored temp/r4-5a.

## 2026-10-07 R4-11b chat queue, deliverables, formulas and map (Codex; pending review)

- Migration009 retains meeting drafts through restart, explicit resume, editable/cancelable queue and current-answer stop; versioned events prevent stale responses.
- Migration010 and shared workspace_present preserve originals, show legacy file cards/thumbnails and share only paths/descriptions. Fixed DSH nested tool-schema declaration; local KaTeX renders message formulas after source sanitisation; maps support floating nodes, directed links and Markdown paste/drop.
- Based on 11a28c88c1; Windows independent fresh install npm run check165/165, no skips, including real DSH/local fixtures. Paid requests/tokens:0; screenshots/evidence ignored temp/r4-11b.

## 2026-10-07 R4-11a window, snapshots and project folders (Codex; pending review)

- Migration008 preserves editing-boundary resource snapshots; history preview/restore/delete replaces workbench changes, with shared workspace_versions and session-local map undo/redo.
- Project entries go to the system recycle bin; location changes preserve existing meeting folders. Fixed stale semantic progress, internal-folder minutes export overwriting canonical content, and Windows clean-checkout LF conversion.
- Native build and actual100%/125% six-state screenshots plus all eight edge/corner drags pass; CDP viewport emulation explained prior frozen dimensions. Windows independent fresh install npm run check147/147, no skips; Rust2/2. Paid requests/tokens:0; complete IME candidate commit not rerun.

## 2026-10-07 R4-4c memory consolidation (Codex)

- Secretary idle work extracts and verifies minutes deltas plus their corresponding raw evidence into proposed memory; migration 007 persists cursors, checkpoints, statuses and reversible memory history.
- Restored grouped memory, inbox/edit/batch decisions, source jump, exact project brief, pending badge and bilingual settings; confirmed shared memory reaches Main on first/resumed/rebuilt turns without a content cap.
- User token budgets stop before later stages and resume saved extraction; provider usage now sums DSH settled attempts rather than absent turn/end accounting. Local DSH tool/retry and scripted memory regressions pass.
- Windows fresh clean checkout npm run check 132/132, no skips; native research flow and exit cleanup pass, 14 real requests / 216,694 tokens. Complete Chinese IME candidate commit remains unverified; M1 incomplete. Evidence/legacy screenshots in ignored temp/r4-4c.

## 2026-10-07 R4-4b secretary chat (Codex)

- Secretary uses an attached meeting with separate history, frozen Main follow-up packets and successful-only cursors; migration 006 persists binding, proposals and reversible proposal history.
- Restored legacy sidebar, streaming/tool cards, local model/effort menu, stop, editable drafts and explicit fill into Main; Main remains mounted and all new strings have English.
- Explicit model changes now restart the runtime process while resuming the same durable history; real DSH/local fixture plus scripted cursor/failure/stop/restart paths pass. Paid requests/tokens: 0.
- Windows independent clean checkout: fresh npm install, npm run check 116/116, no skips; Edge screenshots compared with frozen legacy UI. No attachments/policy/global assistant; details in ignored temp/r4-4b.

## 2026-10-07 R4-4a minutes and summary rules (Codex)

- Secretary background turns maintain incremental minutes with revision-bound coverage, usage and undo; settings consume discussion/message/token/project triggers, one-way Markdown export and direct map/plans/log updates.
- Main/expert session rebuilding uses minutes plus uncovered raw messages; concurrent user edits win and earlier queued questions cannot receive future summaries. Migration 005 preserves existing records.
- Windows independent clean checkout: fresh npm install, final npm run check 106/106, no skips (Edge + real DSH/local fixtures). First 105/106 exposed an old migration-004 fixture applying all newer migrations; scoped it to v4 and preserved both logs. Paid requests/tokens: 0.
- Legacy UI structure/CSS and bilingual strings restored; no secretary sidebar or memory yet. Detailed evidence: ignored temp/r4-4a and temp/r4-4a-screenshots.

## 2026-10-07 R4-3b ordered discussion UI (Codex)

- Restored the legacy discussion strip/menu, real author/status/tool cards, review adoption/read-lock, @ keyboard/IME handling and every participant's latest context; strings have English; roster cap removed.
- Based on R4-3a fe95561; related browser paths pass; first clean check 86/87 exposed an existing test response-listener race, fixed by registering before click; final Windows clean-checkout check 87/87, no skips. Native two experts → review → adopt → Main followup: 5 HTTP200 requests, 90,402 reported tokens, no unknown usage.
- Native restart restores records/context; title-bar close exits 0, all captured process identities disappear and WAL/SHM clear. The first instant check saw WebView2 teardown, so followup waited for real process exit (1.417s), without changing product shutdown.
- Legacy comparison/native screenshots and detailed evidence in ignored temp/r4-3b; model exceeded two sentences and reviewer used two reads despite a no-tools request, recorded as model behaviour. No autonomous/secretary/free discussion restored.

## 2026-10-07 R4-3a ordered discussion core (Codex)

- Participants join on invitation; persisted round policy runs independent experts in parallel, with fixed input cutoffs and ordered messages; reviewer follows all terminal answers.
- Adoption/consumption persist, incomplete or consumed reviews return 409; targeted retry/continue and whole-round cancellation use the shared runner; context API returns each participant's latest usage.
- Windows fresh checkout npm install + npm run check: 84/84, no skips (Edge included); scripted service/API and real DSH/local-model concurrent paths pass. Paid requests/tokens: 0; UI/native acceptance follow in 3b.
- Windows cold DSH boots contended on the shared module lock; adapter queues only startup and awaits pending launches on close, keeping answers parallel. Extra server type/app close changes drain cancelled work before SQLite closes; details in ignored temp/r4-3a.

## 2026-10-06 Review of R0–R4-1 and plan (Claude)

- R4-1b merged (`ee83c3d`); fixed 10 tests that needed a pre-existing temp
  folder (`3e058fe`). Linux check 68: 66 pass, 2 Windows-only.
- Review `reviews/REVIEW_2026-10-06.md`: mainline on track; biggest gap is multi-expert
  discussion (only `direct`). ROADMAP rewritten for R4–R6 with discussion and
  secretary first, milestones M1/M2; old roadmap archived.

## 2026-10-06 R4-1b research UI and local hybrid retrieval (Codex)

- Baseline `aa1a3fe`; branch `codex/r4-1b-research-ui-20261006`. Restored
  database/project/personal/external routes, source table/details, item cards
  and metadata/revision workflows using legacy CSS and Preact. Four research
  tabs only; memory/inbox/brief and previews/attachments stay in later tasks.
  New strings have English entries. Kept the legacy structured JSON form.
- Source PATCH/reparse/open and filtering/sorting/pagination now operate on
  R4-1a records. Imports have no single-file cap. Migration 004 stores vectors
  in the same SQLite. A shared semantic service serves HTTP and AI tools;
  explicit setting/download actions, hashes, hardware check, worker inference,
  background warmup, dialogue index pauses, version checks and whole-request
  300ms keyword fallback retained. Progress is pushed, never polled each second.
- Minimal extra wiring: app.js owns service start/close; tools.js receives it;
  server.js exempts source imports from its generic body bound; static.js
  supplies installed KaTeX/fonts; database.js permits sqlite-vec loading;
  settings resource consumes the new default. Functional integration tests
  cover API/tool sharing and source management; no old-line/native code edits.
- Discovered → cause → repair → verification: async settings initialization
  overwrote download state with model-missing; initialize now respects the
  active download flag, tested with concurrent settings and pushed states.
  Warmup initially blocked startup; it now runs in background, tested with
  a held warmup. Editing populated textareas failed: implicit label included
  default body text; explicit aria-label fixes it, the same create/edit/replace
  browser path passes. Initial full check 67/68 retained in the local failure log.
- Windows real acceptance: clicked download in Settings, all 5 pinned files
  (135,392,183 bytes) pass SHA256; hardware AVX2/32GB, index 9/9, restart ready,
  Chinese semantic query returns hybrid and reads the matching full passage.
  Reference/new screenshots compared; restored database before workbench.
  Task-required top scope tabs/excluded future controls differ from old final
  view. Semantic controls are on the task-specified runtime page, old P33 on
  database settings. Original/new shell differences remain from R3/L1.
- Local evidence/screenshots: `.sciencescope-local/temp/r4-1b/`. Automated
  vector tests use injected fake embeddings, no model downloads. Paid model
  requests/tokens: 0/0; real local inference is reported separately.
- Final Windows `npm run check`: formatting/lint/types and 68/68 tests pass,
  zero skips (82.482s), including all 9 new research Edge paths, existing 3
  Edge paths and real DSH/local-model tests. No native code changed.

## 2026-10-06 R4-1a research base core (Codex)

- Baseline `ac23f0d`; branch `codex/r4-1a-research-core-20261006`. Rewrote
  research parsing/storage/retrieval under `app/services/research/`: PDF,
  DOCX, Markdown, LaTeX and text, unchanged 1200/2400 retrieval units with
  no document truncation. Originals live in `library/originals/` under the
  new data root. No old-line, UI, semantic retrieval or consolidation edits.
- Migration 003 adds sources, chunks, items, immutable revisions and FTS.
  v2 upgrade test proves backup and preservation of projects/messages.
  Superseded items retain their row, validity/provenance and search index;
  default queries select active records. Private items are excluded from AI
  search/read candidates. Each import/item mutation records a transactional
  `research.changed` event for the next UI stage.
- Added research HTTP routes and shared `research_search`/`research_read`
  tools, paged with total/remaining and full passage text. Citation locators
  preserve old composite, Chinese and fullwidth formats; unknown labels keep
  their text and reason. Source ids disambiguate project/personal numbering.
- Discovered → cause → repair → verification: Mammoth discarded empty HTML
  spans for DOCX page breaks, so explicit pages were missing. Its public
  document transform now retains nonempty styled page markers; genuine DOCX
  import/search/read proves pages 1/2 and equations. Without reliable breaks
  page remains null. Scans retain originals and report failed extraction; no OCR.
- Minimal extra integration file: `app/core/index.js` exposes the already
  owned shared DB connection so the service receives DB/events together;
  migration/API/scripted-meeting tests exercise that dependency end to end.
- Final Windows `npm run check`: 50/50, zero skipped; formatting, lint and
  types pass, including 8 new research tests, 3 Edge tests and existing real
  DSH/local-model paths. Paid model requests/tokens: 0/0. No UI change or new
  screenshot required. Final log: `.sciencescope-local/temp/r4-1a/check-final.log`.

## 2026-10-06 L1 Windows native shell (Codex)

- Baseline `f526cd4`; branch `codex/l1-windows-20261006`. Opt-in
  `SCIENCESCOPE_APP=new` starts `app/main.js --data` and loads its first JSON
  line's `ui`. Legacy startup remains the default. Development data defaults
  to `.sciencescope-local/data`; logs/WebView cache follow the new data root.
- `src-tauri/src/new_app.rs` holds launch resolution/readiness; the existing
  Job cleanup/window/dialog capabilities are reused. Added opener plugin and
  scoped HTTP(S) opening; home site buttons invoke it in native windows.
  Node publishes a cooperative `/api/shutdown` capability so SQLite closes
  before the Job fallback. Regression covers Chinese paths/CRLF readiness,
  legacy default and native shutdown/WAL cleanup.
- Discovered → cause → repair → verification: Explorer calls silently failed
  with `ENOENT` because the launcher PATH omitted Windows. `system.js` uses
  `SystemRoot/explorer.exe`, awaits spawn and reports failure; the project
  route awaits it. A regression and real native reopen prove Chinese folder
  opening and default-program HTML opening. No UI structure/style changes.
- Default test concurrency ran 16 files together; two cold DSH profiles each
  materialize about 419 dependency junctions on the external H drive. Startup
  timed out at 30 seconds (initial 38/40, then 40/41), while isolated runtime
  tests and full concurrency-2 comparison passed. `check`/`test:app` now use
  concurrency 2; production timeout unchanged. Final `npm run check` 42/42
  (0 skips), including three Edge tests/screenshots; Rust tests 2/2 and build
  passed. All failed logs remain local.
- Native real-model flow: provider/key/default configured in Settings,
  Chinese project/chat → streamed answer → main edits plans (agent_main
  revision) → workbench/change log → undo → Ctrl+K → English. Five HTTP200
  requests to `deepseek-v4.1-flash`, input 83,558 / output 1,264 / total 84,822
  tokens, no retry/failure; a secret-free counting gateway forwards DSH auth
  and session headers via the local network proxy. Key exists only in ignored
  credential files, never in environment, screenshots or request ledgers.
- WebView2 imports/fonts, minimize/maximize/close, real OS topbar drag,
  native Chinese folder selection/binding and Chinese ZIP download passed.
  Real IME trusted composing key/input events and Enter produced no message;
  candidate-to-Chinese commit completion was not fully verified (untrusted
  compositionend remains distinguished). Synthetic composing-Enter also passed.
- Normal native close/reopen exit 0 and clean WAL/SHM; a separate real-DSH/local
  model run captures host + active DSH before close and proves all owned PIDs
  gone afterward. That fixture adds one local model request, zero paid requests.
- Native/old-reference screenshots reviewed: no platform font/module failure;
  minor sidebar boundary/width and empty project chat wording/badge differences
  remain for Claude. English history retains participant names in Chinese.
  Stable search screenshot centers correctly; initial offset was animation.
  Evidence and long audit only in `.sciencescope-local/temp/l1-windows/`.
  Frozen `desktop/`, `scripts/`, `adapters/` unchanged; no R4/UI redesign.

## 2026-10-05 UI restore: every old entry back, connected to the new core (Claude)

- User direction: the front-end design stays; every feature design not
  rejected is kept. Inventory of all 48 prototype pages and old modules:
  `docs/archive/legacy/UI_RESTORE.md`.
- Batch 1 `b466bb3` settings; batch 2 `152200d` meeting chrome; batch 3
  `649340a` workbench and navigation pages. Full old style sheet stack.
- Fixes found on the way: settings reload when changed elsewhere; a loaded
  turn no longer overwrites a newer ended one; SSE headers flushed at once;
  the map canvas no longer swallows button clicks.
- Remaining entries need services and are queued as R4-1…R4-10.
- Browser tests: meeting, settings, workbench. `npm run check` 38 pass,
  2 skipped (Windows-only). Chromium headless names downloads with CJK
  names "download"; the header is correct (checked in the test).

## 2026-10-05 R3 redo: the old main interface on the new core (Claude, cloud Linux)

- User direction: keep the old main interface design; the rebuild is about the
  backend. The first R3 skeleton (764c62c) used a simplified new design and was
  replaced the same day.
- `app/ui` now renders the old DOM structure and class names and loads the old
  style sheets unchanged (`app/ui/styles/legacy/`, same order as the old
  interface); icons come from the prototype's `iconPaths`. Captures of the old
  interface used for comparison: `.sciencescope-local/temp/r3ref/`.
- Connected: top-bar menus, sidebar tree and object menus, search palette
  (projects, titles, message text via `GET /api/search`), welcome page (first
  message creates the meeting), streaming answers with tool activity cards,
  stop, branch, model choice, browse all with unarchive, workbench (plan and
  log cards, change history with undo, research-map canvas with the
  prototype's layout, project folder via `GET /api/projects/:id/files`).
  Entries without a backend yet are hidden (list in CORE_MODEL §10).
- Browser test rewritten for the old markup; `npm run check` 35 pass, 2 skipped.

## 2026-10-05 R3 interface skeleton (Claude, cloud Linux) — superseded

- `app/ui/`: Preact + htm without a build step, served by the host
  (`app/server/static.js`; vendor builds from node_modules via an import map).
  One state object updated by `applyEvent`; actions call the API; hash routes.
- Views: sidebar (projects, meetings, pin/rename/archive), home (first message
  starts a meeting), meeting (streaming, tool cards with preamble/args/result,
  interrupt, fork, @mention, earlier pages), workbench (global/project plans,
  log, map tree, change history with undo). zh/en with a coverage test.
- New `GET /api/events/head`; `app/main.js` prints a `ui` address.
- Browser test (`app/ui/ui.browser.test.js`): real host + scripted AI in
  headless Chromium, create project → meeting → streamed answer with tool card
  → plan on the workbench → undo → English. `npm run check`: 35 pass, 2 skipped
  (Windows-only). Screenshots: `.sciencescope-local/temp/r3shots/`.

## 2026-10-05 R2 Windows acceptance (Codex)

- Baseline `2afa40f`, branch `codex/r2-windows-20261005`, H-drive workspace.
  `npm install` succeeded (0 vulnerabilities); final `npm run check` passed
  format/lint/types and 35/35 tests, including both real DSH fixture tests.
- OpenCode Go returned HTTP 400 without `x-opencode-session`: provider settings
  now forward optional `headers` through the existing DSH provider config.
  The end-to-end test stores its key through the credential API and checks
  authorization and a custom session header at the local model endpoint.
- The interruption test hung because its 20 ms sleep preceded session startup
  on Windows. It now waits for the generator to install its abort listener;
  the related six tests and full suite pass. Initial failure log is preserved.
- `node app/main.js --data <Chinese data root>` plus credential/settings,
  project/meeting/message APIs ran `deepseek-v4.1-flash`: the actual plans file
  contains 清洗数据 and its revision has `actorId=agent_main`. A counting gateway
  forwards DSH's credential/header through the local network proxy without
  recording secrets. Six paid requests: four HTTP 200, two HTTP 400 (initial
  missing configuration; then a missing header in the validation gateway).
  Reported usage totals 65,374 tokens; neither 400 reported usage.
- Windows `file:///<工作区>/.../plugin.js`, Chinese cwd/data/temp and real console
  Ctrl+C passed on Node 24.21.0: app exit 0, captured app/DSH processes gone,
  WAL/SHM removed. Idle release passed with a temporary 2-second runner setting
  and a real DSH/local model; production default remains 600,000 ms. Ten actual
  minutes were not timed. Validation assertions were corrected for revision
  metadata and reused PIDs; paid model results were retained without rerunning.
- Evidence: `.sciencescope-local/temp/r2-windows-validation/summary.json`,
  preserved failed runs and final check log. No frozen old-code/UI edits.

## 2026-10-05 Rebuild R2 (Claude, cloud)

- Merged Sol's R1 Windows fixes (`1a1f402`: rename retry, locked-file tests).
- R2:
  - `runtime/port.js` and a scripted runtime for tests;
  - lean DSH adapter: one plugin in the DSH process (events, tool calls back to
    the host, prompt/interrupt/instructions) plus one bridge in ours; providers
    and the credentials path are passed as a patch; approvals set to never;
  - `core/context.js`: instructions with ids, seed (minutes plus full record),
    follow-ups (new messages only), visibility (no unfinished or unadopted
    messages), mentions;
  - `core/turns.js` with migration 002 (tool-call preamble);
  - `services/tools.js` (workspace_read/edit/undo);
  - `services/turn-runner.js` (streaming, preamble moved to the tool card,
    max-tokens kept, interrupt, idle release after 10 minutes);
  - `services/conductor.js` (direct policy, mentions, restart recovery);
  - `app.js` assembling the host.
- Verification: `npm run check` 33 pass and 2 Windows-only skips. Two real-DSH
  tests use a local fixture model: a single session (instructions, streaming,
  tool round trip, resume) and the end-to-end flow (API, conductor, DSH, tool,
  plans file, revision attributed to agent_main).

## 2026-10-05 R1 Windows acceptance (Codex)

- Integration baseline `3e9046d`, branch `codex/r1-windows-20261005`, H-drive workspace.
- `npm install` succeeded (0 vulnerabilities); `npm run check` passed format,
  lint, types and 23/23 tests on Windows (Node 25.8.1).
- A real Windows file handle denying delete sharing reproduced `EPERM` for
  file replacement and project-folder rename; failed writes left `.tmp` files.
  Added 50/100/200/400 ms rename retries, `PATH_BUSY`/409 on persistent locks,
  and temporary-file cleanup. Tests prove old text/revisions/project metadata
  remain unchanged on refusal and a released transient lock recovers.
- CLI project/meeting/message/plan flow preserves Chinese paths and UTF-8 text;
  Node 24.19.0 `app/main.js` exits 0 on real Ctrl+C both normally and with active
  SSE. WAL/SHM files disappear, reopened data is intact; owned processes exit.
- Evidence only in `.sciencescope-local/temp/r1-windows-validation/`; no paid
  calls or changes to the frozen old-code directories. `v0-prototype` target is
  `6d2b10c`, as specified by the handoff; tag/push receipt is reported at delivery.

## 2026-10-05 Rebuild R0 and R1 (Claude, cloud)

- R0: old line merged into main (PR #11, `6d2b10c`); style tooling and `npm run check`.
- R1, new code in `app/`:
  - `core/db`: node:sqlite, numbered migrations in `user_version`, backup before
    migrating, refusal of newer data;
  - `core/events.js`: change feed, recorded in the same transaction and
    delivered after commit; transient stream deltas;
  - `core/workspace`: file resources (map, plans, log, minutes, notes, agent,
    settings), full-text revisions, undo with conflict check, external edits
    recorded on the next read;
  - projects with readable folders that follow renames; participants with
    agent definition files; meetings with members, policy and fork; messages
    with paging;
  - `server/`: routes per domain, local token, SSE with replay; `main.js`;
    `cli.js`.
- Verification: `npm run check` (Prettier, ESLint, tsc, 21 tests) on Linux.
  Windows handoff: `docs/archive/legacy/handoff/R1_WINDOWS.md`.
