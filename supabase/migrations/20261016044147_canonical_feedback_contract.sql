-- Pin the canonical feedback contract independently from legacy rubric fields.
alter table public.student_room_assignments
  add column if not exists feedback_schema_version text;

alter table public.feedback_assessment_runs
  add column if not exists feedback_schema_version text;

comment on column public.student_room_assignments.feedback_schema_version is
  'Version of the canonical feedback payload pinned to this attempt.';
comment on column public.feedback_assessment_runs.feedback_schema_version is
  'Version of the canonical feedback payload produced by this assessment run.';
