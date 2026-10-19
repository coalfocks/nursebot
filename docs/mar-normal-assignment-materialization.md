# MAR normal assignment materialization

This is a separate, append-only dependency after `100009` through `100013`.
It is not applied by the frontend release and must not be used to repair an
existing assignment.

The normal call path is:

1. `AssignmentManager.handleAssign` creates stable assignment row IDs and the
   immutable `room-<roomId>-mar-v1` case-version identity.
2. `AssignmentManager.confirmAssignmentCreate` calls
   `get_mar_normal_materialization_readiness`.
3. For each stable assignment ID it calls
   `create_assignment_with_mar_materialization` with that assignment ID as the
   request identity.
4. The RPC snapshots the authored room Orders and assignment-null MAR events,
   inserts the new assignment, creates the immutable baseline snapshot, and
   materializes assignment-scoped administrations in one transaction.
5. Student reads use the assignment's `case_key_version` and assignment-scoped
   events. The RPC is idempotent on retry and never changes an existing
   assignment's version.

Disposable fixture: `supabase/tests/mar_normal_assignment_materialization.sql`.
It asserts one new assignment, one immutable snapshot, stable event counts on
replay, and rollback-safe request identity. Run only against a disposable
database after the reviewed five-file MAR packet and `100014` are installed.

Production readiness remains gated until an operator verifies the migration
ledger, grants, preflight, and a new disposable assignment read-back. No
existing QA assignment, pin, chart, or MAR event is eligible for repair by
this path.
