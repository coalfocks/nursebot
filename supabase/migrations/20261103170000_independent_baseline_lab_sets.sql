alter table public.lab_results
  add column if not exists baseline_set_id text;

create index if not exists lab_results_baseline_set_idx
  on public.lab_results (patient_id, baseline_set_id, collection_time)
  where override_scope = 'baseline' and deleted_at is null;
