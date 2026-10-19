# Consultant/Feedback upgrade operator packet

This packet is disposable-test-backed and production-safe by default. It does
not contain credentials and does not authorize a blanket migration push.

## Reviewed files and hashes

The runner pins the already-applied 3cf files from git object `3cf5770` and
verifies these SHA-256 values before applying them:

```text
20261019000000_consultant_message_transport.sql       cdd01e0ac9f71e16556249dfd622ae6edafc202602c95295985bb1c03283edbe
20261019043010_consultant_transport_contract.sql      cbe55d5b32f7dd4a3abcafe128ed621d5e9e45b6f287f2007ec64fcc309b3b5b
20261019060000_atomic_consultant_transport_v2.sql    eecb8b33ef1c69281e9062ce22cace21929d4ebb1795caa973b38cfffb0d78b7
20261019073000_feedback_evaluator_studio.sql          dca6f9d94267a268082f58f3ef511c2ffd4a580c5f919c2cd8ea0cb696b10553
20261019080000_qa_integrity_repairs.sql               99bb81ac707aeedd48f2572e543c73cc86a0de21ff681ed7a1674314a9d6d5c8
20261019083000_consultant_transport_sequence_upgrade.sql 13f474bb47c43d58dd452bb89c58a3eca6659b00b0214b29c65f963b079f834a
```

The reviewed source and reproducible packet are commit `923965142b75ff94c07fdb3decf3c2deba436da5`.

## Disposable reproduction

From the repository checkout:

```bash
CONSULTANT_UPGRADE_DISPOSABLE=1 \
CONSULTANT_UPGRADE_PGPORT=54331 \
CONSULTANT_UPGRADE_OUTPUT_DIR=/tmp/consultant-upgrade-output \
./scripts/run-consultant-feedback-upgrade-db.sh
```

The runner requires Bash 4+, `docker`, `git`, `psql`, and `sha256sum`. It
refuses to start if the opt-in variable is absent or the selected port is
occupied. It binds the disposable container only to `127.0.0.1`, creates and
removes only its own `postgres:15.3` container,
pins the three historical files from `3cf5770`, applies:

```text
19000000 → 19043010 → 19060000 → 19073000 → 19080000 → 19083000
```

It then runs the failure-injection SQL, same-ID/follow-up/lease tests, the
two-session activation script, and the two-session retry script. The two
background sessions synchronize at a database barrier before invoking their
RPCs; this proves coordinated starts, not a scheduler-level guarantee that
both lock acquisitions overlap. It emits the complete PostgreSQL log under
the requested output directory. The committed
`artifacts/consultant_feedback_upgrade_output.txt` is a short redacted
summary, not a substitute for that full generated log.

The runner asserts `ready=true`, `schemaVersion=4`, `functionVersion=4`,
and `atomicPersistence=true`; a mismatch stops the run.

## Prerequisites, grants, and stop conditions

Production must already have `19000000`, `19043010`, and `19060000` recorded
as applied, with their exact historical hashes matching the packet. Do not
replay those files. Apply only the three new migrations, in the order above,
each as its own single transaction with `ON_ERROR_STOP=1`:

~~~bash
psql "$DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20261019073000_feedback_evaluator_studio.sql
psql "$DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20261019080000_qa_integrity_repairs.sql
psql "$DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20261019083000_consultant_transport_sequence_upgrade.sql
~~~

After each successful transaction, verify the migration ledger and record the
operator evidence before starting the next file. If any statement fails, stop
immediately: do not apply the next migration and do not manually mark the file
applied. Reconcile the failed transaction, ledger state, collision counts, and
database logs with the owner before retrying.

Stop without continuing if any of these occur:

- historical SHA mismatch;
- duplicate evaluator `scope_identity/version` or multiple active rows;
- duplicate consultant `request_id/message_sequence` rows;
- any migration statement fails or the v4 preflight is not `ready=true`;
- backfill counts cannot be reconciled with the migration ledger.

The exact compatible deployed IDs are: current pre-upgrade frontend commit
`85189554f370d3d17dce2ab1a4a9646363d8d392` / deploy
`6ad5c2158e3bcd661004e15a`, `consultant-chat` v7 SHA
`b1956c77e2ef9593b741434837b56dd7d14cbab3724c7ccd145010ac90549b9c`, and
`generate-feedback` v45 SHA
`e131ab0b9f1d35d903c174ff773f4f93cd2483d1bc6e0022c7b6bde2997f43fa`.
Keep these v4-compatible builds deployed after the three migrations. Before
any new migration, the emergency code-only rollback is frontend deploy
`6ad5c12b24f551704bd9be1f` plus consultant-chat v6; keep generate-feedback
v45. After the first new migration commits, do not use that pre-v4 rollback.

`073000` grants authenticated users the read/create RPC paths subject to the
superadmin/school-admin RLS policies; it intentionally has no direct evaluator
UPDATE policy. `create_feedback_evaluator_draft` and
`activate_feedback_evaluator_config` are granted to `authenticated`.
`083000` grants `persist_consultant_response_v2` to `service_role` and the v4
preflight to `authenticated`. `080000` adds columns/indexes and grants nothing.

The operator should record these checks after applying:

```sql
select public.consultant_transport_preflight();
select count(*) filter (where message_sequence is not null),
       count(*) filter (where request_receipt_at is not null)
from public.consultant_chat_messages;
```

Existing timestamps and rows are preserved. The 080000 backfill derives
student/consultant sequence `1/2` and request receipt time from the existing
request timestamp; it does not rewrite message content.

## Rollback compatibility

Before any new migration is applied, the live schema remains compatible with
the current deployed 851/v7/v45 gated release. After any of 073000, 080000,
or 083000 is applied, do not roll back to the pre-v4 consultant frontend or
function. Restore a forward-compatible v4 build and function instead. There
is no destructive down migration: preserve evaluator, sequence, request,
order, message, and result rows. Do not use generate-feedback v42; it is not
schema-compatible with the absent evaluator table.
