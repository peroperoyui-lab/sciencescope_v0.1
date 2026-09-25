# ScienceScope v0.1 development

The next release target is 1.0.0-alpha. Follow the staged plan at the top of
docs/DESKTOP_IMPLEMENTATION.md. Keep prototype, implemented, tested and released
states distinct. An alpha release requires real role/material wiring plus an
installed-package startup and data-preserving upgrade rehearsal, not only tests
against the development server. Display publisher: peroperoyui; credit Codex as
AI-assisted development and Claude (Anthropic) as AI-assisted review and
development, without fabricating GitHub identities or signatures.

## System spec: read first, keep current

At the start of every task, read `docs/SYSTEM_SPEC.md`. It records what each
feature currently does, its status, how it is implemented and how it was
verified. When a change alters a feature's behaviour, API, storage or
verification status, update the relevant section (and its "最近核对" line) in
the same commit. The spec is a record of the present, not a constraint: a
better design may replace what it describes; update the spec when you do.
Dated history and acceptance details stay in `docs/DESKTOP_IMPLEMENTATION.md`.

Read CODEX_START.md and the relevant design/interaction documents before edits.
The approved ScienceScope.html, Logo, colors and layout are the visual baseline;
do not redesign them or import the rejected old GUI.

## Ownership

- Primary agent: frontend, visual/interaction decisions, Tauri integration and acceptance.
- Explicitly delegated implementation jobs: prefer GPT-5.6 Luna. Muse Spark 1.3
  and DeepSeek v4.1 Flash may advise on planning and debugging (user revision
  2026-09-19); they are not required for every task. Delegate bounded runtime
  implementation and non-UI helpers; each brief names allowed files.
- The primary agent reviews actual diffs and reruns checks; a child report is not acceptance.
- Prioritize working features; use proportionate smoke/regression checks, not
  speculative test matrices or new frameworks just for testing.

## Implementation

Reuse DSH's supported SDK/profile, sessions, tools and history. Do not copy the old
ScienceScope backend wholesale or build another generic agent/provider framework.
Check the selected upstream version before choosing APIs; its private Electron
Desktop Host is not assumed to be a public Tauri integration API.

Keep the approved prototype intact while native wiring is developed separately.
Prototype examples are not real model output, persistence or OS functionality.
Never expose native execution commands to external web content. Never put API
keys in tracked files or model-readable research documents.

Keep generated builds, caches, temporary files and test databases beneath
.sciencescope-local in this working directory. Do not change global tool settings.
User workflow revision (2026-09-20): each implementation task delegates Git
delivery to GPT-5.6 Luna. After the primary agent verifies the work, commit and
push to a new codex/ review branch for user/web-session review. Check the actual
H-drive workspace and remote first; never substitute the D-drive backup when
the external disk is unavailable. Exclude secrets, local state, logs and builds.
Do not create a PR or merge unless the user explicitly requests it. Report the
actual remote branch and SHA; failed pushes are not delivery.

## Desktop evolution

- Before changing a visible interaction, compare it to the approved HTML and
  relevant user screenshot. Change only the explicitly requested behavior;
  preserve surrounding layout. A draft chat keeps the approved home/welcome
  composition until its first message is accepted, without a separate route.
  User-facing identity comes from the local profile, never the prototype's Joy.

- Keep production interactions in readable `desktop/*.mjs` and styles, not edits
  to generated HTML or the approved design source. Document behavior changes in
  `docs/DESKTOP_IMPLEMENTATION.md`; distinguish implemented from placeholder UI.
- Chat metadata and paged presentation records belong to the local application
  host. DSH remains the durable runtime history; restoring visible messages alone
  is not proof that model context resumed.
- Bound chat rendering and discard inactive transcript caches. Do not eagerly
  load entire histories or retain one idle runtime process per historical chat.
- Native auxiliary windows use the existing same-origin host and controlled
  WebView data directory. Verify native opening, not just browser mocks.
- Keep generated/copied modules and the desktop HTTP asset allowlist identical.
  Test transitive imports through the production router, not only a permissive
  fixture file server. A missing import can silently restore prototype behavior.
- Production UI must not fall back to browser popups/dialogs or fake web pages.
  Preserve application menus and editing shortcuts; disable browser-only chrome
  shortcuts. Context rings use current DSH pressure, not hardcoded percentages.
- Every test fixture must explicitly use project `.sciencescope-local/temp`,
  never the system temp default; clean up only that test's known owned directory.

## Native interaction and runtime receipts

- Ship without WebView DevTools/browser context menus; retain application context
  menus and normal input/copy shortcuts. Diagnostic remote debugging is process
  local, opt-in, and removed before handing the running client back to the user.
- Composer model/policy/effort choices are small anchored menus, not navigation
  to a settings sheet. Policy information must describe actual enforcement.
- Avoid remounting the transcript/composer for status or tool events. Preserve
  draft, focus and reading position; explicit newest-message actions go to the
  latest page. Keep the 60-message bound after event inserts, not just text turns.
- Report real provider acceptance separately from localhost fixtures. A failed
  diagnostic with an invalid project ID is not evidence of a provider outage.
- Reasoning choices must come from the runtime's model capability, not a list of
  invented effort labels. Changing effort must not replace conversation history.
- Follow the 2026-09-19 desktop revision in docs/02_INTERACTION_CONTRACTS.md.
  Roles and execution policy are separate: assistant/secretary offer ask/full,
  never automation; fixed noTools is an interim implementation, not product policy.
  Keep independent histories and enforce the selected policy in the runtime.
- Quotes capture selected message text with source identity and optional comment,
  not an implicit recent-chat dump. Attachment edits must not remount the transcript.
  Group tool activity under its originating turn; never force-scroll a reading user.
- Ordered discussion now means concurrent independent expert execution with fixed
  display order, not sequential execution. Record this semantic revision explicitly;
  do not reinterpret historical records or silently infer ambiguous @ assignments.
- 2026-09-24 revision: free discussion is removed; @expert in work mode invites
  experts. Ordered discussion shares the same prior transcript, runs selected
  experts in parallel and may end with a reviewer whose result enters later
  context only when the user adopts it. Peers see answers and touched files,
  never tool calls. Tool preambles belong to the tool card, not the answer.
- Research Base (docs/design/RESEARCH_BASE.md, 2026-09-25): literature, knowledge,
  models/formulas, claims and memory share one store. Agents write only through
  research_propose into the user's inbox; the session, never model arguments,
  decides project and role. Private items never reach agents; superseded records
  are kept, not deleted. Research Base work follows docs/tasks/RB_COMMON.md.
- Secretary-to-Main drafting is a registered proposal tool, not a button attached
  to every assistant response. Tool invocation opens an editable proposal; only
  user confirmation sends to its explicitly bound Main chat. Do not claim the
  existing copy-to-draft shortcut implements this contract.
- Release readiness must include actual setting persistence/application, search
  and owned process-tree shutdown. A no-tools chat or an exited main exe alone
  is not acceptance for a full agent or complete application shutdown.
- Secretary proposal tools use the installed DSH value-schema DSL (including
  explicit additionalProperties and per-field required). Verify registration and
  invocation through the real localhost runtime, not only fake-host unit tests.
- Native shutdown tests must observe host-owned descendant PIDs disappear before
  test cleanup. Killing a sibling fixture process is not process-tree evidence.
- A production setting needs a persisted field, a real consumer and explicit
  application timing. Never route it to prototype `S.settings` or a generic
  success toast. Preserve settings categories and approved interactions. Unless
  the user explicitly requests removal/redesign, "fix" and "implement" mean
  connecting the function end-to-end, not deleting or hiding it. Pending controls
  must not claim success, but removing them is not delivery. Preserve existing
  model configuration and distinguish saved defaults from applied session state.
- Configurable shortcuts must have a single dispatch path. Once remapped, the old
  prototype shortcut must not still run. Preserve text editing, IME composition,
  dialog handling and browser-chrome suppression; settings must distinguish
  in-app bindings from operating-system global hotkeys.
