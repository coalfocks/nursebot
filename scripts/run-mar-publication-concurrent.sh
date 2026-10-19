#!/usr/bin/env bash
set -euo pipefail

(( BASH_VERSINFO[0] >= 4 )) || { echo 'Bash 4+ required' >&2; exit 2; }
: "${MAR_NORMAL_DATABASE_URL:?Set MAR_NORMAL_DATABASE_URL to an isolated disposable PostgreSQL URL}"
: "${MAR_NORMAL_DISPOSABLE:?Set MAR_NORMAL_DISPOSABLE=1}"; [[ "$MAR_NORMAL_DISPOSABLE" == 1 ]] || exit 2
command -v psql >/dev/null || { echo 'psql required' >&2; exit 2; }

db="$MAR_NORMAL_DATABASE_URL"
room_id="${MAR_NORMAL_ROOM_ID:-1}"
actor="${MAR_NORMAL_ADMIN_SUB:-00000000-0000-0000-0000-000000000002}"
request_id="$(psql "$db" -Atc 'select gen_random_uuid()')"
expected_revision="$(psql "$db" -Atc "select revision from public.mar_history_revisions where scope_key=(select patient_id::text || ':' || id::text || ':baseline' from public.rooms where id=$room_id)")"
holder_log="$(mktemp)"
holder_pipe="$(mktemp -u)"
call_a_log="$(mktemp)"
call_b_log="$(mktemp)"
cleanup() { rm -f "$holder_log" "$holder_pipe" "$call_a_log" "$call_b_log"; }
trap cleanup EXIT
mkfifo "$holder_pipe"

psql -qAt "$db" <"$holder_pipe" >"$holder_log" 2>&1 &
holder_pid=$!
exec 9>"$holder_pipe"
printf "begin; select pg_advisory_xact_lock(hashtext('mar-authoring:%s')); select 'LOCK_HELD';\n" "$room_id" >&9
for _ in {1..30}; do grep -Fxq LOCK_HELD "$holder_log" && break; sleep 0.1; done
grep -Fxq LOCK_HELD "$holder_log" || { echo 'publication holder did not acquire lock' >&2; exit 1; }

call_sql="set role authenticated; select set_config('request.jwt.claim.sub','$actor',false); select public.publish_mar_case_version_atomic('$request_id'::uuid,$room_id,$expected_revision,null,null);"
PGAPPNAME=mar-publication-a psql -qAt "$db" -v ON_ERROR_STOP=1 -c "$call_sql" >"$call_a_log" 2>&1 & call_a=$!
PGAPPNAME=mar-publication-b psql -qAt "$db" -v ON_ERROR_STOP=1 -c "$call_sql" >"$call_b_log" 2>&1 & call_b=$!

waiting=0
for _ in {1..30}; do
  count="$(psql "$db" -Atc "select count(*) from pg_stat_activity where application_name in ('mar-publication-a','mar-publication-b') and wait_event_type='Lock'")"
  if [[ "$count" == 2 ]]; then waiting=1; break; fi
  sleep 0.1
done
[[ "$waiting" == 1 ]] || { echo 'did not observe both named publication callers waiting' >&2; exit 1; }
echo 'two named publication callers observed waiting on the held room lock'
printf 'rollback;\\q\n' >&9
exec 9>&-
wait "$holder_pid" 2>/dev/null || true
wait "$call_a"
wait "$call_b"

echo "CALL_A $(tr '\n' ' ' <"$call_a_log")"
echo "CALL_B $(tr '\n' ' ' <"$call_b_log")"
ops="$(psql "$db" -Atc "select count(*) from public.mar_publication_operations where request_id='$request_id'")"
versions="$(psql "$db" -Atc "select count(*) from public.mar_authored_case_versions where room_id=$room_id and case_version=(select result->>'caseVersion' from public.mar_publication_operations where request_id='$request_id')")"
[[ "$ops" == 1 && "$versions" == 1 ]] || { echo "publication concurrency duplicated state: operations=$ops versions=$versions" >&2; exit 1; }
echo "MAR publication concurrency: PASS (operations=$ops versions=$versions request_id=$request_id)"
