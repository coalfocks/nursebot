# MAR normal materialization/publication v5 operator packet

Status: source-reviewed candidate only. Do not apply from this packet without the owner’s production ledger, privilege, backfill, and preflight checks.

Candidate commit: exact SHA is provided in the handoff; this packet is committed with it.

## Dependency order

The historical files are unchanged and must not be replayed if the ledger already contains them:

1. Verify `100009`, `100010`, and `100011` are applied with their existing ledger hashes.
2. Apply `100012` + `100013` together in one reviewed transaction unit.
3. Apply `100014` + `100015` + `100016` + `20261019155910_mar_publication_idempotency_and_order_merge.sql` + `20261019160000_mar_publication_contract_v5.sql` together in one reviewed transaction unit. `155910` is required because it creates `mar_publication_operations` and `publish_mar_case_version_atomic`; `160000` only raises the readiness/preview contract.
4. Verify the ledger, grants, revoked legacy mutators, policy bodies, and v5 readiness before enabling writes.
5. Deploy the matching frontend candidate only after readiness is true. Until then, the frontend remains read-only/setup-gated.

The required publication migrations are:

- `20261019155910_mar_publication_idempotency_and_order_merge.sql`, SHA-256 `e3ec5f606c6fd3437ab50f00647554f3a32c823d030625d9dfd68da4ba061853`
- `20261019160000_mar_publication_contract_v5.sql`, SHA-256 `edbabeb3b82346d456f5e04e3597aae001e5ec00aebd616f54d0fa73c21ae223`

## What v5 closes

- `get_mar_publication_preview(room_id)` returns the current baseline MAR revision and a composite hash of the exact medication Orders plus authored MAR events.
- Publication already checks that hash; the frontend now obtains and persists it in the request envelope instead of sending `null`.
- An Orders edit between preview and publish fails with `MAR_PUBLICATION_CONTENT_CONFLICT`; no publication operation or version is created.
- Assignment metadata query errors no longer masquerade as legacy assignments. Mutable baseline medication rows are withheld; own assignment and non-medical rows remain readable with an explicit error.
- Confirmed revision/content conflicts release the frozen pending request and provide a reconcile path. Unknown transport outcomes retain the exact request for Resume.

## Disposable reproduction

Requirements: Bash 4+, `psql`, Docker/PostgreSQL 15.3, and a localhost-only disposable database. The runner requires `MAR_NORMAL_DISPOSABLE=1`, an identity matching `mar-normal-*`, and a `127.0.0.1`/`localhost` database URL. It refuses other hosts.

```bash
MAR_NORMAL_DISPOSABLE=1 \
MAR_NORMAL_DISPOSABLE_ID=mar-normal-v5-160000 \
MAR_NORMAL_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54372/postgres' \
MAR_NORMAL_RAW_LOG=artifacts/mar_normal_materialization_v5_raw_YYYYMMDDTHHMMSSZ.log \
./scripts/run-mar-normal-materialization-db.sh
```

The runner pins all ten migration hashes, applies the reviewed transaction groups, asserts `ready=true`, `materializationVersion=5`, `publicationPreviewVersion=5`, and `atomic=true`, and records the complete redacted stdout/stderr log. A v4/absent-preview partial upgrade must fail closed and must not enable client writes.

Observed disposable result from the candidate run:

- PostgreSQL 15.3, bound to `127.0.0.1:54372`.
- Nonempty authored Orders/MAR materialization and exact replay passed.
- Publication retry, stale revision, changed envelope, lease/scope negatives, and concurrent same-request overlap passed.
- New stale Orders+MAR preview fixture passed: old hash and current hash differed; `MAR_PUBLICATION_CONTENT_CONFLICT` was required; operation count remained zero.
- Raw log: `artifacts/mar_normal_materialization_v5_raw_20261019T1635Z.log`.

## Stop/reconcile and rollback

Stop immediately on any hash mismatch, ledger mismatch, failed transaction, grant/policy mismatch, nonzero backfill discrepancy, or readiness value other than the asserted v5 contract. Reconcile the exact database state before retrying; never replay historical migrations or repair an existing assignment/pin.

Before applying the new database units, compatible rollback is the currently deployed gated frontend and prior function versions. After any new migration commits, keep the matching gated frontend and roll forward/correct the database; do not roll back application code to a version that assumes the old mutable MAR contract. No old QA attempt, reserved attempt, chart, pin, or clinical record is a rollback target.

This packet does not claim production application, live MAR writes, or populated QA acceptance. The normal new-version → new-assignment fixture remains disposable-only until the owner applies the reviewed dependency set.
