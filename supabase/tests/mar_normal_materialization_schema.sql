-- Minimal disposable PostgreSQL schema for the 100009..100017 runner.
-- This is not an application schema and is never suitable for production.
\set ON_ERROR_STOP on
create extension if not exists pgcrypto;
create schema if not exists auth;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create table public.auth_users_placeholder (id uuid primary key);
create table auth.users (id uuid primary key);
drop table public.auth_users_placeholder;
create table public.schools (id uuid primary key, name text not null);
create table public.patients (id uuid primary key, school_id uuid not null references public.schools(id), deleted_at timestamptz);
create table public.profiles (id uuid primary key references auth.users(id), role text, school_id uuid references public.schools(id));
create table public.rooms (
  id integer primary key,
  patient_id uuid not null references public.patients(id),
  school_id uuid not null references public.schools(id),
  available_school_ids uuid[]
);
create table public.student_room_assignments (
  id uuid primary key,
  student_id uuid not null references public.profiles(id),
  room_id integer not null references public.rooms(id),
  assigned_by uuid references auth.users(id),
  school_id uuid references public.schools(id),
  case_key_version text,
  scenario_baseline_version integer,
  status text,
  effective_date timestamptz,
  window_start timestamptz,
  window_end timestamptz
);
create table public.medical_orders (
  id uuid primary key,
  patient_id uuid not null references public.patients(id),
  room_id integer references public.rooms(id),
  assignment_id uuid references public.student_room_assignments(id),
  override_scope text,
  category text,
  order_name text,
  frequency text,
  route text,
  dose text,
  priority text,
  status text,
  ordered_by text,
  order_time timestamptz,
  scheduled_time timestamptz,
  instructions text,
  record_version integer default 1,
  deleted_at timestamptz
);
insert into public.schools(id, name) values
  ('00000000-0000-0000-0000-0000000000a1', 'North'),
  ('00000000-0000-0000-0000-0000000000a2', 'UofA'),
  ('00000000-0000-0000-0000-0000000000a3', 'Unlisted');
insert into auth.users(id) values
  ('00000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000003'),
  ('00000000-0000-0000-0000-000000000004');
insert into public.profiles(id, role, school_id) values
  ('00000000-0000-0000-0000-000000000002', 'school_admin', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-000000000001', 'learner', '00000000-0000-0000-0000-0000000000a2'),
  ('00000000-0000-0000-0000-000000000003', 'learner', '00000000-0000-0000-0000-0000000000a3'),
  ('00000000-0000-0000-0000-000000000004', 'school_admin', '00000000-0000-0000-0000-0000000000a3');
insert into public.patients(id, school_id) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1');
insert into public.rooms(id, patient_id, school_id, available_school_ids) values
  (1, '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', array['00000000-0000-0000-0000-0000000000a2']::uuid[]);
insert into public.medical_orders(id, patient_id, room_id, assignment_id, override_scope, category, order_name, frequency, route, dose, priority, status, ordered_by, order_time, record_version)
values ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 1, null, 'room', 'Medication', 'Disposable authored medication', 'q4h PRN', 'PO', '20 mg', 'Routine', 'Active', 'Scenario author', now(), 1);
grant select on public.schools, public.patients, public.profiles, public.rooms, public.student_room_assignments, public.medical_orders to authenticated;
