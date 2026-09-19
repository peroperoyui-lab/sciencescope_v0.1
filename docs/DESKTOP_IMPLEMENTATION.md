# Desktop implementation — first increment

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
