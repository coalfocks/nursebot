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

`TestRooms` now obtains an eligible version through
`get_mar_eligible_case_version`, which is explicitly limited to `test_user`,
the account's school/available-room scope, and an existing manual packet. It
then calls `create_test_user_assignment_with_manual_snapshot`; the RPC inserts
only a new sandbox assignment and verifies the trigger-created immutable packet
snapshot before returning. It never calls the admin-only publication RPC.

Normal assignment publication from an accepted manual packet is an explicit,
admin-reviewed operation: `publish_mar_case_version_from_manual_packet` reads
the packet, records its packet ID/revision as provenance, and creates a new
immutable authored version for subsequent normal materialization. It does not
rewrite or repopulate the packet.

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
4. For each room, verify the accepted packet first, then use the explicit
   manual-packet publication operation if a normal learner case is required.
   Verify both readiness RPCs and confirm a new disposable assignment has a
   non-null `case_key_version`, exactly one immutable assignment snapshot, and
   assignment-scoped MAR events before learner QA.

Reader selection is assignment-scoped. `get_mar_assignment_reader` selects the
manual snapshot when one exists, otherwise the automatic baseline snapshot;
the admin baseline route continues to prefer the existing manual packet view.
This prevents enabling automatic readiness from hiding valid manual packets.

AssignmentManager freezes the generated IDs/case versions in a client-side
operation envelope. On retry it reconciles existing IDs against
`mar_assignment_materialization_operations`, replays only idempotent RPCs, and
stops on an existing assignment with no operation row instead of creating a
new ID.

These migrations are included in this review branch as prerequisites only;
this branch does not apply them to any database. Apply them separately, in
order, only after the normal migration review and authorization gates.
