-- Preserve the existing numeric value column while adding explicit support for
-- coded, narrative, and lifecycle-aware laboratory results.
alter table public.lab_results
  add column if not exists value_type text not null default 'numeric',
  add column if not exists text_value text,
  add column if not exists narrative text,
  add column if not exists interpretation text,
  add column if not exists abnormal_flag boolean,
  add column if not exists specimen text,
  add column if not exists lifecycle_status text not null default 'resulted';

update public.lab_results
set value_type = case
  when value is not null then 'numeric'
  when text_value is not null then 'coded'
  else coalesce(value_type, 'numeric')
end
where value_type is null or value_type not in ('numeric', 'coded', 'narrative');

alter table public.lab_results
  add constraint lab_results_value_type_check
    check (value_type in ('numeric', 'coded', 'narrative')),
  add constraint lab_results_lifecycle_status_check
    check (lifecycle_status in ('not_ordered', 'ordered', 'collected', 'pending', 'resulted', 'corrected', 'canceled', 'rejected'));

comment on column public.lab_results.value_type is
  'Identifies whether the result is numeric, coded/text, or narrative.';
comment on column public.lab_results.lifecycle_status is
  'Explicit result lifecycle; status remains the clinical interpretation (normal/abnormal/etc.).';
