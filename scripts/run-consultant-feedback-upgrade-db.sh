#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${CONSULTANT_UPGRADE_DISPOSABLE:-} != 1 ]]; then
  echo 'Refusing to run: set CONSULTANT_UPGRADE_DISPOSABLE=1 for disposable-only execution.' >&2
  exit 2
fi
if (( BASH_VERSINFO[0] < 4 )); then
  echo 'Refusing to run: Bash 4+ is required.' >&2
  exit 2
fi
for command in docker git psql sha256sum; do command -v "$command" >/dev/null || { echo "missing command: $command" >&2; exit 2; }; done

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
port=${CONSULTANT_UPGRADE_PGPORT:-54331}
container="consultant-feedback-upgrade-${port}-$$"
workdir=$(mktemp -d "${TMPDIR:-/tmp}/consultant-feedback-upgrade.XXXXXX")
output_dir=${CONSULTANT_UPGRADE_OUTPUT_DIR:-"$repo_root/artifacts/upgrade-output"}
mkdir -p "$output_dir"
log_file="$output_dir/consultant_feedback_upgrade_$(date -u +%Y%m%dT%H%M%SZ).log"
exec > >(tee "$log_file") 2>&1

cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; rm -rf "$workdir"; }
trap cleanup EXIT

if docker ps --format '{{.Ports}}' | grep -Eq "(^|:)${port}->|:${port}-"; then
  echo "Refusing to run: port $port is already published by another container." >&2
  exit 2
fi
if psql "postgresql://postgres:postgres@127.0.0.1:$port/postgres" -Atc 'select 1' >/dev/null 2>&1; then
  echo "Refusing to run: port $port already accepts PostgreSQL connections." >&2
  exit 2
fi

declare -A expected=(
  [20261019000000_consultant_message_transport.sql]=cdd01e0ac9f71e16556249dfd622ae6edafc202602c95295985bb1c03283edbe
  [20261019043010_consultant_transport_contract.sql]=cbe55d5b32f7dd4a3abcafe128ed621d5e9e45b6f287f2007ec64fcc309b3b5b
  [20261019060000_atomic_consultant_transport_v2.sql]=eecb8b33ef1c69281e9062ce22cace21929d4ebb1795caa973b38cfffb0d78b7
  [20261019073000_feedback_evaluator_studio.sql]=dca6f9d94267a268082f58f3ef511c2ffd4a580c5f919c2cd8ea0cb696b10553
  [20261019080000_qa_integrity_repairs.sql]=99bb81ac707aeedd48f2572e543c73cc86a0de21ff681ed7a1674314a9d6d5c8
  [20261019083000_consultant_transport_sequence_upgrade.sql]=13f474bb47c43d58dd452bb89c58a3eca6659b00b0214b29c65f963b079f834a
)

pin_historical() {
  local name=$1
  git -C "$repo_root" show "3cf5770:supabase/migrations/$name" >"$workdir/$name"
}
for name in 20261019000000_consultant_message_transport.sql 20261019043010_consultant_transport_contract.sql 20261019060000_atomic_consultant_transport_v2.sql; do pin_historical "$name"; done
cp "$repo_root/supabase/migrations/20261019073000_feedback_evaluator_studio.sql" "$workdir/20261019073000_feedback_evaluator_studio.sql"
cp "$repo_root/supabase/migrations/20261019080000_qa_integrity_repairs.sql" "$workdir/20261019080000_qa_integrity_repairs.sql"
cp "$repo_root/supabase/migrations/20261019083000_consultant_transport_sequence_upgrade.sql" "$workdir/20261019083000_consultant_transport_sequence_upgrade.sql"

for name in "${!expected[@]}"; do
  actual=$(sha256sum "$workdir/$name" | awk '{print $1}')
  [[ "$actual" == "${expected[$name]}" ]] || { echo "SHA mismatch for $name: $actual" >&2; exit 1; }
  echo "PIN $name sha256=$actual"
done

docker run -d --name "$container" -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=postgres -p "127.0.0.1:$port:5432" postgres:15.3 >/dev/null
for _ in $(seq 1 30); do psql "postgresql://postgres:postgres@127.0.0.1:$port/postgres" -Atc 'select 1' >/dev/null 2>&1 && break; sleep 1; done
DB_URL="postgresql://postgres:postgres@127.0.0.1:$port/postgres"
psql "$DB_URL" -v ON_ERROR_STOP=1 -c "create role anon nologin; create role authenticated nologin; create role service_role nologin; create role supabase_admin nologin; create role dashboard_user nologin; create role authenticator nologin;"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$repo_root/artifacts/consultant_feedback_upgrade_fixture.sql"

for name in 20261019000000_consultant_message_transport.sql 20261019043010_consultant_transport_contract.sql 20261019060000_atomic_consultant_transport_v2.sql 20261019073000_feedback_evaluator_studio.sql 20261019080000_qa_integrity_repairs.sql 20261019083000_consultant_transport_sequence_upgrade.sql; do
  echo "APPLY $name"
  psql "$DB_URL" --single-transaction -v ON_ERROR_STOP=1 -f "$workdir/$name"
done

echo 'BACKFILL COUNTS'
psql "$DB_URL" -At -c "select count(*) filter (where message_sequence is not null), count(*) filter (where request_receipt_at is not null) from public.consultant_chat_messages;"
psql "$DB_URL" -At -c "select count(*) from pg_proc where oid = 'public.persist_consultant_response_v2(uuid,uuid,uuid,uuid,bigint,text,text,text,text,text,text,uuid)'::regprocedure;"
IFS='|' read -r preflight_ready preflight_schema preflight_function preflight_atomic < <(
  psql "$DB_URL" -At -v ON_ERROR_STOP=1 -c "select (p->>'ready')::boolean, p->>'schemaVersion', p->>'functionVersion', (p->>'atomicPersistence')::boolean from (select public.consultant_transport_preflight() as p) q;"
)
echo "PREFLIGHT ready=$preflight_ready schemaVersion=$preflight_schema functionVersion=$preflight_function atomicPersistence=$preflight_atomic"
[[ "$preflight_ready" == t && "$preflight_schema" == 4 && "$preflight_function" == 4 && "$preflight_atomic" == t ]] || {
  echo 'STOP: v4 preflight assertion failed; reconcile before proceeding.' >&2
  exit 1
}
echo 'ASSERT preflight passed'
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$repo_root/artifacts/consultant_feedback_upgrade_db_tests.sql"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$repo_root/artifacts/consultant_transport_db_tests.sql"
bash "$repo_root/artifacts/consultant_feedback_concurrent_activation.sh" "$DB_URL"
bash "$repo_root/artifacts/consultant_feedback_concurrent_retry.sh" "$DB_URL"
echo "PASS disposable upgrade runner; redacted raw output: $log_file"
