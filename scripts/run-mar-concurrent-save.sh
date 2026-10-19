#!/usr/bin/env bash
set -euo pipefail

(( BASH_VERSINFO[0] >= 4 )) || { echo 'Bash 4+ required' >&2; exit 2; }
PORT="${1:?usage: run-mar-concurrent-save.sh PORT}"
HOST=127.0.0.1
REQUEST='40000000-0000-0000-0000-000000000099'
PATIENT='10000000-0000-0000-0000-000000000001'
ASSIGNMENT='20000000-0000-0000-0000-000000000003'
ORDER='30000000-0000-0000-0000-000000000003'
ACTOR='00000000-0000-0000-0000-000000000002'
CALL_SQL="select set_config('request.jwt.claim.sub', '$ACTOR', false); select public.save_mar_history_atomic('$REQUEST'::uuid, '$PATIENT'::uuid, 1, '$ASSIGNMENT'::uuid, 'case-v1-other', 2, jsonb_build_array(jsonb_build_object('orderId', '$ORDER', 'caseVersion', 'case-v1-other', 'occurrenceKey', 'atomic-dose-4', 'relativeOffsetHours', 4, 'medicationName', 'Atomic fixture', 'status', 'Given')));"

psql_user() { PGPASSWORD='mar-scope-user' psql -h "$HOST" -p "$PORT" -U mar_scope_user -d postgres "$@"; }
psql_postgres() { PGPASSWORD='mar-scope-local' psql -h "$HOST" -p "$PORT" -U postgres -d postgres "$@"; }
run_call() {
  local app_name="$1" output="$2"
  PGPASSWORD='mar-scope-user' PGAPPNAME="$app_name" psql -h "$HOST" -p "$PORT" -U mar_scope_user -d postgres -v ON_ERROR_STOP=1 -Atc "$CALL_SQL" >"$output" 2>&1
}

# Hold the request advisory lock first. Both callers are then forced to be
# waiting on the same claim lock before it is released, proving first-use
# concurrency rather than merely starting two background processes.
holder_log="/tmp/mar-holder-$PORT.log"
holder_pipe="/tmp/mar-holder-$PORT.pipe"
rm -f "$holder_log" "$holder_pipe"
mkfifo "$holder_pipe"
PGAPPNAME='mar-concurrent-holder' PGPASSWORD='mar-scope-local' psql -h "$HOST" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt <"$holder_pipe" >"$holder_log" 2>&1 &
holder_pid=$!
exec 9>"$holder_pipe"
printf "begin; select pg_advisory_xact_lock(hashtext('%s')); select 'LOCK_HELD';\n" "$REQUEST" >&9
for _ in {1..30}; do
  grep -Fxq 'LOCK_HELD' "$holder_log" && break
  sleep 0.1
done
grep -Fxq 'LOCK_HELD' "$holder_log" || { echo 'lock holder did not signal acquisition' >&2; exec 9>&-; kill "$holder_pid" 2>/dev/null || true; wait "$holder_pid" 2>/dev/null || true; rm -f "$holder_pipe"; exit 1; }
run_call 'mar-concurrent-a' "/tmp/mar-call-a-$PORT.log" &
call_a=$!
run_call 'mar-concurrent-b' "/tmp/mar-call-b-$PORT.log" &
call_b=$!

overlap=0
for _ in {1..30}; do
  waiting="$(psql_postgres -Atc "select count(*) from pg_stat_activity where application_name in ('mar-concurrent-a','mar-concurrent-b') and wait_event_type = 'Lock'")"
  if [[ "$waiting" == 2 ]]; then overlap=1; break; fi
  sleep 0.1
done
[[ "$overlap" == 1 ]] || {
  echo 'concurrency barrier did not observe both named callers waiting on the request lock' >&2
  psql_postgres -Atc "select application_name || '|' || coalesce(wait_event_type,'') || '|' || coalesce(wait_event,'') || '|' || state from pg_stat_activity where application_name like 'mar-concurrent-%'" >&2 || true
  exec 9>&-
  kill "$holder_pid" 2>/dev/null || true
  wait "$holder_pid" 2>/dev/null || true
  wait "$call_a" 2>/dev/null || true
  wait "$call_b" 2>/dev/null || true
  rm -f "$holder_pipe"
  exit 1
}
echo 'two named callers observed waiting on the held request lock; releasing holder'
printf "rollback;\\q\n" >&9
exec 9>&-
wait "$holder_pid" 2>/dev/null || true
wait "$call_a"
wait "$call_b"
rm -f "$holder_pipe"

ops="$(psql_postgres -Atc "select count(*) from public.mar_save_operations where request_id='$REQUEST'")"
events="$(psql_postgres -Atc "select count(*) from public.mar_administration_events where occurrence_key='atomic-dose-4'")"
[[ "$ops" == 1 && "$events" == 1 ]] || { echo "same-ID concurrency duplicated state: operations=$ops events=$events" >&2; exit 1; }
echo 'MAR same-request concurrency: PASS (two callers waited on claim lock; one operation and one event)'
