# Disposable QA contract review packet

Source-only review packet for project `lvpbwtfvairspufrashl` (`sb1-v84f4fhg`).
No migration application, assignment retry, room/patient write, MAR write, or
clinical data change was performed.

## Exact dependency

- Migration: `supabase/migrations/20261021120000_scope_disposable_qa_learners.sql`
- SHA-256: `6dbd1d54adb88ffbe2b2ecd62aa27aa0012a7e89528fc46fd6e6e730cad6db3f`
- Purpose: add the `student_room_assignments.disposable_qa` discriminator,
  allow-list `1b895dcc-d329-4b31-8735-2059b986ae96`, enforce the
  superadmin/synthetic-learner/same-school/active-room/program boundary.
  It also rejects any `disposable_qa=true` row that is not `is_sandbox=true`.
- Separate from held timeline migrations `20261021224401` and
  `20261022032351`; neither is a prerequisite for this contract.

## Production readback

Request `9bd2dcbd-4bd5-4c16-a3d6-bd030f3941c1` has no assignment row and no
manual snapshot. Its `PGRST204` was caused by the absent production
`disposable_qa` column. The request window expired at `2026-10-22 04:30 UTC`;
there is no authorized retry in this packet. The original request and IDs stay
preserved for reconciliation.

The existing room 118 and MAR packet remain unchanged. A successful future
attempt must create one new assignment with a new request/row ID, then prove
the assignment snapshot and learner read path; it must not recreate room 118 or
rewrite the packet.

## Library content readback

Published course `4e6bdaf6-50b6-4f2f-9a61-5efb6e0d4c71` v1 (`Student Learning
Library Preview`, audience `student`, `is_mandatory=false`) currently pins:

| position | video ID | version | audience | media object |
|---:|---|---:|---|---|
| 0 | `8d70f650-bfad-40d8-b52e-bf39f549db62` | 1 | `test_room` | `22ed263c-09a6-4510-b984-7e8e1700293c/02-Getting-an-account.mp4` |
| 1 | `623d49a5-3400-4d32-9a84-3a82b536841c` | 1 | `test_room` | `9219fb81-e908-4112-a112-c7ab6ed5a03d/07-Opening-an-assigned-student-case.mp4` |
| 2 | `a25d3424-afdf-42a4-b8e3-ea8652c78e2e` | 1 | `test_room` | `1927228e-e671-4640-a108-d9011b70c4c5/04-Nurse-and-bedside-conversations.mp4` |
| 3 | `1a004bd9-a257-4fd5-a285-f72ddd501e78` | 1 | `test_room` | `d06b23e7-ef1c-4f1e-b723-80d3f30664d1/05-Reviewing-EMR-and-ordering-CBC.mp4` |
| 4 | `06216dc8-3420-49c3-a10c-dee8455a47db` | 1 | `test_room` | `62a03e6e-11b1-4dda-bc43-10ad1dc5265d/06-Completing-a-case-and-feedback.mp4` |
| 5 | `4580468f-2aec-4fff-9444-6a7ed50ddc9e` | 1 | `test_room` | `6a1f506e-82fe-45d3-8bc9-ca40431dcd3e/Case-204-Start-to-Finish-Demo.mp4` |

All six are published and processing-ready, with no captions object in the
readback. They are inaccessible to the UA student role by audience policy;
this is a versioned-content repair issue, not a reason to switch Test Room
audiences or make onboarding mandatory.

## Review gates before owner execution

1. Apply only this migration to a disposable schema and capture stdout/stderr.
2. Prove authenticated superadmin + allow-listed synthetic learner + eligible
   same-school room succeeds; with that same learner and requested school A,
   prove a valid active medical room restricted to school B is denied, while
   the eligible room is allowed. Also prove non-superadmin, non-allow-listed
   learner, inactive room, wrong program, and anon fail.
3. Prove `disposable_qa=true` cannot be inserted with `is_sandbox=false` and
   that a successful insert produces exactly one immutable manual assignment
   snapshot/readback for the new assignment.
4. Confirm the old request remains absent before any production retry. If the
   request is retried, reconcile its expired scheduling window first and issue
   one newly authorized request; never replay it blindly.
5. Owner review is required before applying the migration or creating the
   assignment.

## Reproducible isolated evidence

The exact-schema runner is
`scripts/run-disposable-qa-manual-mar-exact.sh`; it requires
`MAR_QA_DISPOSABLE=1`, uses a disposable PostgreSQL 15 container, applies the
unchanged 120000 contract plus manual packet/snapshot hardening, and runs with
`ON_ERROR_STOP=1`. It refuses an occupied container name before installing its
cleanup trap, hard-asserts every positive/negative/NULL/count check, tests a
real unauthorized INSERT, and changes the mutable packet after assignment
creation before verifying the learner still reads the frozen revision-1,
four-event snapshot. The captured passing transcript is
`docs/reviews/2026-10-22-disposable-qa-manual-mar-exact.transcript.txt`.

The transcript proves authenticated NULL/preflight rejection, authenticated
superadmin allow, non-superadmin denial, the same valid allow-listed learner
against an eligible room and a nonempty school-B-restricted room (allowed and
denied respectively), unauthorized INSERT denial, the
`disposable_qa=true,is_sandbox=false` constraint rejection, one assignment
snapshot containing exactly four events, and learner assignment-scoped
readback after the source packet advances to revision 2. The frozen assertion
compares the complete original event JSON, including dose, route, frequency,
status, exact hour, and reason. It is disposable-only and does not prove
production policy behavior. Stop/rollback for the runner is container
teardown; production execution remains a separate owner-reviewed transaction.

## Minimal production owner packet

Target: Supabase project `lvpbwtfvairspufrashl` (`sb1-v84f4fhg`). This packet
is read-only guidance; no production migration or assignment operation was
performed.

- Dependency ledger: preflight the remote migration ledger and apply only
  `20261021120000_scope_disposable_qa_learners.sql` after review. Its manual
  packet prerequisites are the already-applied `20261021130000` and
  `20261021141147` contracts. The held timeline migrations `224401` and
  `032351` are unrelated and must remain separate.
- Schema/preflight: verify `student_room_assignments.disposable_qa`, the
  `is_sandbox` constraint, `can_create_disposable_qa_assignment`, the
  assignment policies, and the manual snapshot/read RPC surface exist in the
  reviewed shape; verify target IDs have no conflicts and request
  `9bd2dcbd-4bd5-4c16-a3d6-bd030f3941c1` still has no assignment row or
  snapshot.
- Grants: confirm direct table access remains revoked as specified by the
  manual contract, RLS is enabled, and only the reviewed authenticated RPC
  execution grants/policies are present. Run actual `SET ROLE` author,
  student, and anon allow/deny checks against a valid school-A envelope and
  school-B-restricted room; do not treat postgres-session booleans as proof.
- Stop rule: abort before commit on any ledger, schema, grant, policy, target
  ID, or request-reconciliation mismatch. Reconcile the expired scheduling
  window and confirmed no-commit state before issuing exactly one new
  authorized request; never replay the expired request blindly.
- Rollback: before commit, rollback the transaction. After commit, do not use
  a blind down migration; use a separately reviewed compensating migration
  only after proving zero dependent assignments/snapshots/progress and naming
  every newly created ID. Existing room 118, MAR events, old pins, and the
  expired request are preserved.

The disposable fixture proves the contract shape and immutable snapshot
behavior, not production policy or live storage access. Production owner
preflight and execution remain required.

## Supported student content repair

The review-only migration
`supabase/migrations/20261022063000_student_library_versioned_content_repair.sql`
(SHA-256 `fa1e5874e2bac91835c46a69bbfb53c3afe650b7df114f7ee74b5a9aba21076d`)
creates six new `student` video IDs and a new optional published course from
the six verified published, processing-ready media objects. It does not change
the existing course v1, its six items, the six `test_room` rows, learner
enrollments/progress, completion records, or `is_mandatory=false`. Its
transaction and target-ID/count assertions fail before commit on drift. The
mounted player test is
`src/pages/StudentWalkthroughVideos.test.tsx`; it verifies a signed media URL
renders in the student player while optional-course messaging remains visible.

This content migration remains unapplied and requires the same owner review as
the QA dependency. It is independent of timeline migrations `224401` and
`032351`. Its exact isolated readback runner is
`scripts/qa/run-student-library-repair-isolated.sh`; the passing transcript is
`docs/reviews/2026-10-22-student-library-repair.transcript.txt` and asserts
`6|6|6|6|1|1|false` (old items, new items, Test Room videos, student videos,
enrollments, progress, new mandatory flag). This verifies migration
transaction/count/ID-conflict behavior in a disposable schema only. The
mounted player test remains rendering-only; real student storage authorization
and playable-media acceptance are still pending Codex review.
