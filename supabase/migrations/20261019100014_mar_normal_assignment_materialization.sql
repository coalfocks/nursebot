-- Append-only normal-path dependency for MAR. Apply only after 100009 ->
-- 100010 -> 100011 -> 100012 -> 100013. This creates a new immutable case
-- version from the authored room Orders/MAR baseline and materializes it into
-- one new assignment in the same transaction. It never repairs old attempts.

create table if not exists public.mar_authored_case_versions (
  room_id integer not null references public.rooms(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  case_version text not null,
  order_snapshot jsonb not null,
  event_snapshot jsonb not null,
  content_hash text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (room_id, case_version),
  constraint mar_authored_case_version_arrays check (
    jsonb_typeof(order_snapshot) = 'array' and jsonb_typeof(event_snapshot) = 'array'
  )
);

create table if not exists public.mar_assignment_materialization_operations (
  request_id uuid primary key,
  assignment_id uuid not null unique references public.student_room_assignments(id) on delete cascade,
  room_id integer not null references public.rooms(id) on delete cascade,
  case_version text not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  result jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.mar_authored_case_versions enable row level security;
alter table public.mar_assignment_materialization_operations enable row level security;
revoke all on public.mar_authored_case_versions, public.mar_assignment_materialization_operations from authenticated;
grant select on public.mar_authored_case_versions, public.mar_assignment_materialization_operations to authenticated;

create policy "MAR authored version scoped read" on public.mar_authored_case_versions
for select to authenticated using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and (
      p.role = 'super_admin' or (p.role = 'school_admin' and p.school_id = mar_authored_case_versions.school_id)
    )
  )
);

create policy "MAR materialization operation scoped read" on public.mar_assignment_materialization_operations
for select to authenticated using (
  actor_id = auth.uid()
  or exists (
    select 1 from public.profiles p join public.rooms r on r.id = mar_assignment_materialization_operations.room_id
    where p.id = auth.uid() and (p.role = 'super_admin' or (p.role = 'school_admin' and p.school_id = r.school_id))
  )
);

create or replace function public.create_assignment_with_mar_materialization(
  p_request_id uuid,
  p_assignment_id uuid,
  p_student_id uuid,
  p_room_id integer,
  p_school_id uuid,
  p_case_version text,
  p_effective_date timestamptz,
  p_window_start timestamptz,
  p_window_end timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  actor_role text;
  room_patient uuid;
  room_school uuid;
  student_school uuid;
  order_snapshot jsonb;
  event_snapshot jsonb;
  content_hash text;
  prior public.mar_assignment_materialization_operations%rowtype;
  result jsonb;
begin
  if actor is null then raise exception 'MAR_AUTH_REQUIRED'; end if;
  select p.role into actor_role from public.profiles p where p.id = actor;
  if actor_role not in ('school_admin', 'super_admin') then raise exception 'MAR_ADMIN_REQUIRED'; end if;
  if p_request_id is null or p_assignment_id is null or p_room_id is null or p_student_id is null
     or p_school_id is null or p_case_version is null or btrim(p_case_version) = '' then
    raise exception 'MAR_MATERIALIZATION_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtext('mar-materialize:' || p_request_id::text));
  select * into prior from public.mar_assignment_materialization_operations where request_id = p_request_id for update;
  if found then
    if prior.assignment_id <> p_assignment_id or prior.room_id <> p_room_id or prior.case_version <> p_case_version or prior.actor_id <> actor then
      raise exception 'MAR_MATERIALIZATION_RETRY_MISMATCH';
    end if;
    return prior.result;
  end if;

  select r.patient_id, r.school_id into room_patient, room_school from public.rooms r where r.id = p_room_id for share;
  if room_patient is null then raise exception 'MAR_ROOM_NOT_FOUND'; end if;
  if room_school <> p_school_id then raise exception 'MAR_ROOM_SCHOOL_MISMATCH'; end if;
  if actor_role <> 'super_admin' and not exists (select 1 from public.profiles p where p.id = actor and p.school_id = room_school) then
    raise exception 'MAR_SCHOOL_SCOPE_MISMATCH';
  end if;
  select p.school_id into student_school from public.profiles p where p.id = p_student_id;
  if student_school is null or student_school <> room_school then
    raise exception 'MAR_STUDENT_SCHOOL_MISMATCH';
  end if;

  select coalesce(jsonb_agg(to_jsonb(o) order by o.id), '[]'::jsonb)
    into order_snapshot
  from public.medical_orders o
  where o.room_id = p_room_id and o.patient_id = room_patient and o.assignment_id is null and o.category = 'Medication' and o.deleted_at is null;
  select coalesce(jsonb_agg(to_jsonb(e) order by e.relative_offset_hours desc nulls last, e.occurrence_key), '[]'::jsonb)
    into event_snapshot
  from public.mar_administration_events e
  where e.room_id = p_room_id and e.patient_id = room_patient and e.assignment_id is null and e.deleted_at is null;
  content_hash := encode(digest(convert_to(order_snapshot::text || ':' || event_snapshot::text || ':' || p_case_version, 'utf8'), 'sha256'), 'hex');

  insert into public.mar_authored_case_versions(room_id, patient_id, school_id, case_version, order_snapshot, event_snapshot, content_hash, created_by)
  values (p_room_id, room_patient, room_school, p_case_version, order_snapshot, event_snapshot, content_hash, actor)
  on conflict (room_id, case_version) do nothing;
  if exists (select 1 from public.mar_authored_case_versions v where v.room_id = p_room_id and v.case_version = p_case_version and v.content_hash <> content_hash) then
    raise exception 'MAR_AUTHORED_VERSION_IMMUTABLE';
  end if;

  insert into public.student_room_assignments(id, student_id, room_id, assigned_by, status, effective_date, window_start, window_end, school_id, case_key_version)
  values (p_assignment_id, p_student_id, p_room_id, actor, 'assigned', p_effective_date, p_window_start, p_window_end, room_school, p_case_version)
  on conflict (id) do nothing;
  if not exists (select 1 from public.student_room_assignments a where a.id = p_assignment_id and a.student_id = p_student_id and a.room_id = p_room_id and a.case_key_version = p_case_version) then
    raise exception 'MAR_ASSIGNMENT_IDENTITY_MISMATCH';
  end if;

  insert into public.mar_assignment_baseline_versions(assignment_id, case_version, patient_id, room_id, event_snapshot, content_hash, created_by)
  values (p_assignment_id, p_case_version, room_patient, p_room_id, event_snapshot, encode(digest(convert_to(event_snapshot::text || ':' || p_case_version, 'utf8'), 'sha256'), 'hex'), actor)
  on conflict (assignment_id, case_version) do nothing;
  insert into public.mar_administration_events(
    id, patient_id, room_id, assignment_id, order_id, case_version, occurrence_key, relative_offset_hours, administered_at,
    medication_name, ordered_dose, administered_dose, unit, route, frequency, category, status, simulated_clinician, reason,
    prn_indication, response, infusion_details, source, actor_id, actor_label, record_version
  )
  select gen_random_uuid(), room_patient, p_room_id, p_assignment_id,
    nullif(value->>'order_id','')::uuid, p_case_version, value->>'occurrence_key', nullif(value->>'relative_offset_hours','')::numeric,
    nullif(value->>'administered_at','')::timestamptz, value->>'medication_name', value->>'ordered_dose', value->>'administered_dose',
    value->>'unit', value->>'route', value->>'frequency', coalesce(value->>'category','scheduled'), coalesce(value->>'status','Not documented'),
    value->>'simulated_clinician', value->>'reason', value->>'prn_indication', value->>'response', value->'infusion_details',
    coalesce(value->>'source','authored_scenario'), actor, value->>'actor_label', 1
  from jsonb_array_elements(event_snapshot) value
  on conflict (patient_id, coalesce(room_id, 0), coalesce(assignment_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(order_id, '00000000-0000-0000-0000-000000000000'::uuid), case_version, occurrence_key) where deleted_at is null do nothing;

  result := jsonb_build_object('assignmentId', p_assignment_id, 'caseVersion', p_case_version, 'orderCount', jsonb_array_length(order_snapshot), 'eventCount', jsonb_array_length(event_snapshot));
  insert into public.mar_assignment_materialization_operations(request_id, assignment_id, room_id, case_version, actor_id, result)
  values (p_request_id, p_assignment_id, p_room_id, p_case_version, actor, result);
  return result;
end;
$$;

revoke all on function public.create_assignment_with_mar_materialization(uuid, uuid, uuid, integer, uuid, text, timestamptz, timestamptz, timestamptz) from public, anon;
grant execute on function public.create_assignment_with_mar_materialization(uuid, uuid, uuid, integer, uuid, text, timestamptz, timestamptz, timestamptz) to authenticated;

create or replace function public.get_mar_normal_materialization_readiness()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ready boolean;
begin
  ready := to_regclass('public.mar_authored_case_versions') is not null
    and to_regclass('public.mar_assignment_materialization_operations') is not null
    and to_regprocedure('public.create_assignment_with_mar_materialization(uuid,uuid,uuid,integer,uuid,text,timestamptz,timestamptz,timestamptz)') is not null
    and to_regclass('public.mar_assignment_baseline_versions') is not null
    and to_regclass('public.mar_administration_events') is not null;
  return jsonb_build_object('ready', ready, 'materializationVersion', case when ready then 1 else 0 end, 'atomic', ready);
end;
$$;
revoke all on function public.get_mar_normal_materialization_readiness() from public, anon;
grant execute on function public.get_mar_normal_materialization_readiness() to authenticated;
