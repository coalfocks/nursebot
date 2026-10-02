-- Add optimistic-concurrency tokens to the two highest-risk immediate-edit EMR tables.
alter table public.clinical_notes
  add column if not exists record_version integer;

alter table public.medical_orders
  add column if not exists record_version integer;

update public.clinical_notes
set record_version = 1
where record_version is null;

update public.medical_orders
set record_version = 1
where record_version is null;

alter table public.clinical_notes
  alter column record_version set default 1,
  alter column record_version set not null;

alter table public.medical_orders
  alter column record_version set default 1,
  alter column record_version set not null;

create or replace function public.bump_emr_record_version()
returns trigger
language plpgsql
as $$
begin
  new.record_version = old.record_version + 1;
  return new;
end;
$$;

drop trigger if exists clinical_notes_bump_record_version on public.clinical_notes;
create trigger clinical_notes_bump_record_version
before update on public.clinical_notes
for each row execute function public.bump_emr_record_version();

drop trigger if exists medical_orders_bump_record_version on public.medical_orders;
create trigger medical_orders_bump_record_version
before update on public.medical_orders
for each row execute function public.bump_emr_record_version();

comment on column public.clinical_notes.record_version is
  'Monotonically increasing optimistic-concurrency token for note edits.';
comment on column public.medical_orders.record_version is
  'Monotonically increasing optimistic-concurrency token for order edits.';
