create table if not exists public.learner_action_events (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.student_room_assignments(id) on delete cascade,
  room_id bigint references public.rooms(id) on delete cascade,
  action_type text not null check (action_type in ('bedside_finding', 'patient_interaction', 'team_escalation', 'clinical_action')),
  channel text not null check (channel in ('bedside', 'patient', 'team', 'chart')),
  content text not null check (length(trim(content)) > 0),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create index if not exists learner_action_events_assignment_time_idx
  on public.learner_action_events (assignment_id, occurred_at);

alter table public.learner_action_events enable row level security;

grant select, insert on public.learner_action_events to authenticated;

create policy "learners can read own action events"
  on public.learner_action_events for select
  using (exists (
    select 1 from public.student_room_assignments a
    where a.id = learner_action_events.assignment_id and a.student_id = auth.uid()
  ));

create policy "learners can create own action events"
  on public.learner_action_events for insert
  with check (exists (
    select 1 from public.student_room_assignments a
    where a.id = learner_action_events.assignment_id and a.student_id = auth.uid()
  ));

create policy "admins can read scoped action events"
  on public.learner_action_events for select
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('school_admin', 'super_admin')
  ));

comment on table public.learner_action_events is
  'Explicit learner-authored bedside/patient/team/chart actions used as feedback evidence; vitals and orders are never implicitly communication evidence.';
