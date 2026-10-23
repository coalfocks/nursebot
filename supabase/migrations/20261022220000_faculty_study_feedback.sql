-- REVIEW ONLY / UNAPPLIED.
-- Faculty study results are deliberately isolated from learner assignments and grades.
create table if not exists public.faculty_study_batches (
  id uuid primary key default gen_random_uuid(),
  batch_key text not null unique,
  manifest jsonb not null,
  manifest_sha256 text not null,
  prompt_version text not null,
  prompt_sha256 text not null,
  model text not null,
  protocol_version text not null,
  generator_revision text not null,
  evaluator_config_revision text not null,
  attempt_attestations jsonb not null default '[]'::jsonb,
  status text not null default 'prepared' check (status in ('prepared', 'running', 'completed', 'failed')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  error jsonb
);

create table if not exists public.faculty_study_results (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.faculty_study_batches(id) on delete cascade,
  case_number integer not null check (case_number between 1 and 30),
  assignment_id uuid not null,
  historical_snapshot jsonb not null,
  result jsonb,
  error jsonb,
  generated_at timestamptz,
  prompt_version text not null,
  model text not null,
  created_at timestamptz not null default now(),
  unique (batch_id, case_number),
  unique (batch_id, assignment_id)
);

alter table public.faculty_study_batches enable row level security;
alter table public.faculty_study_results enable row level security;
revoke all on public.faculty_study_batches from anon, authenticated;
revoke all on public.faculty_study_results from anon, authenticated;

comment on table public.faculty_study_batches is 'Isolated, owner-reviewed faculty study manifests; never a learner or grading record.';
comment on table public.faculty_study_results is 'Deidentified study output and per-attempt errors; no assignment or grade writes.';
