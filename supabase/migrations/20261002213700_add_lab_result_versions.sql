alter table public.lab_results
  add column if not exists record_version integer;

update public.lab_results
set record_version = 1
where record_version is null;

alter table public.lab_results
  alter column record_version set default 1,
  alter column record_version set not null;

create or replace function public.bump_lab_result_version()
returns trigger
language plpgsql
as $$
begin
  new.record_version = old.record_version + 1;
  return new;
end;
$$;

drop trigger if exists lab_results_bump_record_version on public.lab_results;
create trigger lab_results_bump_record_version
before update on public.lab_results
for each row execute function public.bump_lab_result_version();

comment on column public.lab_results.record_version is
  'Monotonically increasing optimistic-concurrency token for lab corrections.';
