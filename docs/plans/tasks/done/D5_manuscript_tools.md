# D5 专家改文稿：manuscript 读写工具、按修改撤回、划选改写

- 起草：Claude，2026-10-22。依据：`architecture/EDITING_DESK.md` §2 场景 2、§5（AI 改写流程、工具表、提示词要点）、§8、§12；`DECISIONS.md` 2026-10-22「编辑台第三版」（专家的修改直接写进正文、不加修订标记、只在后台记录；底部提示可「看改了什么」「撤销」）；D3a/D3b 的会话服务（`app/services/desk/`，修改记录 `chg_…` 已带 `actor_id/meeting_id/turn_id/instruction`）；D4 的 `GET /api/versions/:id/diff`；现有工具 `app/services/tools.js`、批准 `app/services/approvals.js`、提示词 `app/core/context.js`。
- 执行：Sol（Windows）；审阅：Claude。约 2–3 小时，一步交付；超出就停下汇报。

## 目标

1. 专家（主专家、秘书、全局助手、被 @ 的专家）能用共用工具读文稿、按块改文稿、存回项目文件或存版本，每处修改记在 `desk_changes` 里，知道是谁、哪一轮、什么指令。
2. 专家的修改能按 `chg_…` 一处一处撤回，规则同用户的撤回。
3. 编辑台能把一句划选连同指令发给绑定的会议，主专家改完，界面经 `desk.changed` 收到新内容。
4. 专家觉得初稿成形时能提议进入编辑台（`desk_suggest`），界面以后据此弹横条（横条是 U8）。

## 用户会怎么用

- 用户在编辑台划选"结果表明该方法显著优于基线"，输入"语气缓和些，补上样本量"。对话里出现一条用户消息，带这句的引用标记；主专家调 `workspace_read` 读这一段，再调 `workspace_edit manuscript replace`，正文立即变了，没有修订标记。
- 主专家改错了：用户点提示里的「撤销」，那一处恢复原样；之后用户自己又改过这一段时，撤销提示先撤回后面的修改。
- 用户没开编辑台，在对话里说"把第三章的'显著'都改成'较为明显'"：主专家读文稿、逐处改；修改进工作副本，用户下次打开编辑台时看到改后的正文，项目文件没动。
- 主专家改完说"要写回项目文件吗？"，用户同意后它调 `save {to:"project"}`；会议在「请求批准」模式下，这一步和 `write_file` 一样先弹批准。

## 要做的

1. **读**：`workspace_read target="manuscript"`。
   - `scope=<项目 id>`、不给 `key`：列出文稿，用 D3b 的 `listDocuments`，每项给 `key`（已登记为 `<项目 id>/<组 id>`，未登记为 `<项目 id>/path:<相对路径>`）、格式、最新版本号、有没有打开的会话。
   - `key=<项目 id>/<组 id>` 或 `…/path:<相对路径>`（未登记的先按 D3b 登记）：按块分页（`offset` 默认 0、`limit` 默认 40，最多 200），返回 `{ groupId, versionId, sessionId|null, seq, blocks:[{id,kind,level,text}], remaining }`。可加 `version=<版本 id>` 读历史版本（只读）。有打开的会话时读会话里的当前内容，否则读最新版本。
   - 原子在 `text` 里写成记号 `⟦<类型>:<ref>⟧`，域和公式在记号后跟显示文字，如 `⟦field:8 (Zhang, 2024)⟧`、`⟦math:7 x2⟧`；图片 `⟦image:9⟧`。tex、md 没有原子，原文照给。
2. **改**：`workspace_edit resource="manuscript"`，`key` 同上，`op`：
   - `replace {block, find, with}`：`find` 在这一块的读出文字（含原子记号）里必须出现且只出现一次，否则 `TEXT_NOT_FOUND`、`TEXT_AMBIGUOUS`，并回给这一块的当前文字。`find` 范围里的原子记号必须在 `with` 里原样、按原顺序出现，否则 `DESK_ATOM_CHANGED`（不让模型改公式、引文、图片）。新字沿用 `find` 开头那个字的格式标记。
   - `insertBlock {after, text}`：`after` 是块 id 或 `"^"`（开头）；docx 继承 `after` 那段的段落格式；`text` 不能含原子记号。
   - `removeBlock {block}`。
   - `save {to:"project"|"version", label?, tier?}`：走 D3a 的保存；`DESK_EXTERNAL_CHANGE`、`DESK_SAVE_CONFIRM` 原样回给模型（模型应告诉用户，不自动加 `confirm`）。
   - 没有打开的会话时，为最新版本开一个后台会话（绑定当前会议），修改进工作副本；用户之后在编辑台打开时接上这个会话。
   - docx 走 `updateBlocks`，tex、md 把改后的全文交给 `updateText`（D3b），不要另写一套记录。每次调用返回 `{ revisionIds:['chg_…'], seq, block:{id,text} }`。修改记录的 actor 填 `actorId`（专家）、`meetingId`、`turnId`，`instruction` 填这一轮的用户消息前 200 字。
   - 批注、索引（`comment`、`bind`、`unbind`）留到 D6，这次调用返回 `UNKNOWN_OP`。
3. **撤回**：`workspace_undo revisionId="chg_…"` 走 `undoChange`；挡住时返回 D3a 的 `DESK_UNDO_BLOCKED` 和中文提示。其他 `revisionId` 照旧走工作区撤回。
4. **批准**：`save {to:"project"}` 是写项目文件，「请求批准」模式下和 `write_file` 一样先问用户（`approvals.js` 现在只认 `write_file`、`edit_file`，加上这一种；批准卡片写明文件路径和对应版本）。其余 manuscript 修改只动 `data/` 里的工作副本，不问。「始终允许」规则按现有的项目级规则走。
5. **划选改写**：`POST /api/desk/sessions/:id/rewrite { blockId, quote, instruction }`。
   - 会话没绑会议时返回 `DESK_MEETING_REQUIRED`（绑会议是 D3c 的 `/api/desk/enter`，这次测试里直接建会话时传 `meetingId`）。
   - 在绑定的会议里发一条用户消息，正文是指令；研究输入附一条引用标记（schema 1，`kind:'version'`，`id` 为会话基础版本，`location:{paragraph:<块序号>, blockId}`，`quote`），和现在对话里划选引用的标记同一格式。然后照常开始主专家这一轮。沿用现有发送流程：会议空闲时返回 `{ messageId, turnId }`；会议正忙时进入现有待发送队列，返回 `{ messageId:null, turnId:null, queued:true, itemId }`，真正发出后由现有事件通知（2026-10-22 Sol 提问，所有者同意）。
   - 时间线里这条消息照常显示（界面怎么收成一行"编辑请求"是 U4 的事）。
6. **`desk_suggest {reason, document?}`**（新工具，所有角色都有）：`document` 是第 1 条的 `key`。记一条持久事件 `desk.suggested {meetingId, reason, key|null}`，返回 `{ suggested:true }`。同一会议 10 分钟内重复调用只记一次。
7. **提示词**（`app/core/context.js` 里讲工具的地方；按 §5「提示词要点」，不加硬限制）：文稿用 `workspace_edit manuscript`，不用 `edit_file` 改 docx/tex/md；只改划选或用户指定的范围，范围外的问题在回答里说；`find` 取足够长的原文；原子记号原样保留；回答只说改了什么、为什么。秘书和全局助手按用户要求读、比较、存版本，不主动改正文。
8. **测试**（合成文件用代码生成，模型用脚本运行时）：
   - 读：分页和 `remaining`；原子记号格式；有会话时读到未保存的修改；`version=` 读历史版本。
   - 改：docx 中英文 `replace`（其余段落逐字节不变）、`find` 找不到 / 不唯一、动了原子记号被拒、`insertBlock`、`removeBlock`；tex、md 各一次 `replace`；没有会话时自动开后台会话，之后用编辑台接口打开接上同一会话；修改记录带专家、会议、轮次和指令。
   - 撤回：按 `chg_…` 撤回成功；后面又改过同一块时被挡。
   - 批准：「请求批准」模式下 `save {to:"project"}` 先出批准，拒绝后项目文件不变；自动模式直接写回。
   - 改写接口：没绑会议报错；绑了会议时发出带引用标记的用户消息并开始一轮。
   - `desk_suggest`：记事件，10 分钟内去重。

## 可以改的

`app/services/tools.js`、`app/services/approvals.js`、`app/services/desk/`（可加文件）、`app/server/routes/desk.js`、`app/core/context.js`（只加文稿工具的说明）、研究输入里引用标记的构造（如需复用），及各自测试；`docs/architecture/EDITING_DESK.md`（§5、§8 按实际行为改）、`docs/product/FEATURES.md`、`docs/log/IMPLEMENTATION_LOG.md`（不超过 5 行）。

## 不做的

- 不改 `app/ui/`（浮动工具条、提示条、横条是 U4、U8）。
- 不做批注和索引（D6）、`/api/desk/enter` 和 `desk.focus`（D3c）、比较算法（D4 已做）。
- 不新增依赖；不加硬性的字数或次数限制。
- 不动 `<预览安装目录>` 及其数据，不把稿件、截图提交进仓库。

## 完成标准

- 干净检出 `npm run check` 全部通过（含 Windows 测试）。
- 第 8 条的测试都在。
- 真实模型：用 `deepseek-v4.1-flash`，在 D2b 中文学位论文的副本上开会话并绑定一个新会议，走一遍：① 改写接口发"语气缓和些"改一句；② 对话里让主专家把某一节里的一个词全部换掉（至少 3 处）；③ 撤回其中一处；④ 让它存为版本。报告每步的请求数、token、耗时，模型有没有改范围外的字、有没有动原子记号；存版本后用 D4 的 diff 核对只有这几处变化。稿件只放 `.sciencescope-local/temp/desk-d5/`。

## 交付

- 分支：`codex/d5-manuscript-tools-YYYYMMDD`，从 `main` 最新提交开始。报告不超过 15 行，给出远程分支与 SHA、真实模型那一遍的结论、请求数和 token。不建 PR、不合并。
