-- Standalone storage prerequisite for faculty-feedback-review's read-only paths.
-- Evaluation generation remains a separate workflow and is intentionally not added here.
create table if not exists public.faculty_evaluation_versions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.student_room_assignments (id) on delete cascade,
  version integer not null check (version > 0),
  status text not null,
  prompt_version text,
  model text,
  generator_revision text,
  evaluator_config_revision text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  error text,
  artifacts jsonb,
  constraint faculty_evaluation_versions_assignment_version_key unique (assignment_id, version)
);

create index if not exists faculty_evaluation_versions_assignment_id_idx
  on public.faculty_evaluation_versions (assignment_id, version desc);

alter table public.faculty_evaluation_versions enable row level security;
alter table public.faculty_evaluation_versions force row level security;

-- No client-facing policy is intentional: anon/authenticated access must fail closed.
revoke all on table public.faculty_evaluation_versions from anon, authenticated;

comment on table public.faculty_evaluation_versions is
  'Persisted faculty evaluation versions and downloadable artifacts; written by the separate evaluation-generation workflow.';
