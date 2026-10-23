# Faculty study rerun/export review packet

Status: source-only, owner review hold. This packet does not invoke the normal
feedback generator, activate a draft, apply the migration, deploy a function,
or write production data.

## Isolation contract

`/admin/faculty-study` is superadmin-only. The authenticated route accepts a
private JSON manifest and requires exactly 30 unique assignment IDs in exact
Case 1 through Case 30 order. Preparation reads each selected completed
assignment, resolves the same active evaluator configuration the normal
generator would use (room-scoped first, then global), verifies that its prompt
matches the supplied revised prompt, verifies the deployed feedback model, and
requires the deployed generator revision attestation. Those values and the
per-case config IDs/versions are frozen in the isolated batch row before run.

The run reads only assignment-scoped historical rows from conversations,
orders, lab results, vitals, imaging, learner actions, and consultant/patient
messages. It does not fall back to patient-, room-, lineage-, or shared-room
queries. Deleted EMR rows are excluded. The assignment snapshot backs up the
existing feedback/status/score/provenance fields in the isolated results table;
it is never written back to the assignment.

Every case produces either a study result or an explicit error such as missing,
incomplete, inaccessible, or malformed context. A batch failure marks only the
study batch failed. No path updates `student_room_assignments`, grades,
published feedback, learner history, pins, or status.

## Artifacts

Export uses the frozen Case 1–30 manifest order and returns:

- raw JSON with the batch attestation and per-case verbatim strengths,
  improvements, recommendations, six component scores, both domain scores,
  evidence IDs, generation time, prompt/model versions, and explicit errors;
- one CSV sheet with the same fields;
- one deidentified JSON feedback document per case.

Assignment and student identifiers are intentionally omitted from exported
artifacts. The private manifest remains the owner’s source of case-number
mapping.

## Deployment gates

1. Owner supplies the private manifest through the authenticated superadmin
   route and reviews its 30-case order/hash.
2. Owner verifies the deployed `generate-feedback` revision is exposed as
   `GENERATE_FEEDBACK_REVISION`, and verifies the active room/global evaluator
   configuration table and model environment. If the configuration table is
   absent, preparation fails closed with `FEEDBACK_CONFIG_UNAVAILABLE`; do not
   create or activate a draft as a workaround.
3. Apply the review migration only after schema/grant/RLS preflight confirms
   the two isolated tables and service-role function access. This migration is
   currently unapplied.
4. Deploy the edge function with the required model key and generator revision,
   then run a non-clinical smoke check for auth rejection, prompt/model/revision
   mismatch, and a forced context error. Do not use the normal generator for
   smoke data.
5. Prepare the real batch, review the frozen attestation, run once, and compare
   the export case count/order to the private manifest. Confirm assignment
   feedback/status/grade/history counts and representative row hashes are
   unchanged before accepting the study export.

Rollback is batch-local: stop before `run`, or retain/delete only the isolated
study batch/results under an owner-approved retention action. There is no
assignment or learner-history rollback because this workflow is prohibited from
writing those tables. If any preflight or post-run invariant fails, stop and do
not export; leave the batch failed for review.

## Validation performed

The manifest/deidentification/export contract tests pass (`3/3`), including
ordered 30-case validation, duplicate/invalid ID rejection, explicit error
preservation, six component scores, and identifier exclusion. Frontend build
and function syntax/type validation remain required in the deployment
environment; no live database or production function was invoked for this
source-only candidate.

This study workflow is independent of Room 206 goals/progress, ED 28 packet
repair, and QA-room retirement. Those workstreams remain unchanged and are not
deployment prerequisites for this export path.
