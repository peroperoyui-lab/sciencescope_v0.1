# Desktop implementation — first increment

## 2026-09-26 Conversation minutes, history recall, no expert input cap (Claude, cloud)

User decision on the long-context proposal: the secretary keeps the minutes and
every expert can read them; on-demand recall is right; no input cap (a 16k cap
would stop experts that read large files or work in many steps); experts must
understand the whole project history and be told how to look things up, via
system prompt rather than agent.md (one shared file blurs role identity).
- `scripts/chat-minutes.mjs`: versioned per-chat minutes (`chat_minutes`),
  seven fixed sections with #n message references, updated in the background
  after each Main turn and discussion from the previous revision plus new
  messages only (60k-character steps), secretary role model, no-tools session.
  A user edit becomes the next revision; an update running meanwhile stops.
- Expert input: minutes + all messages after their coverage verbatim (4
  messages overlap) + the new message. The 48k-character newest-first cut is
  gone; a 240k-character safety bound names the omitted numbers and points to
  `chat_recall`. Messages are numbered (`n`) so minutes, recall and transcript
  agree.
- Tools (Main and experts, read-only, chat/project bound by the session):
  `chat_recall` (search, or read #from–#to verbatim) and `project_memory`
  (minutes, log, plans, map, versions). `MEMORY_GUIDE` is appended to each
  expert persona and the Main brief; it ends by stating the records do not
  change the reader's role.
- UI: chat "…" menu → 对话纪要 (read, edit, ask the secretary to update).
- Verified: `tests/chat-minutes.test.mjs`, updated `discussion-api` and
  `research-tools-runtime` (real DSH offers both tools to Main and experts),
  `minutes-smoke`; `scripts/evals/minutes-live.mjs` with real cheap models
  (Main/secretary deepseek-v4.1-flash, methodologist glm-5.3-flash,
  statistician qwen3.8-flash): RESULT PASS. The minutes recorded the three
  decisions with #n references; the methodologist answered the history
  question correctly and called `chat_recall` on its own; the statistician
  quoted message #1 verbatim through `chat_recall`. One answer invented a
  participant name (model quality, not context). Native window not tested.
- Fixed during the eval: a pending minutes timer could fire after the API
  closed its database; `api.close()` now closes the minutes service first.

## 2026-09-26 Bilingual GUI (中文 / English) (Claude, cloud)

User request: a switchable English/Chinese GUI; built-in texts switchable;
convert the existing language.
- Approach: the approved prototype HTML stays untouched, so translation is a
  display layer (`desktop/i18n.mjs`): text nodes and interface attributes are
  rewritten from `desktop/i18n-en.mjs` as the DOM renders and restored exactly
  on switching back. Messages, Markdown, inputs, previews and code are never
  touched; a text is translated only when all its Chinese is known interface
  text, so user data is never half-translated.
- Inventory: `scripts/i18n-extract.mjs` lists Chinese fragments in desktop
  modules, host messages and the prototype script; an English-mode crawl of
  every reachable route and menu (`AUDIT_LANG=en`) listed what users actually
  see. About 1160 entries were written plus patterns for numbered and named
  sentences. The remaining crawl misses are user or demo data only.
- Setting: `desktop_preferences.language`, Settings → 界面语言 (options shown
  in their own language), applied on save, synced across windows, cached
  locally to avoid a Chinese flash at startup; reset leaves the language.
  CSS-generated texts have `:root[lang="en"]` variants. The secretary's
  built-in notes template follows the language until the user saves one.
- Verified: `npm test` 125/125 (incl. `tests/i18n.test.mjs`), `i18n-smoke`
  and all browser smokes; English gallery reviewed. Native window not tested.
  `ui-gallery` failed twice on a first run after a rebuild during this work;
  three later runs passed and it could not be reproduced.

## 2026-09-26 Peer context = answers + presented files; deliverable cards; expert context popover (Claude, cloud)

User questions: what goes into another expert's input; long-tail context
cost; showing every active expert's context window.
- Peer context: `transcript()` / `pendingForMain()` now carry each answer's
  final text plus the files it presented with DSH `present` (path and
  description). Previously every path found in any tool argument was listed,
  including files only read. Tool calls, results and preambles were already
  excluded and still are.
- Deliverable cards (`desktop/deliverables.mjs`, `scripts/deliverables.mjs`):
  presented images show as thumbnails, other files as document cards; click
  opens with the default program. The host serves or opens only paths a
  successful `present` in that chat declared, resolved against the chat's
  runtime workspace; images only are streamed (≤20 MB).
- Expert context: `session-control.mjs` measures each expert child's
  context (same algorithm as the Main `/context-usage`, now shared as
  `measureContext`) before disposal and returns it with the result; stored in
  `discussion_entries.context_json`, returned by `/api/execution` as
  `expertContexts`; the ring still shows the Main expert and its popover
  lists every expert's last measured context.
- Long context: recommendation written to `docs/design/EXPERT_CONTEXT.md`
  (shared incremental minutes + recent verbatim window + on-demand recall
  tool + per-expert budget + prefix-cache-friendly ordering); not implemented
  pending the user's decision.
- Also: marks-ui-smoke waited on the popover list but asserted the toggle
  label before it repainted (flaky on the previous commit too); it now waits
  for the label. 5/5 passes.
- Verified: npm test 123/123 (expert-discussion-runtime asserts a measured
  context from real DSH); deliverables-smoke (thumbnail, document card,
  reload, only declared files served, peers see presented files only,
  popover values); discussion-ui, chat-ui, desktop-navigation, workspace-ui,
  marks-ui, features smokes.

## 2026-09-25 Global interface font; bundled 思源黑体 (Claude, cloud)

User request: a global GUI font setting; install and use a 黑体 by default;
list the computer's own fonts (garbled names are acceptable); Windows first.
- Default: 思源黑体 = Noto Sans SC variable (SIL OFL 1.1) from
  `@fontsource-variable/noto-sans-sc@5.3.0` (exact pin): 101 unicode-range
  woff2 subsets (4.6 MB), loaded per character range, so every machine gets
  the same 黑体 regardless of installed fonts. `VENDOR_ASSETS` in
  build-desktop is now the single list for copying and for the production
  router allowlist (marked, DOMPurify, the font CSS, LICENSE and subsets).
- Setting: Settings → 个人资料与常规 → 界面字体 (with "i"), persisted as
  `desktop_preferences.ui_font` (migration adds the column; validation
  refuses characters that could leave a CSS string), applied on 保存 and
  synced to other windows through the existing BroadcastChannel. A preview
  line shows the choice before saving; 重新读取 refreshes the list.
- Font list: `GET /api/fonts` (`scripts/system-fonts.mjs`). Windows:
  PowerShell `System.Drawing.Text.InstalledFontCollection` with UTF-8 output
  (localized names, per-user fonts), falling back to the HKLM/HKCU font
  registry keys; other systems: fontconfig. Deduplicated, vertical "@"
  variants dropped, names kept as reported.
- Verified here: unit tests (preferences incl. persistence and rejection,
  registry parsing, normalization); settings-ui-smoke (default computed font
  is the bundled one and its CJK subset loads through the production router;
  list, preview, save, global application, persistence after reload);
  fontconfig listing on Linux returned 32 families. Not run: the Windows
  PowerShell/registry path on a real machine; native window screenshot.

## 2026-09-25 No "not developed" notices; feature flags; prototype copy (Claude, cloud)

User direction: prototype explanations also go behind "i" or are deleted; all
"not yet developed" notices are removed and the missing features become task
briefs with interfaces.
- Audit first: `scripts/ui-gallery.mjs` gained a copy-audit mode
  (`AUDIT_COPY=<routes>`): visits every route, dumps visible prose and action
  buttons, opens the top-bar, workspace, attachment and message menus and
  triggers every item, recording toasts, route and modal. That showed the
  Help menu reaching the prototype page catalog and per-page dev notes, the
  in-app browser / branch / materials panel / change log entries ending in a
  notice or sample content, and two settings pages saying "尚未开放".
- Feature flags: `/api/status` returns `features` (all false today;
  `folderPicker` comes from `SCIENCESCOPE_NATIVE_FEATURES=pickFolder` set by
  the native shell). `desktop/features.mjs` hides each flag's CSS entry points
  (hidden by default until the status arrives), filters prototype `menu()`
  items and links to hidden routes (`data-route-to`), blocks `go()` to hidden
  routes, and the command palette filters the same routes. Prototype-only
  pages (`help`, `page-doc`, `resume`, `run`, `compose`, `free`, `welcome`)
  are never reachable.
- Academic sites open in the system browser through `POST /api/open-url`
  (http/https only, token-protected) until the in-app browser exists.
- Notices removed: in-app browser panel text and toasts, branch toast, "此设置
  尚未开放" page, data-migration and plugin-CLI sentences, Python "即将提供"
  (the field now offers only 系统 Python, which is what runs), folder picker
  "等待更新" (button hidden until the flag), unparsed-format preview notice,
  assistant-window footer, reset-demo toast; release notes rewritten.
- Prototype copy: project page callout removed, map editor hints to "i",
  source card subtitles and the home hint line removed; settings copy in
  experts, roles, secretary, assistant window and model settings moved to
  "i" (model notice box now shows only status).
- Briefs: `docs/tasks/FEATURE_FLAGS.md`, T12 (branch via DSH
  `session.fork`), T13 (usage), T14 (map history, version notes, diff, change
  log), T15 (plugin management), T16 (data relocation); flag sections added
  to T04, T05, T08, T11.

## 2026-09-25 Info tips replace explanatory page text (Claude, cloud)

User direction: explanatory text should not be written into the pages; use one
consistent, clickable "i" and keep pages coordinated.
- `desktop/info-tip.mjs`: `infoTip(text, {label, tag})` renders the "i";
  hover/focus previews, click pins, click again / outside / Esc / scroll
  closes. Loaded first so its capture listeners run before menu and action
  handlers (an "i" inside a menu item or option explains without choosing).
  Inside an open `<dialog>` the tip mounts in the dialog (top layer) and
  corrects its position for transformed containers. Node tests can import it.
- Converted: creation dialog and project page, settings rows (`row()` ->
  tip; `valueRow()` keeps paths/versions visible), execution policy,
  shortcuts, profile, role, model API fields, extensions, file preview,
  library, workbench bind dialog, review-adopt bar, marks popover and marks
  dialog, composer choice menus (replacing the hover-only `.choice-tooltip`).
- Kept visible on purpose: errors, warnings, status, empty states, the
  "not yet available" page, data values. The approved prototype's own copy
  (welcome text, the project page's green note) is unchanged pending the user.
- Verified: `npm test` 121/121; all browser smokes except the known
  `desktop-interaction` failure (its policy-tip assertion was updated);
  `creation-details-smoke` covers pin, option-not-selected, Esc and a menu
  item; gallery screenshots reviewed.

## 2026-09-25 Creation details dialog: working folder and Python environment (Claude, cloud)

User request: creating a project or an independent chat asks for the working
folder and the Python environment. Interaction implemented here; the Python
backend and the native folder picker belong to T11 (Astra).
- Every independent-chat entry (sidebar, context menu, Alt+Ctrl+N, command
  palette) calls `ScienceScopeCreation.newChat`, which opens an in-app dialog:
  new folder for this chat (default, `projects/independent/<chatId>`), shared
  independent folder, or an existing folder. Cancel creates nothing; confirm
  enters the unchanged welcome draft. Project chats inherit and do not ask;
  an unsent draft made through the dialog reopens without asking again (the
  startup welcome draft has no choices yet, so it asks).
- The approved "创建研究项目" page no longer submits the prototype placeholder
  path; its 工作目录 field is validated by the host before the project exists,
  then bound through `/api/workbench/bind`. A Python field sits below it.
- Host: `scripts/workspace-folders.mjs` refuses relative/missing paths, files,
  drive roots, system folders and the app's own data; the whole home folder
  needs a second confirmation. `/api/folders/check` is new; `workbench/bind`
  validates too.
- Placeholder honesty: without `/api/python/envs` the Python field is a
  disabled "系统 Python" with an explanation; without the Tauri `pick_folder`
  command "选择…" asks the user to paste a path (no browser dialogs).
- Verified: `npm test` 121/121; `creation-details-smoke` and the updated
  workspace-ui, desktop-navigation, shortcuts-ui, background-chat smokes. `discussion-ui-smoke`
  was flaky (also on the previous commit): Playwright's hit-target retry
  delivered two clicks to the adopt toggle's capture listener. The smoke now
  clicks once after the button's position settles; 10/10 passes. Native window
  not tested.

## 2026-09-25 Retrieval decision, Python environments design, docs map (Claude, cloud) — docs only

Decisions recorded with the user today (no product code changed):
- **Retrieval**: keyword-only search is the degraded fallback; the main system
  is hybrid (local dense embeddings first, keyword second, several phrasings
  including Chinese and English), used for literature and long-term memory,
  plus per-turn memory recall. A minimum hardware spec replaces "support every
  old PC". Default embedding model: lightweight multilingual-e5-small; no model
  switching UI for now. See `design/RESEARCH_BASE.md` §3 and `tasks/T10`.
- Measurements behind it (cloud, 4-core Xeon, AVX-512): multilingual-e5-large
  int8 via onnxruntime-node: query 28 ms, 177–223 ms per passage (4 threads),
  ~1.4 GB RSS. Hand-written 15-question mini set (Claude wrote passages,
  questions, gold answers and translations; fictional content): top-3 hits
  keyword 1/15, dense 6/15, dense with bilingual queries 13/15. Direction only;
  e5-small could not be downloaded here and is unmeasured.
- **Python environments** (`design/PYTHON_ENVIRONMENTS.md`, `tasks/T11`): bundled
  Python 3.14 via uv, environments sharing one package cache through hardlinks
  (verified here: same inode across two environments, ~1.5 MB per env),
  per-project/per-chat assignment, system Python when unassigned, installs
  through an approved tool. Settled later the same day: creating a project or
  an independent chat opens a details dialog to choose the working folder
  (native picker for existing folders) and the Python environment (bundled
  preselected, system Python allowed); added to T11 and to the revision
  section of `02_INTERACTION_CONTRACTS.md`.
- **Docs**: `docs/ROADMAP.md` now holds the 1.0.0-alpha A/B/C plan (previously
  inside this log at "1.0.0-alpha 内测交付计划"), task queue and branch status;
  `docs/README.md` maps every document and states upkeep rules; AGENTS.md points
  to both. `tasks/LOCAL_VALIDATION_2026-09-25.md` is the pre-merge Windows check.

## 2026-09-25 Research Base framework (Claude, cloud) — review branch, not merged

User request: parse/display PDF, Word, Markdown, text and LaTeX (and an in-app
browser) with mature tools; a memory system designed for this project; a
claim–evidence ledger; one database backend for literature, distilled
knowledge, theory models/formulas/algorithms and memories, with retrieval.
Design, framework and interfaces by Claude; UI and edge work handed to GPT via
`docs/tasks/T04`–`T10` (shared rules `docs/tasks/RB_COMMON.md`).

Implemented: `scripts/research-base/` (schema, store with proposals,
revisions, supersession and usage receipts; CJK-bigram FTS5 index; search,
reader, citation labels and the project brief; ingest queue and parser registry
with text/markdown/LaTeX parsers), `/api/research/*` in `desktop-api.mjs`,
`host.mjs` `/host-call` + `setToolHandler` + `configureBrief`,
`session-control.mjs` tools `research_search/read/propose` for Main and each
expert subagent (registered on `agent/created`) and the `/brief` prompt
section. Research notes: `docs/design/RESEARCH_MEMO_2026-09-25.md` (research
subagent; network-verified items marked).

Verification (cloud): `npm test` 120/120 (the concurrency assertion in
`expert-discussion-runtime` failed intermittently under full load in 2 of 6
runs; passes alone). New: `research-base`, `research-api`,
`research-tools-runtime` (real DSH: Main and expert tool calls reach the host
with session/expert identity; brief in the system prompt; brief removal;
tool unavailable without handler).

Real provider (OpenCode Go, `scripts/evals/research-base-live.mjs`, two runs):
deepseek-v4.1-flash Main searched and read the base unprompted, cited [S1]/[S2]
and the brief decision [@…], quoted the Matsuda formula from the LaTeX source
(23 s); asked to remember a convention it called `research_propose`. First run
exposed two faults, both fixed and re-verified in run 2: (1) a project-scoped
proposal in a chat without a project was rejected and the model then used bash
to inspect the app data directory and SQLite file — the tool now falls back to
personal scope and says so, run 2 proposed on the first call with no bash;
(2) evidence given as cite labels is now accepted. An @-invited expert
(statistician) searched, read and proposed a claim. Remaining risk: in full
access mode DSH bash can read the app state directory (design doc §8).

## 2026-09-24 Experts, marks and tool preambles (Claude, cloud) — review branch, not merged

User revision (recorded in `02_INTERACTION_CONTRACTS.md`, 2026-09-24 section):
ordered panel with shared prior context and optional reviewer; marks from chat
and file preview with a "标记 N" popover; tool preambles move into the tool
card; free discussion removed in favour of @expert invites in work mode. Peers
see answers and touched files, never tool calls.

Implemented: `scripts/discussion-service.mjs` (transcript digest, identity
prompts, reviewer run, adopt, Main catch-up), `desktop-api.mjs`
(`/api/discussion` kinds ordered/invited + reviewerId, `/api/discussion/adopt`,
Main prefix), `host.mjs` + `session-control.mjs` (preamble split for Main and
experts, expert tool calls/results with argument previews), `tool-activity.mjs`
(`preamble` column), `desktop/discussion.mjs`, `work-mode.mjs`,
`turn-activity.mjs`. Marks and the real file preview (`research-input.mjs`,
`file-preview.mjs`, `marks.css`, `/api/library/preview`) were implemented by a
Claude subagent under a file-scoped brief and reviewed/re-run by the primary
agent.

Verification (cloud): `npm test` all pass, including new
`tool-preamble-runtime` (real DSH + local fixture model: Main and expert
preambles leave the answer and ride on the tool call) and rewritten
`discussion-api`, plus `library-preview`. Browser smokes: discussion-ui,
marks-ui, research-input-ui, chat-ui, workspace-ui, settings-ui,
failed-send-draft, desktop-navigation, workbench-ui, shortcuts-ui,
extensions-ui, background-chat pass.

Real provider (OpenCode Go, `scripts/evals/discussion-api-live.mjs`): Main
(deepseek-v4.1-flash) read `study.md` with preamble "I'll read the file first."
kept out of the answer; ordered panel methodologist (glm-5.3-flash) +
red-team (mimo-v2.6-flash) with reviewer statistician (qwen3.8-flash) ran in
534 s (the reviewer made ~14 tool calls); adopt → 200; @red-team invite
answered in 19 s and identified itself correctly while citing the adopted
review; Main's next turn cited the experts and the review (catch-up worked,
`mainSeen=true`). Not yet: Windows native acceptance.

## 2026-09-24 GUI refresh (Claude, cloud) — review branch, not merged

User request: refresh every user-facing surface (main window and secondary
windows), keep or change the style, and polish button/alignment/animation
details against frontier harness designs. Structure and interactions of the
approved prototype are unchanged; this is a visual/detail layer.

- `desktop/refresh.css`: design tokens for light and dark (dark tokens moved out
  of `settings.css`), centered 760px reading column, user bubbles, hover-revealed
  message actions, streaming caret and waiting dots, markdown tables/code, turn
  activity, composer focus ring and 32px send button, menus/palette/dialogs/toasts,
  secretary and global assistant panels (composer no longer overflows), home
  spacing (composer no longer clipped at 900px height), quiet recent-work list,
  compact library rows, workbench/map/settings/expert cards, orb. Font sizes keep
  honouring `--chat-font-size`/`--code-font-size`.
- `desktop/refresh.mjs`: copy feedback, Esc stops the running reply, real runtime
  status in the footer, pinned project row stays collapsed (no duplicate chats).
- `desktop/discussion.mjs`: `@` candidate menu in free discussion (Enter/Tab picks
  and never sends).
- `scripts/ui-gallery.mjs`: seeded offline screenshot gallery (17 screens).

Verification (cloud, Linux Chromium): `npm test` 111/111; smokes chat-ui,
discussion-ui (new @ menu assertions), settings-ui, workspace-ui,
desktop-navigation, research-input-ui, failed-send-draft, workbench-ui,
shortcuts-ui, extensions-ui, background-chat pass. chat-ui/settings-ui style
assertions updated to the new token values (code radius 12px, dark paper
rgb(22,25,23)). `desktop-interaction-smoke` fails identically on main (stale).
Not yet: Windows native visual acceptance.

## 2026-09-23 Slice B: expert discussion (Claude, cloud)

Implemented the contract's discussion semantics on top of DSH's own subagent
service, without a new agent loop or one process per expert.

- **Runtime** (`adapters/runtime-dsh/session-control.mjs` `/experts`, `host.mjs`
  `runExperts`/`cancelExperts`): each expert is a fresh in-process `spawn` child of
  the chat's DSH session, with its own persona and optional provider/model/effort.
  All experts get one frozen shared prompt concurrently; an optional per-expert
  suffix tells an expert which earlier answer is its own. Main's history is untouched.
- **Roster** (`scripts/expert-roster.mjs`, SQLite `experts`): stable ids are the
  execution identity, labels are display only; model `null` = the chat's model.
  Seeded once with 方法学家 / 统计审稿人 / 魔鬼代言人. `GET/POST /api/experts`.
- **Rounds** (`scripts/discussion-service.mjs`, `POST /api/discussion`): `independent`
  (no expert sees another) and `critique` (each sees the previous round, marked by
  name, plus optional user addition). Each answer is a normal assistant message;
  `discussion_entries` records author, model and stop reason, and the messages
  page returns it as `message.expert`. Stop in the composer cancels a running round
  (`/api/chat/stop` → discussion cancel). Chat/project/model binding rules equal Main.
- **UI** (`desktop/discussion.mjs`): in "有序讨论" all enabled experts answer and are
  shown in roster order; in "自由讨论" only `@label`/`@id` mentions are sent, and no
  mention means no request. A participants strip in the approved panelhead style
  offers "互相质询". "工作" mode is unchanged. The work-mode menu text now states
  the real behaviour.

Live progress: each expert's text streams into its own card, and a running tool
call shows as "正在使用工具：…" (per-expert `expert-delta`/`expert-tool` events,
serialised in order). Settings → 专家角色 edits the roster.

Not yet done: per-chat persistence of the selected work mode (resets to 工作 on reload), the
`@` candidate menu, streaming expert text (answers appear when each expert
finishes), a secretary-built disagreement matrix, and passing a discussion into
Main's own history (use quotes for now).

Live end-to-end result (`scripts/evals/discussion-api-live.mjs`, OpenCode Go): roster
saved with glm-5.3-flash / qwen3.8-flash / mimo-v2.6-flash; independent round 351s,
critique round 405s, all six answers completed and read back with correct author and
model. The statistician used the bash tool seven times to recompute effect sizes and
power, and in the critique round corrected its own earlier sample-size figure. Stored
answers are in completion order; the messages API reorders each round by roster
position, as the contract requires a fixed display order.

Tests: `tests/expert-discussion-runtime.test.mjs` (real DSH + fixture: concurrency,
per-expert model/persona isolation), `tests/discussion-api.test.mjs` (roster, rounds,
records, errors), `scripts/discussion-ui-smoke.mjs` (Linux Chromium: ordered, critique,
free @, work mode unchanged). Live evidence: `scripts/evals/expert-discussion-live.mjs`
and `scripts/evals/discussion-api-live.mjs` with glm-5.3-flash / qwen3.8-flash /
mimo-v2.6-flash on OpenCode Go.

## 2026-09-23 Research material as tagged blocks (Claude, cloud)

`scripts/research-input.mjs` now renders material inside the existing
`[User-provided research material]` markers as `<material>`, `<quote>` and
`<annotation>` blocks with escaped attributes and verbatim bodies, instead of one
JSON-escaped string. A literal closing tag inside a body is neutralised. The
snapshot/receipt structure and all limits are unchanged; the size limit now
applies to the rendered blocks.

Evidence (real OpenCode Go `deepseek-v4.1-flash`, `scripts/evals/material-format-ab.mjs`):
accuracy was identical for both formats (20/20 each on ~58k/51k-char material,
four exact-retrieval questions × 5). The change saves ~12% characters per send;
it is not a measured accuracy gain. `npm test` 108/108;
`research-input-ui-smoke` passes on Linux Chromium with the new block assertions.

## 2026-09-23 No stray console window (Claude, cloud) — pending native check

User report: launching ScienceScope left a terminal window open. Cause: the
launcher runs the **debug** executable, and `windows_subsystem = "windows"` was
only applied to release builds, so Windows attached a console that the Node host
and DSH children shared. Now:

- `src-tauri/src/main.rs` uses the GUI subsystem in every build.
- The Node host starts with `CREATE_NO_WINDOW`; DSH processes it spawns inherit
  that windowless console instead of opening their own.
- Host stderr, previously printed to that console, is written per launch to
  `<exe dir>/data/logs/desktop-host.log` (under `.sciencescope-local`, not tracked).
  Stdout still carries only the capability line.

Tested: `cargo check` for Linux and for `x86_64-pc-windows-msvc` (type-check only,
temporary icons, no resource compile). **Not yet verified on Windows**: rebuild the
debug client and confirm no console window, no flashing windows while a turn runs
tools, and that the log file is written. See `docs/tasks/T02_console_window.md`.

## 2026-09-23 T01 round 2 — Windows acceptance and per-launch API authority

Baseline: `a22353c786871b25f49027198bad2157946301f2`, fast-forwarded main in
`<工作区>`; implementation branch `codex/t01-round2-20260923` in
the existing H-drive desktop worktree. No reset, PR, merge or runtime redesign.

### Part 1: actual Windows / OpenCode Go (not fixtures)

- `node scripts/failed-send-draft-smoke.mjs`: PASS on installed Edge; two local
  requests, zero Provider requests. Original text returns after failure; newer
  text typed during the run is not overwritten.
- **F1 PASS:** actual native UI resent the nonexistent model test with
  `T01_ROUND2_F1: Do not use tools. Reply exactly OK.`. The host stayed available
  (HTTP 200), Chinese model-not-found error appeared, Send returned, and native
  accessibility confirmed the exact text back in the composer. No production
  fix was made to the already-merged `desktop/live-chat.mjs`.
- **F2 PASS for the desktop-host/runtime/persistence/native-display path:** one
  synthetic request submitted to the actual desktop host API using full mode and
  `deepseek-v4.1-flash`. One `pwsh` call ran
  `Start-Sleep -Seconds 330; echo SLEPT` with timeoutMs=420000; successful result
  `SLEPT` persisted, then assistant text included `SCIENCESCOPE_T01_LONG_OK`.
  Activity was completed. The native client reloaded and displayed that final
  response and the completed tool group with full mode. This was not a second
  paid request or an isolated direct-DSH substitute.
- The temporary Node fetch observer itself hit `UND_ERR_BODY_TIMEOUT` at about
  five minutes. This is a test-driver limitation, not hidden as a passing stream
  capture: the actual host continued, completed, and persisted the response.
  Future long-running Node observers should disable their own body idle timeout.
- Paid application turns: two (one invalid model, one long tool round). The long
  round contains tool-selection and final-answer model steps. No independent
  wire counter/billing total is claimed. No real research file was read or changed.
- Temporary invalid model entry removed; 30 original model IDs and saved DSH
  credential retained. No key or per-launch token written to tracked files.

### Parts 2/3: implementation

- Every `createDesktopServer` generates an independent 32-byte random API token;
  all `/api/*`, including status and binary assets, require Bearer authentication
  using byte-length checks plus timingSafeEqual. Direct `createDesktopApi` tests
  may omit it for compatibility. Production server never omits it.
- The token is passed only in the desktop readiness pipe and kept in memory.
  All native windows receive an origin-guarded, non-enumerable, immutable property.
  Frontend requests share host-client; unload saves use authenticated keepalive
  rather than unauthenticated sendBeacon. Images use authenticated blobs/object
  URLs, never token query parameters or an unauthenticated asset exception.
- Static capability no longer grants all loopback ports. Runtime capability uses
  exactly the spawned host's origin with local=false, reusing the existing
  permission list. This also covers built-in window/event IPC, rather than only
  checking custom commands. Secondary URLs derive from the stored host authority,
  not from the currently navigated main window.
- Browser/HTTP smoke runners receive the token from their owning server; native
  fixture readiness forwards it. Diagnostics never print token values. Test-only
  browser injection is restricted to the matching fixture origin.

### Verification

- `npm test`: 107/107 PASS (default concurrency=2).
- `cargo build --offline --manifest-path src-tauri/Cargo.toml`: PASS using the
  project-local Rust/Cargo cache and existing MSVC toolchain; no global env changes.
- `node scripts/native-api-token-smoke.mjs`: PASS. Main, assistant, orb, quick,
  map and browser windows read authenticated status. The property is immutable
  and non-enumerable. On another loopback port it is absent and native IPC is
  denied even though the Tauri bridge exists; returning to host origin works.
  Main close exits the isolated native fixture. Zero paid requests.
- First native auth-smoke launch failed while fixture readiness still lacked the
  new token; fixed fixture wiring and reran successfully. No auth check was waived.
- Actual saved-provider client was also launched with the new binary: authenticated
  status available, configured Provider retained, temporary invalid model removed.
- `node scripts/assistant-window-smoke.mjs`: PASS, including startup orb, panel
  show/hide, preservation of an unsent draft, saved preference, and native exit.
- `node scripts/research-input-ui-smoke.mjs`, `desktop-navigation-smoke.mjs`,
  `settings-ui-smoke.mjs`, and `workbench-ui-smoke.mjs`: PASS. The workbench
  check includes authenticated image decoding after reload. Navigation's F5
  synthetic event now targets a DOM element like a real key event; settings
  waits for the persisted template to finish loading. Assertions were retained.
- Supplemental `node scripts/assistant-api-smoke.mjs --native`: FAILED before
  the native stage at `providers/save` (HTTP 501, DSH host not ready in its fresh
  fixture). This is not a 401 auth failure and was not bypassed or reported as
  passed; root cause remains unconfirmed. Runtime adapter changes are out of
  this task's permitted scope. The separate native-window/auth tests above pass.
- `git diff --check`: PASS. Forbidden task files and merged draft restoration
  remain unchanged. Provider-key exact scan found no key in Git diff. No automatic
  release, PR or merge; delivery is a review branch, not an Alpha release claim.


## 2026-09-23 T01 Windows native acceptance — STOPPED at F1 draft retention

Baseline: `ca9865f47fdfb07537c75121b3e5e64d5512858f` (latest fetched main).
The main branch belongs to the clean `<工作区>` worktree; it was
fast-forwarded there, then this desktop worktree created
`codex/t01-api-token-20260923` from it. No reset or existing-work overwrite.

Part 1 ran against the actual Windows Tauri development executable launched by
`scripts/windows/launch-client.ps1`, with the updated source-backed desktop host
at `http://127.0.0.1:65329/`. This was native-window Computer Use, not a browser
fixture or an API-only substitute. The existing native executable was reused;
Rust was not rebuilt and this is not installed-release acceptance.

F1: **FAILED overall; host survival and error display passed, draft retention failed.**

1. In the native Provider UI, temporarily added `sciencescope-t01-does-not-exist`
   to the existing OpenCode Go model list; left its credential field empty to
   preserve the stored key. Selected this nonexistent model in the native UI.
2. Entered `T01_F1_DRAFT_20260923: Do not use tools. Reply exactly OK.` and clicked
   Send once. No real research material or tools were involved.
3. The native UI displayed `模型服务找不到所选模型；请在模型设置中确认模型 ID 仍然可用。`.
   The Send button returned. The same API host answered `/api/status` HTTP 200,
   available=true, and `/api/chat/activity` reported the test chat as failed.
4. Both native accessibility state and the screenshot showed the composer empty
   after failure. The text survived as a sent user message, **not as the required
   retryable draft**. Source inspection agrees: `desktop/live-chat.mjs` clears
   text on acceptance, while its error handler restores research inputs but not
   the composer text. No fix was made because T01 requires stopping on failure.
5. Restored the Provider model list through the local application API, removing
   only the temporary test ID. All 30 original models and configured credential
   remain. Test conversation retained as local evidence; no keys/logs added to Git.

Request accounting: one native application send to the real OpenCode Go route,
using a deliberately nonexistent model. No successful generation or usage was
returned. No wire-level counter was installed, so Provider retry count and actual
charge are not asserted. No other paid model request was intentionally sent.

F2: **NOT RUN**, per the Part 1 stop condition. H1/H2: **NOT IMPLEMENTED**.
No `npm test`, native smoke or `cargo build --offline` was run after this failure;
this documentation-only result must not be reported as completion of T01.
`git diff --check` passed. Next review decision: authorize the narrow failed-send
draft restoration repair, then rerun F1 before proceeding to F2 and API hardening.

## 2026-09-23 Failed-send draft restoration (Claude, cloud) — fix for T01 F1

Addresses the T01 F1 failure above. `desktop/live-chat.mjs` cleared the Main
composer on `accepted` but only restored research inputs on a later failure.
The failure path now puts the sent text back into the composer (current chat:
`S.drafts.main` and the textarea; background chat: `chatData[id].draft`) only
when that composer is still empty, so text typed during the run is never
overwritten. The already-persisted user message and failure receipt stay in the
transcript as the record of the attempt.

Tested (Linux Chromium, offline fixture, zero provider requests):
`SCIENCESCOPE_BROWSER=<chromium> node scripts/failed-send-draft-smoke.mjs` passes
(restores text; keeps newer text). The same smoke on the previous source fails
with an empty composer, matching the native observation. `scripts/chat-ui-smoke.mjs`
still passes; `npm test` 104/104. **Native Windows re-run of F1 is still pending (T01 round 2).**

## 2026-09-20 Real Provider acceptance — partial pass, startup failure remains

Tested source baseline: `00b6b035e9d7bcd17b18af6697afdeb3374b2ad6`.
Used the running native client's application host, initially loopback port 59211,
then 59501 after a user-approved restart. Ports are ephemeral, not defaults.
Saved the existing OpenCode Go provider using ScienceScope's actual settings form
(automated Edge rendering of that same host UI, not a direct provider API write).
Preserved its model list. Explicit route: `openai-chat-completions`, DSH
`openai-completions`, `https://opencode.ai/zen/go/v1`, `deepseek-v4.1-flash`.

- Tiny application/DSH request returned `SCIENCESCOPE_REAL_OK`: seven text deltas,
  approximately 6.3 seconds to first text. A second turn recalled the sentinel;
  both assistant messages survived host restart.
- The opt-in command is now `node scripts/real-provider-smoke.mjs <desktop-host-url>
  <test-project-id>`. The project must bind to an existing directory beneath this
  checkout's `.sciencescope-local/temp`. It never saves/removes a provider.
  Real execution passed: one `read` call on its unique synthetic file, matching
  successful result, streaming sentinel, completed event and SQLite assistant.
- Stop via ScienceScope's API cancelled a longer synthetic response after text
  began. Partial text persisted; activity became `stopped`. The actual UI loaded
  it with no pending state and with the Send button restored. This is not a test
  of clicking the native WebView Stop button during generation.
- Catalog returned `reasoning: null`; no invented reasoning effort was tested.
- Count evidence: four valid application sends plus one invalid-model UI send.
  DSH persisted five LLM steps and one retry across the three test sessions
  (consistent with six attempts, not an independently measured HTTP wire count).
  Reported usage totals: input 15107, cache-read 14720, output 143, total 29970.
  The interrupted turn has no returned usage, so this is not a full billing total.
  Exact-key scanning of all three decoded DSH histories found no secret.
- **Failed acceptance:** sending an unregistered model through the actual UI caused
  the application API host to disappear (`ECONNREFUSED`), while the native window
  stayed open. Provider configuration and existing messages survived restart.
  Do not call error-path containment passed. Source inspection finds `controlReady`
  can reject before `harness.start()` finishes and before its rejection is observed;
  this is a diagnosis candidate, not a confirmed/patched root cause in this slice.
- Exact-key scans found no hits in tracked files/diff, SQLite rows, ordinary DSH
  settings or 15 local log files. The key is in the ignored DSH credential store;
  the pre-existing ignored test credential source is retained, not exported.
- Offline regression: default concurrent run 101/103 (two 30-second SDK initialize
  timeouts); both affected files passed separately, then
  `node --test --test-concurrency=1 tests/*.test.mjs` passed 103/103. No test or
  timeout was weakened. Real tests remain explicit opt-in, outside `npm test`.

Only synthetic test material was used. This acceptance does not prove full Alpha
release readiness; repair startup-failure containment before calling it complete.
Test chats were soft-deleted and their dedicated project archived; DSH history is
retained for diagnostics. The smoke removed its read fixture. Final removal of
the remaining ignored `temp/provider-acceptance-20260920` directory and five
temporary acceptance runner scripts was blocked by execution policy, so complete
temporary-file cleanup is still pending. Saved Provider credentials are retained.

## 2026-09-20 Alpha 收口路线：Slice A Research Input

最新用户任务改为科研流程优先，不再因次要设置延迟 Alpha。当前工作区接续
`594a875`，不围绕 main 重做。纵向顺序：A 共享输入 → B 专家名册/并行讨论 →
C project_state.md → D 稳定版本组/DOCX → E Main 空闲换模型 → F Workbench
字段感知乐观重试 → G Portable 单一 app root。本轮先实现并提交 A。
后续不重做 DSH loop、Provider/Meeting/权限框架；专家职责以提示词区分。
Portable 优先于自动更新、签名与完整安装器；已有开发窗口不是 Portable 验收。

### Implemented

- 默认 Main persona 明确支持按需解释方法、公式、统计假设与科研依据，帮助用户
  理解、判断、纠正研究；删除 teaching tutor 禁令。不主动长篇基础教学，不依据
  私人画像改变科学结论。已保存自定义 prompt/已有绑定快照不被强制覆盖。
- Main/Secretary/Global 请求共用 research-input 编译器，复用 Library 与已有附件
  读取。txt/md/csv/json/tex/log 最多 64000 字符材料正文；其他格式只提供真实路径
  和“未提取”说明。坏 UTF-8 同样保留原件，不伪称 PDF/DOCX/图片已解析。
- 显式研究材料位于 `[User-provided research material]` / end 标记之间，作为
  用户请求材料而非 system prompt。材料结构最大 128000 字符，用户正文最大64000。
- 聊天文字选择菜单提供 Main/Secretary/Global/复制；冻结源 chat/message ID 和
  精确 DOM 选中文字，可填写 comment。服务端点查源消息存在和 speaker，不扫描
  最近聊天；选区可跨 Markdown 标签，不声称其是 raw Markdown 的逐字子串。
- Main 真实附件原件入库，输入框显示可编辑引用；附件可添加文本片段、位置说明及
  comment。旧批注仅当 version ID 能映射真实项目资源才发送，缺失则保留并报错。
- draft/receipt 存 SQLite；消息记录可展开已发送研究输入。ACK 按 id+revision 清理
  捕获的批注/引用，保护新批注和新 revision；迟到的草稿保存不复活已消费 revision。
  Secretary 的 annotation 不被消费，不自动写项目记录。模型发送失败时恢复材料，
  保留更新的草稿；重复 userMessageId 拒绝重发。
- 复杂输入暂不进入 text-only outbox：全部留在草稿并明确提示当前轮结束后再次确认，
  后端也拒绝把复杂输入 silently drop 成纯文本。后台发送纯文本队列不带当前草稿材料。
- 附件操作只更新输入框，不重绘 transcript；修复原型 smooth scroll 动画在工具更新时
  继续移动阅读位置，以及引用菜单 mouseup 重建自身导致点击失效。

### Actually tested / remaining

生产资源路由 UI smoke：实际选取跨 Markdown 的正文、中文路径文件导入、创建批注、
点击发送、宿主实际收到材料、ACK 清理及重开 receipt。API/store 验证 source identity、
失败前/后保留原件与草稿、A/B 发送期间 A 新 revision/C 新增、秘书不消费、重复消息、
复杂队列拒绝。实际 DSH localhost composition 验证材料到 provider 请求，7 次本地
请求、零付费请求，包含原有秘书提案 tool-call、独立历史、停止及恢复验收。

精确引用不是隐式广播完整专家历史。未来 B 的 Expert 应复用此编译器；B 尚未实现。
此 Slice 不新增文件全文预览、Word/PDF parser、OCR、自动 annotation 定位；当前可填写
材料已知页/行/章节，版本材料继承已知 version identity。旧 contextChatId API 兼容入口
仍存在，但新 UI 引用按钮已改为选区指引，不再附加最近二十条消息。
完整任务书中的 B–G 和最终科研闭环尚未验收；Alpha readiness：NOT PROVEN。

本 Slice 实际命令：
- `node --test --test-concurrency=2 tests/*.test.mjs`：103/103。
- `node scripts/research-input-ui-smoke.mjs`：生产路由、真实选区、附件/批注、ACK、重开快照通过。
- `node scripts/chat-ui-smoke.mjs`：流式 Markdown、阅读位置、工具详情、停止和纯文本队列通过。
- `node scripts/assistant-api-smoke.mjs`：真实 DSH，7 次 localhost 请求，0 次付费请求。
- `node scripts/assistant-api-smoke.mjs --native`：真实 Tauri 副本 + DSH，通过秘书/全局助手 UI、草稿重开、Main 隔离与主窗口退出；11 次 localhost 请求，0 次付费请求。
- `git diff --check`：通过。

## 2026-09-19 全局助手窗口设置

全局助手设置新增独立的 SQLite 启动偏好：closed（默认）、orb、expanded。
启动时仅主 WebView 读取一次；保存供下次启动使用，不立即打断当前窗口。
即时显示浮球、打开对话、隐藏两窗口复用现有 Tauri 窗口，不新建 Agent 会话。
hide_assistant 限制为 main 调用，仅 hide 不 destroy；未发送草稿与执行保持。
隐藏不是停止任务，界面明确说明；原有右键关闭动作保留，主窗口关闭仍完全退出。
只显示浮球时面板以不可见状态创建，避免先闪出对话再收起。
窗口设置不改变模型、提示词、聊天内容或权限，不读取任何用户全局配置。

验证：项目受控 Rust 工具链 `cargo build --offline` 通过；完整
`node --test --test-concurrency=2 tests/*.test.mjs` 89/89。
`node scripts/assistant-window-smoke.mjs` 使用独立临时副本和真实 Tauri exe，
验证已保存 orb 偏好启动、面板初始隐藏、按钮展开/隐藏、未发送草稿保留、
保存 closed 偏好和主窗口退出。可见性由原生 isVisible 检查，不以网页
document.visibilityState 代替；诊断端口只在测试子进程启用，正常启动不带。
无付费模型请求，未提交或推送；截图快捷键和跨项目检索设置仍未接通。

## 2026-09-19 可编辑的客户端快捷键

设置 → 快捷键已接通搜索与命令、浏览全部、项目内新对话、独立新对话四项。
输入框通过实际按键录入，保存到本客户端 SQLite；重复绑定、非法组合和保留的
编辑/浏览器保护组合拒绝整次保存。保存后即时应用并广播到其它窗口，侧栏提示同步。
新绑定接管入口后，旧 Ctrl+K / Ctrl+N 原型监听器不会继续触发第二套动作。
恢复默认需要确认，仅恢复四项快捷键，不重置发送键、资料和模型设置。

快捷键仅作用于客户端主窗口，不是操作系统全局热键；辅助窗口不因主窗口导航键
误建主对话。IME 合成和模态确认期间不派发导航操作。发送、Esc、复制粘贴、
导图编辑快捷键保持原行为，发送方式仍在常规设置配置。
原型 HTML 未修改，未引入新的键盘库；注册入口在 desktop-behavior 的捕获阶段，
生产资源清单包含 shortcuts.mjs。此次不代表所有系统热键均已可配置。

验证：完整 `node --test --test-concurrency=2 tests/*.test.mjs` 86/86；
其后新增文件数据库重开测试，`node --test tests/shortcut-settings.test.mjs`
5/5 通过。`node scripts/shortcuts-ui-smoke.mjs` 经生产路由检查按键录入、
冲突不写入、刷新恢复、旧键失效、新键触发、浏览入口、独立草稿不提前持久化、
恢复默认与多窗口同步；`node scripts/settings-ui-smoke.mjs` 同样通过。
本轮零付费模型调用，未提交/推送，未改变正式原型。

设置回归额外暴露并修复：自动整理开关的工作站广播会重绘设置页，导致模板输入
被旧数据覆盖。现在非工作站页面只失效缓存，回到相关页面再读取；跨路由完成的
后台读取不重绘新页面。修复后设置 UI smoke 重新通过。

## 2026-09-19 设置原设计对照与继续接线

已执行 `git fetch origin`、`git pull --ff-only`，上游与本地 HEAD 均为
`60ac8bb`，结果 Already up to date；没有覆盖当前未提交工作。
对照 `src/original-base.html` 的 configDefs、P31–P40 页面说明，以及本机
Codex 26.915.4065.0 的只读应用资源（未读取用户配置、凭据或聊天数据库）。
Codex 仅作为分类和交互参考，不复制其代码或素材，不改变 ScienceScope 原型。

设置导航分为个人偏好、科研协作、工具与环境，保留全部原有入口及新增能力。
本次新增可用：浅色/深色/跟随系统、标准/紧凑、代码字号、15px 正文字号、
确认恢复阅读与操作默认值；SQLite additive migration 保留旧值，广播到其它窗口。
恢复默认不清空个人资料、角色、模型、历史或材料。
秘书版本说明模板保存到 SQLite，下次版本整理的实际 host.send 使用模板；
当前项目自动整理开关复用 workbench 的 autoOrganize/revision，不另建状态来源。
自动整理仍使用工作站已选择的模型，只支持原有文本格式，不因保存设置调用模型。

### 原有设置能力清单（不是完成声明）

| 原设计类别 | 已接通 | 仍待实现的原设计能力 |
| --- | --- | --- |
| 常规/个人资料 | 用户名、介绍、主题、密度、正文/代码字号、发送键、动画、滚动条、偏好恢复 | 通知、启动页、语言切换 |
| 模型/API | 显式协议、手动模型配置、已有 discovery 接口、角色默认模型与可用思考强度 | 继续做端到端 UI 可用性验收 |
| 人格/专家 | Main/秘书/全局助手提示词及空闲显式应用，历史保留 | 独立专家名册编辑、人格/记忆专属管理（目前人格和专家共用 Main 设置） |
| 执行策略 | 各对话实际 ask/full，Main 自动化 | 设置页默认策略、网络/子代理数等独立策略控制 |
| 秘书 | 模型、提示词、模板、项目自动整理、提案工具 | 导图同步策略、缩略图尺寸、说明目录策略 |
| 全局助手 | 模型/提示词、浮球显示/隐藏、启动行为 | 搜索范围、截图快捷键 |
| 数据库/文件 | 真实路径、打开目录、原有导入与检索 | 可迁移根目录、导入识别策略、默认打开位置 |
| 环境 | 实际运行路径及状态 | 外部技能目录注册、路径迁移 |
| 快捷键 | 四项导航快捷键重映射、冲突校验、确认恢复、发送键可改 | 系统全局热键及其它编辑键定制 |
| 插件/技能 | 本地 SKILL.md 增删改、启停、真实插件清单 | DSH 插件包安装/升级/卸载与重启协调 |
| 浏览器 | 保留原入口 | 内置真实浏览器、会话/下载目录策略 |
| 用量 | 保留原入口 | 按日期/模型/项目聚合、导出；未知费用不可显示为零 |

关闭行为遵循用户后续明确的“关闭即退出”，不恢复原型里的托盘驻留。
剩余项必须继续连接存储、实际消费者和应用时机；不得以删入口、说明文案或假保存替代。
本轮无付费模型请求；未发布、未宣布 alpha 完成。

验证：`node --test --test-concurrency=2 tests/*.test.mjs` 82/82 通过。
`node scripts/settings-ui-smoke.mjs` 经实际生产资源路由验证主题计算样式、
偏好重载、多窗口同步、恢复默认、模板重载、角色设置和发送快捷键。
模板进入真实整理函数的 `host.send` 输入由离线 fixture 验证，不是付费模型验收。

## 2026-09-19 本地技能管理与真实插件清单

设置 → 插件与技能现在实际支持：添加/导入 SKILL.md、查看编辑、启用/停用、可恢复移除、打开本地技能目录。保持设置布局，不另建通用插件框架。

- 全部技能元数据与正文合法性由安装版 DSH `FileSystemSkillProvider` / `isSkillName` 处理，没有另写 YAML/skill 解析器。技能原件放在本客户端 `.sciencescope-local/dsh/skills/<name>/SKILL.md`，停用目录为相邻 `disabled-skills`，移除目录为 `removed-skills/<id>/<name>`。启停/移除搬移整个目录，编辑只改 SKILL.md，保留脚本与素材。失败保存清理本次临时目录，不覆盖旧技能。
- 当前导入入口只导入 SKILL.md，不承诺自动导入 ZIP/目录内的附带资源；可从“打开技能目录”添加资源。变更由 DSH 后续目录发现读取，停用不是擦除模型已读历史的安全机制；需要无旧技能内容的上下文应新建会话。
- 模型的实际 `skill` 工具仍来自 DSH；技能不授予额外工具权限。本轮未安装任何第三方包或调用付费模型。SDK/Web 宿主的 DSH_AGENTS_HOME 指向客户端受控目录，避免隐式借用用户全局 `.agents/skills`。
- 宿主插件和 Agent 预设清单来自 `pluginInventory/list`，显示真实启用配置与 fiberPhase；未把宿主插件等同于模型可用工具。此接口只读。安装版 DSH 的依赖包安装/移除需走 `dsh plugin --profile ...` CLI 并考虑重启，因此任意插件安装/更新/启停管理仍须后续接通，不能把清单当成安装器。

验证：`node --test --test-concurrency=2 tests/*.test.mjs` 77/77；`node scripts/skills-runtime-smoke.mjs` 验证真实 DSH 插件清单、发现技能、skill 工具读正文、停用后新会话不含技能、重新启用恢复，4 次 localhost 请求、零付费请求。`scripts/extensions-ui-smoke.mjs` 覆盖实际生产路由下的添加、编辑、停用重开、启用与确认移除。`git diff --check` 通过。

## 2026-09-19 用户纠正与角色设置真实接线

用户明确：未指定删除或重设计的功能，默认修复并实现连通。前一轮隐藏设置分类不是功能交付；本轮恢复原有分类，不再以撤掉入口作为实现。

本轮实际完成：

- 主专家（人格/专家页）、任务秘书、全局助手的 system prompt 编辑、SQLite 保存及版本号；每个角色独立的默认模型、运行时支持的默认思考强度。
- 默认模型/强度用于新空白对话；保留已有有内容的草稿与绑定会话，不隐式换模型。辅助窗口在首次会话时读取其角色默认值。
- 保存配置不改变已有 runtime。每个会话保存已应用的提示词快照。旧会话在本功能首次使用时仍绑定旧内置提示词，不因保存了新默认值而改变。
- 用户空闲时点击“应用已保存提示词”，通过 DSH 公共 systemPrompt.section + Agent.runMaintenance 更新当前会话；保持 session/history。运行中拒绝应用；模型/权限不随 prompt 改变。界面可查看持久应用版本与时间。
- Main 和辅助会话的恢复路径读取已应用快照；重启后“仅保存但未应用”的提示词不会偷渡进旧会话。

验证：真实 DSH + localhost fixture 检查 system prompt 确实替换、旧用户消息仍在；辅助 composition 验证先保存、重开仍旧 prompt、显式应用后才切换。settings UI smoke 验证编辑后重开、默认模型/思考强度进入新输入框。完整测试首次默认并发下两个 DSH 初始化超过 30 秒；未改运行时超时或删测试，改用 `node --test --test-concurrency=2 tests/*.test.mjs` 重跑 74/74 通过。`git diff --check` 通过。零付费 Provider 请求。

剩余工作仍是实现，不是删除：自定义多专家身份和调度配置、全局/项目记忆管理、插件/技能启停与安装、浏览器和用量页、目录迁移。恢复的分类尚不能视为这些功能已经全部接通。新角色配置是本轮闭环，不代表完整 alpha。

## 2026-09-19 设置页接线与占位清理

- 生产设置页不再调用原型 `configDefs/settingRow`，不会只更新 `S.settings` 就报告保存成功。保留原有左右设置布局和视觉基线；未接线的人格/专家管理、浏览器、插件、账户用量页面不提供假开关、假数据或保存动作。
- 常规设置：个人资料继续使用真实 profile store；聊天字号（14/16/18/20）、Enter 或 Ctrl+Enter 发送、减少过渡动画、显示滚动条存 SQLite `desktop_preferences`。保存后立即应用，通过窗口通知同步；不进入模型上下文，不改变导图键位。Shift+Enter 始终换行。
- 模型/API 保留现有真实 provider 编辑流程。执行策略页解释实际 ask/full/auto 并返回当前对话；秘书/全局助手设置页打开真实角色入口，模型与策略仍在各自输入框修改，不放置另一套不生效的默认配置。
- 数据库/环境页读取当前进程的真实路径、Node 版本和 runtime 加载状态。打开文件夹只接受固定目录 ID，不接受任意调用方路径。DSH 加载不等于真实模型连通验收；不展示秘密内容。目录迁移尚未支持，不提供可编辑路径假装迁移。
- 快捷键页列出当前绑定；仅发送键可配置。刷新/重开设置深链接时保留设置路由，不被初始工作区加载强制跳走。

验证：`node --test tests/*.test.mjs` 66/66；`node scripts/settings-ui-smoke.mjs` 验证保存/重开、跨窗口字号应用、真实路径、各设置路由无原型控件、Enter 换行；`git diff --check` 通过。零付费模型请求。

尚未实现：角色 system prompt 的保存/显式应用、默认角色模型、插件与技能管理、浏览器设置、账户用量、数据目录迁移。它们本轮是撤掉虚假操作，不是已实现。下一步优先做角色配置到实际 runtime 的闭环，而非重新填满表单。

## 2026-09-19 实施更新：辅助 Agent、正文搜索与退出清理

以下更新覆盖下方较早复盘中对应的旧状态，不代表所有 alpha 缺口已经关闭。

- 助手/秘书已解除固定 noTools，输入框提供询问/完全接管（无自动化）。实际映射 DSH approval + sandbox policy；询问不是“每个工具都弹窗”，只有运行时要求的操作需要审批。完全接管不逐次询问。历史继续独立。
- 辅助输入框可以选择模型及 DSH 声明支持的思考强度。显式空闲切换保留 runtime session/history；失败不更新保存的模型。未声明能力的模型只有默认项，不伪造高/中/低。
- 辅助附件进入本地 library 原件存储，草稿引用存 SQLite。文本、Markdown、CSV、JSON、TeX、日志以 UTF-8 有界摘录进入请求；其它格式提供原件路径，**不宣称 PDF/图片已经解析或模型具有视觉能力**。上传只刷新输入区，不重挂 Main transcript。
- `propose_main_draft` 是秘书 session 显式注册的真实 DSH tool。调用产生持久待审提案和可编辑卡片，用户确认后填入绑定 Main 的草稿，仍须用户发送；忽略只处理提案。普通答复不再自带“填入草稿”按钮。不把模型工具调用当作用户发送授权。
- 辅助工具记录复用 `tool_activity` 有界展示投影，刷新后可查看。DSH 仍拥有完整 runtime history。
- 搜索框空输入显示设置；输入后匹配设置优先，再显示 SQLite 正文命中，最多 40 项、每项 220 字摘要。可定位较早消息并保持最多 60 条展示。排除已删除/归档及辅助私聊，不等同于全局 Agent 检索工具。
- 主窗关闭先向本机宿主发认证关闭请求，限时等待后以既有 Windows Job Object 结束整个自有进程树。不终止其它用户 Node/浏览器进程。独立原生副本测试覆盖宿主额外启动的长驻子进程，无测试手动 kill 后冒充应用退出。

实际验证：`node --test tests/*.test.mjs` 63/63；生产路由 navigation smoke（含正文搜索定位）通过；真实 DSH + localhost assistant UI smoke（附件进入输入、秘书提案编辑不自动发送、工具记录重载）通过；Cargo offline build 通过；原生退出副本测试通过。`node scripts/assistant-api-smoke.mjs --native` 亦通过：11 次 localhost 模型请求，实际换模型保留 DSH 历史、两个原生角色窗口、草稿恢复、Main 未被提案自动发送。均未请求付费 Provider。

仍未完成：精确选区引用与批注的三处统一传递、Main 附件/已有会话换模型、Agent 项目/历史查询工具、完整设置页接线、多专家并行/@、签名安装包和更新演练。下方复盘表保留为当时的问题清单，不能据它将本段已完成能力倒退为 noTools。

## 1.0.0-alpha 内测交付计划（2026-09-19，A 阶段实施中）

### 用户实测复盘：角色能力与产品完整性（2026-09-19；源码核对，不是验收完成）

当前仍是开发客户端，不能称为完整可用 alpha。此前通过的测试只覆盖对应切片，特别是 noTools 私聊测试通过不代表完整助手可用。用户截图揭示的问题分类如下：

| 项目 | 当前证据与缺口 | 完成标准 |
| --- | --- | --- |
| 秘书提供 Main 草稿 | assistant-chat 每条秘书答复挂 use-draft 按钮，未注册对应工具 | 按新的交互规范注册提案工具；模型调用后出现可编辑提案；用户确认发送；目标身份稳定、调用幂等 |
| 助手/秘书权限 | assistant-chat-service 固定 noTools=true、固定 ask，persona 明确禁止工具 | 两处均有 ask/full；复用 DSH 实际审批/执行；禁用的是自动化入口而非全部工具；独立历史不变 |
| 全局项目可查 | 当前仅手工摘取最近 20 条对话；没有项目/聊天检索工具 | 通过已有应用服务提供项目列表、持久对话查询、材料读取；按需读取而非全库注入，不让 agent 直接修改 SQLite |
| 文件与精确引用 | Main 拒绝材料/批注，助手无上传；引用是整段最近正文 | 三处共用有来源的附件快照和精确选区批注；只改输入区；真正进入实际模型输入 |
| 模型切换 | Main 和辅助会话均有已绑定模型拒绝逻辑 | 复用 DSH 显式模型选择，在空闲时切换并保留历史，失败保持原配置，不暗中重建会话 |
| 推理强度 | 菜单/运行参数存在，但 provider 配置主要保存模型 ID，缺少能力映射；辅助输入框没有对应控件 | 从实际模型描述提供能力选项，保存并验证下一次请求；不支持者明确不可调，不伪造档位 |
| 设置 | preferences 仅部分真实接线；多页沿用原型 select/toggle 和示例模型 | 逐项标记并绑定存储与生效端；未实现项禁用/隐藏，不显示虚假的“保存成功” |
| 搜索 | paletteItems 仍存在，主要搜设置、项目名和对话标题；未实现持久正文检索 | 单独复现用户所说入口失效；再接 SQLite 正文分页搜索及消息定位，不只扫当前 DOM |
| 退出 | main.rs 有主窗 exit、HostProcess/ChildHandle 和 Windows Job 清理 | 原生副本中运行真实宿主并启动受控子进程，记录 PID/父子关系，关闭主窗后核查自有 Node/DSH/工具/WebView/端口；不能只看 exe 退出码 |
| 多专家讨论 | 工作模式切换与提示已接，不是实际专家调度 | 并行独立执行固定卡片；@ 明确派发、可核对分工，不传播同伴私有思考/工具记录 |

建议按三份可验收交付推进，而非再拆成大量“按钮已接通”的宣称：

1. **桌面可靠性与设置清单。** 先复现进程残留和搜索入口；对退出记录完整自有进程树，而非关闭用户其他 Node/浏览器进程。列出设置的真实存储字段、应用点和重启语义；纯原型项不继续假装生效。
2. **三处真实 Agent 输入。** 一起完成助手/秘书 ask/full、材料/选区引用、持久项目与对话查询工具、秘书提案工具、显式模型切换与能力支持的推理强度。权限与 persona 分离，复用上游 SDK 工具/会话能力，不新增通用 Agent 框架。验收应从 UI 实际输入到模型/工具，再重开确认历史；只测服务返回 200 不够。
3. **多专家任务派发。** 前一步稳定后再接有序并行卡片和自由 @ 分工。最终用同一个真实项目串联验证，而不是把单项通过相加当完整 alpha。

本次复盘没有宣称上述缺口已修复。没有重启用户客户端、运行真实 Provider、提交或推送；继续使用现有开发手册，不另建平行状态文件。

独立 Sol 复核与主实现核对一致。需额外注意：当前 native exit 没有等待宿主优雅关闭的显式握手，Windows Job 负责进程回收不等于数据库/运行时关闭钩子已完成。退出修复应先停止接收新任务、处理当前执行和写队列，在有界期限内完成关闭，再以自有 Job 回收兜底；用实际启动入口验证主窗 X 和退出菜单，不能只测试 fixture watchdog。搜索也不是全部缺失：现有 Library/Knowledge 查询与命令导航保留，待补的是持久聊天正文检索和用户报告的入口失效复现。

### 后台对话状态修复（2026-09-19）

切到其他聊天或工作站后，主聊天继续执行。侧栏对应条目显示运行中、待处理、排队中、已暂停、已完成、失败或已停止；有未展示的执行/队列时提供“后台任务”入口，悬停可看当前工具名及待发数量。点击返回原对话，不强制跳转、不刷新当前正文或覆盖草稿。

`GET /api/chat/activity` 汇总实际 Main run、审批/goal 的同步投影和一次分组 SQL 队列计数；不逐个唤醒历史 runtime，也不加载全部正文。终态提示在当前宿主进程内有界保留 200 项，查看后前端消除已读提示；这不是新增的持久通知中心。无执行证据的旧聊天不标为已完成；连接失败显示状态待更新，不伪造结束。助手私聊不出现在主聊天状态列表。

实际验证：`node scripts/background-chat-smoke.mjs` 通过真实宿主路由，覆盖 A 流式执行→切到 B→A 后台增量→切回接续→再次切走→完成提示→加载完整持久结果；B 草稿保留且无串话。`node --test tests/*.test.mjs` 57 项通过，包含运行/队列/审批优先级与状态查询零 context 读取、零额外 runtime 恢复。既有聊天 UI smoke 通过，未调用付费 Provider。经用户确认重启客户端；本轮没有进入材料/引用或其他下一阶段开发。

### A2.1 修复补记：真实启动路由与上下文圆环（2026-09-19）

- 用户报告新对话失败。定位到 `turn-activity.mjs`、`main-outbox.mjs` 虽复制到构建输出，却未列入 DESKTOP_ASSETS；实际 preview-desktop HTTP allowlist 返回 404，导致 live-chat 及其依赖整图不执行。此前直接读取任意静态文件的 smoke 未覆盖该故障，因此先前副本通过不能代表实际宿主模块加载成功。本次统一清单，并检查每个相对导入都能被宿主提供。
- 增加根目录 `Start-ScienceScope.cmd` / scripts/windows/launch-client.ps1。运行既有 exe、不编译、不下载；进程局部配置 Node/host 路径，现有同路径实例优先激活。仍允许开发机 Node 回退，正式包自带 runtime 尚未完成。启动入口已实际拉起可见的 ScienceScope 主窗；实际宿主三个新增模块请求均返回 200。
- 禁止 F5、浏览器刷新/打印/页面保存/地址栏/下载列表/DevTools 等浏览器快捷键及落在非应用区域的文件拖入导航。原生辅助窗口不再回退到 window.open；保留应用菜单和文本编辑操作。浏览器侧栏删除假文章与假导航，当前明确显示“网页浏览尚未接入”，并未把它冒充真实内置浏览器。
- 圆环读取 DSH sessionProjections 的 contextPressure；优先 projectedTokens（包含上下文增删的估计差量），没有样本时读取 tokenMeter 测量；容量来自 runtime contextWindow。不累加历史请求费用，不拿可见 60 条消息估算整段上下文。未知为灰环；悬停只显示实际占用、上限与必要的估计标记。后台会话不为读取指标而自动恢复。
- `node --test tests/*.test.mjs`：56 项通过；production HTTP router 测试和相对导入检查新增。`node scripts/desktop-navigation-smoke.mjs` 使用同一生产宿主路由，验证首条发送保存、新空白草稿、不弹浏览器对话框、无模块 404，以及圆环 25%→50%→10% / 切换新会话清空。
- `node scripts/dsh-approval-smoke.mjs` 实际 DSH + localhost fixture 验证上下文容量 32768、占用大于零及工具审批往返；没有真实供应商请求。内置真实网页浏览、发布安装包及其余 A2 内容仍未完成。

### A2.1 交付记录：主聊天中断、文本队列与工具过程（2026-09-19）

本段是当前实现，后面的 A2 仍是整体计划，不能视为三步全部完成。

- Main 普通运行与临时问答接 POST /api/chat/stop，调用 DSH interrupt。发送按钮在运行中变为停止；中断保留已输出文本。覆盖建立会话期间取消及复用同一会话第二次运行的取消。自动化目标仍走已有 goal 暂停/结束接口。
- 主聊天运行中 Enter 或“加入队列”保存待发文本到 SQLite chat_outbox。固定文本、模型、策略、推理强度和消息 ID，按入队顺序执行；可暂停、继续、取回编辑、删除。当前运行停止或失败后暂停续发；重启将遗留队列置为暂停，发送状态不明的项标为待确认，不自动重试。取回编辑只回填文字，其他设置以当前输入框选择为准。队列最多 20 条，仅普通非临时文本；附件和自动化输入尚未接入。
- tool_activity 是 DSH 工具事件的有界展示投影，不是另一套运行历史。调用/结果按回复和 callId 配对，保留工具名、输入/结果预览及状态；新工具事件不再变成两条普通系统消息。已有历史系统回执不删除、不伪造迁移。
- 每条回复一个紧凑的工具折叠区，可展开预览；默认收起，用户主动展开的详情在回复完成后保留。单条预览有大小限制并过滤常见凭据字段/格式，不承诺任意自由文本均能自动识别秘密；不保存 tool-private meta。正文页面最多返回 200 条工具投影，实时单回复缓存最多 100 条；完整运行记录仍归 DSH。
- 工具更新不重挂聊天或输入框；上滚阅读不强制跳底。模式回执不把历史阅读页切回最新。排队发送不清空用户后写的草稿。

实际检查（全部本地，无付费 Provider 请求）：

- `node --test tests/*.test.mjs`：55 项通过。包含 SQLite 队列恢复、FIFO/claim、存储快照优先于调用方覆盖字段、结束项不可重复派发、API 历史工具分组，以及两轮同会话中断和部分正文保存。
- `node scripts/chat-ui-smoke.mjs`：4 次本地流请求，Markdown、草稿/焦点、工具详情、上滚位置、停止按钮、Enter 入队与后续草稿保留通过。
- `node scripts/dsh-approval-smoke.mjs`：真实 DSH、2 次 localhost 模型请求；工具参数/结果/turn 身份可用，拒绝审批后结束，测试命令未获执行授权。
- `node scripts/assistant-api-smoke.mjs --native`：独立原生副本、7 次 localhost 请求；助手/秘书问答、草稿恢复、独立停止和 Main 不受影响通过。这不是本轮新增助手权限/上传验收。
- `git diff --check` 通过。重启前将现有 SQLite 一致性备份到 `.sciencescope-local/backups/before-chat-execution-1789815816053/sciencescope.sqlite`；未删旧库，未改全局环境，未提交或推送。

下一步仍为 A2 第 2 步：助手/秘书 ask/full 实际策略、三处文件与精确选区引用、模型能力配置与上下文指标。本轮未实现这些，也未完成多专家派发、安装包、签名或自动更新。当前客户端仍是开发版，不称为 alpha 发布就绪。

### A2 实施顺序：统一聊天行为（2026-09-19，规划，尚未实现）

以 `02_INTERACTION_CONTRACTS.md` 的同日桌面修订为准。用户截图指出的是实际可用性缺口，不能以 A1 测试通过代替完整聊天验收。保留 A1 代码和历史验收，但其固定 noTools、整段最近对话引用、模型锁定不是最终产品规则。

1. **先修执行和阅读体验。** 在 desktop/live-chat.mjs、execution.mjs、workspace.mjs 与 assistant-chat.mjs 中统一提交/接受/运行/停止/结束状态。通过已有 host interrupt 接普通 Main 中断；复用 DSH 会话串行执行能力，在应用层保存小型待发送队列，不创建另一套运行循环。工具事件在 assistant-stream-bridge 与 desktop-api 之间保留 run/message/call 身份和有界详情，归入对应回复；SQLite 表示采用可迁移的附加记录，不把工具原文伪装成普通对话。前端局部更新，保留选择、输入焦点和滚动锚点。
   验收：一轮多工具执行只有一个紧凑过程入口；详情可查；中断能结束实际 runtime；两条排队按顺序且各执行一次；上滚和添加附件不跳底，重开后队列不自行启动。
2. **再统一三处输入与真实材料/引用。** 沿用当前文件资源存储、assistant-conversations 草稿及 host 服务，增加文件/引用结构化草稿，提交时冻结快照。选中正文的快捷菜单将精确选区和可选批注送入指定目标；独立窗口从宿主读取，不依赖临时 DOM。助手/秘书取消固定 noTools 和“私聊·只读上下文”文案，接入实际 ask/full 策略与审批；服务端拒绝其自动化请求。角色职责与工具能力分开，凭据不进入可读材料。模型菜单与 reasoning.mjs 共用能力来源，检查自定义 provider descriptor 到 DSH catalog 的缺口；支持能力的配置应可明确修正，不硬编码供应商型号。
   验收：三处均能上传、查看和移除附件；跨窗口引用只发送选中文字与批注；取消不发送；后续编辑不被旧回执清掉；询问实际产生审批、完全接管使用用户已选授权范围；支持强度的模型在实际请求中收到选择，不支持者明确显示不可调节。
3. **最后接专家派发。** 复用独立 DSH session，以 task/chat + expertId 绑定；本次有序讨论采用并行执行和固定卡片顺序，不沿用旧串行定义。自由讨论的 @ 先解析显式目标与分句，共同任务共享、独立任务分别投递，歧义分工可编辑确认。保存派发内容与结果身份，失败专家不覆盖成功结果；不同专家不接收彼此工具原文和私有思考。共同文件写入不能靠提示词避免覆盖，使用现有审批/冲突检查，不新建通用调度框架。
   验收：两位专家同轮并发、卡片独立展开；一个失败另一个继续；用户给出的三种 @ 句型能生成可核对的派发清单；未指定专家不运行；重启后可查询各次指派和公开结果。

当前源码证据：Main 对 annotations/contextRefs 仍直接拒绝；工具调用仍追加系统消息；助手服务仍 noTools=true；自定义模型目录可能缺少 reasoning 描述。这些都是待修项，不是本轮已完成能力。先按上述三个有界交付实施，再继续安装、签名和升级阶段；不以改版本号替代验收。

独立 Sol 只读复核补充：工具过程优先作为 DSH 历史的可重建投影，不复制第二份完整工具日志；队列在停止当前运行后暂停续发，自动化运行期间不隐式插入队列文本；重新派发前核对当前授权，不能沿用已撤回的权限。模型配置编辑器目前只接收 ID，需要沿 DSH 支持的 reasoningEfforts 描述接线，而不是只修选择菜单。P04 原型串行说明已明确标注被本次新定义覆盖。实际实施与验收仍由主实现者负责。

本次仅更新规范和实施设计，保留已有未提交代码；未运行模型请求、未重启客户端、未提交或推送。实现时对每项补实际证据，不能沿用本段作为通过记录。

### A1 交付记录：独立助手与任务秘书（2026-09-19）

已接通真实 DSH 调用，不再走 HTML 原型的模拟回复。尚未完成整个 A 阶段，
更不代表 alpha 包体、签名或更新已就绪。

| 可见入口 | 真实操作/数据 | 当前验收 |
| --- | --- | --- |
| 全局悬浮助手 | 独立 global 会话、流式 Markdown、草稿/历史、停止 | 独立原生副本 + 本地模型服务通过 |
| 主工作区秘书侧栏 | 每个主任务一个独立 secretary 会话，不共用 Main 历史 | 两任务隔离、并发与原生 UI 通过 |
| 引用对话 | 用户显式选择，服务端提取最多 20 条公开正文、总计 20000 字符 | 私聊/系统工具回执不混入，越任务引用被拒绝 |
| 填入主专家草稿 | 用户显式点击后填入；已有草稿先确认；不会自动发送 | 已接线，尚需补齐与材料/批注联合流程 |
| 助手模型菜单 | 读取已配置模型；现有会话保持模型绑定 | 初始选择接通；同会话改模型仍待下一步 |
| 历史与草稿 | SQLite 关联表复用现有 chats/messages，独立助手不出现在 Main 列表 | 数据库重开与浏览器重开通过 |

实现：scripts/assistant-conversations.mjs 管理 scope/owner → chat 关系与草稿；
chat 与关系创建在同一 SQLite 事务内。scripts/assistant-chat-service.mjs 调用
现有 DSH host，独立 workspace/session/persona；desktop/assistant-chat.mjs 接管
秘书与全局助手原型发送入口，流式更新不重挂输入框。停止调用公开 Agent.cancel，
并保留已输出内容。身份、权限与 system prompt 分开；Main 操作接口拒绝辅助会话 ID。

本阶段助手严格 noTools：不开放 shell、文件写入、子代理或全库自动扫描。
“只读上下文”指用户明确引用的正文，不意味着已拥有全部知识查询工具。
秘书私聊会话按任务继续；版本整理仍沿用独立的一次性 organizer，二者不共享历史。
在来源对话被移动/删除、模型切换、自动工具授权等流程扩展前继续保持边界明确。

实际检查：
- `node --test tests/*.test.mjs`：46 项通过（包括关系存储与助手服务隔离）。
- `node scripts/assistant-api-smoke.mjs --ui`：真实 DSH + localhost fixture，
  Main/global/secretary 隔离、明确引用、runtime 重启接续、停止隔离、两处输入发送及草稿恢复。
- `node scripts/assistant-api-smoke.mjs --native`：独立项目内测试副本，复制现有
  Tauri exe，独立 WebView 数据和数据库；秘书侧栏与真实悬浮窗口通过，关闭主窗退出码 0。
  7 次 localhost 请求、0 次付费 Provider 请求。不是 Go 真实角色验收，不是安装包验收。
- `node scripts/chat-ui-smoke.mjs`：既有主聊天流式/Markdown/草稿焦点回归通过。
- 现有用户 SQLite 已在项目 backups 中做一致性备份，再启动普通客户端；未删除旧库。
  测试副本及专用调试入口清理，未关闭用户正在执行的会话。

下一小步：完成助手/秘书角色设置与可控模型变更、接入材料/批注与可查询来源，再接
主任务的专家派发。按上面的 A/B/C 计划推进；不要把本次 noTools 私聊当作完整 agent 产品。

### 核对基线与判定

- 本轮通过 `git status --short --branch`、`git log`、`git ls-remote origin`
  核对：本地 HEAD、远端 main 与 codex/desktop-first-slice 均指向
  `60ac8bb93051642e9fc74cd9c8282d6471f406fc`。开始规划时工作树干净。
- 当前是可运行的开发客户端，不是可发布安装版：Tauri bundle.active=false，
  三处版本仍为 0.1.0；原生宿主需要启动脚本传入 Node/host-script 路径。
  不能把已有开发机运行成功当作干净机器安装成功。
- 既有 37 项测试及真实 Main 回复/只读工具往返是上一轮验收；本轮只做源码、
  配置与远端核对，不重跑真实 Provider，不声明新的全量功能/CI 验收。
- 本轮明确未就绪：全局助手/秘书真实问答、多专家调度、材料/批注发送、
  DSH 分支接线、完整历史检索、安装签名、升级恢复。当前仓库未见 release CI。

### 完成标准与范围

交付 Windows x64 内测产品 1.0.0-alpha.1（系列名称 1.0.0-alpha），而不是
只改版本号。保留批准的 UI、DSH、SQLite 与文件原件布局，不重写后端/前端框架。
内测必须支持：首次配置模型、建项目、导入常见材料、主专家工作、独立秘书问答、
多专家讨论、可审阅的真实产物、全局助手按授权查询、关闭/重开接续，以及查询
历史/材料/执行结果。所有核心可见按钮必须有真实操作、明确作用域与错误回执。
非核心尚不支持的功能明确隐藏或禁用并解释，不保留模拟成功和演示数据。

### A：完整任务闭环（下一项开发；包含一次早期安装技术验证）

1. 根据 docs/page-manifest.json、49 份页面说明和实际 data-v/data-action 入口，
   在本手册维护页面/动作验收矩阵：入口、接口、数据所有者、权限、空/忙/错状态、
   持久化、实测状态。页面数量不等于功能数量。继续保留原型作为设计参照。
2. 复用 adapters/runtime-dsh/host.mjs、session-control.mjs 与已有服务；将
   scripts/desktop-api.mjs 中确有复用需求的调用/身份绑定抽成小模块，避免为三类
   角色复制整套 agent loop。生产 UI 在 desktop/ 接线，不修改批准 HTML。
3. 建立明确绑定：Main=project/chat；专家=task/chat + expertId；秘书私聊与
   生命周期整理分开；全局助手使用独立全局会话。全局助手可按用户授权检索其他
   项目，不默认把全库/全部私聊塞入 prompt。授权范围与 persona、模型分开。
   主专家负责主要撰写，其他专家提供建议/检索/分析，也可接到明确写作任务。
4. 多 @ 明确形成目标列表，冻结本轮公共输入，各目标独立接收指派；自由讨论按显式目标派发，
   有序讨论按同日用户修订并行执行、固定顺序展示。不向同伴传播思维链/工具原始历史。文件写入
   避免多个执行者无协调覆盖同一文件；单个失败不能抹掉其他人的结果。
5. 实接角色/模型/提示词设置：保存与生效分开；空闲显式应用提示词、保留历史并
   留下变更记录。模型切换复用上游支持能力，明确历史语义，禁止静默 fallback。
6. 接通材料/批注/秘书草稿发送：固定来源与版本，接收成功才清空本次草稿/批注；
   用户后来输入的内容不被异步回执清掉。秘书建议不自动改变正式研究决定。
   复用成熟解析工具提供 PDF/DOCX/Markdown/TXT/CSV/XLSX 最小阅读路径；扫描件
   无 OCR 时明确提示。图片依模型能力；不支持的文件保留原件并可用默认应用打开。
   至少完成一种编辑后文稿交付（DOCX 或用户明确选定格式），不是仅返回聊天文本。
7. 接入 DSH 已有工具、skills/MCP 的最小配置与可见执行路径：文件、检索、文档/
   数据处理优先；选择少量成熟组件，不新造插件平台。列出已启用能力和依赖，
   skills 不赋权。缺少搜索凭据/外部服务时明确不可用，不阻塞离线科研工作。
8. 统一发送/停止/失败/重试/审批状态，包含全局助手与秘书窗口。上下文/缓存/用量
   有真实数据才显示。查询从持久历史与 Catalog 取数，不能只搜索当前 60 条 DOM。
   知识更新采用有来源的候选与确认，项目过滤是全局库视图；私有偏好隔离。
9. 提前做不发布的安装技术验证：捆绑 Node/DSH 能否在无开发工具的 Windows
   启动。这是 A 阶段并行排雷，不等 UI 全部完成后才发现 runtime 无法分发。

源码落点：desktop/live-chat.mjs、workspace.mjs、preferences.mjs、model-settings.mjs、
execution.mjs、work-mode.mjs、workbench.mjs、library.mjs；scripts/desktop-api.mjs、
chat-store.mjs、application-database.mjs、workbench-store.mjs；DSH adapter 边界。
仅按需要拆分这些现有文件，不恢复旧仓库的大量分层包。

A 验收：一个新项目完成“导入→提问→至少两位专家讨论→秘书私问→用户纠偏→主专家
执行→文件产物→版本/日志可查”；同时全局助手独立问答；重启后可接续，各角色不
串话，错误/取消可解释。离线回归 + 少量授权真实 Provider；不把论文质量当发布门槛。

### B：安装、数据生命周期、签名与升级

- src-tauri/src/main.rs 改为从安装资源目录解析自身 Node/DSH/host；不依赖
  D:/nodejs、开发 PATH、PowerShell 编译脚本或工作树绝对路径。打包已验证的 Node
  版本及实际依赖；最小 Python 工具集按 A 的文件/计算需求捆绑并验证许可证。
  WSL 是可选执行环境，不是所有用户安装/首次运行的强制条件，不承诺当普通文件捆绑。
- 使用 Tauri 标准 Windows NSIS 安装链，提供选择安装位置、桌面/开始菜单快捷方式、
  正常卸载和明确的数据保留选项。主窗口关闭=退出所有自有宿主/工具进程与辅助窗口。
  先支持 Windows x64，不同时扩展三平台。
- 尽量保持一个用户选择的可写 ScienceScope 根目录，内部程序资源与稳定 data 分开。
  受保护安装目录不可写时必须明确选择可写数据位置，不能静默散落文件或要求管理员
  身份运行科研任务。快捷方式/卸载登记等 OS 集成是明确例外。
- 凭据、SQLite、DSH 历史、项目文件/导图/原件都不被升级覆盖。采用一致性数据库
  备份与版本化迁移；文件迁移有恢复记录。回退旧程序前确认数据兼容，不对已升级
  数据库盲目运行旧代码。中断更新保留旧版可启动及数据可恢复路径。
- 接 Tauri updater + GitHub Releases 的独立 alpha 通道；检查/下载/验证/用户确认/
  保存与停任务/安装/重启。无缝=不丢数据、无需重装环境，不是边执行边替换 runtime。
  签名验证失败拒绝更新；断网/取消不会损坏当前安装。首次发布前演练一次
  alpha.1 候选包→alpha.2 测试包升级，不拿唯一用户库试验。
- 发布者展示名 peroperoyui；关于/开发手册写 Contributors: Codex (AI-assisted
  development)。不冒用不存在的 GitHub 作者邮箱，不承诺修改 GitHub 自动贡献统计。
- Windows Authenticode 和 updater 签名是两件事。产品 publisher 名称不是证书。
  公共信任签名依赖用户持有/申请合适证书或签名服务；证书法定主体可能与 GitHub ID
  不同。自签可用于约定的封闭测试，但不能宣称 Windows 默认受信任或保证无警告。
  没有证书/密钥之前，签名验收保持 BLOCKED，不伪装完成；此时可继续其余开发。
- 新增必要 Windows build/release workflow：锁文件安装、离线测试、构建、签名、
  产物/发布说明/依赖许可、更新清单；普通 PR 不用真实 API key；发布只在明确 tag
  和受控发布步骤执行。证书/更新私钥不进仓库、包体、模型上下文与日志。

B 验收：干净 Windows 机器没有 Node/Python/Rust/仓库也能安装、快捷方式启动、
配置自己的 API、完成 A 的核心路径；签名可核查；程序退出无残留；同根数据在
升级后完整；卸载默认保留研究数据。安装与升级都用候选包，不用 cargo run 代替。

### C：候选包真实内测与上线门槛

- 对同一个待发布构建逐页走查动作矩阵：主窗/各辅助窗、空库/有库、短/长对话、
  拖入/默认程序打开、持久化、查询定位、快捷键、常用缩放/DPI与窗口大小。
- 至少一次两项目完整任务 + 一次多轮讨论/执行/纠偏/重开；读取真实材料只使用
  用户已授权的数据和模型。测试在干净备份后的独立副本，所有路径指向本副本。
- 针对实际边界核对串话、跨项目误写、密钥泄漏、审批/取消、重复提交、请求失败、
  磁盘不可写/外接盘失联、迁移/更新中断；不铺设无关的庞大安全测试框架。
- 后台接口结果与 UI 状态一致；没有假数据/空按钮；错误可查，导出诊断不包含
  API key/默认全文私聊。已知限制列入发布说明而不是藏在按钮后。
- 每个核心功能必须有当前候选包证据。核心阻塞未清零或签名/安装/升级未通过，
  不标记 ready、不公开上线；远端 CI 以实际状态为准。

### 开发交接与本轮边界

三个阶段是三项交付目标，不要求一次巨大 commit。允许跨阶段并行排雷，保持小而
可审查提交。主实现负责接口/上下文/权限/集成；有界代理负责明确的页面接线、
fixture 与回归；最终依据实际 diff 和运行结果，不采用未经核查的子代理结论。
README 后续区分产品启动与 HTML 原型；CODEX_START 指向本节；本手册和
NATIVE_SETUP 记录当前状态，不新增平行膨胀的状态系统。

待用户提供的外部条件：Windows 签名证书/签名服务选择，以及发布时的签名密钥
保管与授权。尚未采购、生成生产签名私钥、修改 GitHub Secrets 或发布 Release。
规划轮仅更新计划/开发说明；后续实施记录见本节顶部。未获发布授权时不提交或推送。

官方实现依据（2026-09-19 核对）：
- https://v2.tauri.app/distribute/windows-installer/
- https://v2.tauri.app/distribute/sign/windows/
- https://v2.tauri.app/plugin/updater/

## Latest: usable native Main conversation and composer controls (2026-09-19)

- Native main and auxiliary WebViews disable DevTools; browser context menus and
  inspect/source shortcuts are suppressed without stopping application context
  menus. Inputs, conversation text and tables remain selectable with a pale gray
  highlight. Shell labels/buttons are not selectable. Small modal X is top-right.
- Policy selection is a compact upward composer menu with keyboard/hover help.
  Full control and automation use muted red labels; full control still requires
  explicit confirmation. The menu does not remount the conversation or composer.
- Work/discussion intent selection no longer navigates to prototype routes.
  Its persisted presentation notice appears at the newest end, including when
  the user was reading an older page. This is NOT multi-expert dispatch: free
  and ordered choices explicitly disclose that execution is still Main-only.
- Effort choices come from DSH's public `session/modelCatalog`, not an invented
  enum or the model ID. The agent-scoped public `installModelSelection` seam
  changes effort for the next idle invocation without replacing session history.
  The saved custom OpenCode Go / deepseek-v4.1-flash route currently declares no
  selectable efforts in DSH; its menu truthfully offers only model default.
- Tool-call/result receipts are streamed with the same callId and stored as
  bounded presentation notices. Raw arguments, private result metadata and
  reasoning traces are not copied to the application transcript. DSH retains
  its own runtime log. Receipt updates do not remount the composer.
- Connection errors are classified without exposing provider payloads or keys.
  Host capability no longer claims ready when provider-service startup failed;
  native startup allows 45 seconds for a cold external-disk start.
- The old opt-in real smoke incorrectly used an unregistered project and also
  rewrote provider configuration. It now uses only the running host's existing
  provider, creates its own independent test chat and soft-removes that entry.
  This script defect does not establish the cause of the user's earlier failure.

Actual checks this increment:

- `node --test tests/*.test.mjs`: 37/37, including two localhost model requests
  with low then high effort in the SAME session, history retained, unsupported
  effort rejected before network I/O. This is not a paid-provider effort claim.
- `node scripts/desktop-interaction-smoke.mjs`: menu position/help/color,
  browser key/context suppression, copy selection, existing custom menu,
  exact composer/transcript node retention, latest mode notice, close alignment.
- `node scripts/chat-api-smoke.mjs`: real local DSH fixture, continuation,
  project move, temporary isolation and bounded automation regression.
- `node scripts/dsh-stream-smoke.mjs` and `dsh-approval-smoke.mjs`: incremental
  output; one requested escalation rejected; matching tool call/result IDs.
- Native Windows build and CDP-assisted inspection passed. One real Go turn
  read ONLY a designated sentinel fixture and returned the sentinel, with one
  successful tool call/result and persisted final text. A separate real send
  through the native textarea/send button displayed its expected response.
  Test chats were soft-removed, not mixed into ordinary user conversation.
  No assertion of exactly one provider HTTP call for the tool loop is made.

Still not a complete product: global/secretary chat wiring, multi-expert dispatch
and material/annotation submission are not validated by these Main checks.
Do not describe those prototype controls as working agent capabilities.
No publication/PR is part of this increment. Local state/credentials remain
ignored; approved prototype and visual baseline remain unchanged.

## Latest: SQLite, sliding history and execution controls (2026-09-19)

- Chat opens at the latest message. The presentation window is at most 60
  messages; scrolling each end fetches 30 and evicts the opposite end, retaining
  a visible message anchor. Eviction affects DOM/memory only, not history.
- `.sciencescope-local/state/sciencescope.sqlite` stores projects/workspace,
  chats/messages, runtime bindings, profile, material catalog, sourced knowledge
  candidates and execution projections. Node's built-in SQLite is used; no
  additional database driver/server was installed. WAL and transactions cover
  message/count updates. DSH's session log remains the runtime authority.
- The first opening transaction imports legacy `chats.json`, `chat-pages`,
  `workspace.json` and `profile.json` once. Their bytes are retained, not dual-written.
  A pre-migration backup is at `.sciencescope-local/backups/pre-sqlite-20260919`;
  it excludes provider credentials. Shutdown explicitly closes database handles.
- Material originals remain ordinary files under local `library/originals`, or
  referenced project version directories. The existing database screens now show
  actual catalog entries, import files, open originals and search metadata.
  Project filters are views over the catalog, not a second copy of the library.
- Knowledge distinguishes canonical knowledge, conditional research heuristics,
  and private preferences. New entries are candidates with source links; explicit
  user acceptance marks adoption. Private entries are excluded from default
  knowledge queries and are not automatically injected into expert context.
  This is not automatic fact verification, a vector engine, or automatic memory
  consolidation. Current search is SQLite text matching, not semantic retrieval.
- Workbench portable JSON/map files remain their existing project-local truth;
  this increment does not silently migrate every subsystem or redefine file
  ownership. Library cataloging references their versions without moving originals.
- The composer exposes three modes, applied on the next send: ask (DSH workspace
  write plus risk approvals), full control (explicit user confirmation, DSH
  danger-full-access and no per-call approval), and automation (workspace write
  plus risk approvals, native persistent Goal and round driver). Full control
  uses the existing OS user's authority; it does not grant administrator rights.
- Automation reuses `dsh-goal`, its model tools and `dsh-goal-round-driver`;
  ScienceScope does not implement a competing agent loop. Outputs from each
  committed round enter the chat database with session/sequence identity.
  Users can pause/resume and answer approval requests. Restart disarms goals;
  Ending a goal records a clear, not a false success, and keeps existing output.
  continuing requires an explicit action. The upstream default cap is 256
  automatic rounds, with completion/blocking/cancellation stopping continuation.
  Goal semantics were checked against the official
  [Codex goal guide](https://developers.openai.com/zh-Hans/use-cases/follow-goals).
  No OpenAI configuration or production model routing was changed.

Checks include legacy migration/reopen/unchanged backups, 60/30 bidirectional
SQL and browser paging, catalog/provenance/private namespace, actual DSH local
goal continuation and pause/resume, actual permission rejection, and desktop API
automation-to-SQLite committed replies. These use localhost model fixtures, not
paid provider calls. Remote CI/publication is not part of this uncommitted UI work.

Actual acceptance: 36 Node tests passed; browser 60/30 scrolling and existing
workspace/chat regressions passed. Real DSH localhost fixtures passed native
goal pause/resume and two-round continuation, rejected one approval request,
and persisted two automated replies through the desktop API before explicit
goal termination. Native Windows verified migration retained the existing chat,
opening landed at the bottom, all three mode options appeared, and the actual
library endpoint returned successfully without prototype material rows.

## Latest: usable workbench wiring (2026-09-18)

This section supersedes the historical prototype-only descriptions below for
the workbench. The approved HTML/design sources remain unchanged.

- `desktop/workbench.mjs` and its stylesheet keep the approved three-column
  composition. Redundant left-hand plan/log actions and the explanatory version
  footer are removed; plans are compact and project logs have a full-list entry.
- `scripts/workbench-store.mjs` persists project records in the actual bound
  project folder (`workbench.json`), original version bytes in `paper_versions`,
  and the editable graph in `mind_map/research.json`. Global plans live in local
  application state. Defaults remain under `.sciencescope-local/projects`;
  binding an existing absolute directory is explicit and does not migrate files.
- Directory listings come from disk. Refresh reads external changes; Explorer
  and ordinary-document opening resolve against the bound directory. Unknown
  or executable formats are revealed, not executed. New runtime sessions use
  the binding; old sessions retain their original working directory and history.
- The graph starts with one root. Both entry views fit/center. Double-click
  edits Markdown in place; node-targeted image drops persist actual assets.
  Floating nodes can be dragged; explicit directed/undirected links can be
  added/removed. Undo/redo includes explicit links. Long text wraps and scrolls
  within the node while retaining full content. Save updates other idle views;
  revision conflicts preserve the current draft instead of overwriting it.
- External edits to `research.json` are read on refresh and advance the revision.
  Invalid graph files produce an error and are not overwritten. This is not a
  continuous filesystem watcher, multi-process transaction system, or full
  historical graph-snapshot restore implementation.
- Plan/log edits and their attachments are persisted. No example plans or fake
  project files are introduced. Conversation-driven automatic log/plan creation
  is not newly implemented by this increment.
- Secretary auto-organization is an explicit, default-off preference. On import
  it uses the explicitly selected model in a fresh, no-tools DSH session. This
  first path reads UTF-8 text/Markdown/CSV/LaTeX/JSON only; PDF and Office parsing
  are not claimed. Per-source text is bounded to 40,000 characters with truncation
  disclosed. Notes are real Markdown beside the version, with the prior version
  as comparison input. Missing model/unsupported format/failure preserve originals;
  a manual organize action permits a later retry. Existing notes are not replaced.
- Context/cache fields show unknown until actual runtime usage is connected;
  no fictional percentage or token numbers remain in the context popover.

Validation: Node tests (33), actual local-host browser workbench smoke (file
import, graph Markdown/image/link edits, undo/redo, save/reload, plan/log reload),
and actual DSH with a localhost model fixture (streaming and no-tools request).
No real-provider requests were required. Native Windows checks confirmed an
actual project directory opens through Explorer (HTTP 200) and the detached
map window loads the same project with no back button. The normal client is
restarted without the temporary CDP debug port after verification.
Delegation output is reviewed rather than treated as test evidence.
No publication/PR is authorized by this UI increment.

## Baseline and ownership

Approved design baseline: `c7943509ca74f03cd9acb3bf5d6a0417f97e6433`.
Development worktree: `<工作区>`;
branch: `codex/desktop-first-slice`. The clean baseline remains at
`<工作区>`. These worktrees share Git objects, but not working files.

Primary agent owns frontend/Tauri integration. DeepSeek v4.1 Flash is preferred
for bounded implementation; GPT-5.6 Luna is also authorized. Muse Spark is no
longer used. No automatic adoption
of child edits or migration of old backend packages.

## Current increment

The resource helper preserves the approved HTML byte-for-byte. The desktop build
adds a separate model-settings module only to generated output, not the original
HTML. The shell loads that generated directory, not the whole repository. It deliberately has no provider, shell,
filesystem or credential commands. Its title marks it as a design preview.
Prototype data still resets on reload. Prototype auxiliary browser windows have
not yet been mapped to native windows. This is not the working research MVP.

Only the main window's minimize/maximize/close commands are enabled; external
web content receives no permissions. WebView data is explicitly placed beside
the executable in `data/webview` rather than the user profile.
No tray residence is introduced. Native startup and exit were subsequently
verified with the real Node/DSH child tree; see the latest increment below.

## Local checks and build

Resource preparation and tests need only Node, no npm installation:

```powershell
node scripts/build-desktop.mjs
node --test tests/*.test.mjs
node scripts/preview-desktop.mjs
```

After a supported Rust MSVC toolchain, Windows C++ build tools and WebView2 are
available, the first compile path is:

```powershell
$env:CARGO_HOME = "$PWD/.sciencescope-local/cache/cargo"
$env:CARGO_TARGET_DIR = "$PWD/.sciencescope-local/build/tauri"
node scripts/build-desktop.mjs
cargo run --manifest-path src-tauri/Cargo.toml
```

Run in a temporary PowerShell process. No global environment modification is
needed. Cargo.lock will be generated and reviewed at the first successful
dependency resolution; no tested Rust dependency set is claimed before then.
Packaging is disabled until native launch/exit and runtime ownership pass.

## Next vertical slice and acceptance

1. Build and launch this visual baseline; verify Windows scaling and clean exit.
2. Inspect a pinned DSH public SDK/profile release. Reuse its provider setup and
   session persistence, not its private Electron host and not a new HTTP dialect.
3. Replace the real-mode settings/send hooks, preserving approved controls.
   Disable demo responses in real mode; absent configuration is a visible error.
4. Bind project + chat to a DSH session. Stream real output and tool events into
   the existing conversation layout. Switching chats must not redirect output.
5. Open one explicitly selected project file; close/reopen and recover its chat.

Acceptance requires actual desktop launch, model configuration, streamed reply,
one project-file operation, history recovery and no owned process left after exit.
An HTML copy test is not evidence for those capabilities. No new generic
permission, plugin, prompt or storage framework is planned for this slice.

References checked: https://v2.tauri.app/reference/config/ and
https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md.

## Model settings UI increment (initial)

The primary agent implemented `desktop/model-settings.mjs` and CSS following the
approved P28/P29 layout, with ZCode's supplier-first setup flow as a reference.
Both settings and the composer model menu lead to the new page. It supports
adding, editing and removing window-local non-secret drafts, three explicit
protocol choices, multiline manual model IDs and field-level validation.
Drafts are not executable DSH configurations and reset on reload. Credential
input, discovery and actual model execution remain unavailable, explicitly
labelled. No network request is used to pretend to verify a provider.

Muse Spark 1.3 produced the pure draft validator but its run failed with proxy
502 before delivering tests. The primary agent reviewed it and added validation,
UI event-handler and generated-entry tests. UI handler tests use a VM with host
stubs; they are not browser layout or native-window acceptance.

## Runtime wiring increment

The development preview now adds a narrow application API for runtime status,
capability-gated provider operations, and Main text submission. It binds each
project/chat to one SDK session in memory and rejects an implicit model change
within an existing binding. It is not another provider protocol implementation.
Only DSH owns model requests. Browser chat history persistence is not yet wired.

`@deepseek-ai/dsh` and `@deepseek-ai/dsh-sdk-client` are installed and pinned to
`0.1.6-alpha.1` with package-lock.json. The registry's SDK `latest` tag pointed to
an older release; the explicit alpha tag matches the current documented SDK.
The SDK adapter only consumes verified finalResponse, never guessed descendant
notifications. It does not implement provider CRUD/discovery or token streaming.
Those settings controls stay unavailable rather than making fake requests.
The DSH full web profile's supported service surface supplies those capabilities
in the subsequent increment below; they are not rebuilt in ScienceScope.

The generated UI replaces Main's simulated submission with the application host
request, and omits seeded example messages. Material/annotation submission is
explicitly refused until actual context wiring exists. Secretary and discussion
remain prototype interactions. Model success has not been demonstrated.

`desktop:preview` serves allowlisted generated assets and application endpoints
on a loopback ephemeral port; same-origin checks guard application actions. It
is a development host, not a packaged release. Ctrl+C closes its owned SDK
children. Native Tauri now starts this host when launched through the script.

DeepSeek's Go delegation failed with proxy 502 without code delivery. Luna
implemented the SDK helper and native setup scripts; the primary agent reviewed
and corrected integration details. Rust setup stays project-local; MSVC and
WebView2 were found installed. See NATIVE_SETUP.md for native build status.

## Native host + real settings increment

`scripts/windows/run-desktop.ps1` supplies the development Node/script locations;
Tauri starts the host, waits for a bounded JSON-ready message and opens its
loopback page. A Windows Job Object owns the whole child tree. Closing the tested
window exited the app plus all nine captured descendants, including Node/DSH and
WebView2. Native rebuild and restart also succeeded. Launching the raw executable
without the script still uses static preview; runtime bundling is not done yet.

Provider add/edit/remove and key storage now use the real DSH web-profile Remote
services. The UI shows saved/key-configured facts without claiming connectivity;
manual models can be selected from settings or the composer. Discovery invokes
the upstream optional endpoint interrogation and retains manual input on failure.
No real provider request was made in this increment. Main's committed-response
path is wired, not yet end-to-end verified with a live model. Streaming remains
message-level; true token streaming, transcript reopen and materials/tools UI
wiring are still unfinished. The original design HTML remains untouched.

A full-turn offline DSH routing smoke returned SCIENCESCOPE_LOCAL_OK with exactly
one request to a local SSE fixture. The frontend labels execution/reasoning as
DSH/model defaults and does not pretend its old prototype selectors enforce
approval policy or inference parameters.

## Streaming and message presentation (2026-09-17)

The desktop extension now uses locally bundled Marked + DOMPurify rather than
the prototype's regular-expression formatter. Headings, lists, fenced code,
copy-code buttons and scrollable tables retain the approved visual palette.
Stylesheets live in `head`, because the inherited renderer replaces `body`.
Raw model HTML cannot create application buttons; remote images are not fetched.

Text updates replace only the active message body, coalesced at 50ms intervals.
They preserve the next-message draft, input focus, and a reader's scroll position.
The model ID replaces the duplicate Main label. Partial failed responses remain
visible with an explicit failure receipt rather than being marked complete.

The DSH SDK still owns sessions and execution. A small supported Cordis plugin
forwards the runtime's live assistant text events over an authenticated loopback
presentation channel. It does not implement model HTTP or modify upstream code.
The final SDK response is not appended again. A run-idle barrier drains all
attempts, and failed attempts roll back their transient display.

Research launches now use workspace-only instruction discovery and a Main
research persona, not the SDK coding persona or ancestor repository AGENTS.
This is prompt-source isolation, not filesystem/tool permission enforcement.

Checks: `node --test tests/*.test.mjs`, `node scripts/chat-ui-smoke.mjs`, and
`node scripts/dsh-stream-smoke.mjs`. Browser smoke uses installed Edge, local
fixtures and a profile under `.sciencescope-local/ui-smoke`; no browser download
or paid API is needed. `scripts/real-stream-smoke.mjs` is a separate explicit
real-provider check using an already-saved route without changing it.

Old running windows keep their loaded code. Restart through the Windows launcher
to adopt this increment; old provider history is not silently rewritten. UI
transcript restore across restart remains unfinished: export anything needed
before closing. Next functional increments are transcript restore, real material
selection/default-app opening, and visible tool execution—not a visual redesign.

## Workspace interaction increment (2026-09-17, supersedes restart limitation above)

Implemented in `desktop/workspace.mjs`, `workspace-layout.mjs`, and
`workspace.css`, leaving the approved HTML untouched:

- New conversation opens an inline draft in the focused project, or an
  independent draft outside a project. First accepted send creates its list entry.
  The new-conversation context menu offers contextual, independent, and (only
  within a project) temporary native-window conversations.
- Independent conversations can join a project through the menu or drag/drop.
  Existing DSH identity/history survives. DSH's original working directory is
  retained; the confirmation and subsequent model context distinguish the new
  project directory from that original directory. Files are not relocated.
- Project summary docks inside the chat column when no sidebar is open. Opening
  a sidebar dismisses it; reopening overlays the chat; closing that sidebar keeps
  the summary and moves it back into the reserved right-hand space. Sidebar and
  summary width/position changes animate, respecting reduced-motion preference.
- Compact composer prioritizes attach, model and send; secondary controls are
  suppressed at narrow widths. Send no longer wraps onto a separate row.
- Removing a chat/project entry, deleting a record, or removing provider keys
  requires an explicit dialog. Chat removal is a soft removal: stored history and
  research files remain. Runtime branch UI is explicitly unavailable, not a fake
  copy of visible history.

`scripts/chat-store.mjs` stores versioned, whitelisted workspace/chat metadata
and paged presentation records (50 messages/file) below local `state`. The UI
loads at most 60 records at a time, replaces pages rather than accumulating them,
and evicts inactive transcript caches. Model context is NOT restricted to those
60 display records. Idle ordinary runtimes are capped at three; active runs are
not evicted. Temporary windows request owned-session release when they close.

The installed SDK wire cannot resume an existing persisted ID. The adapter now
uses a small supported Cordis lifecycle plugin over `agents.create/resume`,
`createUserMessage`, `followup`, `whenIdle`, and owned disposal. SDK launch/profile
and DSH persistence/agent loop remain upstream-owned; no provider transport or
manual replay of copied chat text was added. Application completion is sent only
after the presentation record has been saved.

Native secondaries use a narrowly declared `open_secondary_window` capability,
the owning loopback origin, and the same project-controlled WebView directory.
The command is async to avoid Windows WebView2 synchronous creation deadlock.
Closing main exits the app and owned windows/host; this is not tray residency.

Actual verification:

- 24 ordinary Node tests pass.
- `scripts/workspace-ui-smoke.mjs`: deferred creation, menu choices, summary
  transitions, compact composer, move/removal confirmation, 140-message history
  with at most 60 message elements, and reload restoration.
- `scripts/dsh-reopen-smoke.mjs`: two separate runtime processes retain the same
  session ID; the second real local-fixture request includes first-turn history.
- `scripts/chat-api-smoke.mjs`: API restart, transcript recovery, move preserving
  session identity/context, and separate temporary question; three local requests.
- `scripts/native-windows-smoke.mjs`: actual Tauri assistant, quick, map and
  browser windows open, focus existing instances, and close without closing main.
- Native build succeeds. One explicit real OpenCode Go UI request returned
  `SCIENCESCOPE_WORKSPACE_OK` and saved its transcript; no additional paid call is
  required by the ordinary tests.
- Reloading the native UI restored that real message and its selected model.
  Closing the native main window exited all 11 captured owned processes (zero
  survivors); the current desktop was then restarted without the temporary CDP
  inspection switch.

Remaining boundaries: temporary questions receive project identity/goal/directory,
not automatic Main transcript injection. This is not a new filesystem sandbox.
Global assistant AI, full secretary execution, material import/default-app open,
and tool UI remain separate wiring work. Unsaved drafts and prototype-only plan/
map edits are not claimed as durable. Chat-page and index writes are individually
atomic, not a power-loss transaction across DSH plus the presentation projection.
Current search operates on titles/currently loaded messages, not a full-text index.

Testing-path correction: early chat-store tests mistakenly used OS temp; the
tests now allocate and clean project-local fixtures. Sixteen known disposable
`sciencescope-chat-*` directories under the user's Windows Temp remain because
the attempted cleanup was denied by environment policy. They contain synthetic
fixture data, not API credentials. Do not describe this as a completely clean
outside-project filesystem, and do not bypass the cleanup denial.

## 2026-09-18: settings search, local profile and assistant window

Production overrides remain in `desktop/`; approved prototype sources are unchanged.
Empty command search lists settings only. Nonempty searches include projects,
chats and actions, with matching settings first. General settings now edits a
local display name and biography through `GET/POST /api/profile`; the atomic
profile file lives in `.sciencescope-local/state/profile.json`, independently of
workspace snapshots. It is not added to model inputs or research state.

All native secondary windows are frameless. The assistant is created only on
explicit user action, initially expanded (450 x 800 logical pixels by default).
The entry toggles expanded/orb mode after creation. The 64 x 64 logical-pixel orb
is always-on-top; clicking expands it and dragging uses the native window.
A native right-click menu offers expand/close. Expanded dimensions are stored
under the executable's project-controlled `data/assistant-window.json`; minimizing
or entering orb mode must not overwrite those dimensions. Monitor work-area
clamping prevents the orb leaving the screen. This change wires the window, not
the global assistant's model execution or cross-project data access.

Local checks: 25 Node tests pass; workspace browser smoke includes settings-only
empty search, ranked matches, profile edit and reload, plus existing chat checks.
Native acceptance results are recorded after the actual window run, not inferred
from browser preview or Cargo check.

Actual native run passed `scripts/native-windows-smoke.mjs` (all four secondary
surfaces, initial portrait, 64 x 64 orb, main-entry toggle, reuse and close).
`SCIENCESCOPE_NATIVE_PID=<owned PID> node scripts/native-assistant-geometry-smoke.mjs`
used real Win32 resize/move: 520 x 760 restored after orb and close/reopen;
attempted off-screen orb movement clamped to (0,0), wholly inside the monitor.
The original preference file was restored after testing. Native menu selection
has not been automated. All these checks made zero provider requests.

### Skill and multi-target investigation (not a completed dispatch feature)

Installed DSH 0.1.6-alpha.1 already provides the skill registry, filesystem
discovery and `skill` tool. Discovery publishes summaries; the model loads the
full body on demand. A direct user `/kebab-case-skill-name` gesture can inject a
user-invocable skill at pre-step. `modelInvocable`/`userInvocable` govern these
two paths. There is currently no ScienceScope role-based mandatory skill list,
installation/enablement UI, or verified product skill-trigger acceptance.
Skill instructions are not tool permissions. Existing upstream discovery roots
must be explicitly constrained before exposing external skill-source management.

Next bounded execution slice: explicit target chips resolving to stable target
IDs plus provider/model routes; one independent DSH session per target within
the chat; freeze public text context before fan-out. Each target receives its
own assignment and the same committed public snapshot. Sibling responses do not
enter that same dispatch; later user dispatches may include committed final text
only, never peer reasoning/tool traces. Failures are per target. No automatic
model-to-model recursive dispatch. First version should be text consultation,
with upstream `agentCtx.tools.restrict({allow:[]})` applied in both create and
resume setup. Scoped tool additions must also be controlled; the restriction is
not a filesystem sandbox. Retain normal Main execution separately. Before UI
enablement, add persisted target identity/reply attribution and prove same-round
isolation plus restart behavior. Plain `@name` currently remains plain text;
the application must not claim it has scheduled multiple models.

The two linked ChatGPT discussion bodies were not accessible through this
session's tools. Their recommendations are not treated as read or implemented.

## Design correction: new-chat welcome composition

The earlier compact empty-chat replacement departed from the approved welcome
design. Empty ordinary chats now reuse the original home composition: logo,
project-aware heading, personal greeting, real recent chats, academic-site row,
and bottom composer. This is an empty state of the existing chat, not a separate
new-chat route; the first accepted message still materializes the chat and
switches to its transcript. Temporary project windows keep their distinct view.
The screenshot's greeting and footer hint are restored despite the v2 prototype
CSS hiding them. Approved source HTML and assets remain unchanged.

Welcome, sidebar and rendered user-message names follow the local profile.
Profile-change notifications refresh identity labels in other open windows
without replacing their chat bodies or drafts. No message contents are rewritten.
The browser smoke verifies the restored sections, project/name binding and
first-send transition; a comparison screenshot is stored locally under
`.sciencescope-local/workspace-ui/restored-new-chat.png`. 25 Node tests passed.

## Persistent assistant orb and production profile-route correction

Latest user direction supersedes the earlier single-window orb/expanded switch:
`secondary-assistant-orb` now remains a separate 64px native window while the
rounded `secondary-assistant` panel is shown/hidden. Left click toggles the
panel; the native right-click menu can exit both. No assistant autostart was
added. The panel's old header is removed. Placement prefers above-left of the
orb, flips/clamps to monitor work area, and moving the orb reanchors the panel.
Do not move the orb in response to panel placement: that creates a position loop.
Main application exit still owns both auxiliary windows and the local host.

The actual profile failure was a missing `/desktop/preferences.mjs` static route
in `preview-desktop.mjs`, despite build output containing the module. Earlier
fixture servers served arbitrary built files and missed this production bug.
Build and production host now share `DESKTOP_ASSETS`; the sidebar name provides
a direct profile-edit entry. `native-client-smoke.mjs` checks production asset
URLs, actual profile save/reload (restoring the original afterward), and the
separate orb/panel. Existing window/geometry smoke scripts follow the new policy.

Logo appearance on tinted surfaces uses CSS multiply blending, retaining the
approved source image rather than claiming the PNG gained an alpha channel.
Native ICO generation clips a padded version of the approved mark to a rounded
tile with transparent corners. This is not a logo redesign.

Validation for this revision: browser workspace regression passed. Native source
checks are separate from runtime acceptance; the current running client has not
yet been restarted while awaiting confirmation about unsent drafts. New dual-window
native acceptance and production profile save/reload are therefore PENDING, not
the PASS reported for the previous single-window design. No real provider calls.

## Discussion intake: research control and knowledge boundaries

The conversation reader became available on the next turn. Both referenced chats
("前沿研究综述" and "本地Agent数据库方法比较") were now retrieved as design
background, superseding the earlier access limitation. Their literature claims
have not been independently verified and are not implementation evidence.

Planning principles to carry forward, without a storage/runtime rewrite:

- Keep research intent, adopted decisions and their evidence inspectable. An AI
  suggestion is not an accepted user decision; changes of direction need an
  explicit acceptance, not silent summary replacement.
- Separate original assets/events, curated reusable knowledge, and private user
  preferences logically. This does not require three databases. Curated entries
  need sources, scope and adoption status; personal profile is not automatically
  injected into formal expert context.
- Prefer source-linked, low-interruption summaries over more messages, compulsory
  quizzes, or mandatory forms. Explanation support is on demand; Main/experts
  retain research responsibilities rather than becoming teaching personas.
- First finish real client interactions and isolated assistant conversations;
  then wire explicit multi-target dispatch and usable material/source links.
  Do not implement speculative graph/vector/automatic-memory systems to absorb
every proposal in these discussions. Prototype pages are not durable features.

### Native acceptance follow-up

After user approval, the updated native client was built and started. The real
host returned all 12 declared production assets; profile edit through the sidebar
entry persisted across native-page reload. The test restored the original profile.
Independent orb/panel creation, header removal, rounded panel and left-click
show/hide passed. Windows initially imposed a 136px creation width on the orb;
explicit min/max inner sizes plus setting size after creation fixed the actual
WebView to 64 x 64. Geometry checks passed native resize/restore/reopen and orb
work-area clamp. Quick/map/browser reuse and close also passed. Native context-menu
selection is still not automatically verified; do not imply that it was.

### Next bounded delivery plan (not implemented)

1. Wire the global assistant's real text conversation using the existing DSH
   host, streaming renderer and history store. Give it explicit identity/model
   binding and isolated history; never send its messages to Main implicitly.
   Acceptance: real first reply, streamed Markdown, restart continuation,
   hide/show retains draft, Main history unchanged. Cross-project retrieval and
   mutation are separate explicit capabilities, not granted by prompt wording.
2. Add explicit multi-model targets and response attribution after that vertical
   slice. Freeze a public context snapshot for each fan-out; keep peer reasoning
   and tool traces private; show per-target status/failure. Start with consultation
   rather than concurrent unrestricted filesystem mutation.
3. Connect material/source references and decision adoption to existing UI slots.
   A suggested method/goal is not silently accepted. Keep source records separate
   from curated knowledge and private preferences. A large memory engine, graph
   database or automatic scholar profiling is not a prerequisite.

Delegation this turn used DeepSeek V4.1 Flash through the Codex Go skill. The
separate planning job failed with upstream 502/SSL EOF and produced no accepted
deliverable; a queued/running code review is not counted as a completed review.
The review job produced no execution events for over six minutes and was
cancelled through its owned runner; no DeepSeek review verdict was accepted.
Parent-run native/regression checks above are the actual acceptance evidence.
