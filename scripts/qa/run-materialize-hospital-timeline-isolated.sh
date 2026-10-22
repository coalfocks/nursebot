#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TRANSCRIPT="${1:-${ROOT_DIR}/docs/reviews/2026-10-22-materialize-hospital-timeline-exact-schema.transcript.txt}"
TMP_DIR="$(mktemp -d)"
CONTAINER="nursebot-materialize-isolated-${RANDOM}"
cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; rm -rf "$TMP_DIR"; }
trap cleanup EXIT

exec > >(tee "$TRANSCRIPT") 2>&1
echo "runner=$(basename "$0")"
echo "mode=read-only production schema dump + disposable PostgreSQL"
echo "stream_capture=combined stdout+stderr"
echo "migration_sha256=$(sha256sum "$ROOT_DIR/supabase/migrations/20261021224401_fix_timeline_materialization_conflict_predicate.sql" | awk '{print $1}')"
echo "compatibility_sha256=$(sha256sum "$ROOT_DIR/supabase/migrations/20261022032351_add_lab_results_case_blueprint_provenance.sql" | awk '{print $1}')"
echo "prior_function_sha256=$(sha256sum "$ROOT_DIR/docs/reviews/2026-10-22-materialize_hospital_timeline.prior.sql" | awk '{print $1}')"
echo "exact_test_sha256=$(sha256sum "$ROOT_DIR/supabase/tests/20261022_materialize_hospital_timeline_exact_schema.sql" | awk '{print $1}')"
echo "runner_sha256=$(sha256sum "$ROOT_DIR/scripts/qa/run-materialize-hospital-timeline-isolated.sh" | awk '{print $1}')"

supabase db dump --linked --schema public --file "$TMP_DIR/public-schema.sql"
echo "production_public_schema_dump_sha256=$(sha256sum "$TMP_DIR/public-schema.sql" | awk '{print $1}')"
docker pull postgres:16
docker run -d --rm --name "$CONTAINER" -e POSTGRES_PASSWORD=postgres -p 127.0.0.1::5432 postgres:16 >/dev/null
until docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
docker cp "$TMP_DIR/public-schema.sql" "$CONTAINER:/tmp/public-schema.sql"
docker cp "$ROOT_DIR/supabase/tests/20261022_materialize_hospital_timeline_exact_schema.sql" "$CONTAINER:/tmp/exact.sql"
docker cp "$ROOT_DIR/supabase/migrations/20261021224401_fix_timeline_materialization_conflict_predicate.sql" "$CONTAINER:/tmp/20261021224401.sql"
docker cp "$ROOT_DIR/supabase/migrations/20261022032351_add_lab_results_case_blueprint_provenance.sql" "$CONTAINER:/tmp/20261022032351.sql"
docker cp "$ROOT_DIR/docs/reviews/2026-10-22-materialize_hospital_timeline.prior.sql" "$CONTAINER:/tmp/prior.sql"

echo '== restoring exact public schema into disposable database =='
docker exec "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c \
  "create role anon; create role authenticated; create role service_role; create schema if not exists auth; create table auth.users (id uuid primary key); create function auth.uid() returns uuid language sql stable as 'select null::uuid'; create function auth.role() returns text language sql stable as 'select current_user';"
if docker exec "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/public-schema.sql >/tmp/nursebot-schema-restore.log 2>&1; then
  cat /tmp/nursebot-schema-restore.log
else
  restore_status=$?
  cat /tmp/nursebot-schema-restore.log
  echo "SCHEMA RESTORE FAILED: status=${restore_status}"
  exit "$restore_status"
fi
docker exec "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -v migration_file=/tmp/20261021224401.sql \
  -v compatibility_file=/tmp/20261022032351.sql \
  -v prior_file=/tmp/prior.sql -f /tmp/exact.sql
echo 'TRANSCRIPT PASS'
