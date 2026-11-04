alter table public.lab_results
  add column if not exists relative_label text;

comment on column public.lab_results.relative_label is
  'Optional authored learner-facing label for a baseline lab set; does not alter values or timestamps.';
