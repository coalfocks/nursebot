# MAR normal assignment materialization

This is a separate, append-only dependency after `100009` through `100013`.
It is not applied by the frontend release and must not be used to repair an
existing assignment.

The normal call path is:

1. A superadmin publishes an explicit authored MAR revision through
   `publish_mar_case_version`; this freezes Orders and authored MAR together as
   `room-<roomId>-mar-vN`. A mutable baseline is never selected implicitly.
2. `AssignmentManager.handleAssign` creates stable assignment row IDs and
   resolves the published immutable version.
3. `AssignmentManager.confirmAssignmentCreate` calls
   `get_mar_normal_materialization_readiness`.
4. For each stable assignment ID it calls
   `create_assignment_with_mar_materialization` with that assignment ID as the
   request identity.
5. The RPC validates the actor, learner, effective school availability,
   complete immutable envelope and published content hash before replay. It
   snapshots the authored room Orders and assignment-null MAR events,
   inserts the new assignment, creates the immutable baseline snapshot, and
   materializes assignment-scoped administrations in one transaction.
6. Student order reads use `get_mar_assignment_order_snapshot` rather than
   mutable room Orders; learner-created assignment Orders are added separately.
   Student MAR events use the assignment's `case_key_version` and
   assignment-scoped events. The RPC is idempotent on exact retry and rejects
   existing/unattributed assignments.

Append-only correction: `100015_mar_materialization_scope_and_snapshot_reader.sql`.
It preserves `100009` through `100014`, adds null-safe school availability,
published-version APIs, the frozen order reader, and the complete retry
envelope. The role-aware harness is
`scripts/run-mar-normal-materialization-db.sh`; it requires an explicitly
isolated disposable PostgreSQL URL and disposable educator/learner IDs. The
committed fixture is
`supabase/tests/mar_normal_assignment_materialization_v2.sql`.

The committed raw disposable evidence is
`artifacts/mar_normal_materialization_v2_raw_20261019T1512Z.log`. It covers
readiness, publication, nonempty assignment materialization, exact replay,
changed-envelope rejection, existing-assignment rejection, learner frozen
order read, missing-profile denial, anonymous denial, and unlisted-school
denial. It is source validation only, not production evidence.

Production readiness remains gated until an operator separately reviews and
applies `100014` and `100015`, verifies the migration ledger, grants, preflight,
backfill/privileges, and a new disposable assignment read-back. No existing QA
assignment, pin, chart, or MAR event is eligible for repair by this path.
