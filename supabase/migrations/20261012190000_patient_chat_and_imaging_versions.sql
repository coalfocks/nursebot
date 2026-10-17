-- Patient conversation is a separate, assignment-scoped thread.  It must never
-- share the nurse chat table or expose evaluator-only context.
create table if not exists public.patient_chat_messages (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.student_room_assignments(id) on delete cascade,
  role text not null check (role in ('student', 'patient', 'caregiver')),
  content text not null check (length(trim(content)) > 0),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists patient_chat_messages_assignment_created_idx
  on public.patient_chat_messages(assignment_id, created_at);

alter table public.patient_chat_messages enable row level security;
drop policy if exists "patient chat owner can read" on public.patient_chat_messages;
create policy "patient chat owner can read" on public.patient_chat_messages for select
using (
  exists (select 1 from public.student_room_assignments a
    where a.id = patient_chat_messages.assignment_id and a.student_id = auth.uid())
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
);
drop policy if exists "patient chat owner can write" on public.patient_chat_messages;
create policy "patient chat owner can write" on public.patient_chat_messages for insert
with check (
  role = 'student' and exists (select 1 from public.student_room_assignments a
    where a.id = patient_chat_messages.assignment_id and a.student_id = auth.uid())
);

-- Keep original reports immutable while allowing an authorized author to create
-- a new report version or addendum.
alter table public.imaging_studies
  add column if not exists body_site text,
  add column if not exists laterality text,
  add column if not exists indication text,
  add column if not exists findings text,
  add column if not exists impression text,
  add column if not exists encounter_time timestamptz,
  add column if not exists record_version integer not null default 1;

create table if not exists public.imaging_study_versions (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.imaging_studies(id) on delete cascade,
  version integer not null,
  author_id uuid references auth.users(id) on delete set null,
  report text,
  body_site text,
  laterality text,
  contrast text,
  indication text,
  findings text,
  impression text,
  status text,
  encounter_time timestamptz,
  is_addendum boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  unique(study_id, version)
);

alter table public.imaging_study_versions enable row level security;
drop policy if exists "imaging versions authenticated read" on public.imaging_study_versions;
create policy "imaging versions authenticated read" on public.imaging_study_versions for select
using (auth.role() = 'authenticated');
drop policy if exists "imaging versions admin write" on public.imaging_study_versions;
create policy "imaging versions admin write" on public.imaging_study_versions for insert
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true));
