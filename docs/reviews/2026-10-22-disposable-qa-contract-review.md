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
   same-school room succeeds; prove non-superadmin, non-allow-listed learner,
   cross-school room, inactive room, wrong program, and anon fail.
3. Prove `disposable_qa=true` cannot be inserted with `is_sandbox=false` and
   that a successful insert produces exactly one immutable manual assignment
   snapshot/readback for the new assignment.
4. Confirm the old request remains absent before any production retry. If the
   request is retried, reconcile its expired scheduling window first and issue
   one newly authorized request; never replay it blindly.
5. Owner review is required before applying the migration or creating the
   assignment.
