# Stage 3 retrieval-eval fixture contract

The tracked `gold.json` is a byte-for-byte copy of the user-approved set on
2026-09-27. Its historical top-level `DRAFT` labels are retained; the
approval record is what makes this set approved for the validation run.
The immutable source inputs are:

- `.sciencescope-local/temp/local-validation-r4/retrieval-draft/gold-draft.json`
- `.sciencescope-local/temp/local-validation-r4/retrieval-draft/USER_APPROVAL.md`
- `.sciencescope-local/temp/local-validation-r4/corpus/manifest.json`

The runner defaults to this tracked copy (`tests/fixtures/retrieval-eval/gold.json`)
so later preparation cannot accidentally reuse an old temporary gold path.

The approved gold SHA-256 is
`5f1de0c94f388b242286ecde082e3da86c843653533e301e1d6eea6c0f2aa506`.
The runner writes reproducible preparation artifacts and its persistent test
database below `.sciencescope-local/temp/local-validation-r4/final-eval`.

## Interface

```text
node scripts/evals/real-corpus-retrieval.mjs prepare
node scripts/evals/real-corpus-retrieval.mjs keyword --mapping <manually-reviewed-mapping.json>
node scripts/evals/real-corpus-dense.mjs dense --mapping <manually-reviewed-mapping.json>
```

`prepare` imports the eight corpus copies through the production desktop API,
waits for `/api/research/sync`, records each source's observed terminal status,
duration, parse error and parser SHA, exports chunks, and creates a mapping draft.
It does not read paper query, answer, or rank fields and does not score.
`keyword` refuses drafts: a reviewer must set `freezeStatus` to `FROZEN` and
preserve the immutable gold hash. It calls production `ResearchBase.search`
with `gold.query.zh`, reports paper (52) and synthetic memory (8; 5 positive,
3 negative) metrics separately. The dense command is separate and local-only:
it requires the pinned model already present under `.sciencescope-local/models`
and isolated benchmark dependencies under `.sciencescope-local/bench`; it
reports zh-only, en-only and bilingual max-cosine separately, with no
keyword/hybrid fusion.

No corpus originals are modified and no network/provider/secret is used.
