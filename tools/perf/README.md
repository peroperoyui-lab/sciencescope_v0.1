# P4a Windows performance and background usage

Use an isolated **ScienceScope Install Test** installation. Keep the user's preview installation and data untouched. All generated documents, databases, captures and receipts belong below an ignored `.sciencescope-local/` directory; only these scripts and the aggregate handoff report are tracked.

Run with Node 22.22.2 and dependencies installed from the repository lockfile (`npm ci --registry https://registry.npmmirror.com`). The corpus uses existing PDF-lib and JSZip dependencies, with original synthetic text. No model is needed to generate it. The public report is `docs/handoff/reports/P4a.md`.

## Generate the corpus

Close the test application first. In PowerShell, choose an empty test data directory:

```powershell
$perfInstall = '<isolated test installation>'
$perfData = Join-Path $perfInstall 'data'
$perfOut = '.sciencescope-local/temp/p4a'
node tools/perf/seed.mjs --data $perfData --seed p4a-20261026
```

The default corpus has 100 PDFs, 100 DOCX files and 100 Markdown files, 12 conversations with 1,000 messages, genuine local tool-call records and attachment relationships, and a roughly 50,000-Chinese-character DOCX with a table, embedded picture and equation. Two manuscript versions contain controlled changes. Files pass through the normal parsing/indexing services; the manifest reports actual chunks rather than inserting artificial chunk rows. The recorded corpus has **5,760 chunks and 50,213 Chinese characters in the long manuscript**.

`perf-seed-manifest.json` contains file hashes, counts and the IDs consumed by the measurement harness. Repeating the command with the same seed verifies and reuses its corpus; it does not delete unknown directories. Use a new empty test data directory to reproduce the initial corpus after modifying it. Content and file hashes are reproducible; database IDs and timestamps need not be byte-identical. `--tiny` creates a small functional smoke fixture.

## Measure the installed native product

Finish builds, indexing and unrelated tests before measuring. Warm mode performs one untimed launch, then three measured launches. Each action records its actual ready condition, backend request window and browser CPU profile. The DOCX edit is undone and saved after each sample, with the original file hash checked.

```powershell
node tools/perf/native-measure.mjs --install $perfInstall --data $perfData --manifest "$perfData/perf-seed-manifest.json" --out "$perfOut/native-warm-baseline" --mode warm --runs 3 --port 9390 --label baseline --observer tools/perf/observe.mjs
```

`native-measure.json` reports medians and individual observations. Startup begins before launching the installed executable and ends when the input/home data is observed ready. CDP attachment bounds the earliest readiness observation. The other measurements cover opening the longest conversation, loading earlier messages, library/search/graph, opening the long DOCX, editing to write-back readiness, and showing the comparison. Keep failed attempts in their own output directories.

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
node --test tools/perf/native-profile.test.mjs
```

`backend-summary.json` gives request counts and p50/p95, sorted by p95; browser network durations are reported separately. Load the saved `.cpuprofile` files in Chromium DevTools to inspect the named UI functions. When comparing a backend fix, keep the same corpus, native binary configuration, run count and readiness criteria, and use a separate `after` output directory.

## Measure twenty live conversation rounds

Use the fresh test installation with a separate empty data profile. Add OpenCode Go and choose `deepseek-v4.1-flash` through Settings. Credentials belong only in that profile's `secret/credentials.yaml`; do not put a provider key in a CLI argument, environment variable or report. Leave minutes, memory, version notes and paper-card defaults enabled.

`runLive(api, {out})` in `live.mjs` accepts the authenticated local application client. It sends twenty distinct synthetic research decisions in one conversation, normally imports one synthetic paper and two manuscript versions, then leaves the application idle for 10.5 minutes so the default memory timer can run. It saves each attempt and stops on a failed answer rather than repeating a successful scenario. The CLI alternative accepts a **local application token file**, not a provider key:

```powershell
node tools/perf/live.mjs --endpoint http://127.0.0.1:PORT --token-file '<ignored local app token file>' --out "$perfOut/live-baseline/live.json"
node tools/perf/usage.mjs --data '<isolated usage data>' --windows "$perfOut/live-baseline/live.json" --out "$perfOut/live-baseline/usage.json"
```

Usage comes from the installed runtime's actual request logs, joined to persisted sessions and jobs. Report each background function separately, including failed or missing-usage requests. Duration totals are work time, so concurrent calls may overlap. Context hashes identify repeated inputs without exporting their text; an already-running background call overlapping a foreground answer is distinguished from a new background request started while the foreground was busy.

Run the repository's complete `npm run check` from a clean checkout after measurement, so the test workload does not contaminate timing samples. Keep installation/build receipts and all raw profiles in the ignored evidence directory; publish aggregate numbers and reproducible steps only.
