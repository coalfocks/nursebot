-- Minimal disposable MAR fixture.
-- This is deliberately not a production schema or a replay of the historical
-- migration chain. It contains only the relations/columns required by the
-- reviewed 20261029170000/173000 contracts.

create extension if not exists pgcrypto;
create schema if not exists auth;
create table auth.users (id uuid primary key);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create table public.schools (id uuid primary key);
create table public.profiles (
  id uuid primary key references auth.users(id),
  role text not null,
  school_id uuid references public.schools(id)
);
create table public.patients (id uuid primary key, name text not null);
create table public.rooms (
  id integer primary key,
  room_number text not null,
  patient_id uuid not null references public.patients(id),
  school_id uuid not null references public.schools(id),
  available_school_ids uuid[] not null default '{}'
);
create table public.student_room_assignments (
  id uuid primary key,
  student_id uuid not null references auth.users(id),
  room_id integer not null references public.rooms(id),
  assigned_by uuid not null references auth.users(id),
  status text not null,
  effective_date timestamptz,
  window_start timestamptz,
  window_end timestamptz,
  is_sandbox boolean not null default false,
  school_id uuid not null references public.schools(id),
  case_key_version text,
  scenario_baseline_version integer
);

create table public.manual_mar_packets (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id),
  room_id integer not null references public.rooms(id),
  case_version text not null,
  revision integer not null,
  events jsonb not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.manual_mar_assignment_snapshots (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null unique references public.student_room_assignments(id),
  source_packet_id uuid,
  patient_id uuid not null references public.patients(id),
  room_id integer not null references public.rooms(id),
  case_version text not null,
  packet_revision integer not null,
  events jsonb not null,
  content_hash text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create table public.mar_authored_case_versions (
  room_id integer not null references public.rooms(id),
  patient_id uuid not null references public.patients(id),
  school_id uuid not null references public.schools(id),
  case_version text not null,
  order_snapshot jsonb not null,
  event_snapshot jsonb not null,
  content_hash text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (room_id, case_version)
);
create table public.mar_assignment_baseline_versions (
  assignment_id uuid not null references public.student_room_assignments(id),
  case_version text not null,
  patient_id uuid not null references public.patients(id),
  room_id integer not null references public.rooms(id),
  event_snapshot jsonb not null,
  content_hash text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (assignment_id, case_version)
);

create or replace function public.mar_effective_school_allowed(
  p_primary_school uuid, p_available_schools uuid[], p_school uuid
) returns boolean language sql immutable as $$
  select p_school is not null and (
    p_primary_school = p_school or p_available_schools is null
    or cardinality(p_available_schools) = 0 or p_school = any(p_available_schools)
  )
$$;

create or replace function public.manual_mar_snapshot_new_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
declare packet public.manual_mar_packets%rowtype; patient uuid;
begin
  select patient_id into patient from public.rooms where id = new.room_id;
  select * into packet from public.manual_mar_packets
   where patient_id = patient and room_id = new.room_id and case_version = new.case_key_version;
  if not found then return new; end if;
  insert into public.manual_mar_assignment_snapshots(
    assignment_id, source_packet_id, patient_id, room_id, case_version,
    packet_revision, events, content_hash, created_by
  ) values (
    new.id, packet.id, patient, new.room_id, new.case_key_version,
    packet.revision, packet.events,
    md5(packet.patient_id::text || '|' || packet.room_id::text || '|' || packet.case_version || '|' || packet.revision::text || '|' || packet.events::text),
    packet.created_by
  );
  return new;
end;
$$;
create trigger manual_mar_snapshot_assignment_insert
after insert on public.student_room_assignments
for each row execute function public.manual_mar_snapshot_new_assignment();

create or replace function public.get_manual_mar_packet(
  p_patient_id uuid, p_room_id integer, p_assignment_id uuid, p_case_version text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare actor uuid := auth.uid(); role_name text; packet public.manual_mar_packets%rowtype; snapshot public.manual_mar_assignment_snapshots%rowtype;
begin
  select role into role_name from public.profiles where id = actor;
  if p_assignment_id is null then
    if role_name not in ('school_admin', 'super_admin') then raise exception 'MANUAL_MAR_ADMIN_REQUIRED'; end if;
    select * into packet from public.manual_mar_packets where patient_id = p_patient_id and room_id = p_room_id and case_version = p_case_version;
    if not found then return null; end if;
    return jsonb_build_object('id', packet.id, 'patientId', packet.patient_id, 'roomId', packet.room_id, 'caseVersion', packet.case_version, 'revision', packet.revision, 'events', packet.events);
  end if;
  select * into snapshot from public.manual_mar_assignment_snapshots where assignment_id = p_assignment_id;
  if not found then return null; end if;
  return jsonb_build_object('id', snapshot.id, 'patientId', snapshot.patient_id, 'roomId', snapshot.room_id, 'caseVersion', snapshot.case_version, 'revision', snapshot.packet_revision, 'events', snapshot.events);
end;
$$;

insert into public.schools values ('00000000-0000-0000-0000-000000000001');
insert into auth.users values
  ('00000000-0000-0000-0000-000000000101'),
  ('00000000-0000-0000-0000-000000000102'),
  ('00000000-0000-0000-0000-000000000103'),
  ('00000000-0000-0000-0000-000000000104');
insert into public.profiles values
  ('00000000-0000-0000-0000-000000000101', 'super_admin', null),
  ('00000000-0000-0000-0000-000000000102', 'school_admin', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000103', 'test_user', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000104', 'student', '00000000-0000-0000-0000-000000000001');
insert into public.patients values
  ('00000000-0000-0000-0000-000000001204', 'Synthetic 204'),
  ('00000000-0000-0000-0000-000000001020', 'Synthetic ED20'),
  ('00000000-0000-0000-0000-000000001304', 'Synthetic 304');
insert into public.rooms values
  (204, '204', '00000000-0000-0000-0000-000000001204', '00000000-0000-0000-0000-000000000001', '{}'),
  (20, 'ED 20', '00000000-0000-0000-0000-000000001020', '00000000-0000-0000-0000-000000000001', '{}'),
  (304, '304', '00000000-0000-0000-0000-000000001304', '00000000-0000-0000-0000-000000000001', '{}');

insert into public.manual_mar_packets(patient_id, room_id, case_version, revision, events, created_by)
select r.patient_id, r.id, 'accepted-manual-v1', 1,
  (select jsonb_agg(jsonb_build_object(
    'occurrenceKey', format('event-%s', n), 'relativeOffsetHours', n,
    'administeredAt', '2026-10-29T17:00:00Z', 'medicationName', format('Synthetic medication %s', n),
    'orderedDose', '10 mg', 'administeredDose', case when n % 3 = 0 then null else '10 mg' end,
    'unit', 'mg', 'route', 'PO', 'frequency', 'q4h', 'category', 'scheduled',
    'status', case when n % 3 = 0 then 'Held' when n % 2 = 0 then 'Not documented' else 'Given' end,
    'reason', case when n % 3 = 0 then 'Held for synthetic safety check' else null end,
    'source', 'authored_scenario', 'actorLabel', 'Synthetic clinician'
  ) order by n)
  from generate_series(1, case r.id when 204 then 7 when 20 then 8 else 4 end) n),
  '00000000-0000-0000-0000-000000000102'
from public.rooms r;
