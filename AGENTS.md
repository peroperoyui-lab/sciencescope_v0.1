# ScienceScope v0.1 development

Read CODEX_START.md and the relevant design/interaction documents before edits.
The approved ScienceScope.html, Logo, colors and layout are the visual baseline;
do not redesign them or import the rejected old GUI.

## Ownership

- Primary agent: frontend, visual/interaction decisions, Tauri integration and acceptance.
- Explicitly delegated jobs: prefer DeepSeek v4.1 Flash, with GPT-5.6 Luna as
  another user-approved option. Do not use Muse Spark. Delegate bounded runtime
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
Do not commit, push, open a PR or merge until the user requests a publication step.

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
