-- Enforce patient/room/assignment identity for EMR rows. Existing authored
-- rows are not rewritten; new writes must satisfy these invariants.

create or replace function public.emr_scope_is_valid(p_patient_id uuid, p_room_id integer, p_assignment_id uuid, p_override_scope text)
returns boolean language sql stable as $$
  select p_patient_id is not null
    and p_override_scope in ('baseline', 'room', 'assignment')
    and ((p_override_scope = 'baseline' and p_room_id is null and p_assignment_id is null)
      or (p_override_scope = 'room' and p_room_id is not null and p_assignment_id is null)
      or (p_override_scope = 'assignment' and p_room_id is not null and p_assignment_id is not null))
    and (p_room_id is null or exists (select 1 from public.rooms r where r.id = p_room_id and r.patient_id = p_patient_id))
    and (p_assignment_id is null or exists (
      select 1 from public.student_room_assignments a join public.rooms r on r.id = a.room_id
      where a.id = p_assignment_id and a.room_id = p_room_id and r.patient_id = p_patient_id
    ));
$$;

create or replace function public.validate_emr_scope_identity()
returns trigger language plpgsql as $$
begin
  if not public.emr_scope_is_valid(new.patient_id, new.room_id, new.assignment_id, new.override_scope) then
    raise exception 'Invalid EMR scope identity' using errcode = '23514';
  end if;
  if new.school_id is not null and not exists (select 1 from public.patients p where p.id = new.patient_id and p.school_id is not distinct from new.school_id) then
    raise exception 'EMR patient and school identities do not match' using errcode = '23514';
  end if;
  return new;
end;
$$;

do $$ declare t text; begin
  foreach t in array array['clinical_notes', 'lab_results', 'vital_signs', 'medical_orders', 'imaging_studies'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_validate_scope', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.validate_emr_scope_identity()', t || '_validate_scope', t);
  end loop;
end $$;

create or replace function public.emr_is_admin_for_school(p_school_id uuid)
returns boolean language sql stable security invoker as $$
  select auth.role() = 'service_role' or exists (
    select 1 from public.profiles p where p.id = auth.uid()
      and (p.role = 'super_admin' or (p.role = 'school_admin' and p.school_id is not distinct from p_school_id))
  );
$$;

do $$ declare t text; begin
  foreach t in array array['patients', 'clinical_notes', 'lab_results', 'vital_signs', 'medical_orders', 'imaging_studies'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "allow authenticated read" on public.%I', t);
    execute format('drop policy if exists "allow authenticated write" on public.%I', t);
    execute format('drop policy if exists "EMR admins manage school rows" on public.%I', t);
    execute format('create policy "EMR admins manage school rows" on public.%I for all to authenticated using (public.emr_is_admin_for_school(school_id)) with check (public.emr_is_admin_for_school(school_id))', t);
  end loop;
end $$;

create policy "EMR users read assigned patients" on public.patients for select to authenticated using (exists (
  select 1 from public.student_room_assignments a join public.rooms r on r.id = a.room_id
  where a.student_id = auth.uid() and r.patient_id = patients.id
));

do $$ declare t text; begin
  foreach t in array array['clinical_notes', 'lab_results', 'vital_signs', 'medical_orders', 'imaging_studies'] loop
    execute format('drop policy if exists "EMR users read assigned rows" on public.%I', t);
    execute format('create policy "EMR users read assigned rows" on public.%I for select to authenticated using (exists (select 1 from public.student_room_assignments a join public.rooms r on r.id = a.room_id where a.student_id = auth.uid() and ((%I.override_scope = ''baseline'' and r.patient_id = %I.patient_id) or (%I.override_scope = ''room'' and a.room_id = %I.room_id) or (%I.override_scope = ''assignment'' and a.id = %I.assignment_id))))', t, t, t, t, t, t, t);
    execute format('drop policy if exists "Learners write assignment rows" on public.%I', t);
    execute format('create policy "Learners write assignment rows" on public.%I for insert to authenticated with check (%I.override_scope = ''assignment'' and exists (select 1 from public.student_room_assignments a join public.rooms r on r.id = a.room_id where a.id = %I.assignment_id and a.student_id = auth.uid() and a.room_id = %I.room_id and r.patient_id = %I.patient_id))', t, t, t, t, t);
    execute format('drop policy if exists "Learners update assignment rows" on public.%I', t);
    execute format('create policy "Learners update assignment rows" on public.%I for update to authenticated using (%I.override_scope = ''assignment'' and exists (select 1 from public.student_room_assignments a where a.id = %I.assignment_id and a.student_id = auth.uid())) with check (%I.override_scope = ''assignment'' and exists (select 1 from public.student_room_assignments a join public.rooms r on r.id = a.room_id where a.id = %I.assignment_id and a.student_id = auth.uid() and a.room_id = %I.room_id and r.patient_id = %I.patient_id))', t, t, t, t, t, t, t);
    execute format('drop policy if exists "Learners delete assignment rows" on public.%I', t);
    execute format('create policy "Learners delete assignment rows" on public.%I for delete to authenticated using (%I.override_scope = ''assignment'' and exists (select 1 from public.student_room_assignments a where a.id = %I.assignment_id and a.student_id = auth.uid()))', t, t, t);
  end loop;
end $$;

comment on function public.emr_scope_is_valid(uuid, integer, uuid, text) is 'Ensures EMR patient, room, assignment, and override scope identify one encounter.';
