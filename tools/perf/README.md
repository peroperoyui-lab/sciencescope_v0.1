# P4a Windows performance and background usage

Use an isolated **ScienceScope Install Test** installation. Keep the user's preview installation and data untouched. All generated documents, databases, captures and receipts belong below an ignored `.sciencescope-local/` directory; only these scripts and the aggregate handoff report are tracked.

Run with Node 22.22.2 and dependencies installed from the repository lockfile (`npm ci --registry https://registry.npmmirror.com`). The corpus uses existing PDF-lib and JSZip dependencies, with original synthetic text. No model is needed to generate it. The public report is `docs/handoff/reports/P4a.md`.

## Generate the corpus

Close the test application first. In PowerShell, choose an empty test data directory:

```powershell
$perfInstall = '<isolated test installation>'
$perfData = Join-Path $perfInstall 'data'
$perfOut = '.sciencescope-local/temp/p4a'
node tools/perf/seed.mjs --data $perfData --seed p4a-20261027
```

The version-2 corpus has 100 PDFs, 100 DOCX files and 100 Markdown files, 12 conversations with 1,000 messages, genuine local tool-call records and attachment relationships, and a roughly 50,000-Chinese-character DOCX with a table, embedded picture and equation. All 100 synthetic PDFs become paper catalog nodes without model calls; the DOCX and Markdown sources retain their original kinds. Two manuscript versions contain controlled changes. Files pass through the normal parsing/indexing services; the manifest reports actual chunks rather than inserting artificial chunk rows. With the 2026-10-27 parser the corpus has 5,060 chunks and 50,213 Chinese characters in the long manuscript.

`perf-seed-manifest.json` contains file hashes, counts (including paper nodes) and the IDs consumed by the measurement harness. Repeating the command with the same seed verifies and reuses its corpus; it does not delete unknown directories. Version 2 requires a fresh data directory and rejects version-1 manifests. Use a new empty test data directory to reproduce the initial corpus after modifying it. Content and file hashes are reproducible; database IDs and timestamps need not be byte-identical. `--tiny` creates a small functional smoke fixture with two PDF paper nodes.

## Measure the installed native product

Finish builds, indexing and unrelated tests before measuring. Warm mode performs one untimed launch, then three measured launches. Each action records its actual ready condition, backend request window and browser CPU profile. The DOCX edit is undone and saved after each sample, with the original file hash checked.

```powershell
node tools/perf/native-measure.mjs --install $perfInstall --data $perfData --manifest "$perfData/perf-seed-manifest.json" --out "$perfOut/native-warm-baseline" --mode warm --runs 3 --port 9390 --label baseline --observer tools/perf/observe.mjs
```

`native-measure.json` reports medians and individual observations. Startup begins before launching the installed executable and ends when the input/home data is observed ready. CDP attachment bounds the earliest readiness observation. The other measurements cover opening the longest conversation, loading earlier messages, library/search, the global knowledge graph, opening the long DOCX, opening the actual desk version tree, editing to write-back readiness, and showing the comparison. The graph operation records rendered node and edge counts; it uses the existing global graph rather than a project graph. Version-tree readiness requires both seeded nodes in the visible UI and saves its screenshot. Keep failed attempts in their own output directories.

For cold startup, each sample must follow an actual reboot or system file-cache purge. A fresh process alone is not a cold sample. This run uses the Microsoft-signed [RAMMap](https://learn.microsoft.com/en-us/sysinternals/downloads/rammap) tool (`-Es` then `-Et`), downloaded only for local acceptance. `clear-cache.ps1` checks its signature and records cache counters before/after. Cache clearing needs administrator confirmation and can temporarily slow other applications.

Create an ignored hook accepting `-Run` that invokes the following command with your local paths, and returns only its JSON receipt:

```powershell
param([int]$Run)
& tools/perf/clear-cache.ps1 -RamMap '<RAMMap64.exe>' -Receipt ".sciencescope-local/temp/p4a/cache-$Run.json" -Run $Run -Elevate
```

```powershell
node tools/perf/native-measure.mjs --install $perfInstall --data $perfData --manifest "$perfData/perf-seed-manifest.json" --out "$perfOut/native-cold-baseline" --mode cold --startup-only --runs 3 --port 9390 --label baseline --observer tools/perf/observe.mjs --cold-hook '<ignored hook.ps1>'
```

The observer uses Node's HTTP diagnostics channels, writes method/path/status/timing without tokens, query strings or bodies, and excludes SSE/static requests. It changes no application route. Aggregate only requests inside the recorded action windows:

```powershell
node tools/perf/observe.mjs --input "$perfOut/native-warm-baseline/backend-http.jsonl" --windows "$perfOut/native-warm-baseline/native-measure.json" --out "$perfOut/native-warm-baseline/backend-summary.json"
node --test "tools/perf/*.test.mjs"
```

`backend-summary.json` gives request counts and p50/p95, sorted by p95; browser network durations are reported separately. Load the saved `.cpuprofile` files in Chromium DevTools to inspect the named UI functions. When comparing a backend fix, keep the same corpus, native binary configuration, run count and readiness criteria, and use a separate `after` output directory.

## Measure twenty live conversation rounds

Use the fresh test installation with a separate empty data profile. Add the actual **OpenCode Go preset** and choose `deepseek-v4.1-flash` through Settings; the preset supplies Go's session-routing header. Credentials belong only in that profile's `secret/credentials.yaml`; do not put a provider key in a CLI argument, environment variable or report. Record and keep the current saved defaults, including memory budget and idle delay, minutes policy, paper cards and version-note preferences. P4b uses the default **100,000-token memory budget**: current memory requests reserve at most 32,768 output tokens. The P4a historical run explicitly raised its fixture budget to 500,000 because the earlier implementation reserved the model's full 384,000-token output limit; keep that difference in comparisons instead of repeating the override on current code. The preset's connection-test UI chooses the first catalog model; when testing only flash, specify that model through the existing test API and record this setup request separately.

`runLive(api, {out})` in `live.mjs` accepts the authenticated local application client. It sends twenty distinct synthetic research decisions in one conversation, normally imports one synthetic paper and two manuscript versions, then leaves the application idle for at least 10.5 minutes so the default memory timer can run. Minutes updates restart the idle timer; pass `drainTimeoutMs: 600000` to wait for the naturally scheduled memory task to reach a terminal state after that initial idle period. The Windows acceptance wrapper submits each message through the existing native composer and preserves the actual API response. Every attempt is saved; a failed answer stops the scenario. The CLI alternative accepts a **local application token file**, not a provider key:

```powershell
node tools/perf/live.mjs --endpoint http://127.0.0.1:PORT --token-file '<ignored local app token file>' --out "$perfOut/live-baseline/live.json"
node tools/perf/usage.mjs --data '<isolated usage data>' --windows "$perfOut/live-baseline/live.json" --scenario "$perfOut/live-baseline/live.json" --out "$perfOut/live-baseline/usage.json"
```

Usage comes from the installed runtime's actual request logs, joined to persisted sessions and jobs. Each row retains provider/model identity. Report each background function separately, including failed or missing-usage requests. Duration totals are work time, so concurrent calls may overlap. Context hashes identify repeated inputs without exporting their text; distinguish a repeated full context from the same user input followed by a new tool result. An already-running background call overlapping a foreground answer is distinguished from a new background request started while the foreground was busy. Concurrent minutes can be attributed through unique durable message ownership; ambiguous jobs remain unassigned. Collect a separate unfiltered profile total for setup and failed attempts outside the scenario window. After all requests have settled, close the test product, remove its test credential reference, and retain the ignored evidence for review.

Run the repository's complete `npm run check` from a clean checkout after measurement, so the test workload does not contaminate timing samples. Keep installation/build receipts and all raw profiles in the ignored evidence directory; publish aggregate numbers and reproducible steps only.

## P4b: current pages and startup breakdown

Use a new isolated install and keep the product closed during seeding. The base v2 corpus uses the same seed as P4a so the original 300 files, 5,060 chunks, 12 chats, 1,000 messages and long DOCX remain comparable. The overlay adds 30 actual manuscript versions with notes, a 200-node map, 12 plans, 20 log entries and a local read/knowledge-change history on the last existing answer, without model requests. The graph therefore has 100 original paper nodes plus one synthetic entity and its evidence link. `perf-p4b-manifest.json` retains the base counts and records the overlay separately. `--tiny` is a functional smoke fixture. Reusing the overlay verifies source hashes and durable counts; start from a fresh profile to rebuild it after edits.

```powershell
node tools/perf/p4b-seed.mjs --data $perfData --seed p4a-20261027
node tools/perf/native-measure.mjs --p4b --install $perfInstall --data $perfData --manifest "$perfData/perf-p4b-manifest.json" --out '.sciencescope-local/temp/p4b/native-warm' --mode warm --runs 3 --port 9390 --observer tools/perf/observe.mjs
node tools/perf/native-measure.mjs --p4b --install $perfInstall --data $perfData --manifest "$perfData/perf-p4b-manifest.json" --out '.sciencescope-local/temp/p4b/native-cold' --mode cold --startup-only --runs 3 --port 9390 --observer tools/perf/observe.mjs --cold-hook '<ignored cache-purge hook.ps1>'
node tools/perf/observe.mjs --input '.sciencescope-local/temp/p4b/native-warm/backend-http.jsonl' --windows '.sciencescope-local/temp/p4b/native-warm/native-measure.json' --out '.sciencescope-local/temp/p4b/native-warm/backend-summary.json'
node --test "tools/perf/*.test.mjs"
```

The current UI path additionally measures workbench cards and version notes, workbench comparison, map open and drag through the save response, journal list and edit through save, a 300-file expanded folder tree and selected-file properties/text, both knowledge blocks below one answer, and Settings blur-triggered autosave. Map, journal and settings edits are restored outside the measured operation. Desk comparison is opened by its real version-tree button. Each action retains browser CPU profiles and its actual readiness detail. Screenshots and diagnostics remain local.

Each run captures the existing `logs/startup.log` wall-clock marks, browser navigation/script resource timings, first-screen API resources and any index-progress SSE frames observed after CDP attachment. No app/native code is instrumented. Database opening/migrations share the existing `createCore` interval; an already indexed fixture may have no startup content-index task.

For a separate startup diagnosis, use `--startup-only --mode fresh-process --runs 1 --observer tools/perf/startup-observe.mjs` and a distinct output directory. This preload composes the normal HTTP observer and writes `startup-<pid>.json` plus a Node CPU profile beside the HTTP log. It stops on first-screen rendered acknowledgement. Inspector sampling adds overhead, so keep diagnostic launch timings separate from the official warm/cold medians. Stack-attributed sampled milliseconds describe CPU attribution, while `startup.log` intervals describe elapsed time.

## P4b: static structure inventory

```powershell
node tools/perf/structure-audit.mjs --root . --out '.sciencescope-local/temp/p4b'
node --test tools/perf/structure-audit.test.mjs
```

The audit reuses the installed TypeScript compiler API (5.9.3, Apache-2.0), records its actual installed metadata, and adds no dependency. It parses code under `app/` and `tools/`; production statistics cover `app/services/`, `app/core/`, `app/server/` and `app/shared/`, excluding test files and explicitly listed testing/fixture helpers. Outputs are `structure-inventory.json` and `structure-summary.md`. They retain the largest 15 files, every function above 80 physical lines with its lexical container and nested-function count, literal imports and layer transitions, direct server→core imports, SCC cycles within scope and full-app cycles touching scope, unresolved/nonliteral imports and parse diagnostics. Outer factory spans include nested functions; the separate own-line count helps distinguish closure organization from long individual operations.

The module→test inventory separates exact companions, direct imports and transitive import paths, grouped as browser, runtime or other tests. Literal `new Worker(new URL(..., import.meta.url))` entries are recorded separately and traversed for test associations; worker launches remain separate from module-import SCCs. These static associations support assertion review; they are separate from executed line/branch coverage. Runtime-port imports are flagged for boundary review, preserving the distinction between a public port and a concrete provider SDK.

## P4c phase-by-phase comparisons

Run each comparison before editing its product path and again after the focused tests pass. Keep both JSON files under `.sciencescope-local/temp/p4c/`; the probes refuse to overwrite a previous receipt. The cumulative report is `docs/handoff/reports/P4c.md`.

Part 1 checks existing similarity settings with the production save resource and an empty derived graph; it opens no application data or model. `--source` optionally selects another source checkout for the same probe. The counts describe validation agreement, not indexing performance.

```powershell
node tools/perf/p4c-similarity.mjs --source "<before-checkout>" --out .sciencescope-local/temp/p4c/part1-before.json
node tools/perf/p4c-similarity.mjs --out .sciencescope-local/temp/p4c/part1-after.json
```

Part 2 seeds catalog metadata for 300 sources and 5,060 chunks, plus 12 chats with 1,000 synthetic answer messages. Every answer has a completed `research_read` receipt; no original documents, parser, runtime or model is involved. The longest chat has 180 answers and the probe reads its last 30. One warm-up precedes three measured runs. The old path makes 90 sequential loopback HTTP requests; the batch path makes one. These server-side timings exclude UI/WebView and do not simulate browser request concurrency. The after probe checks exact JSON equality against the old endpoints on the same fixture.

```powershell
node tools/perf/p4c-extras.mjs --phase before --source "<before-checkout>" --out .sciencescope-local/temp/p4c/part2-before.json
node tools/perf/p4c-extras.mjs --phase after --out .sciencescope-local/temp/p4c/part2-after.json
node tools/perf/p4c-extras.mjs --phase after --knowledge-changes --out .sciencescope-local/temp/p4c/part2-history.json
```

The optional history case creates six changed turns and restore chains of lengths one and two: 99 old requests versus one batch. Receipts retain all three samples, median wall time, request counts and uncompressed response-body bytes. Failures are retained in their reserved receipt; use a new output name for the next attempt.

Part 2b measures the two desk read APIs. Use the test product's `runtime/node.exe` (22.22.2) to match the installed runtime; each receipt records `process.version`. The sources probe uses a single 1,000-answer conversation, the same 300-source/5,060-chunk synthetic catalog, and one warm-up plus three samples. Its old control calls the shared source rules over in-memory messages and one tool-call query per turn; the new path is a complete loopback HTTP request. The old control is a diagnostic, not an existing whole-conversation UI endpoint. Exact successful-receipt parity, source/use counts and SQL counts are checked.

```powershell
node tools/perf/p4c-sources.mjs --phase before --source "<before-checkout>" --out .sciencescope-local/temp/p4c/part2b-sources/before.json
node tools/perf/p4c-sources.mjs --phase after --out .sciencescope-local/temp/p4c/part2b-sources/after.json
node tools/perf/p4c-version-media.mjs --phase before --source "<before-checkout>" --out .sciencescope-local/temp/p4c/part2b-media/before.json
node tools/perf/p4c-version-media.mjs --phase after --out .sciencescope-local/temp/p4c/part2b-media/after.json
```

The media probe generates two 1,200-paragraph DOCX versions with two embedded pictures. It verifies image refs in the real diff and the media endpoint, then compares 20 repeated service reads through `readFile + readDocx + indexMedia + readMedia` against the warm version-package cache. HTTP transport, diff computation and initial cache loading are outside this timing. One warm-up and three measured iterations retain byte identity and timing samples. Never compare measurements across Node versions as one before/after pair. All receipts and generated originals remain in the ignored P4c temporary directory.

Part 3 measures settings saving with all three real settings-event consumers: knowledge jobs/cards, semantic configuration, and memory scheduling. It uses 300 synthetic paper records, 5,060 chunks, 12 chats and 1,000 messages with completed derived/card checkpoints. Memory stays enabled at its default ten-minute idle period; semantic indexing is disabled. Only embedding resources and the agent runtime use local stand-ins. One generated fixture header exercises the real credential hooks; model requests and downloads must remain zero.

```powershell
node tools/perf/p4c-settings.mjs --phase before --source "<instrumented-before-checkout>" --out .sciencescope-local/temp/p4c/part3/before.json
node tools/perf/p4c-settings.mjs --phase after --baseline .sciencescope-local/temp/p4c/part3/before.json --out .sciencescope-local/temp/p4c/part3/after.json
```

Each graph-view preference or profile-bio save is one PATCH, matching the actual UI calls. One warm-up precedes three measured runs per path. Receipts separately report HTTP completion, completion of the consumers, response bytes/hashes, and private `sciencescope.settings.performance` stage timings/counts. A settings-queue barrier drains scheduled reads; its seven diagnostic observations are excluded. Stage durations can overlap or contain other stages, so never add their sums into total request time. The before checkout must contain the same observation-only marks; a revision without these marks cannot provide this breakdown. The original P4c before measurement used checkpoint `f564170` plus those marks, before optimization. Current-source runs are independently repeatable; `--baseline` additionally verifies all six response-byte hashes against an immutable earlier receipt.

Part 4 keeps the exact same synthetic 30-version fixture across measurements. It creates small Markdown originals, real notes and workspace revisions, metadata, and 420 stored instruction rows (300 returned after the existing distinct/order/limit rules). A fake diff worker is used only during setup and settles before timing. The first process-local graph GET is separate from one warm-up and three measured GETs; operating-system caches are not cleared.

```powershell
node tools/perf/p4c-version-graph.mjs --phase before --source "<before-checkout>" --out .sciencescope-local/temp/p4c/part4/before.json
$graphBefore = Get-Content -Raw .sciencescope-local/temp/p4c/part4/before.json | ConvertFrom-Json
node tools/perf/p4c-version-graph.mjs --phase after --data $graphBefore.fixtureDirectory --baseline .sciencescope-local/temp/p4c/part4/before.json --out .sciencescope-local/temp/p4c/part4/after.json
```

The receipt records SQL categories, actual notes-file read counts/bytes/concurrency, HTTP time and body hash. Temporary filesystem instrumentation delegates to the original `readFile` and is restored after each request. The after run checks complete JSON and byte-hash equality against the before response, plus all 60 original/notes hashes and version/catalog/revision/instruction snapshots. `--data` requires `--baseline` so a preserved fixture cannot be reseeded accidentally. The main version metadata query is distinct from the per-note canonical path and revision checks, which remain in place.
