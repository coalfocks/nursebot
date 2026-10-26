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

-- Make the read-only review flow useful immediately for completed attempts that
-- already have saved learner feedback. This copies data into an isolated review
-- record and never updates the learner assignment, grade, or feedback columns.
insert into public.faculty_evaluation_versions (
  assignment_id,
  version,
  status,
  prompt_version,
  model,
  generator_revision,
  evaluator_config_revision,
  created_at,
  completed_at,
  artifacts
)
select
  a.id,
  1,
  'completed',
  'legacy-assignment-feedback',
  'existing-saved-feedback',
  'migration-20261026215927',
  'legacy',
  coalesce(a.feedback_generated_at, a.completed_at, a.created_at, now()),
  coalesce(a.feedback_generated_at, a.completed_at, a.created_at, now()),
  jsonb_build_object(
    'json', to_jsonb(jsonb_build_object(
      'assignment_id', a.id,
      'version', 1,
      'saved_at', coalesce(a.feedback_generated_at, a.completed_at, a.created_at),
      'communication_score', a.communication_score,
      'mdm_score', a.mdm_score,
      'grade', a.grade,
      'learning_objectives', a.learning_objectives,
      'nurse_feedback', a.nurse_feedback,
      'communication_breakdown', a.communication_breakdown,
      'mdm_breakdown', a.mdm_breakdown
    )::text),
    'html', to_jsonb(format('<html><body><h1>Saved evaluation v1</h1><p>Assignment: %s</p><p>Saved: %s</p><pre>%s</pre></body></html>', a.id, coalesce(a.feedback_generated_at, a.completed_at, a.created_at), replace(coalesce(a.nurse_feedback, '{}'::jsonb)::text, '&', '&amp;'))),
    'csv', to_jsonb(('assignment_id,version,saved_at,communication_score,mdm_score,grade' || E'\n' || a.id::text || ',1,' || coalesce(a.feedback_generated_at, a.completed_at, a.created_at)::text || ',' || coalesce(a.communication_score::text, '') || ',' || coalesce(a.mdm_score::text, '') || ',' || coalesce(a.grade::text, ''))),
    'artifact_version', 'legacy-assignment-feedback-v1'
  )
from public.student_room_assignments a
where a.status = 'completed'
  and a.feedback_status = 'completed'
  and (a.nurse_feedback is not null or a.communication_score is not null or a.mdm_score is not null)
on conflict (assignment_id, version) do nothing;
