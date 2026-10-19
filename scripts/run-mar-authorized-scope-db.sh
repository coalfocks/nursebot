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
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
if docker ps -a --format '{{.Names}}' | grep -Fxq "$NAME"; then
  echo "refusing occupied disposable container $NAME" >&2
  exit 2
fi
docker run -d --name "$NAME" -p "127.0.0.1:${PORT}:5432" -e POSTGRES_PASSWORD="$PASSWORD" postgres:15.3 >/dev/null
for _ in {1..60}; do
  if PGPASSWORD="$PASSWORD" psql -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -Atqc 'select 1' >/dev/null 2>&1; then break; fi
  sleep 1
done

PG=(psql -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1)
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
"${PG[@]}" -f supabase/migrations/20261019100012_mar_atomic_snapshot_save.sql >/dev/null
"${PG[@]}" <<'SQL'
grant usage on schema public, auth to authenticated;
grant authenticated to mar_scope_user;
grant execute on function public.save_mar_history(uuid, integer, uuid, text, integer, jsonb) to mar_scope_user;
grant execute on function public.get_mar_history_revision(uuid, integer, uuid) to mar_scope_user;
grant execute on function public.create_mar_baseline_version(uuid, text, jsonb) to mar_scope_user;
grant execute on function public.get_mar_readiness() to mar_scope_user;
grant execute on function public.save_mar_history_atomic(uuid, uuid, integer, uuid, text, integer, jsonb) to mar_scope_user;
SQL

PGPASSWORD='mar-scope-user' psql -h 127.0.0.1 -p "$PORT" -U mar_scope_user -d postgres -v ON_ERROR_STOP=1 -f supabase/tests/mar_authorized_scope.sql
ATOMIC_OUTPUT="$(PGPASSWORD='mar-scope-user' psql -h 127.0.0.1 -p "$PORT" -U mar_scope_user -d postgres -v ON_ERROR_STOP=1 -At <<'SQL'
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
select public.save_mar_history_atomic('40000000-0000-0000-0000-000000000001'::uuid, '10000000-0000-0000-0000-000000000001'::uuid, 1, '20000000-0000-0000-0000-000000000003'::uuid, 'case-v1-other', 1, jsonb_build_array(jsonb_build_object('orderId', '30000000-0000-0000-0000-000000000003', 'caseVersion', 'case-v1-other', 'occurrenceKey', 'atomic-dose-4', 'relativeOffsetHours', 4, 'medicationName', 'Atomic fixture', 'status', 'Given')));
select public.save_mar_history_atomic('40000000-0000-0000-0000-000000000001'::uuid, '10000000-0000-0000-0000-000000000001'::uuid, 1, '20000000-0000-0000-0000-000000000003'::uuid, 'case-v1-other', 999, jsonb_build_array(jsonb_build_object('orderId', '30000000-0000-0000-0000-000000000003', 'caseVersion', 'case-v1-other', 'occurrenceKey', 'atomic-dose-4', 'relativeOffsetHours', 4, 'medicationName', 'Atomic fixture', 'status', 'Given')));
SQL
)"
[[ "$ATOMIC_OUTPUT" == *'"revision": 2'* && "$ATOMIC_OUTPUT" == *'"caseVersion": "case-v1-other"'* ]] || { echo "atomic MAR RPC assertion failed: $ATOMIC_OUTPUT" >&2; exit 1; }
POLICY_ASSERT="$(${PG[@]} -Atc "select count(*) from pg_policies where schemaname='public' and tablename='mar_administration_events' and policyname='MAR authenticated read' and lower(qual) like '%student_id = auth.uid()%' and lower(qual) like '%school_id = r.school_id%'")"
[[ "$POLICY_ASSERT" == 1 ]] || { echo 'MAR read-scope policy replacement was not installed' >&2; exit 1; }
REVISION_POLICY_ASSERT="$(${PG[@]} -Atc "select count(*) from pg_policies where schemaname='public' and tablename='mar_history_revisions' and policyname='MAR revisions authenticated read' and lower(qual) like '%student_id = auth.uid()%' and lower(qual) like '%school_id = r.school_id%'")"
[[ "$REVISION_POLICY_ASSERT" == 1 ]] || { echo 'MAR revision read-scope policy replacement was not installed' >&2; exit 1; }
VERSION_ASSERT="$(${PG[@]} -Atc "select count(*) from pg_proc where proname='create_mar_baseline_version'")"
[[ "$VERSION_ASSERT" == 1 ]] || { echo 'MAR immutable baseline version RPC missing' >&2; exit 1; }
READINESS="$(${PG[@]} -Atc "select public.get_mar_readiness()")"
[[ "$READINESS" == *'"ready": true'* && "$READINESS" == *'"schemaVersion": 4'* && "$READINESS" == *'"atomicPersistence": true'* ]] || { echo "MAR readiness assertion failed: $READINESS" >&2; exit 1; }
echo 'MAR authorized scope disposable harness: PASS'
