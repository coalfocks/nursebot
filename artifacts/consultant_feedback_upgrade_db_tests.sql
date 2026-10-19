\set ON_ERROR_STOP on

-- Disposable contract fixture only. It models the prerequisite tables/columns
-- used by the reviewed consultant and Feedback Studio migrations; it never
-- connects to production and never contains clinical/QA records.
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create table if not exists public.profiles (
  id uuid primary key,
  role text,
  is_admin boolean default false
);
create table if not exists public.patients (id uuid primary key);
create table if not exists public.rooms (
  id bigint primary key,
  patient_id uuid references public.patients(id),
  school_id uuid
);
create table if not exists public.student_room_assignments (
  id uuid primary key,
  student_id uuid not null,
  room_id bigint not null references public.rooms(id)
);
create table if not exists public.case_blueprints (id bigint primary key);
create table if not exists public.feedback_assessment_runs (id uuid primary key default gen_random_uuid());
create table if not exists public.medical_orders (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid,
  assignment_id uuid,
  room_id bigint,
  school_id uuid,
  override_scope text,
  category text,
  order_name text,
  priority text,
  status text,
  ordered_by text,
  order_time timestamptz,
  instructions text,
  deleted_at timestamptz
);
create table if not exists public.consultant_requests (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.student_room_assignments(id),
  patient_id uuid,
  room_id bigint,
  specialty text not null,
  summary text not null,
  clinical_question text not null,
  reason text not null,
  urgency text not null default 'routine',
  client_request_id uuid not null,
  consult_order_id uuid,
  response text,
  disposition text not null default 'routine_review',
  status text not null default 'requested',
  created_at timestamptz not null default timezone('utc', now()),
  answered_at timestamptz
);
create table if not exists public.consultant_chat_messages (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.student_room_assignments(id),
  role text not null,
  content text not null,
  created_at timestamptz not null default timezone('utc', now()),
  request_id uuid,
  specialty text,
  urgency text,
  consult_order_id uuid
);

insert into auth.users values ('11111111-1111-4111-8111-111111111111') on conflict do nothing;
insert into public.profiles values ('11111111-1111-4111-8111-111111111111', 'super_admin', true) on conflict do nothing;
insert into public.patients values ('22222222-2222-4222-8222-222222222222') on conflict do nothing;
insert into public.rooms values (7001, '22222222-2222-4222-8222-222222222222', '44444444-4444-4444-8444-444444444444') on conflict do nothing;
insert into public.student_room_assignments values ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 7001) on conflict do nothing;

-- The caller applies, in order, the exact 3cf consultant migrations, then
-- 20261019073000, 20261019080000, and 20261019083000. This file is the
-- post-upgrade assertion phase.
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);

do $$
declare
  global_a uuid;
  global_b uuid;
  room_a uuid;
  room_b uuid;
  anchors jsonb := jsonb_build_object(
    'focused_information_gathering', jsonb_build_object('range', '0-2'),
    'closed_loop_team_communication', jsonb_build_object('range', '0-3'),
    'efficiency_deduction', jsonb_build_object('range', '-2-0'),
    'orders_monitoring_quality', jsonb_build_object('range', '0-3'),
    'clinical_reasoning_documentation', jsonb_build_object('range', '0-2'),
    'safety_deduction', jsonb_build_object('range', '0,-1,-2')
  );
begin
  select (public.create_feedback_evaluator_draft('global', null, 'global prompt', anchors)).id into global_a;
  select (public.create_feedback_evaluator_draft('global', null, 'second global prompt', anchors)).id into global_b;
  if (select count(*) from public.feedback_evaluator_configs where scope_identity = 'global' and version in (1, 2)) <> 2 then
    raise exception 'global version allocation failed';
  end if;

  update public.feedback_evaluator_configs set evaluator_prompt = 'tampered' where id = global_a;
  raise exception 'immutable evaluator update unexpectedly succeeded';
exception when sqlstate 'P0001' then
  if sqlerrm not like 'EVALUATOR_VERSION_IMMUTABLE:%' then raise; end if;
end $$;

do $$
begin
  insert into public.feedback_evaluator_configs(scope, version, status, evaluator_prompt, scoring_anchors)
  select 'global', 99, 'active', 'concurrent active', '{}'::jsonb;
  insert into public.feedback_evaluator_configs(scope, version, status, evaluator_prompt, scoring_anchors)
  select 'global', 100, 'active', 'second active', '{}'::jsonb;
  raise exception 'one-active-scope constraint unexpectedly allowed two active rows';
exception when unique_violation then null;
end $$;

select 'feedback evaluator upgrade constraints passed' as result;
