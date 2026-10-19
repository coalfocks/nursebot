create extension if not exists pgcrypto;

create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
do $$ begin
  create role authenticated;
exception when duplicate_object then null;
end $$;
do $$ begin
  create role service_role;
exception when duplicate_object then null;
end $$;

create table public.patients (
  id uuid primary key
);
create table public.rooms (
  id bigint primary key,
  patient_id uuid not null references public.patients(id),
  school_id uuid
);
create table public.profiles (
  id uuid primary key,
  is_admin boolean not null default false
);
create table public.student_room_assignments (
  id uuid primary key,
  student_id uuid not null,
  room_id bigint not null references public.rooms(id)
);
create table public.medical_orders (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid,
  assignment_id uuid,
  room_id bigint,
  school_id uuid,
  override_scope text,
  category text not null,
  order_name text not null,
  priority text,
  status text not null default 'Active',
  ordered_by text,
  order_time timestamptz not null default timezone('utc', now()),
  instructions text,
  deleted_at timestamptz
);
create table public.consultant_chat_messages (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.student_room_assignments(id) on delete cascade,
  role text not null check (role in ('student', 'consultant')),
  content text not null check (length(trim(content)) > 0),
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.medical_orders enable row level security;
alter table public.patients enable row level security;
alter table public.rooms enable row level security;
alter table public.student_room_assignments enable row level security;
alter table public.profiles enable row level security;
