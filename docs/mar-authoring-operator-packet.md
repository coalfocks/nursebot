# MAR authoring/operator packet

This packet is source-only until an authorized operator applies the MAR migrations. It never repairs or repins an existing attempt. Visual MAR work is intentionally out of scope until the functional gate below passes.

## Dependency order

On a disposable database, or production only after the operator verifies the ledger and lineage, apply exactly:

1. `20261019100009_mar_authored_baseline_and_administrations.sql`
2. `20261019100010_mar_authorized_scope_materialization.sql`
3. `20261019100011_mar_read_scope_and_versions.sql`
4. `20261019100012_mar_atomic_snapshot_save.sql`
5. `20261019100013_mar_revoke_split_mutators.sql`

The first three are historical MAR files. `100012` installs the atomic-save/preflight path and `100013` revokes the superseded authenticated mutators; they are one coordinated rollout unit. Do not replay any file already recorded in the target ledger. Exact source hashes on the reviewed branch:

```text
100009  6f60888b3177dc750e0c8762c90ef0ecec62644f98299217570e3dc6b1555d88
100010  d2ad577476c2d42daa88015786210abf8822c3c7f22aec1a95ada6e90c001a16
100011  ce3ac9202ccd5a2e8aa0c19de1dfcc23035531a9b25d4c2352e1400356efe302
100012  24e38096a83a8da0c368a1fd66f86ea1f8087f3c1e9e648088c7a1ea741efbc3
100013  5f4a0461fbd681eabb58df0bfec348061ce2c3717fea365c6f66f287b3850ea8
```

## Disposable reproduction

Requirements: Bash 4+, Docker, and `psql`. The harness binds its PostgreSQL container to `127.0.0.1` and refuses an occupied named container.

```bash
MAR_SCOPE_DISPOSABLE=1 \
MAR_SCOPE_PGPORT=54341 \
./scripts/run-mar-authorized-scope-db.sh
```

The runner requires Bash 4+, Docker, and `psql`; it binds its disposable PostgreSQL 15.3 container to `127.0.0.1`, refuses an occupied named container without removing it, and removes only a container created by that run. It applies the exact five files, with `100012` and `100013` in one `--single-transaction` rollout unit, then asserts the v4 preflight response (`ready=true`, `schemaVersion=4`, `atomicPersistence=true`) and both assignment/read policy replacements. It also verifies same-room learner isolation, cross-school denial, direct-table-write denial, immutable version rejection, same-ID changed-payload rejection, atomic rollback with zero leftover rows, and the synchronized two-session same-ID claim-lock interleaving with observed PostgreSQL lock waits.

Observed disposable result on the reviewed source: prerequisite fixtures/backfill `2|2`; preflight `ready=true/schemaVersion=4/functionVersion=4/atomicPersistence=true`; same-ID concurrency `one operation/one event`; rollback `0|0|0`; MAR schedule suite `5 tests passed`; TypeScript, build, and focused ESLint passed.

The successful redacted raw transcript is committed at
`artifacts/mar_authorized_scope_upgrade_raw_20261019T125345Z.log`; it is the
full runner output for the exact five pinned migration bodies above, not a
summary. The occupied-container refusal regression is separately exercised by
`scripts/test-mar-authorized-scope-occupied.sh`.

## Production stop/reconcile

Before each rollout unit, verify the migration ledger and exact file SHA-256. Verify the prerequisite schema, `pgcrypto`, authenticated RPC execution grants, and expected school/assignment/patient/order backfill counts. Apply `100009`, `100010`, and `100011` each in its own `--single-transaction -v ON_ERROR_STOP=1` transaction. Then apply `100012` and `100013` together in one `--single-transaction -v ON_ERROR_STOP=1` transaction; do not run readiness or enable writes between those two files. Stop immediately on any error; do not rerun a partially applied unit. Record the failing migration and reconcile its transaction/ledger state before any further action. After every unit, re-read the ledger; after `100011`, inspect both actual `pg_policies` bodies; after the `100012+100013` unit, inspect atomic RPC privileges, legacy-mutator revocations, and `get_mar_readiness()`.

After `100013`, verify that the legacy mutators `save_mar_history(...)` and `create_mar_baseline_version(...)` return `permission denied` for authenticated callers; their read counterparts remain available. Verify that a failed atomic save after snapshot insertion leaves no snapshot, revision, event, or operation row; two first-use same-ID calls serialize and return one committed result; a same-request retry returns the original result only when the complete actor/scope/revision/payload envelope matches; a changed payload or revision with the same request ID is rejected; and a new case version requires an explicit preview/diff rather than overwriting the old snapshot. Keep the complete redacted runner log as an operator artifact; the committed harness output is a reproducible summary, not a substitute for that raw log.

## Code compatibility and rollback

The MAR frontend is compatible with the v4 RPC only after the migration preflight is true. Until then it remains a read-only shell with an “Awaiting MAR setup” state and no generation or save controls.

Before any MAR migration is applied, the compatible code rollback is the prior production MAR shell (`990441c` / Netlify `6ad60046296f9d1a0b8e5e27`). The current gated frontend is `60842833b00c1018ec2c91279506dacbda036a2b` / Netlify `6ad60a080bd48406fba3033d` / bundle `index-DVO2k6Cr.js`; it remains visibly gated and has no function deployment. After any MAR migration is applied, keep the v4-compatible frontend and function lineage; do not roll back to code that probes only the old table or split snapshot/save RPCs. No MAR migration has been applied by this change.
