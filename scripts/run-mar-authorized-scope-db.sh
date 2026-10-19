#!/usr/bin/env bash
set -euo pipefail

(( BASH_VERSINFO[0] >= 4 )) || { echo 'Bash 4+ required' >&2; exit 2; }
: "${MAR_SCOPE_DISPOSABLE:?Set MAR_SCOPE_DISPOSABLE=1}"
[[ "$MAR_SCOPE_DISPOSABLE" == 1 ]] || { echo 'Refusing without disposable opt-in' >&2; exit 2; }
command -v docker >/dev/null || { echo 'docker required' >&2; exit 2; }
command -v psql >/dev/null || { echo 'psql required' >&2; exit 2; }

PORT="${MAR_SCOPE_PGPORT:-54341}"
NAME="mar-scope-${PORT}"
PASSWORD='mar-scope-local'
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
created_by_this_run=0
cleanup() {
  if [[ "$created_by_this_run" == 1 ]]; then
    docker rm -f "$NAME" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT
assert_hash() {
  local file="$1" expected="$2" actual
  actual="$(sha256sum "$file" | awk '{print $1}')"
  [[ "$actual" == "$expected" ]] || { echo "hash mismatch: $file expected=$expected actual=$actual" >&2; exit 1; }
  echo "PIN $(basename "$file") sha256=$actual"
}
assert_hash "$script_dir/../supabase/migrations/20261019100009_mar_authored_baseline_and_administrations.sql" 6f60888b3177dc750e0c8762c90ef0ecec62644f98299217570e3dc6b1555d88
assert_hash "$script_dir/../supabase/migrations/20261019100010_mar_authorized_scope_materialization.sql" d2ad577476c2d42daa88015786210abf8822c3c7f22aec1a95ada6e90c001a16
assert_hash "$script_dir/../supabase/migrations/20261019100011_mar_read_scope_and_versions.sql" ce3ac9202ccd5a2e8aa0c19de1dfcc23035531a9b25d4c2352e1400356efe302
assert_hash "$script_dir/../supabase/migrations/20261019100012_mar_atomic_snapshot_save.sql" 24e38096a83a8da0c368a1fd66f86ea1f8087f3c1e9e648088c7a1ea741efbc3
assert_hash "$script_dir/../supabase/migrations/20261019100013_mar_revoke_split_mutators.sql" 5f4a0461fbd681eabb58df0bfec348061ce2c3717fea365c6f66f287b3850ea8
if docker ps -a --format '{{.Names}}' | grep -Fxq "$NAME"; then
  echo "refusing occupied disposable container $NAME" >&2
  exit 2
fi
docker run -d --name "$NAME" -p "127.0.0.1:${PORT}:5432" -e POSTGRES_PASSWORD="$PASSWORD" postgres:15.3 >/dev/null
created_by_this_run=1
for _ in {1..60}; do
  if PGPASSWORD="$PASSWORD" psql -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -Atqc 'select 1' >/dev/null 2>&1; then break; fi
  sleep 1
done

PG=(psql -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1)
PG_TX=(psql -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -1 -v ON_ERROR_STOP=1)
export PGPASSWORD="$PASSWORD"
"${PG[@]}" <<'SQL'
create extension if not exists pgcrypto;
create schema auth;
create role authenticated nologin;
create role anon nologin;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create table public.patients (id uuid primary key, school_id uuid);
create table public.rooms (id integer primary key, patient_id uuid, school_id uuid);
create table public.profiles (id uuid primary key, role text not null, school_id uuid);
create table public.student_room_assignments (id uuid primary key, student_id uuid, room_id integer, school_id uuid, case_key_version text, scenario_baseline_version integer, status text);
create table public.medical_orders (id uuid primary key, patient_id uuid, room_id integer, assignment_id uuid);
create table auth.users (id uuid primary key);
create role mar_scope_user login password 'mar-scope-user' nosuperuser noreplication;
grant usage on schema public, auth to mar_scope_user;
grant select on public.patients, public.rooms, public.profiles, public.student_room_assignments, public.medical_orders to mar_scope_user;
grant insert on public.patients, public.rooms, public.profiles, public.student_room_assignments, public.medical_orders to mar_scope_user;
insert into auth.users(id) values
  ('00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000003'),
  ('00000000-0000-0000-0000-000000000004');
SQL
"${PG[@]}" -f supabase/migrations/20261019100009_mar_authored_baseline_and_administrations.sql >/dev/null
"${PG[@]}" -f supabase/migrations/20261019100010_mar_authorized_scope_materialization.sql >/dev/null
"${PG[@]}" -f supabase/migrations/20261019100011_mar_read_scope_and_versions.sql >/dev/null
"${PG[@]}" -c "grant authenticated to mar_scope_user"
# Exercise the historical split mutators before the atomic upgrade. Their
# authenticated execute grants are intentionally revoked by 100013 below.
PGPASSWORD='mar-scope-user' psql -h 127.0.0.1 -p "$PORT" -U mar_scope_user -d postgres -v ON_ERROR_STOP=1 -f supabase/tests/mar_authorized_scope.sql >/tmp/mar-authorized-scope-$PORT.log
# These two files are one reviewed rollout unit. --single-transaction means
# readiness cannot become true with the atomic RPC installed but legacy
# mutators still executable if the revocation fails.
"${PG_TX[@]}" -f supabase/migrations/20261019100012_mar_atomic_snapshot_save.sql -f supabase/migrations/20261019100013_mar_revoke_split_mutators.sql >/dev/null
"${PG[@]}" <<'SQL'
grant usage on schema public, auth to authenticated;
grant authenticated to mar_scope_user;
grant execute on function public.get_mar_history_revision(uuid, integer, uuid) to mar_scope_user;
grant execute on function public.get_mar_readiness() to mar_scope_user;
grant execute on function public.save_mar_history_atomic(uuid, uuid, integer, uuid, text, integer, jsonb) to mar_scope_user;
SQL

"${PG[@]}" <<'SQL'
insert into public.student_room_assignments(id, student_id, room_id, school_id, case_key_version, status)
values ('20000000-0000-0000-0000-000000000098', '00000000-0000-0000-0000-000000000001', 1, '00000000-0000-0000-0000-0000000000a1', 'rollback-case', 'in_progress')
on conflict (id) do nothing;
SQL

OLD_RPC_OUTPUT="$(PGPASSWORD='mar-scope-user' psql -h 127.0.0.1 -p "$PORT" -U mar_scope_user -d postgres -v ON_ERROR_STOP=0 -At 2>&1 <<'SQL'
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
select public.save_mar_history('10000000-0000-0000-0000-000000000001'::uuid, 1, '20000000-0000-0000-0000-000000000001'::uuid, 'case-v1', 1, '[]'::jsonb);
select public.create_mar_baseline_version('20000000-0000-0000-0000-000000000001'::uuid, 'case-v1', '[]'::jsonb);
SQL
)"
[[ "$OLD_RPC_OUTPUT" == *'permission denied'* ]] || { echo "legacy MAR mutator denial assertion failed: $OLD_RPC_OUTPUT" >&2; exit 1; }
printf 'legacy mutator denial output: %s\n' "$OLD_RPC_OUTPUT"

ATOMIC_OUTPUT="$(PGPASSWORD='mar-scope-user' psql -h 127.0.0.1 -p "$PORT" -U mar_scope_user -d postgres -v ON_ERROR_STOP=1 -At <<'SQL'
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
select public.save_mar_history_atomic('40000000-0000-0000-0000-000000000001'::uuid, '10000000-0000-0000-0000-000000000001'::uuid, 1, '20000000-0000-0000-0000-000000000003'::uuid, 'case-v1-other', 1, jsonb_build_array(jsonb_build_object('orderId', '30000000-0000-0000-0000-000000000003', 'caseVersion', 'case-v1-other', 'occurrenceKey', 'atomic-dose-4', 'relativeOffsetHours', 4, 'medicationName', 'Atomic fixture', 'status', 'Given')));
select public.save_mar_history_atomic('40000000-0000-0000-0000-000000000001'::uuid, '10000000-0000-0000-0000-000000000001'::uuid, 1, '20000000-0000-0000-0000-000000000003'::uuid, 'case-v1-other', 1, jsonb_build_array(jsonb_build_object('orderId', '30000000-0000-0000-0000-000000000003', 'caseVersion', 'case-v1-other', 'occurrenceKey', 'atomic-dose-4', 'relativeOffsetHours', 4, 'medicationName', 'Atomic fixture', 'status', 'Given')));
SQL
)"
[[ "$ATOMIC_OUTPUT" == *'"revision": 2'* && "$ATOMIC_OUTPUT" == *'"caseVersion": "case-v1-other"'* ]] || { echo "atomic MAR RPC assertion failed: $ATOMIC_OUTPUT" >&2; exit 1; }
MISMATCH_OUTPUT="$(PGPASSWORD='mar-scope-user' psql -h 127.0.0.1 -p "$PORT" -U mar_scope_user -d postgres -v ON_ERROR_STOP=0 -At 2>&1 <<'SQL'
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
select public.save_mar_history_atomic('40000000-0000-0000-0000-000000000001'::uuid, '10000000-0000-0000-0000-000000000001'::uuid, 1, '20000000-0000-0000-0000-000000000003'::uuid, 'case-v1-other', 1, jsonb_build_array(jsonb_build_object('orderId', '30000000-0000-0000-0000-000000000003', 'caseVersion', 'case-v1-other', 'occurrenceKey', 'atomic-dose-changed', 'relativeOffsetHours', 4, 'medicationName', 'Atomic fixture', 'status', 'Given')));
SQL
)"
[[ "$MISMATCH_OUTPUT" == *'MAR_RETRY_PAYLOAD_MISMATCH'* ]] || { echo "same-ID changed-payload assertion failed: $MISMATCH_OUTPUT" >&2; exit 1; }
ROLLBACK_OUTPUT="$(PGPASSWORD='mar-scope-user' psql -h 127.0.0.1 -p "$PORT" -U mar_scope_user -d postgres -v ON_ERROR_STOP=0 -At 2>&1 <<'SQL'
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
select public.save_mar_history_atomic('40000000-0000-0000-0000-000000000098'::uuid, '10000000-0000-0000-0000-000000000001'::uuid, 1, '20000000-0000-0000-0000-000000000098'::uuid, 'rollback-case', 0, jsonb_build_array(jsonb_build_object('caseVersion', 'rollback-case', 'occurrenceKey', 'rollback', 'relativeOffsetHours', 4, 'medicationName', 'Rollback fixture', 'category', 'invalid')));
SQL
)"
[[ "$ROLLBACK_OUTPUT" == *'invalid input value for enum'* || "$ROLLBACK_OUTPUT" == *'violates check constraint'* ]] || { echo "rollback injection did not reach the event insert: $ROLLBACK_OUTPUT" >&2; exit 1; }
ROLLBACK_STATE="$(${PG[@]} -Atc "select (select count(*) from public.mar_save_operations where request_id='40000000-0000-0000-0000-000000000098'), (select count(*) from public.mar_assignment_baseline_versions where assignment_id='20000000-0000-0000-0000-000000000098' and case_version='rollback-case'), (select count(*) from public.mar_history_revisions where scope_key='10000000-0000-0000-0000-000000000001:1:20000000-0000-0000-0000-000000000098'), (select count(*) from public.mar_administration_events where occurrence_key='rollback')")"
[[ "$ROLLBACK_STATE" == '0|0|0|0' ]] || { echo "atomic rollback left state: $ROLLBACK_STATE" >&2; exit 1; }
printf 'rollback injected error: %s\n' "$ROLLBACK_OUTPUT"
echo "rollback state (operation|snapshot|revision|event): $ROLLBACK_STATE"
echo 'running same-request concurrency barrier'
bash "$script_dir/run-mar-concurrent-save.sh" "$PORT"
echo 'same-request concurrency barrier complete'
POLICY_ASSERT="$(${PG[@]} -Atc "select count(*) from pg_policies where schemaname='public' and tablename='mar_administration_events' and policyname='MAR authenticated read' and lower(qual) like '%student_id = auth.uid()%' and lower(qual) like '%school_id = r.school_id%'")"
[[ "$POLICY_ASSERT" == 1 ]] || { echo 'MAR read-scope policy replacement was not installed' >&2; exit 1; }
echo "event read policy assertions: $POLICY_ASSERT"
REVISION_POLICY_ASSERT="$(${PG[@]} -Atc "select count(*) from pg_policies where schemaname='public' and tablename='mar_history_revisions' and policyname='MAR revisions authenticated read' and lower(qual) like '%student_id = auth.uid()%' and lower(qual) like '%school_id = r.school_id%'")"
[[ "$REVISION_POLICY_ASSERT" == 1 ]] || { echo 'MAR revision read-scope policy replacement was not installed' >&2; exit 1; }
echo "revision read policy assertions: $REVISION_POLICY_ASSERT"
VERSION_ASSERT="$(${PG[@]} -Atc "select count(*) from pg_proc where proname='create_mar_baseline_version'")"
[[ "$VERSION_ASSERT" == 1 ]] || { echo 'MAR immutable baseline version RPC missing' >&2; exit 1; }
READINESS="$(${PG[@]} -Atc "select public.get_mar_readiness()")"
[[ "$READINESS" == *'"ready": true'* && "$READINESS" == *'"schemaVersion": 4'* && "$READINESS" == *'"functionVersion": 4'* && "$READINESS" == *'"atomicPersistence": true'* ]] || { echo "MAR readiness assertion failed: $READINESS" >&2; exit 1; }
echo 'MAR authorized scope disposable harness: PASS'
