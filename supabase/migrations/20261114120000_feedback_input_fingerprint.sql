-- Saved-score reuse: identical frozen inputs (evidence, coverage, case key,
-- rubric/assessment versions, model, prompt/config) share a fingerprint.
alter table public.feedback_assessment_runs add column if not exists input_fingerprint text;

create index if not exists feedback_assessment_runs_fingerprint_idx
  on public.feedback_assessment_runs (input_fingerprint, created_at desc)
  where input_fingerprint is not null;
