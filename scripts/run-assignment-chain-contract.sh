#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
run_id="$(date -u +%Y%m%dT%H%M%S)-$$"
container_name="assignment-chain-contract-pg-${run_id}"
container_id=""
stage_dir="$(mktemp -d "${TMPDIR:-/tmp}/assignment-chain-contract.XXXXXX")"
readiness_attempts="${ASSIGNMENT_CHAIN_READINESS_ATTEMPTS:-60}"
db_password="$(date -u +%s%N)-$$"

cleanup() {
  if [[ -n "$container_id" ]]; then
    docker rm -f "$container_id" >/dev/null 2>&1 || true
  fi
  rm -rf "$stage_dir"
}
trap cleanup EXIT

mkdir -p "$stage_dir/supabase/tests/fixtures" "$stage_dir/supabase/tests" "$stage_dir/supabase/migrations"
cp -- "$repo_root/supabase/tests/fixtures/mar-baseline-schema.sql" "$stage_dir/supabase/tests/fixtures/"
cp -- "$repo_root/supabase/tests/fixtures/assignment-chain-bootstrap.sql" "$stage_dir/supabase/tests/fixtures/"
cp -- "$repo_root/supabase/tests/assignment-chain-rpc.integration.sql" "$stage_dir/supabase/tests/"
for migration in \
  20261019100009_mar_authored_baseline_and_administrations.sql \
  20261019100010_mar_authorized_scope_materialization.sql \
  20261019100011_mar_read_scope_and_versions.sql \
  20261019100012_mar_atomic_snapshot_save.sql \
  20261019100013_mar_revoke_split_mutators.sql \
  20261019100014_mar_normal_assignment_materialization.sql \
  20261019100015_mar_materialization_scope_and_snapshot_reader.sql \
  20261103035651_assignment_chain_snapshots_prospective.sql \
  20261103041000_assignment_chain_source_corrections.sql; do
  cp -- "$repo_root/supabase/migrations/$migration" "$stage_dir/supabase/migrations/"
done

if ! created_id="$(docker run --rm -d --name "$container_name" -e "POSTGRES_PASSWORD=$db_password" -v "$stage_dir:/repo:ro" postgres:16)"; then
  echo "assignment-chain disposable PostgreSQL create failed; no owned container cleanup attempted" >&2
  exit 1
fi
container_id="$created_id"

ready=0
for ((attempt = 1; attempt <= readiness_attempts; attempt++)); do
  if docker exec "$container_id" pg_isready -U postgres >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if (( ready == 0 )); then
  echo "assignment-chain disposable PostgreSQL readiness timed out after ${readiness_attempts} attempts" >&2
  exit 1
fi
echo "postgres_server_version=$(docker exec "$container_id" psql -Atqc 'show server_version' -U postgres -d postgres)"

docker exec -i "$container_id" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  < "$repo_root/supabase/tests/fixtures/assignment-chain-bootstrap.sql"
docker exec -i "$container_id" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  < "$repo_root/supabase/tests/assignment-chain-rpc.integration.sql"
