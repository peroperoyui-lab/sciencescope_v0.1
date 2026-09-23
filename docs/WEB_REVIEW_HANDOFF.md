# Desktop review handoff — 2026-09-20

## Purpose

This branch collects the desktop iterations since `60ac8bb` for user testing and
review with the web planning conversation. It is not an alpha release, installer,
or declaration that every prototype page is implemented. Preserve the approved
HTML design. Refine requirements against actual behavior, not demo controls.

## Implemented in this review increment

- Separate Main, task-secretary and global-assistant conversations, persisted
  application records and runtime bindings; real DSH execution paths.
- Streaming Markdown output, interrupt, normal Main text queue, grouped tool
  activity and background status without eagerly restoring every session.
- SQLite-backed profile and role settings, model/reasoning defaults, explicit
  idle prompt application with receipts and preserved history.
- Actual settings persistence: appearance, density, text/code sizes, send key,
  animations, scrollbars, reset; configurable navigation shortcuts.
- Secretary version-note template and per-project auto-organize controls.
- Local skill management and real DSH plugin inventory (inventory is not an
  arbitrary plugin package installer).
- Native assistant orb/panel controls and persisted startup behavior; hiding
  preserves unsent draft and does not stop tasks. Main close exits the client.
- Project-local development launcher: `Start-ScienceScope.cmd`.

## Testing evidence and limits

Latest full run before handoff: 89 offline tests passed. Native assistant-window
smoke used a copied real executable and isolated project-local test database;
verified startup orb, hidden initial panel, show/hide, draft preservation and
main-window exit. Settings and shortcut production-router smokes passed in prior
iterations. Detailed dated evidence is in `DESKTOP_IMPLEMENTATION.md`.

Local fixtures are not paid-provider verification. Do not infer current model
availability, signed-package readiness or production update support from them.
User data, credentials, binaries and diagnostic output are not in this branch.

## Useful user trial

1. Launch the development client, configure a provider and model in settings.
2. Edit profile, theme and shortcuts; reopen settings and verify persistence.
3. Send a Main request; inspect tool details, stop it, queue another text message,
   and change chats while checking background status.
4. Use the secretary and global assistant independently; check model selection,
   permission selection and role prompt save versus explicit application.
5. Test assistant startup preferences, orb movement, hide/show and draft retention.
6. Import a supported text version and enable/disable secretary organization;
   verify the saved note uses the configured template and keeps original bytes.

## Not yet delivered

Precise selected-message annotation workflow, full multi-expert dispatch/UI,
complete attachment workflow, dedicated memory management, notification settings,
usage analytics, real embedded browser, directory migration, screenshot hotkey,
cross-project search settings, general plugin-package install/update management,
signed installer and data-preserving packaged update rehearsal remain unfinished
or require further end-to-end acceptance. The settings inventory in the desktop
manual is the detailed source; do not remove these requirements to hide gaps.

## How to return feedback

For each issue include page/role, steps, expected behavior, actual behavior and
whether the current layout should stay. Separate product intent from suggested
implementation. Keep working behavior and added settings unless explicitly
superseded. Local agent implements/verifies; web session helps refine requirements;
user decides review and merge. No automatic merge from this handoff.
