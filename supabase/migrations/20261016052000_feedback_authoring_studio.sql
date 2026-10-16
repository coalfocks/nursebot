-- Additive authoring model. These tables are intentionally independent from
-- the EMR isolation migration and can be applied before or after it.
alter table public.rooms
  add column if not exists consultant_specialties text[] not null default '{}',
  add column if not exists consultant_expected_disposition text,
  add column if not exists consultant_urgent_exceptions text,
  add column if not exists feedback_config_version text;

alter table public.case_blueprints
  add column if not exists target_diagnosis text,
  add column if not exists consultant_specialties text[] not null default '{}',
  add column if not exists consultant_expected_disposition text,
  add column if not exists consultant_urgent_exceptions text,
  add column if not exists feedback_config_version text;

create table if not exists public.feedback_studio_configs (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  instructions text not null default '',
  style text not null default 'concise',
  max_strengths integer not null default 3 check (max_strengths between 1 and 5),
  max_next_steps integer not null default 3 check (max_next_steps between 1 and 5),
  communication_anchors jsonb not null default '{}'::jsonb,
  clinical_reasoning_anchors jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists feedback_studio_one_published
  on public.feedback_studio_configs(status) where status = 'published';

create table if not exists public.room_feedback_overrides (
  room_id bigint primary key references public.rooms(id) on delete cascade,
  config_version text not null,
  target_diagnosis text,
  goals text[] not null default '{}',
  consultant_specialties text[] not null default '{}',
  consultant_prompt text,
  consultant_expected_disposition text,
  consultant_urgent_exceptions text,
  rubric_override jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.feedback_studio_audit (
  id uuid primary key default gen_random_uuid(),
  config_id uuid references public.feedback_studio_configs(id) on delete set null,
  room_id bigint references public.rooms(id) on delete set null,
  action text not null check (action in ('draft_saved', 'published', 'rolled_back', 'room_override_saved')),
  before_value jsonb,
  after_value jsonb,
  actor_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.feedback_studio_configs enable row level security;
alter table public.room_feedback_overrides enable row level security;
alter table public.feedback_studio_audit enable row level security;

create policy "Admins read feedback studio configs" on public.feedback_studio_configs for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('school_admin', 'super_admin')));
create policy "Super admins write feedback studio configs" on public.feedback_studio_configs for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin'));

create policy "Admins read room feedback overrides" on public.room_feedback_overrides for select to authenticated
  using (exists (select 1 from public.profiles p join public.rooms r on r.school_id = p.school_id or p.role = 'super_admin' where p.id = auth.uid() and p.role in ('school_admin', 'super_admin') and r.id = room_id));
create policy "Admins write room feedback overrides" on public.room_feedback_overrides for all to authenticated
  using (exists (select 1 from public.profiles p join public.rooms r on r.school_id = p.school_id or p.role = 'super_admin' where p.id = auth.uid() and p.role in ('school_admin', 'super_admin') and r.id = room_id))
  with check (exists (select 1 from public.profiles p join public.rooms r on r.school_id = p.school_id or p.role = 'super_admin' where p.id = auth.uid() and p.role in ('school_admin', 'super_admin') and r.id = room_id));

create policy "Admins read feedback studio audit" on public.feedback_studio_audit for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('school_admin', 'super_admin')));
create policy "Admins append feedback studio audit" on public.feedback_studio_audit for insert to authenticated
  with check (actor_id = auth.uid() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('school_admin', 'super_admin')));

comment on table public.feedback_studio_configs is 'Versioned, role-protected global feedback instructions and rubric anchors.';
comment on table public.room_feedback_overrides is 'Room-authored diagnosis, goals, consultant behavior, and rubric overrides.';
