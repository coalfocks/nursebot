-- Completed student attempts are read-only at the database boundary. Educator
-- roles retain audit/edit access; UI hiding is only a usability layer.
create or replace function public.guard_completed_assignment_emr_write()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  target_assignment uuid;
  assignment_status text;
  actor_role text;
begin
  if tg_op = 'DELETE' then
    target_assignment := nullif(to_jsonb(old)->>'assignment_id', '')::uuid;
  else
    target_assignment := nullif(to_jsonb(new)->>'assignment_id', '')::uuid;
  end if;

  if target_assignment is null or auth.uid() is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  select status into assignment_status
  from public.student_room_assignments
  where id = target_assignment;

  if assignment_status <> 'completed' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  select role into actor_role from public.profiles where id = auth.uid();
  if actor_role in ('super_admin', 'school_admin') then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  raise exception 'COMPLETED_ASSIGNMENT_READ_ONLY'
    using errcode = '42501',
          detail = 'Student EMR writes are disabled after assignment completion.';
end;
$$;

drop trigger if exists guard_completed_assignment_medical_orders on public.medical_orders;
create trigger guard_completed_assignment_medical_orders
before insert or update or delete on public.medical_orders
for each row execute function public.guard_completed_assignment_emr_write();

drop trigger if exists guard_completed_assignment_lab_results on public.lab_results;
create trigger guard_completed_assignment_lab_results
before insert or update or delete on public.lab_results
for each row execute function public.guard_completed_assignment_emr_write();

drop trigger if exists guard_completed_assignment_clinical_notes on public.clinical_notes;
create trigger guard_completed_assignment_clinical_notes
before insert or update or delete on public.clinical_notes
for each row execute function public.guard_completed_assignment_emr_write();

drop trigger if exists guard_completed_assignment_vital_signs on public.vital_signs;
create trigger guard_completed_assignment_vital_signs
before insert or update or delete on public.vital_signs
for each row execute function public.guard_completed_assignment_emr_write();

drop trigger if exists guard_completed_assignment_imaging_studies on public.imaging_studies;
create trigger guard_completed_assignment_imaging_studies
before insert or update or delete on public.imaging_studies
for each row execute function public.guard_completed_assignment_emr_write();

comment on function public.guard_completed_assignment_emr_write() is
  'Prevents non-educator writes to assignment-scoped EMR records after completion.';
