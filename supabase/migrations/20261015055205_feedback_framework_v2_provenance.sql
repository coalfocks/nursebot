-- Additive feedback v2 provenance. Existing attempts and scoring columns remain intact.
alter table public.student_room_assignments
  add column if not exists scoring_start_at timestamptz,
  add column if not exists rubric_version text,
  add column if not exists case_key_version text,
  add column if not exists assessment_version text,
  add column if not exists source_event_ids jsonb not null default '[]'::jsonb,
  add column if not exists technical_incomplete boolean not null default false,
  add column if not exists safety_result jsonb,
  add column if not exists feedback_debrief jsonb;

comment on column public.student_room_assignments.scoring_start_at is 'First nurse page delivered for this attempt; only learner events at/after this boundary are scored.';
comment on column public.student_room_assignments.source_event_ids is 'Event IDs used as evidence for the latest formative assessment.';
comment on column public.student_room_assignments.technical_incomplete is 'True when no first nurse page was recorded; no learner score is assigned.';

create table if not exists public.feedback_assessment_runs (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.student_room_assignments(id) on delete cascade,
  attempt_id uuid not null,
  rubric_version text not null,
  case_key_version text not null,
  assessment_version text not null,
  scoring_start_at timestamptz,
  source_event_ids jsonb not null default '[]'::jsonb,
  technical_incomplete boolean not null default false,
  result jsonb,
  created_at timestamptz not null default now()
);

create index if not exists feedback_assessment_runs_assignment_idx on public.feedback_assessment_runs(assignment_id, created_at desc);
alter table public.feedback_assessment_runs enable row level security;

drop policy if exists "Students can read their feedback assessment runs" on public.feedback_assessment_runs;
create policy "Students can read their feedback assessment runs"
  on public.feedback_assessment_runs for select to authenticated
  using (exists (select 1 from public.student_room_assignments a where a.id = assignment_id and a.student_id = auth.uid()));

drop policy if exists "Admins can read school feedback assessment runs" on public.feedback_assessment_runs;
create policy "Admins can read school feedback assessment runs"
  on public.feedback_assessment_runs for select to authenticated
  using (exists (
    select 1 from public.student_room_assignments a
    join public.rooms r on r.id = a.room_id
    where a.id = assignment_id
      and exists (select 1 from public.profiles p where p.id = auth.uid() and (p.role = 'super_admin' or (p.role = 'school_admin' and p.school_id = r.school_id)))
  ));
