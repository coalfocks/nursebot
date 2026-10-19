-- Completed student attempts are read-only at the database boundary. Educator
-- roles retain audit/edit access; UI hiding is only a usability layer.
create or replace function public.guard_completed_assignment_emr_write()
returns trigger language plpgsql security invoker set search_path = public as $$
declare
  old_assignment uuid;
  new_assignment uuid;
  target_assignment uuid;
  assignment_status text;
  actor_role text;
  actor_id uuid;
  service_finalization boolean := current_setting('app.emr_finalization', true) = '1'
    and current_setting('request.jwt.claim.role', true) = 'service_role';
begin
  old_assignment := nullif(to_jsonb(old)->>'assignment_id', '')::uuid;
  new_assignment := nullif(to_jsonb(new)->>'assignment_id', '')::uuid;
  actor_id := auth.uid();
  select role into actor_role from public.profiles where id = actor_id;

  -- Educators retain audit/edit access. A service-role caller must opt into a
  -- transaction-local, pre-completion finalization context; NULL auth never
  -- bypasses the guard by accident.
  if actor_role in ('super_admin', 'school_admin') then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  -- Check both sides of UPDATE. This prevents moving a row out of a completed
  -- assignment to evade the completed-record boundary.
  -- Lock every affected assignment in UUID order before reading status. This
  -- serializes writes against the authoritative completion transition and
  -- avoids cross-assignment deadlocks when an UPDATE changes provenance.
  for target_assignment in
    select assignment_id
      from unnest(array[old_assignment, new_assignment]) as assignment_id
     where assignment_id is not null
     group by assignment_id
     order by assignment_id
  loop
    select status into assignment_status
      from public.student_room_assignments
      where id = target_assignment
      for update;
    if assignment_status is null or assignment_status not in ('assigned', 'in_progress', 'bedside', 'completed') then
      raise exception 'ASSIGNMENT_WRITE_NOT_AUTHORIZED'
        using errcode = '42501', detail = 'Assignment status is missing or unknown; learner EMR writes fail closed.';
    end if;
    if assignment_status = 'completed' then
      raise exception 'COMPLETED_ASSIGNMENT_READ_ONLY'
        using errcode = '42501', detail = 'Student EMR writes are disabled after assignment completion.';
    end if;
  end loop;

  if service_finalization then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if actor_id is null then
    raise exception 'ASSIGNMENT_WRITE_NOT_AUTHORIZED'
      using errcode = '42501', detail = 'EMR writes require an authenticated learner, educator, or explicit pre-completion finalization context.';
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array['medical_orders','lab_results','clinical_notes','vital_signs','imaging_studies'] loop
    execute format('drop trigger if exists guard_completed_assignment_%I on public.%I', table_name, table_name);
    execute format('create trigger guard_completed_assignment_%I before insert or update or delete on public.%I for each row execute function public.guard_completed_assignment_emr_write()', table_name, table_name);
  end loop;
end $$;

comment on function public.guard_completed_assignment_emr_write() is
  'Prevents non-educator writes to assignment-scoped EMR records after completion.';
