-- Append-only correction for 100014. Apply only after 100009..100014 have
-- been reviewed. This migration never repairs or repins an existing attempt.

alter table public.mar_assignment_materialization_operations
  add column if not exists student_id uuid references public.profiles(id) on delete restrict,
  add column if not exists patient_id uuid references public.patients(id) on delete restrict,
  add column if not exists school_id uuid references public.schools(id) on delete restrict,
  add column if not exists effective_date timestamptz,
  add column if not exists window_start timestamptz,
  add column if not exists window_end timestamptz,
  add column if not exists published_content_hash text,
  add column if not exists envelope_hash text;

create or replace function public.mar_effective_school_allowed(
  p_primary_school uuid,
  p_available_schools uuid[],
  p_school uuid
) returns boolean
language sql immutable as $$
  select p_school is not null and (
    p_primary_school = p_school
    or p_available_schools is null
    or cardinality(p_available_schools) = 0
    or p_school = any(p_available_schools)
  )
$$;

create or replace function public.publish_mar_case_version(
  p_room_id integer,
  p_case_version text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  actor_role text;
  actor_school uuid;
  room_patient uuid;
  room_school uuid;
  available_schools uuid[];
  version_name text;
  order_snapshot jsonb;
  event_snapshot jsonb;
  content_hash text;
  prior public.mar_authored_case_versions%rowtype;
begin
  if actor is null then raise exception 'MAR_AUTH_REQUIRED'; end if;
  select p.role, p.school_id into actor_role, actor_school from public.profiles p where p.id = actor;
  if actor_role is null or actor_role not in ('school_admin', 'super_admin') then raise exception 'MAR_ADMIN_REQUIRED'; end if;
  select r.patient_id, r.school_id, r.available_school_ids
    into room_patient, room_school, available_schools
    from public.rooms r where r.id = p_room_id for share;
  if room_patient is null then raise exception 'MAR_ROOM_NOT_FOUND'; end if;
  if actor_role <> 'super_admin' and not public.mar_effective_school_allowed(room_school, available_schools, actor_school) then
    raise exception 'MAR_SCHOOL_SCOPE_MISMATCH';
  end if;
  version_name := nullif(btrim(p_case_version), '');
  if version_name is null then
    select format('room-%s-mar-v%s', p_room_id, coalesce(max((substring(case_version from '-v([0-9]+)$'))::integer) filter (where case_version ~ '-v[0-9]+$'), 0) + 1)
      into version_name
      from public.mar_authored_case_versions where room_id = p_room_id;
  end if;
  select coalesce(jsonb_agg(to_jsonb(o) order by o.id), '[]'::jsonb)
    into order_snapshot
    from public.medical_orders o
    where o.patient_id = room_patient and o.deleted_at is null and o.category = 'Medication'
      and (o.room_id = p_room_id or o.room_id is null) and o.assignment_id is null;
  select coalesce(jsonb_agg(to_jsonb(e) order by e.relative_offset_hours desc nulls last, e.occurrence_key), '[]'::jsonb)
    into event_snapshot
    from public.mar_administration_events e
    where e.patient_id = room_patient and e.deleted_at is null and e.room_id = p_room_id and e.assignment_id is null;
  content_hash := encode(extensions.digest(convert_to(order_snapshot::text || ':' || event_snapshot::text, 'utf8'), 'sha256'), 'hex');
  select * into prior from public.mar_authored_case_versions where room_id = p_room_id and case_version = version_name for share;
  if found then
    if prior.content_hash is distinct from content_hash then raise exception 'MAR_AUTHORED_VERSION_IMMUTABLE'; end if;
    return jsonb_build_object('caseVersion', version_name, 'contentHash', content_hash, 'orderCount', jsonb_array_length(prior.order_snapshot), 'eventCount', jsonb_array_length(prior.event_snapshot), 'reused', true);
  end if;
  insert into public.mar_authored_case_versions(room_id, patient_id, school_id, case_version, order_snapshot, event_snapshot, content_hash, created_by)
  values (p_room_id, room_patient, room_school, version_name, order_snapshot, event_snapshot, content_hash, actor);
  return jsonb_build_object('caseVersion', version_name, 'contentHash', content_hash, 'orderCount', jsonb_array_length(order_snapshot), 'eventCount', jsonb_array_length(event_snapshot), 'reused', false);
end;
$$;

revoke all on function public.publish_mar_case_version(integer, text) from public, anon;
grant execute on function public.publish_mar_case_version(integer, text) to authenticated;

create or replace function public.get_mar_published_case_version(p_room_id integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare actor uuid := auth.uid(); actor_role text; actor_school uuid; room_school uuid; available_schools uuid[]; result jsonb;
begin
  if actor is null then raise exception 'MAR_AUTH_REQUIRED'; end if;
  select p.role, p.school_id into actor_role, actor_school from public.profiles p where p.id = actor;
  if actor_role is null then raise exception 'MAR_AUTH_REQUIRED'; end if;
  if actor_role not in ('school_admin','super_admin') then raise exception 'MAR_ADMIN_REQUIRED'; end if;
  select r.school_id, r.available_school_ids into room_school, available_schools from public.rooms r where r.id = p_room_id;
  if room_school is null then raise exception 'MAR_ROOM_NOT_FOUND'; end if;
  if actor_role <> 'super_admin' and not public.mar_effective_school_allowed(room_school, available_schools, actor_school) then raise exception 'MAR_SCHOOL_SCOPE_MISMATCH'; end if;
  select jsonb_build_object('caseVersion', v.case_version, 'contentHash', v.content_hash, 'orderCount', jsonb_array_length(v.order_snapshot), 'eventCount', jsonb_array_length(v.event_snapshot))
    into result from public.mar_authored_case_versions v where v.room_id = p_room_id order by v.created_at desc, v.case_version desc limit 1;
  return coalesce(result, '{}'::jsonb);
end;
$$;
revoke all on function public.get_mar_published_case_version(integer) from public, anon;
grant execute on function public.get_mar_published_case_version(integer) to authenticated;

create or replace function public.get_mar_assignment_order_snapshot(p_assignment_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb; actor_role text; actor_school uuid;
begin
  select p.role, p.school_id into actor_role, actor_school from public.profiles p where p.id = auth.uid();
  if actor_role is null then raise exception 'MAR_AUTH_REQUIRED'; end if;
  select v.order_snapshot into result
  from public.student_room_assignments a
  join public.mar_authored_case_versions v on v.room_id = a.room_id and v.case_version = a.case_key_version
  join public.rooms r on r.id = a.room_id
  left join public.profiles learner on learner.id = a.student_id
  where a.id = p_assignment_id
    and (a.student_id = auth.uid() or (
      actor_role in ('school_admin','super_admin')
      and (actor_role = 'super_admin' or public.mar_effective_school_allowed(r.school_id, r.available_school_ids, actor_school))
      and public.mar_effective_school_allowed(r.school_id, r.available_school_ids, learner.school_id)
    ))
    and learner.id is not null
    and a.school_id is not distinct from learner.school_id;
  if result is null then raise exception 'MAR_ASSIGNMENT_SNAPSHOT_NOT_FOUND'; end if;
  return result;
end;
$$;
revoke all on function public.get_mar_assignment_order_snapshot(uuid) from public, anon;
grant execute on function public.get_mar_assignment_order_snapshot(uuid) to authenticated;

create or replace function public.create_assignment_with_mar_materialization(
  p_request_id uuid, p_assignment_id uuid, p_student_id uuid, p_room_id integer, p_school_id uuid,
  p_case_version text, p_effective_date timestamptz, p_window_start timestamptz, p_window_end timestamptz
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid(); actor_role text; actor_school uuid; room_patient uuid; room_school uuid; available_schools uuid[]; student_school uuid;
  snapshot public.mar_authored_case_versions%rowtype; prior public.mar_assignment_materialization_operations%rowtype; existing public.student_room_assignments%rowtype;
  envelope jsonb; envelope_hash text; result jsonb;
begin
  if actor is null then raise exception 'MAR_AUTH_REQUIRED'; end if;
  select p.role, p.school_id into actor_role, actor_school from public.profiles p where p.id = actor;
  if actor_role is null or actor_role not in ('school_admin','super_admin') then raise exception 'MAR_ADMIN_REQUIRED'; end if;
  if p_request_id is null or p_assignment_id is null or p_student_id is null or p_room_id is null or p_school_id is null or nullif(btrim(p_case_version),'') is null then raise exception 'MAR_MATERIALIZATION_INVALID'; end if;
  select r.patient_id, r.school_id, r.available_school_ids into room_patient, room_school, available_schools from public.rooms r where r.id = p_room_id for share;
  if room_patient is null then raise exception 'MAR_ROOM_NOT_FOUND'; end if;
  select p.school_id into student_school from public.profiles p where p.id = p_student_id;
  if student_school is null then raise exception 'MAR_STUDENT_PROFILE_NOT_FOUND'; end if;
  if p_school_id is distinct from student_school then raise exception 'MAR_ASSIGNMENT_SCHOOL_MISMATCH'; end if;
  if not public.mar_effective_school_allowed(room_school, available_schools, student_school) then raise exception 'MAR_STUDENT_ROOM_UNAVAILABLE'; end if;
  if actor_role <> 'super_admin' and not public.mar_effective_school_allowed(room_school, available_schools, actor_school) then raise exception 'MAR_SCHOOL_SCOPE_MISMATCH'; end if;
  select * into snapshot from public.mar_authored_case_versions where room_id = p_room_id and patient_id = room_patient and case_version = p_case_version for share;
  if not found then raise exception 'MAR_AUTHORED_VERSION_NOT_PUBLISHED'; end if;
  envelope := jsonb_build_object('requestId',p_request_id,'assignmentId',p_assignment_id,'studentId',p_student_id,'patientId',room_patient,'roomId',p_room_id,'schoolId',p_school_id,'caseVersion',p_case_version,'publishedContentHash',snapshot.content_hash,'effectiveDate',p_effective_date,'windowStart',p_window_start,'windowEnd',p_window_end,'actorId',actor);
  envelope_hash := encode(extensions.digest(convert_to(envelope::text,'utf8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtext('mar-materialize:' || p_request_id::text));
  select * into prior from public.mar_assignment_materialization_operations where request_id = p_request_id for update;
  if found then
    if prior.envelope_hash is null or prior.envelope_hash is distinct from envelope_hash then raise exception 'MAR_MATERIALIZATION_RETRY_MISMATCH'; end if;
    return prior.result;
  end if;
  select * into existing from public.student_room_assignments where id = p_assignment_id for update;
  if found then raise exception 'MAR_ASSIGNMENT_ALREADY_EXISTS'; end if;
  insert into public.student_room_assignments(id,student_id,room_id,assigned_by,status,effective_date,window_start,window_end,school_id,case_key_version)
  values (p_assignment_id,p_student_id,p_room_id,actor,'assigned',p_effective_date,p_window_start,p_window_end,p_school_id,p_case_version);
  insert into public.mar_assignment_baseline_versions(assignment_id,case_version,patient_id,room_id,event_snapshot,content_hash,created_by)
  values (p_assignment_id,p_case_version,room_patient,p_room_id,snapshot.event_snapshot,encode(extensions.digest(convert_to(snapshot.event_snapshot::text || ':' || p_case_version,'utf8'),'sha256'),'hex'),actor);
  insert into public.mar_administration_events(id,patient_id,room_id,assignment_id,order_id,case_version,occurrence_key,relative_offset_hours,administered_at,medication_name,ordered_dose,administered_dose,unit,route,frequency,category,status,simulated_clinician,reason,prn_indication,response,infusion_details,source,actor_id,actor_label,record_version)
  select gen_random_uuid(),room_patient,p_room_id,p_assignment_id,nullif(value->>'order_id','')::uuid,p_case_version,value->>'occurrence_key',nullif(value->>'relative_offset_hours','')::numeric,nullif(value->>'administered_at','')::timestamptz,value->>'medication_name',value->>'ordered_dose',value->>'administered_dose',value->>'unit',value->>'route',value->>'frequency',coalesce(value->>'category','scheduled'),coalesce(value->>'status','Not documented'),value->>'simulated_clinician',value->>'reason',value->>'prn_indication',value->>'response',value->'infusion_details',coalesce(value->>'source','authored_scenario'),actor,value->>'actor_label',1
  from jsonb_array_elements(snapshot.event_snapshot) value;
  result := jsonb_build_object('assignmentId',p_assignment_id,'caseVersion',p_case_version,'contentHash',snapshot.content_hash,'orderCount',jsonb_array_length(snapshot.order_snapshot),'eventCount',jsonb_array_length(snapshot.event_snapshot));
  insert into public.mar_assignment_materialization_operations(request_id,assignment_id,room_id,case_version,actor_id,result,student_id,patient_id,school_id,effective_date,window_start,window_end,published_content_hash,envelope_hash)
  values(p_request_id,p_assignment_id,p_room_id,p_case_version,actor,result,p_student_id,room_patient,p_school_id,p_effective_date,p_window_start,p_window_end,snapshot.content_hash,envelope_hash);
  return result;
end;
$$;
revoke all on function public.create_assignment_with_mar_materialization(uuid,uuid,uuid,integer,uuid,text,timestamptz,timestamptz,timestamptz) from public, anon;
grant execute on function public.create_assignment_with_mar_materialization(uuid,uuid,uuid,integer,uuid,text,timestamptz,timestamptz,timestamptz) to authenticated;

create or replace function public.get_mar_normal_materialization_readiness()
returns jsonb language plpgsql security definer set search_path = public as $$
declare base jsonb; ready boolean;
begin
  select public.get_mar_readiness() into base;
  ready := coalesce((base->>'ready')::boolean,false)
    and to_regclass('public.mar_authored_case_versions') is not null
    and to_regprocedure('public.publish_mar_case_version(integer,text)') is not null
    and to_regprocedure('public.get_mar_assignment_order_snapshot(uuid)') is not null
    and to_regprocedure('public.create_assignment_with_mar_materialization(uuid,uuid,uuid,integer,uuid,text,timestamptz,timestamptz,timestamptz)') is not null
    and not has_function_privilege('authenticated','public.save_mar_history(uuid,integer,uuid,text,integer,jsonb)','EXECUTE');
  return jsonb_build_object('ready',ready,'materializationVersion',case when ready then 2 else 0 end,'atomic',ready,'baseReadiness',base,'requiresPublishedVersion',true,'oldMutatorsRevoked',ready);
end;
$$;
revoke all on function public.get_mar_normal_materialization_readiness() from public, anon;
grant execute on function public.get_mar_normal_materialization_readiness() to authenticated;
