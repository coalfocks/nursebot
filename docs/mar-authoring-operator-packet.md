# MAR authoring/operator packet

This packet is source-only until an authorized operator applies the MAR migrations. It never repairs or repins an existing attempt.

## Dependency order

On a disposable database, or production only after the operator verifies the ledger and lineage, apply exactly:

1. `20261019100009_mar_authored_baseline_and_administrations.sql`
2. `20261019100010_mar_authorized_scope_materialization.sql`
3. `20261019100011_mar_read_scope_and_versions.sql`
4. `20261019100012_mar_atomic_snapshot_save.sql`

The first three are historical MAR files; `100012` is the new append-only atomic-save/preflight dependency. Do not replay any file already recorded in the target ledger.

## Disposable reproduction

Requirements: Bash 4+, Docker, and `psql`. The harness binds its PostgreSQL container to `127.0.0.1` and refuses an occupied named container.

```bash
MAR_SCOPE_DISPOSABLE=1 \
MAR_SCOPE_PGPORT=54341 \
./scripts/run-mar-authorized-scope-db.sh
```

The runner asserts the v4 preflight response (`ready=true`, `schemaVersion=4`, `atomicPersistence=true`) and both assignment/read policy replacements. It also verifies same-room learner isolation, cross-school denial, direct-table-write denial, immutable version rejection, and the atomic function's existence. A full concurrent fixture remains required before enabling live writes.

## Production stop/reconcile

Before each file, verify the migration ledger and exact file SHA-256. Apply each file in its own `--single-transaction -v ON_ERROR_STOP=1` transaction. Stop immediately on any error; do not rerun a partially applied file. Reconcile the ledger, policy bodies, grants, snapshot/materialization counts, and `get_mar_readiness()` before proceeding.

After `100012`, verify that a failed atomic save leaves no snapshot, revision, event, or operation row; a same-request retry returns the original result; a changed payload with the same request ID is rejected; and a new case version requires an explicit preview/diff rather than overwriting the old snapshot.

## Code compatibility and rollback

The MAR frontend is compatible with the v4 RPC only after the migration preflight is true. Until then it remains a read-only shell with an “Awaiting MAR setup” state and no generation or save controls.

Before any MAR migration is applied, the compatible code rollback is the prior production MAR shell (`990441c` / Netlify `6ad60046296f9d1a0b8e5e27`). After any MAR migration is applied, keep the v4-compatible frontend and function lineage; do not roll back to code that probes only the old table or split snapshot/save RPCs. No MAR migration has been applied by this change.
