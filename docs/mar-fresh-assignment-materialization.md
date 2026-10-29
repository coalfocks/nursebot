# Fresh assignment MAR materialization

This source change only wires the two supported fresh-attempt paths. It does
not apply database changes, create attempts, or alter an existing assignment.

## Normal learner route

`AssignmentManager` now:

1. Reads the accepted manual packet through
   `publish_mar_case_version_from_manual_packet`, which creates or reuses a
   new immutable authored version without rewriting the packet.
2. Generates stable assignment IDs before any request.
3. Requires `get_mar_normal_materialization_readiness` to report atomic
   materialization version 2.
4. Calls `create_assignment_with_mar_materialization` for each new assignment.

That RPC must insert the assignment, preserve the published
`case_key_version`, create the immutable assignment snapshot, and materialize
assignment-scoped events in one transaction. A retry must use the same
assignment/request identity.

## `test_user` route

`TestRooms` now calls the role-scoped `get_mar_eligible_case_version` lookup
and `create_test_user_assignment_with_manual_snapshot` RPC. The RPC copies the
accepted manual packet into a new immutable assignment snapshot, and replay
validates the exact owner, room, school, version, timing envelope, and frozen
snapshot. It never calls the admin-only publication lookup, copies mutable room
data into an old assignment, or treats `scenario_baseline_version` as a MAR
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
4. For each QA room, run the reviewed admin-only
   `publish_mar_case_version_from_manual_packet` operation once. Verify both
   readiness RPCs and confirm a new disposable assignment has a non-null
   `case_key_version`, one immutable assignment snapshot, and an
   assignment-scoped reader result before learner QA. The reader is selected
   by `get_mar_assignment_reader`: manual snapshots remain manual even when
   global automatic readiness is true; normal assignments use the immutable
   authored snapshot.

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

## Legacy attempts

An attempt with no non-empty `case_key_version` and no immutable assignment
snapshot is not historically recoverable from current authoring data. The
supported compatibility option is a read-only, explicitly labelled admin
provenance view showing that the historical MAR snapshot is unavailable. A
human must decide whether to leave that attempt unavailable or create a new
disposable attempt; no repinning, current-packet substitution, reset, or
retroactive administration is supported.
