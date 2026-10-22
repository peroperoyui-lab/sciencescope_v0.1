# D3c + D8 进入编辑台、跳到文稿位置、编辑台原生窗口

- 起草：Claude，2026-10-22。依据：`architecture/EDITING_DESK.md` §2 场景 1、9，§7（窗口），§8（接口、事件），§10 的 D3c、D8；`core/meetings.js` 的 `fork`、`touch`；D3a 的会话（`desk_sessions.meeting_id`）；D6 的 `relocate`（按原文和前后文找位置）；`src-tauri/src/main.rs` 的 `open_secondary_window` 和 `assistant-window.json`（助手窗口记住大小的做法）。
- 执行：Sol（Windows）；审阅：Claude。约 2.5 小时，一步交付；超出就停下汇报。

## 目标

1. 从对话进入编辑台时，可以「接续当前对话」或「开新分支进入」；直接从左栏进入时，绑定这个项目最近用过的对话，没有就新建一个。
2. 对话里引用过文稿某一句的标记，能换算成编辑台当前文稿里的位置；原文已经不在时说清楚，不猜。
3. 编辑台原生窗口记住大小、位置和是否最大化；被叫到前面时，最小化或被挡住的窗口也能出来；主窗口不被锁定。

界面（进入横条、标记点击、滚动高亮）是 U4、U8 的事，这次只做后端和原生窗口。

## 用户会怎么用

- 主专家调了 `desk_suggest`，对话底部出现"要进入编辑台吗？"。用户点「开新分支进入」：从最新一条消息分出新对话，编辑台绑定新对话，原对话停在这里不变；已经打开的这个项目的文稿，之后的修改都记在新对话名下。
- 用户点左栏「编辑台」直接进入：绑定这个项目最近用过的对话；新项目还没有对话时，新建一个"编辑台"对话。
- 对话里有一条"第三章第二段说样本 1,284 家"的引用标记。用户点它：编辑台窗口从最小化恢复到前面，打开那份文稿，滚到那句并短暂高亮。文稿在 Word 里改过、那句挪了位置，仍能找到；那句被删了，提示"这句已不在当前文稿里"。
- 用户把编辑台拖到副屏、调成半屏，关掉再开，还在原处；拔掉副屏后再开，窗口回到主屏可见范围内。

## 要做的

1. **进入编辑台**：`POST /api/desk/enter { projectId, meetingId?, mode: 'continue'|'branch', atMessageId? }` → `{ meeting:{ id, title, parentMeetingId }, mode, created, sessionIds }`。
   - `continue` 带 `meetingId`：用这个对话。对话不属于这个项目返回 `DESK_MEETING_PROJECT`。
   - `branch`：用现有 `meetings.fork` 从 `atMessageId`（省略时取最新一条消息）分出新对话，标题沿用 fork 的默认写法。对话还没有消息时返回 `DESK_BRANCH_EMPTY`。原对话的消息、成员和设置都不变。
   - 不带 `meetingId`（只能是 `continue`）：取这个项目里未归档、最近有活动的对话（按 `touch` 写的 `updated_at`）；没有就按 `POST /api/meetings` 的同一套默认（成员、工作文件夹）新建，标题"编辑台"，`created: true`。
   - 绑定：这个项目当前打开的所有会话，`meeting_id` 改成这次的对话（`sessionIds` 列出改了哪些）。已经记下的修改不改归属。之后 `POST /api/desk/sessions` 打开同组已有会话时，如果带了不同的 `meetingId`，也改绑（现在是忽略）。
   - 进入后对这个对话 `touch` 一次，发 `desk.entered { projectId, meetingId, mode }`，界面据此收起进入横条、更新编辑台显示的对话。不自动让专家开始回答。
2. **跳到文稿位置**：`POST /api/desk/focus { reference }`，`reference` 是 schema 1 引用对象（`core/references.js`），`kind` 为 `project-file`（`projectId`、`path`）或 `version`（`id`），`location` 里有 `blockId`、`characters` 和 `quote`（`{exact,prefix,suffix}`），哪项缺都可以，但 `quote.exact` 和 `blockId` 至少一个。
   - 找到版本组，取这个组的当前文稿：已有打开的会话就用它；没有就像 `POST /api/desk/sessions` 一样打开一个（tex、md 的块 id 只在会话内稳定，所以位置必须在会话里算）。`version` 引用指向旧版本时，也在当前文稿里找，返回里带上引用原本的 `versionId`。
   - 定位规则复用 D6 的 `relocate`：先按 `blockId` 和 `characters` 核对 `quote.exact`；对不上在全文找，多处命中用前后文选；只有 `blockId` 没有原文时，块还在就定位到整块。
   - 返回 `{ projectId, path, groupId, sessionId, versionId, status:'exact'|'moved'|'missing', blockId?, from?, to? }`，同时发同样内容的 `desk.focus`（编辑台窗口已经开着时据此滚动，不管点击发生在哪个窗口）。`missing` 时不带范围。
   - 不支持的格式、找不到文件按现有错误码返回。
3. **原生窗口（D8）**，改 `src-tauri/`：
   - 记住编辑台窗口的位置、大小、是否最大化，存在原生数据目录（照 `assistant-window.json`，比如 `desk-window.json`）。移动、缩放结束时写，不在拖动过程中频繁写。
   - 打开时恢复；记下的位置已不在任何显示器的可见范围内（拔了副屏、改了分辨率）时，回到主屏居中，大小不超过主屏工作区。125% 缩放下大小和位置不漂移（注意物理像素和逻辑像素）。
   - 已有编辑台窗口时再调 `open_secondary_window`（surface `desk`）：最小化的先恢复，再显示、置前、拿焦点，然后发 `desk-open`。查一下 Windows 前台锁：从主窗口、助手窗口里点击时都要能置前。
   - 编辑台窗口不是模态的，主窗口和助手窗口照常可用；关主窗口时编辑台的行为不变（照现有的副窗口处理）。
   - 标题栏的置顶按钮不在这次做（等窗口回查那条分支合并后由 Claude 接）。
4. **测试**：
   - 进入：接续；分支（原对话消息数不变，新对话有 `parentMeetingId`、`forkMessageId`）；不带对话时取最近的、没有时新建；对话不属于项目；空对话分支；打开的会话被改绑，之前的修改归属不变；`desk.entered` 事件。
   - 打开会话：同组已有会话带不同 `meetingId` 时改绑。
   - 跳转：docx 和 tex 各一份；`exact`；外部改过文件后（段落挪动）`moved`；原文删掉 `missing`；多处命中用前后文；只有 `blockId`；`version` 引用指向旧版本；没有会话时自动打开；`desk.focus` 事件。
   - 原生部分的位置换算（越界回到主屏、缩放）能抽成纯函数的就写 Rust 单元测试。

## 可以改的

`app/services/desk/`（可加文件）、`app/server/routes/desk.js`、`app/core/meetings.js`（只在需要时加一个"项目最近的对话"查询）、`app/ui/api.js` 的 `EVENT_TYPES`（只加 `desk.entered`、`desk.focus` 两项）、`src-tauri/src/`、各自测试；`docs/architecture/EDITING_DESK.md`（§7、§8 按实际行为改）、`docs/product/FEATURES.md`、`docs/process/NATIVE_SETUP.md`（如有需要）、`docs/log/IMPLEMENTATION_LOG.md`（不超过 5 行）。

## 不做的

- 除 `EVENT_TYPES` 两项外不改 `app/ui/`（横条、标记点击、滚动高亮由 Claude 做）。
- 不做编辑台标题栏置顶，不改主窗口、助手窗口的大小记忆。
- 不新增依赖（Rust 和 npm 都不加；不引入 tauri 的 window-state 插件）。
- 不动 `<预览安装目录>` 及其数据，不把稿件、截图提交进仓库。

## 完成标准

- 干净检出 `npm run check` 全部通过（含 Windows 测试）；`cargo test` 通过。
- 第 4 条的测试都在。
- 原生验收（Windows，开发构建或本地打包，不用预览安装）：在开发者工具里调 `open_secondary_window` 打开编辑台；调整大小、拖到另一处（有副屏就拖到副屏）、最大化再还原，关掉重开位置和大小都在；改记录文件让位置越界，重开回到主屏；编辑台最小化或被主窗口挡住时，从主窗口和助手窗口各调一次，都能到前面；编辑台开着时主窗口照常可用。100% 和 125% 各做一遍。报告里写结果，不附截图。

## 交付

- 分支：`codex/d3c-d8-desk-enter-window-YYYYMMDD`，从 `main` 最新提交开始。报告不超过 15 行，给出远程分支与 SHA、原生验收结论。不建 PR、不合并。
