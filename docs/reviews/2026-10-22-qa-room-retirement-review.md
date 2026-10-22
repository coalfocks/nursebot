# QA-room retirement/restore review packet

Status: source-only, review hold. No production readback, room update, patient
write, assignment write, clinical write, migration, or deployment is included.

## Scope

The target set is an exact, reviewable manifest produced from readback rows:

- the two analytics seed schools `nurse-althea-qa-north-20261015` and
  `nurse-althea-qa-south-20261015`, but only their `QA-*` rooms;
- `QA-MAR-*` rooms, including the existing `QA-MAR-1021-A6` fixture;
- `QA-LIB-FEEDBACK-20261015`;
- `QA-FB-BEDSIDE-*` retained synthetic feedback fixtures.

The generic `QA-` prefix is not itself sufficient for targeting. Every room
must be present in the owner-reviewed readback manifest. Original authored
case rooms, patient rows, Room 00, schools, profiles, specialties, notes,
orders, learner actions, assignments, MAR packets/audits, snapshots, pins,
completion records, and progress are excluded from mutation.

Room 00 is identified independently from
`walkthrough_sandbox_launches.slug = 'practice-room-00'`; its `room_id` is a
hard exclusion, even if a future fixture accidentally matches another marker.

## Proposed reversible action

Retire only `public.rooms.is_active = false` for the exact manifest IDs. Do not
delete rows or unlink `rooms.patient_id` / `patients.room_id`. This removes the
rooms from active/assignable flows while keeping learner history and all chart
relationships intact. The manifest stores each room's prior `is_active` value;
restore sets only that field back to its captured value.

The plan generator is intentionally readback-only:

```sh
node scripts/qa/qa-room-retirement-plan.mjs room-readback.json qa-room-retirement-manifest.json
```

It refuses an empty target set and creates the manifest with exclusive-create
semantics. It does not connect to Supabase and has no apply flag.

## Owner execution gates (not performed)

Before an owner runs the generated transaction, require:

1. fresh room readback and exact manifest ID/hash review;
2. a separate Room 00 readback proving the hard exclusion;
3. counts/digests for patients, assignments, notes, orders, learner actions,
   manual packets/audits, assignment snapshots, course pins, and progress;
4. a transaction that locks and updates only the manifest room IDs, then
   rechecks those counts/digests before commit;
5. immediate `ROLLBACK` on a missing target, changed target metadata,
   unexpected row count, or any dependent-row mutation;
6. post-commit readback, followed by restore from the unchanged manifest if
   the owner elects to undo the retirement.

The existing `scripts/qa-seed-analytics.mjs --cleanup` is not an acceptable
rollback: it performs cascading-style hard deletes across schools, rooms,
assignments, specialties, and profiles and cannot preserve history.

## Validation

`src/lib/qaRoomRetirement.test.ts` proves selector boundaries, Room 00 and
original-case exclusion, non-destructive SQL shape, captured inactive-state
restore, and empty/unsafe manifest rejection. This is disposable/source proof,
not production authorization or RLS proof. Production execution remains on
hold pending owner review.
