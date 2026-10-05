# ScienceScope

Rewritten 2026-10-05 after the overall review (`docs/REVIEW_2026-10-05.md`).
The previous rule set is archived in `docs/archive/AGENTS_2026-10-05.md`;
product decisions recorded there remain in `docs/SYSTEM_SPEC.md`,
`docs/02_INTERACTION_CONTRACTS.md` and `docs/design/`.

## What ScienceScope is

A tidy "database + harness": a local academic research assistant in which
several AI experts discuss with the user and follow a complete research
workflow, helping the user understand and advance their own research project
(reading, analysis, writing). Every feature serves this.

## Product principles

1. **Data.** ScienceScope keeps all of its own content under its install
   directory (`data/`): user-editable files and folders (workbench, map, plans,
   log, versions, minutes, notes) and one SQLite database for agent work,
   indexes and RAG vectors. The external project folder the user chooses is the
   only exception: ScienceScope works in it but stores none of its own files
   there. Data survives updates and stays readable without the app.
   Design: `docs/design/DATA_AND_ROLES.md`.
2. **Roles share one tool set.** Main, experts, the secretary and the global
   assistant all "read the project and change the data". They differ by prompt
   and by default context (which project or chat they are attached to), not by
   hard-coded functions or permission tables.
3. **Agents can edit the workspace.** Everything in the GUI that affects research
   and writing can be read and edited by the secretary and the global assistant.
   Edits apply directly, appear in a change log and can be undone.
4. **Soft boundaries over hard ones.** Guide behaviour with prompts. No hard caps
   on output length, tool arguments or what a role may read. Keep only the
   provider's own limits and resource bounds that page or name what they omit.
5. **Security is not a current focus.** Do not add guards, approval gates or
   security tests. Keep the cheap measures that already exist: keys live in a
   separate credentials file, never in environment variables or tracked files.
6. **Visual baseline.** The approved `ScienceScope.html`, logo, colours and layout.
   The GUI is bilingual (中文 / English; every new string needs an entry in
   `desktop/i18n-en.mjs`). Explanations go behind the "i" info tip; status,
   errors and data stay visible. Unfinished features stay hidden behind
   feature flags (`desktop/features.mjs`), never shown as "coming soon".
   No fake data presented as real.
7. **Runtime.** DSH through the runtime port only (`docs/design/RUNTIME_PORT.md`):
   only `adapters/runtime-*/` imports runtime packages. Whether to keep DSH is
   decided after alpha.

## Engineering rules

- Readable, maintainable code comes first: `docs/CODE_STYLE.md` (written in S1).
  Until then: one statement per line, lines of at most 100 characters, files of
  roughly 400 lines or fewer, one responsibility per module.
- Frontend: new features register through the UI registry (S4). Do not add new
  wrappers around prototype globals (`render`, `objectMenu`, `submitMain`, …).
- Database changes go through the migration registry (S2), never through ad-hoc
  `CREATE`/`ALTER` in module start-up.
- "Fix" or "implement" means connecting the feature end to end, not hiding or
  deleting it, unless the user asks. A setting needs a stored value and a real
  consumer.
- Tests: one functional test per user-visible path. Test what users do, not
  every defensive branch. No security tests and no speculative matrices.
  Fixtures use `.sciencescope-local/temp`.
- Real-model evaluation only in tasks that ask for it.
- Builds, caches, temporary files and test databases stay under `.sciencescope-local`.

## Workflow

- **Claude**: design, frontend, review and merge into the integration branch.
  **Sol** (GPT-6.1 Sol): implementation and Windows acceptance; its subagents
  use GPT-6.1 Sol, Git delivery uses GPT-6 Luna. **Dot**: Linux verification,
  upgrade rehearsal and evaluation on `dot/` branches only; no product code.
- One task, one brief: goal, files it may change, done criteria, things not to
  do. About one to two hours of work; if it grows, stop and report.
- Verification: related tests while working; the full suite (`npm test`, later
  `npm run check`) once before delivery. One screenshot if the UI changed.
  Native acceptance only if native code changed.
- Report in 15 lines or fewer: what changed, which files, test result, open
  issues. Long material stays in `.sciencescope-local/temp`.
- Branches `codex/tNN-topic-YYYYMMDD` from the integration branch. Report the
  remote branch and SHA. No PR or merge unless the user asks. Never commit
  secrets, local state, logs or builds.
- Docs: `SYSTEM_SPEC.md` describes what exists now (update it when behaviour
  changes); `ROADMAP.md` holds direction and the task queue;
  `DESKTOP_IMPLEMENTATION.md` is a short dated log. Do not add a rule here for
  every incident; prefer a test.
- Credit: publisher peroperoyui; Codex as AI-assisted development; Claude
  (Anthropic) as AI-assisted review and development. Never fabricate identities
  or signatures.
