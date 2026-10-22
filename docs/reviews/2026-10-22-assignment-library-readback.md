# Assignment and Learning Library readback

Read-only production readback for project `lvpbwtfvairspufrashl` on 2026-10-22
UTC. No assignment retry, room/patient write, course republish, completion
write, migration application, or MAR write was performed.

## Disposable assignment request

Request `9bd2dcbd-4bd5-4c16-a3d6-bd030f3941c1` has no persisted assignment row
and no `manual_mar_assignment_snapshots` row. The request ID is client-side;
it is not a database column. The submitted payload includes `disposable_qa`,
but the linked production `student_room_assignments` table does not have that
column. The local-only migration that adds it is
`20261021120000_scope_disposable_qa_learners.sql`; it is not in the remote
migration ledger. This is the exact schema-cache cause of `PGRST204`.

The existing room and manual packet were unchanged:

- room `118`, `QA-MAR-1021-A6`, UA school `f92ee295-55ec-4393-988c-0f2ed2950f6b`
- patient `bf70acee-686e-4c91-bfb6-cc10fa225585`
- packet `b6e74e41-df37-4bb7-9b39-abc946fdc08d`, case version `room-118-mar-v1`, revision `2`
- packet event digest `f626ec965e2da6f0d76d40c602fe9025`
- no assignment snapshot for room `118`

The compatible dependency is therefore the separately reviewable
`disposable_qa` contract, not a room recreation or request retry.

## Learning Library

The effective learner is role `student`, UA school
`f92ee295-55ec-4393-988c-0f2ed2950f6b`, learner program `medical`. The selected
published course is `Student Learning Library Preview`, id
`4e6bdaf6-50b6-4f2f-9a61-5efb6e0d4c71`, version `1`, audience `student`,
status `published`, `is_mandatory=false`.

Its six pinned items point to published `test_room` videos, while a student
can read only `student`/`both` audiences. The learner query therefore returns
zero matching pinned videos and the old UI incorrectly says no course is
published. The source fix now reports a published-course/content-integrity
mismatch, preserves progress and mandatory metadata, and offers retry.

Practice Room 00 is independently read back as slug `practice-room-00`,
`room_id=null`, `enabled=false`. The source fix queries this launcher
independently, distinguishes disabled/not-configured/query-error states, and
does not create an assignment while loading the library.

No course, item, video, progress, mandatory flag, or launcher row was changed.
