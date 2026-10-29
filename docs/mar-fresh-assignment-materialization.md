# Fresh assignment MAR materialization

This source change only wires the two supported fresh-attempt paths. It does
not apply database changes, create attempts, or alter an existing assignment.

## Normal learner route

`AssignmentManager` now:

1. Requires a published immutable room MAR version from
   `get_mar_published_case_version`.
2. Generates stable assignment IDs before any request.
3. Requires `get_mar_normal_materialization_readiness` to report atomic
   materialization version 2.
4. Calls `create_assignment_with_mar_materialization` for each new assignment.

That RPC must insert the assignment, preserve the published
`case_key_version`, create the immutable assignment snapshot, and materialize
assignment-scoped events in one transaction. A retry must use the same
assignment/request identity.

## `test_user` route

`TestRooms` now creates only a fresh sandbox assignment with a published
`case_key_version`, and refuses to launch if `get_manual_mar_readiness` is not
ready. The insert relies on the reviewed append-only
`manual_mar_snapshot_new_assignment` trigger to copy the already-published
manual packet into an assignment snapshot. It never copies mutable room data
into an old assignment and never treats `scenario_baseline_version` as a MAR
version.

The dashboard also exposes **Start fresh (preserve history)**. It creates a
new sandbox assignment through this same path while leaving the existing test
room assignment and its clinical/chat history untouched. The existing Reset
session action remains destructive and is not part of the supported QA flow
for validating historical preservation.

## Database prerequisites to review/apply separately

On an isolated disposable database, in order:

1. Apply `supabase/migrations/20261019100009_mar_authored_baseline_and_administrations.sql` through `20261019100013_mar_revoke_split_mutators.sql`.
2. Apply `supabase/migrations/20261019100014_mar_normal_assignment_materialization.sql` and `20261019100015_mar_materialization_scope_and_snapshot_reader.sql`.
3. For the `test_user` sandbox contract, apply
   `supabase/migrations/20261021130000_manual_mar_packet_contract.sql` and
   `supabase/migrations/20261021141147_manual_mar_assignment_snapshot_hardening.sql`.
4. Publish a room's authored Orders/MAR revision through the reviewed admin
   publication operation. Verify both readiness RPCs and confirm a new
   disposable assignment has a non-null `case_key_version`, one immutable
   assignment snapshot, and assignment-scoped MAR events before learner QA.

## Retry invariant

`20261029173000_mar_test_assignment_retry_hardening.sql` treats the assignment
envelope and its immutable snapshot as the replay authority. A later manual
packet revision under the same case key is valid authoring history and must not
make a lost-response retry fail or replace the original snapshot. Only a new
assignment reads the current packet. The executable regression is
`supabase/tests/mar-replay-immutability.integration.sql`.

These migrations are included in this review branch as prerequisites only;
this branch does not apply them to any database. Apply them separately, in
order, only after the normal migration review and authorization gates.
