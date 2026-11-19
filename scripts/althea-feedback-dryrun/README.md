# Althea feedback dry run (write-free)

Runs the real `supabase/functions/generate-feedback` handler against a read-only snapshot of one
attempt, then renders before/after through the app's own sheet code. Nothing is written.

## What is guarded

- **Database:** `stubs/supabase-stub.ts` replaces `@supabase/supabase-js`. Reads come from the snapshot.
  Every insert/update/upsert/delete is recorded in `intercepted` and acknowledged locally. The stub has
  no transport, so no write can reach the database. The only RPC allowed is the event-manifest read.
- **Network:** during the pipeline, `fetch` allows only `https://api.openai.com/v1/chat/completions`.
  Any other host throws and is counted in `blocked_network_calls`.
- **Snapshot:** `run.ts` reads prod through the Supabase management API inside `SET TRANSACTION READ ONLY`,
  and refuses any statement that does not start with `select` or `with`.
- **Key:** the key file (`~/.config/nursebot/openai-eval.env`, mode 600) is read only in live mode.
  Its values are never printed or written to outputs.

## Run

From the repo root:

```sh
# live (needs the approved key file)
deno run -A --import-map scripts/althea-feedback-dryrun/import_map.json \
  scripts/althea-feedback-dryrun/run.ts --assignment <uuid> --out <dir>

# mock (no key; plumbing check only, scores are placeholders)
deno run -A --import-map scripts/althea-feedback-dryrun/import_map.json \
  scripts/althea-feedback-dryrun/run.ts --assignment <uuid> --out <dir> --mock
```

Outputs: `summary.md` (deidentified before/after), `before-*.html` / `after-*.html` (download and preview),
`preview-vs-download-*.diff`, `provenance.json` (commit, model, prompt and request hash, versions, checks),
and `internal/` (raw model traffic and the learner/patient text; not deidentified, do not share).

The exit code is 0 only when the write guard passes and the structure checks pass (2 strengths, 2 improvements,
3+3 components). A structure failure exits 2 and is reported, not hidden.

## Known limits

- Model: resolved the same way as the function (`OPENAI_MODEL_GENERATE_FEEDBACK`, then `OPENAI_MODEL`, then
  the code default). Prod function secrets are not readable here, so prod may use a different model.
- Bedside telemetry cutoff (`ALTHEA_BEDSIDE_TELEMETRY_SINCE`) is a function secret and is not readable here.
  It is treated as unset, and `provenance.json` says so.
- Baseline medications and orders are reported as unavailable. Prod has no baseline snapshot table (PR #46 is not applied).
- Saved-score reuse is bypassed (the snapshot returns no prior runs, and `forceRegrade` is set), so every run is a fresh evaluation.
- The learner debrief page (`AssignmentDebrief`) has no exported render function, so it is not rendered here.
  The preview is `FeedbackSheet` (admin preview) and the download is `renderFeedbackSheetHtml`.
