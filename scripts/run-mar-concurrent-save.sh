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

# Hold the request advisory lock first. Both callers are then forced to be
# waiting on the same claim lock before it is released, proving first-use
# concurrency rather than merely starting two background processes.
PGPASSWORD='mar-scope-local' psql -h "$HOST" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -c "select pg_advisory_lock(hashtext('$REQUEST')); select pg_sleep(2); select pg_advisory_unlock(hashtext('$REQUEST'));" >/tmp/mar-holder-$PORT.log 2>&1 &
holder_pid=$!
psql_user -v ON_ERROR_STOP=1 -Atc "$CALL_SQL" >/tmp/mar-call-a-$PORT.log 2>&1 &
call_a=$!
psql_user -v ON_ERROR_STOP=1 -Atc "$CALL_SQL" >/tmp/mar-call-b-$PORT.log 2>&1 &
call_b=$!

overlap=0
for _ in {1..30}; do
  waiting="$(psql_postgres -Atc "select count(*) from pg_stat_activity where query like '%save_mar_history_atomic%' and wait_event_type = 'Lock'")"
  if [[ "$waiting" == 2 ]]; then overlap=1; break; fi
  sleep 0.1
done
wait "$call_a"
wait "$call_b"
wait "$holder_pid"
[[ "$overlap" == 1 ]] || { echo 'concurrency barrier did not observe two callers waiting on the request lock' >&2; exit 1; }

ops="$(psql_postgres -Atc "select count(*) from public.mar_save_operations where request_id='$REQUEST'")"
events="$(psql_postgres -Atc "select count(*) from public.mar_administration_events where occurrence_key='atomic-dose-4'")"
[[ "$ops" == 1 && "$events" == 1 ]] || { echo "same-ID concurrency duplicated state: operations=$ops events=$events" >&2; exit 1; }
echo 'MAR same-request concurrency: PASS (two callers waited on claim lock; one operation and one event)'
