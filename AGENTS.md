# ScienceScope

Rewritten 2026-10-05 after the overall review (`docs/reviews/REVIEW_2026-10-05.md`).
Architecture (first principles: participants, tools, meetings, workspace,
events): `docs/architecture/ARCHITECTURE.md`.
The previous rule set is archived in `docs/archive/AGENTS_2026-10-05.md`.
Docs index: `docs/README.md` (reorganized 2026-10-18). The owner's decisions
are in `docs/decisions/DECISIONS.md`; what exists now is in
`docs/product/FEATURES.md`; how the work flows is in `docs/process/WORKFLOW.md`.

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
   Design: `docs/architecture/DATA_AND_ROLES.md`.
2. **Roles share one tool set.** Main, experts, the secretary and the global
   assistant all "read the project and change the data". They differ by prompt
   and by default context (which project or chat they are attached to), not by
   hard-coded functions or permission tables.
3. **Agents can edit the workspace.** Everything in the GUI that affects research
   and writing can be read and edited by the secretary and the global assistant.
   Edits apply directly and leave a history version that can be restored
   (2026-10-07: history versions replace the change-log column; undo / redo
   belong to one open editing session).
4. **Soft boundaries over hard ones.** Guide behaviour with prompts. No hard caps
   on output length, tool arguments or what a role may read. Keep only the
   provider's own limits and resource bounds that page or name what they omit.
5. **Security is not a current focus.** Do not add guards, approval gates or
   security tests. Keep the cheap measures that already exist: keys live in a
   separate credentials file, never in environment variables or tracked files.
   One exception (user 2026-10-16): the execution mode 「请求批准」 asks the
   user before shell commands, writes in the project folder and package installs.
6. **Visual baseline.** Keep the logo, colours and art style of `ScienceScope.html`.
   Layout, components and interaction follow `docs/design/DESIGN_SYSTEM.md`
   (user 2026-10-16: the one-to-one restore of the old interface is retired,
   `docs/archive/legacy/UI_RESTORE.md` is history only). Compact rather than loose; one
   icon set; no raw colours or font sizes outside the design tokens.
   The GUI is bilingual (中文 / English; every new string needs an English entry,
   `app/ui/i18n/en.js` for new code). Explanations go behind the "i" info tip; status,
   errors and data stay visible. Status means the outcome and what the user can do
   next: no token counters, batch progress or raw model output unless asked. Unfinished features stay hidden behind
   feature flags, never shown as "coming soon".
   No fake data presented as real.
7. **Runtime.** ScienceScope's own agent runtime on `@earendil-works/pi-ai` and
   `@earendil-works/pi-agent-core`, through the runtime port only
   (`docs/architecture/RUNTIME_PORT.md`): only `app/runtime/` imports model or agent
   packages. DSH is being removed (user 2026-10-16, task P1a); the old line keeps
   it as a dev dependency until R5.

## Engineering rules

- **Rebuild in progress** (`docs/architecture/ARCHITECTURE.md` §6; alpha order in `docs/plans/ROADMAP.md`). New
  code goes into `app/` following `docs/architecture/CORE_MODEL.md`. The old line
  (`desktop/`, `scripts/`, `adapters/`) is frozen as reference (tag
  `v0-prototype`): no new features there, only fixes needed to keep it running.
  It is deleted after the R5 cutover.
- Readable, maintainable code comes first: `docs/process/CODE_STYLE.md`, enforced by
  `npm run check` (format, lint, types, tests).
- Frontend: Preact + htm components in `app/ui/`, rendered from data; never wrap
  or override another module's functions.
- Database changes only through numbered migrations in `app/core/db/migrations/`.
- "Fix" or "implement" means connecting the feature end to end, not hiding or
  deleting it, unless the user asks. A setting needs a stored value and a real
  consumer.
- Tests: one functional test per user-visible path. Test what users do, not
  every defensive branch. No security tests and no speculative matrices.
  Fixtures use `.sciencescope-local/temp`.
- Real-model checks are encouraged (user 2026-10-08): when a change touches a
  user-visible AI path (answers, discussion, secretary, assistant, tools), run
  it once with the cheap paid model (OpenCode Go, `deepseek-v4.1-flash`) in
  addition to the scripted runtime, and report requests and tokens. Larger
  evaluations (many questions, several rounds, model comparisons) only in tasks
  that ask for them.
- Builds, caches, temporary files and test databases stay under `.sciencescope-local`.
- Downloads on the user's machine (user 2026-10-12, limited cross-border
  traffic): install dependencies from domestic mirrors (npm: npmmirror; pip/uv:
  Aliyun or Tsinghua; models: ModelScope) and reuse local caches. Avoid
  Hugging Face and other overseas sources unless there is no mirror; say so in
  the report when one was used.

## Workflow

- **Claude**: design, frontend, review and merge into the integration branch.
  All GUI work (design and implementation in `app/ui/`) is Claude's (user
  2026-10-16). **Sol** (GPT-6.1 Sol): backend, packaging and Windows acceptance;
  Sol does not design or restyle the UI, and touches `app/ui/` only where a
  brief names it. Its subagents use GPT-6.1 Sol, Git delivery uses GPT-6 Luna. Dot is no longer used (user
  2026-10-12): Claude re-checks on Linux in the cloud; installs, upgrade
  rehearsals and evaluations run locally on the user's H: drive by Sol / Codex.
- Rebuild workflow: Claude builds R0–R3 in the cloud (Linux) and sets the
  baselines; Codex pulls to Windows and Sol localizes (L1); afterwards Sol takes
  the heavy work (R4–R6) with short briefs, Claude reviews diffs.
- One task, one brief: goal, how the user will use it, files it may change,
  done criteria, things not to do. About one to two hours of work; if it grows,
  stop and report. If the brief asks for something that will be awkward for the
  user, say so before building it.
- For complex features (parsers, editors, agent loop, mind map, file preview)
  look for a mature open-source library or reference implementation first; name
  it and its licence in the report.
- Verification: related tests while working; the full `npm run check` once before
  delivery (`npm test` is the old line's suite). When the user can see the change,
  screenshots at 100% and 125% scaling. AI paths are accepted from a fresh
  install: add the provider in Settings, then run the task.
  Native acceptance only if native code changed.
- Report in 15 lines or fewer: what changed, which files, test result, open
  issues. Long material stays in `.sciencescope-local/temp`.
- Branches `codex/tNN-topic-YYYYMMDD` from the integration branch. Report the
  remote branch and SHA. No PR or merge unless the user asks. Never commit
  secrets, local state, logs or builds.
- Docs: `docs/product/FEATURES.md` describes what exists now (update it in the
  same commit when behaviour changes); `docs/plans/ROADMAP.md` holds direction
  and the task queue; `docs/log/IMPLEMENTATION_LOG.md` is a short dated log;
  briefs live in `docs/plans/tasks/` (template `docs/process/BRIEF_TEMPLATE.md`).
  Do not add a rule here for every incident; prefer a test.
- Credit: publisher peroperoyui; Codex as AI-assisted development; Claude
  (Anthropic) as AI-assisted review and development. Never fabricate identities
  or signatures.
