#!/usr/bin/env bash
set -euo pipefail

: "${MAR_QA_DISPOSABLE:?Set MAR_QA_DISPOSABLE=1}"
[[ "$MAR_QA_DISPOSABLE" == 1 ]] || { echo 'Refusing without disposable opt-in' >&2; exit 2; }
command -v docker >/dev/null || { echo 'docker required' >&2; exit 2; }
command -v psql >/dev/null || { echo 'psql required' >&2; exit 2; }

PORT="${MAR_QA_PGPORT:-54342}"
NAME="mar-qa-exact-${PORT}"
PASSWORD='mar-qa-exact-local'
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${MAR_QA_TRANSCRIPT:-$ROOT/docs/reviews/2026-10-22-disposable-qa-manual-mar-exact.transcript.txt}"
created_by_this_run=0
cleanup() { if [[ "$created_by_this_run" == 1 ]]; then docker rm -f "$NAME" >/dev/null 2>&1 || true; fi; }
trap cleanup EXIT
[[ ! "$(docker ps -a --format '{{.Names}}' | grep -Fx "$NAME" || true)" ]] || { echo "refusing occupied disposable container $NAME" >&2; exit 2; }

sha256sum "$ROOT/supabase/migrations/20261021120000_scope_disposable_qa_learners.sql" | grep -F '6dbd1d54adb88ffbe2b2ecd62aa27aa0012a7e89528fc46fd6e6e730cad6db3f'
sha256sum "$ROOT/supabase/migrations/20261021130000_manual_mar_packet_contract.sql" | grep -F '59ac4a9e04c2415c006c1f88643892c326e37163e1735782aea2a6752608f12b'
sha256sum "$ROOT/supabase/migrations/20261021141147_manual_mar_assignment_snapshot_hardening.sql" | grep -F 'dce3dd3499f429e309c2e734ccaf4facff307e9588f24187e0871d8ea5dd2801'

docker run -d --name "$NAME" -p "127.0.0.1:${PORT}:5432" -e POSTGRES_PASSWORD="$PASSWORD" postgres:15.3 >/dev/null
created_by_this_run=1
for _ in {1..60}; do PGPASSWORD="$PASSWORD" psql -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -Atqc 'select 1' >/dev/null 2>&1 && break; sleep 1; done
PG=(psql -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1)
export PGPASSWORD="$PASSWORD"
{
  echo 'DISPOSABLE QA + MANUAL MAR EXACT-SCHEMA TRANSCRIPT'
  echo "UTC $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  "${PG[@]}" <<'SQL'
create extension if not exists pgcrypto;
create schema auth;
create role authenticated nologin;
create role anon nologin;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
create table public.profiles (id uuid primary key, role text not null, school_id uuid, learner_program text);
create table auth.users (id uuid primary key);
create table public.patients (id uuid primary key);
create table public.rooms (id integer primary key, patient_id uuid not null references public.patients(id), school_id uuid not null, available_school_ids uuid[] default '{}', is_active boolean not null default true, learner_program text not null);
create table public.student_room_assignments (id uuid primary key, student_id uuid not null, room_id integer not null references public.rooms(id), assigned_by uuid not null, school_id uuid not null, learner_program text, status text, effective_date timestamptz, window_start timestamptz, window_end timestamptz, case_key_version text, scenario_baseline_version integer, is_sandbox boolean not null default false);
alter table public.student_room_assignments enable row level security;
insert into auth.users values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002'), ('00000000-0000-0000-0000-000000000003'), ('1b895dcc-d329-4b31-8735-2059b986ae96');
insert into public.profiles values
 ('00000000-0000-0000-0000-000000000001','super_admin','10000000-0000-0000-0000-000000000001','medical'),
 ('00000000-0000-0000-0000-000000000002','student','10000000-0000-0000-0000-000000000001','medical'),
 ('00000000-0000-0000-0000-000000000003','student','20000000-0000-0000-0000-000000000002','medical'),
 ('1b895dcc-d329-4b31-8735-2059b986ae96','student','10000000-0000-0000-0000-000000000001','medical');
insert into public.patients values ('30000000-0000-0000-0000-000000000001');
insert into public.rooms values
 (9001,'30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','{}',true,'medical'),
 (9002,'30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002',array['20000000-0000-0000-0000-000000000002'::uuid],true,'medical');
create role qa_author login password 'qa-author';
create role qa_student login password 'qa-student';
grant authenticated to qa_author, qa_student;
grant usage on schema public, auth to authenticated;
grant select, insert on public.profiles, public.rooms, public.patients, public.student_room_assignments to authenticated;
SQL
  "${PG[@]}" -f "$ROOT/supabase/migrations/20261021130000_manual_mar_packet_contract.sql"
  "${PG[@]}" -f "$ROOT/supabase/migrations/20261021141147_manual_mar_assignment_snapshot_hardening.sql"
  "${PG[@]}" -f "$ROOT/supabase/migrations/20261021120000_scope_disposable_qa_learners.sql"
  "${PG[@]}" <<'SQL'
grant usage on schema public, auth to authenticated;
grant select, insert on public.profiles, public.rooms, public.patients, public.student_room_assignments to authenticated;
grant execute on function public.get_manual_mar_packet(uuid, integer, uuid, text) to authenticated;
grant execute on function public.save_manual_mar_packet(uuid, uuid, integer, text, integer, jsonb) to authenticated;
SQL
  echo 'NULL/preflight checks:'
  NULL_CHECKS="$(PGPASSWORD='qa-author' psql -h 127.0.0.1 -p "$PORT" -U qa_author -d postgres -v ON_ERROR_STOP=1 -At <<'SQL'
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false), set_config('request.jwt.claim.role','authenticated',false);
select public.can_create_disposable_qa_assignment(null, null, null) = false, public.can_create_disposable_qa_assignment('1b895dcc-d329-4b31-8735-2059b986ae96',9001,null) = false;
SQL
)"
  [[ "$NULL_CHECKS" == *'t|t' ]] || { echo "NULL/preflight assertion failed: $NULL_CHECKS" >&2; exit 1; }
  echo 'SET ROLE allow/deny checks:'
  PGPASSWORD='qa-author' psql -h 127.0.0.1 -p "$PORT" -U qa_author -d postgres -v ON_ERROR_STOP=1 -At <<'SQL'
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false), set_config('request.jwt.claim.role','authenticated',false);
select public.can_create_disposable_qa_assignment('1b895dcc-d329-4b31-8735-2059b986ae96',9001,'10000000-0000-0000-0000-000000000001') as allowed;
select public.can_create_disposable_qa_assignment('1b895dcc-d329-4b31-8735-2059b986ae96',9002,'10000000-0000-0000-0000-000000000001') as school_restricted_room_denied;
SQL
  ALLOW_DENY="$(PGPASSWORD='qa-author' psql -h 127.0.0.1 -p "$PORT" -U qa_author -d postgres -v ON_ERROR_STOP=1 -At <<'SQL'
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false), set_config('request.jwt.claim.role','authenticated',false);
select public.can_create_disposable_qa_assignment('1b895dcc-d329-4b31-8735-2059b986ae96',9001,'10000000-0000-0000-0000-000000000001'), public.can_create_disposable_qa_assignment('1b895dcc-d329-4b31-8735-2059b986ae96',9002,'10000000-0000-0000-0000-000000000001');
SQL
)"
  [[ "$ALLOW_DENY" == *'t|f' ]] || { echo "allow/deny assertion failed: $ALLOW_DENY" >&2; exit 1; }
  PGPASSWORD='qa-student' psql -h 127.0.0.1 -p "$PORT" -U qa_student -d postgres -v ON_ERROR_STOP=1 -At <<'SQL'
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false), set_config('request.jwt.claim.role','authenticated',false);
select public.can_create_disposable_qa_assignment('1b895dcc-d329-4b31-8735-2059b986ae96',9001,'10000000-0000-0000-0000-000000000001') as non_superadmin_denied;
SQL
  NON_SUPERADMIN="$(PGPASSWORD='qa-student' psql -h 127.0.0.1 -p "$PORT" -U qa_student -d postgres -v ON_ERROR_STOP=1 -At <<'SQL'
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false), set_config('request.jwt.claim.role','authenticated',false);
select public.can_create_disposable_qa_assignment('1b895dcc-d329-4b31-8735-2059b986ae96',9001,'10000000-0000-0000-0000-000000000001') = false;
SQL
)"
  [[ "$NON_SUPERADMIN" == *'t' ]] || { echo "non-superadmin assertion failed: $NON_SUPERADMIN" >&2; exit 1; }
  echo 'sandbox invariant:'
  if "${PG[@]}" -Atc "insert into public.student_room_assignments(id,student_id,room_id,assigned_by,school_id,disposable_qa,is_sandbox) values ('40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002',9001,'00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',true,false)" 2>&1; then exit 1; else echo 'disposable_qa=true,is_sandbox=false rejected'; fi
  echo 'four-event manual snapshot/readback:'
  PGPASSWORD='qa-author' psql -h 127.0.0.1 -p "$PORT" -U qa_author -d postgres -v ON_ERROR_STOP=1 -At <<'SQL'
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false), set_config('request.jwt.claim.role','authenticated',false);
select public.save_manual_mar_packet('50000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',9001,'room-9001-mar-v1',0,'[{"medicationName":"ceftriaxone","orderedDose":"2 g","administeredDose":"2 g","unit":"g","route":"IV","frequency":"daily","occurrenceKey":"cef-24","category":"scheduled","status":"Given","relativeOffsetHours":24,"source":"authored_scenario"},{"medicationName":"acetaminophen","orderedDose":"650 mg","administeredDose":null,"unit":"mg","route":"PO","frequency":"q6h PRN","occurrenceKey":"apap-12","category":"prn","status":"Held","relativeOffsetHours":12,"reason":"Ordered hold","source":"authored_scenario"},{"medicationName":"Duoneb","orderedDose":"3 mL","administeredDose":null,"unit":"mL","route":"INH","frequency":"q2h PRN","occurrenceKey":"duoneb-6","category":"prn","status":"Refused","relativeOffsetHours":6,"reason":"Patient declined","source":"authored_scenario"},{"medicationName":"heparin","orderedDose":"5000 units","administeredDose":null,"unit":"units","route":"SQ","frequency":"q8h","occurrenceKey":"hep-36","category":"scheduled","status":"Not documented","relativeOffsetHours":36,"source":"authored_scenario"}]'::jsonb);
insert into public.student_room_assignments(id,student_id,room_id,assigned_by,school_id,learner_program,status,case_key_version,is_sandbox,disposable_qa) values ('40000000-0000-0000-0000-000000000002','1b895dcc-d329-4b31-8735-2059b986ae96',9001,'00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','medical','assigned','room-9001-mar-v1',true,true);
SQL
  SNAPSHOT_COUNTS="$("${PG[@]}" -Atc "select count(*) || '|' || coalesce(max(jsonb_array_length(events)),0) from public.manual_mar_assignment_snapshots where assignment_id='40000000-0000-0000-0000-000000000002';")"
  [[ "$SNAPSHOT_COUNTS" == '1|4' ]] || { echo "snapshot count assertion failed: $SNAPSHOT_COUNTS" >&2; exit 1; }
  if PGPASSWORD='qa-student' psql -h 127.0.0.1 -p "$PORT" -U qa_student -d postgres -v ON_ERROR_STOP=1 -At <<'SQL'; then
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false), set_config('request.jwt.claim.role','authenticated',false);
insert into public.student_room_assignments(id,student_id,room_id,assigned_by,school_id,learner_program,status,case_key_version,is_sandbox,disposable_qa) values ('40000000-0000-0000-0000-000000000003','1b895dcc-d329-4b31-8735-2059b986ae96',9001,'00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','medical','assigned','room-9001-mar-v1',true,true);
SQL
    echo 'unauthorized student INSERT unexpectedly succeeded' >&2; exit 1
  else
    echo 'unauthorized student INSERT rejected'
  fi
  PGPASSWORD='qa-student' psql -h 127.0.0.1 -p "$PORT" -U qa_student -d postgres -v ON_ERROR_STOP=1 -At <<'SQL'
select set_config('request.jwt.claim.sub','1b895dcc-d329-4b31-8735-2059b986ae96',false), set_config('request.jwt.claim.role','authenticated',false);
select public.get_manual_mar_packet('30000000-0000-0000-0000-000000000001',9001,'40000000-0000-0000-0000-000000000002','room-9001-mar-v1');
SQL
  PGPASSWORD='qa-author' psql -h 127.0.0.1 -p "$PORT" -U qa_author -d postgres -v ON_ERROR_STOP=1 -At <<'SQL'
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false), set_config('request.jwt.claim.role','authenticated',false);
select public.save_manual_mar_packet('50000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001',9001,'room-9001-mar-v1',1,'[{"medicationName":"ceftriaxone","orderedDose":"2 g","administeredDose":"2 g","unit":"g","route":"IV","frequency":"daily","occurrenceKey":"cef-24","category":"scheduled","status":"Held","relativeOffsetHours":24,"source":"authored_scenario"},{"medicationName":"acetaminophen","orderedDose":"650 mg","administeredDose":null,"unit":"mg","route":"PO","frequency":"q6h PRN","occurrenceKey":"apap-12","category":"prn","status":"Held","relativeOffsetHours":12,"reason":"Ordered hold","source":"authored_scenario"},{"medicationName":"Duoneb","orderedDose":"3 mL","administeredDose":null,"unit":"mL","route":"INH","frequency":"q2h PRN","occurrenceKey":"duoneb-6","category":"prn","status":"Refused","relativeOffsetHours":6,"reason":"Patient declined","source":"authored_scenario"},{"medicationName":"heparin","orderedDose":"5000 units","administeredDose":null,"unit":"units","route":"SQ","frequency":"q8h","occurrenceKey":"hep-36","category":"scheduled","status":"Not documented","relativeOffsetHours":36,"source":"authored_scenario"}]'::jsonb);
SQL
  FROZEN_READBACK="$(PGPASSWORD='qa-student' psql -h 127.0.0.1 -p "$PORT" -U qa_student -d postgres -v ON_ERROR_STOP=1 -At <<'SQL'
select set_config('request.jwt.claim.sub','1b895dcc-d329-4b31-8735-2059b986ae96',false), set_config('request.jwt.claim.role','authenticated',false);
select public.get_manual_mar_packet('30000000-0000-0000-0000-000000000001',9001,'40000000-0000-0000-0000-000000000002','room-9001-mar-v1');
SQL
)"
  [[ "$FROZEN_READBACK" == *'"revision": 1'* ]] || { echo 'snapshot revision changed' >&2; exit 1; }
  [[ "$(grep -o '"occurrenceKey"' <<<"$FROZEN_READBACK" | wc -l | tr -d ' ')" == 4 ]] || { echo 'snapshot event count changed' >&2; exit 1; }
  FULL_FROZEN="$("${PG[@]}" -Atc "select events = '[{\"medicationName\":\"ceftriaxone\",\"orderedDose\":\"2 g\",\"administeredDose\":\"2 g\",\"unit\":\"g\",\"route\":\"IV\",\"frequency\":\"daily\",\"occurrenceKey\":\"cef-24\",\"category\":\"scheduled\",\"status\":\"Given\",\"relativeOffsetHours\":24,\"source\":\"authored_scenario\"},{\"medicationName\":\"acetaminophen\",\"orderedDose\":\"650 mg\",\"administeredDose\":null,\"unit\":\"mg\",\"route\":\"PO\",\"frequency\":\"q6h PRN\",\"occurrenceKey\":\"apap-12\",\"category\":\"prn\",\"status\":\"Held\",\"relativeOffsetHours\":12,\"reason\":\"Ordered hold\",\"source\":\"authored_scenario\"},{\"medicationName\":\"Duoneb\",\"orderedDose\":\"3 mL\",\"administeredDose\":null,\"unit\":\"mL\",\"route\":\"INH\",\"frequency\":\"q2h PRN\",\"occurrenceKey\":\"duoneb-6\",\"category\":\"prn\",\"status\":\"Refused\",\"relativeOffsetHours\":6,\"reason\":\"Patient declined\",\"source\":\"authored_scenario\"},{\"medicationName\":\"heparin\",\"orderedDose\":\"5000 units\",\"administeredDose\":null,\"unit\":\"units\",\"route\":\"SQ\",\"frequency\":\"q8h\",\"occurrenceKey\":\"hep-36\",\"category\":\"scheduled\",\"status\":\"Not documented\",\"relativeOffsetHours\":36,\"source\":\"authored_scenario\"}]'::jsonb from public.manual_mar_assignment_snapshots where assignment_id='40000000-0000-0000-0000-000000000002';")"
  [[ "$FULL_FROZEN" == 't' ]] || { echo "full frozen event equality failed: $FULL_FROZEN" >&2; exit 1; }
  echo 'rollback/stop: migration runner is ON_ERROR_STOP=1; no production target, no rollback applied.'
  echo 'PASS: exact disposable QA, NULL/preflight, SET ROLE allow/deny, sandbox invariant, and one immutable four-event snapshot/readback.'
} 2>&1 | tee "$OUT"
