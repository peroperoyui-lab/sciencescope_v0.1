# 实施记录

## 2026-10-19 A2-2 删除自动化后端（Codex）

- 迁移 021 将旧自动化会议改为普通对话、移除旧目标与目标表；删除调度、工具、接口和目标批准联动，保留停止/关闭/重启取消批准。相关测试 14/14，干净 Windows 检出 check 241/241（零跳过，含两项 Windows 测试）；原生旧库副本 flash 普通回答通过（1 请求 / 3,187 tokens，连接探测另 1 / 167）。未改界面或用户预览；完整验证见 `.sciencescope-local/temp/a2-2/REPORT.md`。

> 新核心（`app/`，重建 R0 起）的开发与验收日志，最新在最上面。每次交付一条，不超过 5 行；细节放 `.sciencescope-local/temp`。
> 2026-10-05 之前旧原型时期的记录在 `archive/legacy/DESKTOP_IMPLEMENTATION_legacy.md`。

## 2026-10-19 B1 品牌打包（Codex）

- 打包与开发配置接入已批准的绿底ICO、NSIS右侧页头与等比侧图，停止调用旧线图标生成脚本；干净检出251/251及打包3/3通过，独立测试产品完成Windows实际100%/125%图标验收，窗口无需额外设置。材料见 `.sciencescope-local/temp/b1/`。

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
