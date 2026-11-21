# Faculty feedback rerun investigation — 2026-11-21

## Verified production records (read-only)

- IM-07 `a3d778f4-aaaf-4b68-9c66-ba39e1d7db0a`: completed at 2026-11-21T02:44:44.058Z; Communication null, MDM 4. Saved `feedback_debrief.section_errors.communication`: `Model returned no content (finish_reason=length)`. Assessment run `bfd3a9e2-5cc7-4964-ab43-ea43e7598a9e` stores the same error. All required sources are available/available-empty, not failed source queries.
- IM-08 `dabc3086-2312-45fa-9fe1-e55679436f15`: failed; feedback_error records evidence-reconciliation rejection: text says no communication was captured while packet contains 6 learner communication events. Recorded timestamp remains 2026-07-04T14:04:51.89Z.
- OB-01 `2aeb3a6d-a985-4b7d-9afa-66179e99e29d`: failed; feedback_error records safety concern requiring -1 versus saved candidate deduction 0, plus no-communication contradiction against 5 learner communication events. Recorded timestamp remains 2026-07-04T14:05:03.041Z.
- No new assessment run was found for the two rejected assignments. Failed candidates are not retained, so the exact offending sentences cannot be independently inspected; do not claim the regex is or is not a false positive from these messages alone.
- Downloaded deployed generate-feedback source for inspection under local backups/feedback-investigation-20261121. The legacy management logs endpoint returned HTTP 410; these findings are from actual persisted backend errors and the successful run, not a claim of live-log retrieval.

## Root causes and changes

1. A section request error was replaced by an empty object, canonicalized to unscored values, then saved as completed if the other section succeeded. Reject technical component incompleteness before persistence and exclude incomplete saved runs from fingerprint reuse. Preserve explicit evidence-based null scores with supplied reasons.
2. A length-limited response may exhaust the reasoning/output budget. Retry this failure once with twice the budget and identical messages, not new rubric instructions; other errors are not retried.
3. IM-08 and OB-01 are explicit reconciliation failures, not persistence loss. Do not weaken reconciliation or synthesize scores. Log backend failure diagnostics and surface the wrapper's errors[] in the client, instead of discarding them for a generic message.
4. AssignmentManager stores the review row independently from the refreshed list. Retain only selected row identity and derive both detail views from current rows; refresh before success and after failure.

## Verification

- 53 focused tests pass across contract, selection hook, section isolation, evidence packet and closed-loop evidence. Synthetic fixtures, not production/cohort attempts.
- Deno typecheck passes with existing catch-variable configuration relaxed; no model-message/content changes.
- Edge Runtime v1.74.0 generate-feedback bundle check passes.
- Frontend Vite production build passes.
- TypeScript AST comparison confirms all model-message string/template literals unchanged from origin/main. Evaluation prompts, comments, contract, simulation prompt, evidence reconciliation and scoring files are byte-identical.

## Blast radius / decomposition

One coherent technical fix for feedback response acceptance and UI readback; independent nurse chat work is excluded. No evaluator wording, scoring rules, goals, case content, snapshots or cohort attempts changed. Existing safety/evidence rejection stays in force. No deployment authorized or performed in this task; no claim of live end-to-end/model validation. Latency may rise for a single length retry under the existing function deadline; insufficient coherent output still fails with prior feedback preserved.
