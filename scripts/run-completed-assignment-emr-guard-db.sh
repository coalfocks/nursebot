#!/usr/bin/env bash
set -euo pipefail

(( BASH_VERSINFO[0] >= 4 )) || { echo 'Bash 4+ required' >&2; exit 2; }
: "${COMPLETED_EMR_GUARD_DISPOSABLE:?Set COMPLETED_EMR_GUARD_DISPOSABLE=1}"
[[ "$COMPLETED_EMR_GUARD_DISPOSABLE" == 1 ]] || { echo 'Refusing without disposable opt-in' >&2; exit 2; }
command -v docker >/dev/null || { echo 'docker required' >&2; exit 2; }
command -v psql >/dev/null || { echo 'psql required' >&2; exit 2; }

PORT="${COMPLETED_EMR_GUARD_PGPORT:-54337}"
NAME="completed-emr-guard-${PORT}"
PASSWORD='completed-emr-guard-local'
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

PG="PGPASSWORD=$PASSWORD psql -h 127.0.0.1 -p $PORT -U postgres -d postgres -v ON_ERROR_STOP=1"
eval "$PG" <<'SQL'
create extension if not exists pgcrypto;
create schema auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create table public.profiles (id uuid primary key, role text not null, school_id uuid, full_name text not null default 'Fixture');
create table public.student_room_assignments (id uuid primary key, student_id uuid not null, room_id integer not null, assigned_by uuid not null, school_id uuid, status text not null);
create table public.medical_orders (id uuid primary key, assignment_id uuid, instructions text);
create table public.lab_results (id uuid primary key, assignment_id uuid);
create table public.clinical_notes (id uuid primary key, assignment_id uuid);
create table public.vital_signs (id uuid primary key, assignment_id uuid);
create table public.imaging_studies (id uuid primary key, assignment_id uuid);
create role emr_guard_user login password 'emr-guard-user' nosuperuser noreplication;
grant usage on schema public, auth to emr_guard_user;
grant select on public.profiles to emr_guard_user;
grant select, update on public.student_room_assignments to emr_guard_user;
grant select, update on public.medical_orders to emr_guard_user;
grant select, update on public.lab_results, public.clinical_notes, public.vital_signs, public.imaging_studies to emr_guard_user;
alter table public.medical_orders enable row level security;
create policy emr_read on public.medical_orders for select to public using (
  exists (select 1 from public.student_room_assignments a join public.profiles p on p.id = auth.uid()
    where a.id = medical_orders.assignment_id and (
      a.student_id = auth.uid() or (p.role in ('school_admin','super_admin') and p.school_id = a.school_id)
      or current_setting('request.jwt.claim.role', true) = 'service_role')));
create policy emr_update on public.medical_orders for update to public using (
  exists (select 1 from public.student_room_assignments a join public.profiles p on p.id = auth.uid()
    where a.id = medical_orders.assignment_id and (
      a.student_id = auth.uid() or (p.role in ('school_admin','super_admin') and p.school_id = a.school_id)
      or current_setting('request.jwt.claim.role', true) = 'service_role')))
  with check (true);
insert into public.profiles values
 ('00000000-0000-0000-0000-000000000001','student','00000000-0000-0000-0000-0000000000a1','Student'),
 ('00000000-0000-0000-0000-000000000002','school_admin','00000000-0000-0000-0000-0000000000a1','Allowed admin'),
 ('00000000-0000-0000-0000-000000000003','school_admin','00000000-0000-0000-0000-0000000000b2','Denied admin');
insert into public.student_room_assignments values
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',1,'00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a1','completed'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001',2,'00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a1','in_progress');
insert into public.medical_orders values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','completed'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','active');
SQL

eval "$PG" -f supabase/migrations/20261019100000_completed_assignment_emr_write_guard.sql >/dev/null
eval "$PG" <<'SQL'
grant execute on function public.guard_completed_assignment_emr_write() to emr_guard_user;
SQL

APP="PGPASSWORD=emr-guard-user psql -h 127.0.0.1 -p $PORT -U emr_guard_user -d postgres -v ON_ERROR_STOP=1"
eval "$APP" \
  -v student_id=00000000-0000-0000-0000-000000000001 \
  -v school_admin_id=00000000-0000-0000-0000-000000000002 \
  -v denied_school_admin_id=00000000-0000-0000-0000-000000000003 \
  -v completed_assignment_id=10000000-0000-0000-0000-000000000001 \
  -v completed_order_id=20000000-0000-0000-0000-000000000001 \
  -v writable_assignment_id=10000000-0000-0000-0000-000000000002 \
  -v writable_order_id=20000000-0000-0000-0000-000000000002 \
  -f supabase/tests/completed_assignment_emr_write_guard.sql
echo 'completed EMR guard disposable harness: PASS'

# Two-session interleaving: the writer holds the assignment row lock while the
# authoritative completion transition waits. The writer must observe the
# pre-completion status and commit once; completion then commits afterward.
PGPASSWORD="$PASSWORD" psql -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -c "update public.student_room_assignments set status='in_progress' where id='10000000-0000-0000-0000-000000000002'"
OUT_DIR="$(mktemp -d)"
cleanup_interleave() { rm -rf "$OUT_DIR"; }
trap 'cleanup_interleave; cleanup' EXIT
APP_SESSION="PGPASSWORD=emr-guard-user psql -h 127.0.0.1 -p $PORT -U emr_guard_user -d postgres -v ON_ERROR_STOP=1"
eval "$APP_SESSION" -v writable_assignment_id=10000000-0000-0000-0000-000000000002 -v writable_order_id=20000000-0000-0000-0000-000000000002 -f supabase/tests/completed_assignment_emr_guard_write_session.sql >"$OUT_DIR/writer.log" 2>&1 &
WRITER_PID=$!
sleep 0.25
PGPASSWORD="$PASSWORD" psql -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -v writable_assignment_id=10000000-0000-0000-0000-000000000002 \
  -f supabase/tests/completed_assignment_emr_guard_completion_session.sql >"$OUT_DIR/completion.log" 2>&1 &
COMPLETION_PID=$!
wait "$WRITER_PID"
wait "$COMPLETION_PID"
FINAL_STATUS="$(PGPASSWORD="$PASSWORD" psql -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -Atqc "select status from public.student_room_assignments where id='10000000-0000-0000-0000-000000000002'")"
[[ "$FINAL_STATUS" == completed ]] || { echo "interleaving final status was $FINAL_STATUS" >&2; cat "$OUT_DIR"/*.log >&2; exit 1; }
echo 'completed EMR guard two-session write/completion interleaving: PASS'
