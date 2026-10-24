#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PGDATA_DIR="$(mktemp -d /tmp/faculty-study-pg.XXXXXX)"
PORT="${FACULTY_STUDY_PG_PORT:-55439}"
SOCKET_DIR="$(mktemp -d /tmp/faculty-study-socket.XXXXXX)"
LOG_DIR="$(mktemp -d /tmp/faculty-study-lease-log.XXXXXX)"
CONTAINER_ID=""
cleanup() {
  if [[ -n "$CONTAINER_ID" ]]; then
    docker rm -f "$CONTAINER_ID" >/dev/null 2>&1 || true
  else
    pg_ctl -D "$PGDATA_DIR" -m immediate stop >/dev/null 2>&1 || true
  fi
  rm -rf "$PGDATA_DIR" "$SOCKET_DIR" "$LOG_DIR"
}
trap cleanup EXIT

if command -v postgres >/dev/null 2>&1; then
  initdb -D "$PGDATA_DIR" --no-locale --auth=trust >/dev/null
  pg_ctl -D "$PGDATA_DIR" -o "-p $PORT -k $SOCKET_DIR" -w start >/dev/null
  DB_HOST="$SOCKET_DIR"
else
  CONTAINER_ID="$(docker run -d --rm -e POSTGRES_HOST_AUTH_METHOD=trust -p "$PORT:5432" postgres:16)"
  for _ in $(seq 1 30); do
    pg_isready -h 127.0.0.1 -p "$PORT" >/dev/null 2>&1 && break
    sleep 1
  done
  pg_isready -h 127.0.0.1 -p "$PORT" >/dev/null
  DB_HOST="127.0.0.1"
fi

PSQL=(psql -X -h "$DB_HOST" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1)
"${PSQL[@]}" -f "$ROOT_DIR/supabase/tests/20261024_faculty_study_result_lease_concurrency.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT_DIR/supabase/migrations/20261022220000_faculty_study_feedback.sql" >/dev/null

run_case() {
  local case_name="$1"
  local case_tag="$2"
  local session_a="$3"
  local batch_id="00000000-0000-4000-8000-00000000001${case_tag}"
  local assignment_id="00000000-0000-4000-8000-00000000011${case_tag}"
  local lease_a="00000000-0000-4000-8000-000000000a1${case_tag}"
  local lease_b="00000000-0000-4000-8000-000000000b1${case_tag}"

  "${PSQL[@]}" -v batch_id="$batch_id" -v assignment_id="$assignment_id" -v lease_a="$lease_a" -c "insert into public.faculty_study_batches (id,batch_key,manifest,manifest_sha256,prompt_version,prompt_sha256,model,protocol_version,generator_revision,evaluator_config_revision,created_by,status,lease_token,started_at,lease_expires_at) values ('$batch_id','lease-regression-$case_name','{}','sha','rubric-v4','sha','study-model','faculty-study-v1','test','test','00000000-0000-4000-8000-000000000001','running','$lease_a',now(),now() + interval '15 minutes');" >/dev/null

  "${PSQL[@]}" -v batch_id="$batch_id" -v assignment_id="$assignment_id" -v lease_a="$lease_a" -v lease_b="$lease_b" -f "$ROOT_DIR/supabase/tests/$session_a" >"$LOG_DIR/a-$case_name.log" 2>&1 &
  local a_pid=$!
  sleep 1
  "${PSQL[@]}" -v batch_id="$batch_id" -v assignment_id="$assignment_id" -v lease_a="$lease_a" -v lease_b="$lease_b" -f "$ROOT_DIR/supabase/tests/20261024_faculty_study_result_lease_session_b.sql" >"$LOG_DIR/b-$case_name.log" 2>&1 &
  local b_pid=$!
  wait "$a_pid"
  wait "$b_pid"

  "${PSQL[@]}" -v batch_id="$batch_id" -v lease_b="$lease_b" <<'SQL'
select exists (
  select 1 from public.faculty_study_results
  where batch_id = :'batch_id' and batch_ordinal = 1
    and lease_token = :'lease_b'::uuid
    and result = '{"score":5}'::jsonb
    and frozen_input = '{"frozen":"B"}'::jsonb
) as final_row_ok \gset
\if :final_row_ok
\else
\echo 'LEASE_REGRESSION_FAILED: final row was changed by stale worker'
\quit 1
\endif
select 'FACULTY_STUDY_LEASE_CONCURRENCY_PASS' as result;
SQL
  printf '%s\n' "--- $case_name session A transcript ---"
  sed -n '1,200p' "$LOG_DIR/a-$case_name.log"
  printf '%s\n' "--- $case_name session B transcript ---"
  sed -n '1,200p' "$LOG_DIR/b-$case_name.log"
}

run_case success 0 20261024_faculty_study_result_lease_session_a.sql
run_case error 1 20261024_faculty_study_result_lease_session_a_error.sql

"${PSQL[@]}" <<'SQL'
select rolname from pg_roles where rolname in ('anon', 'authenticated', 'service_role') order by rolname;
select has_function_privilege('service_role', 'public.write_faculty_study_result_owned(uuid,integer,uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,text,timestamptz)', 'EXECUTE') as service_role_execute,
       has_function_privilege('anon', 'public.write_faculty_study_result_owned(uuid,integer,uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,text,timestamptz)', 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', 'public.write_faculty_study_result_owned(uuid,integer,uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,text,timestamptz)', 'EXECUTE') as authenticated_execute;
SQL
