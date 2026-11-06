alter table public.lab_results
  add column if not exists baseline_relative_offset_hours numeric(6,2);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.lab_results'::regclass
      and conname = 'lab_results_baseline_relative_offset_hours_check'
  ) then
    alter table public.lab_results
      add constraint lab_results_baseline_relative_offset_hours_check
      check (
        baseline_relative_offset_hours is null
        or (baseline_relative_offset_hours >= 0 and baseline_relative_offset_hours <= 720)
      );
  end if;
end $$;

comment on column public.lab_results.baseline_relative_offset_hours is
  'Admin-authored learner-facing prior offset for the entire baseline_set_id; NULL preserves legacy provenance without guessing.';
