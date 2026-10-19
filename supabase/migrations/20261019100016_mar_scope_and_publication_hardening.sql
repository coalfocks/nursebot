-- Append-only hardening for the reviewed 100014/100015 normal MAR path.
-- This migration never repairs or repins an existing assignment.

create or replace function public.mar_effective_school_allowed(
  p_primary_school uuid,
  p_available_schools uuid[],
  p_school uuid
) returns boolean
language sql immutable
as $$
  select p_school is not null
    and p_primary_school is not null
    and (
      p_primary_school = p_school
      or (p_available_schools is not null and cardinality(p_available_schools) = 0)
      or (p_available_schools is not null and p_school = any(p_available_schools))
    )
$$;

create or replace function public.publish_mar_case_version(
  p_room_id integer,
  p_case_version text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  actor uuid := auth.uid();
  actor_role text;
  actor_school uuid;
  room_patient uuid;
  room_school uuid;
  requested text := nullif(btrim(p_case_version), '');
  version_name text;
  order_snapshot jsonb;
  event_snapshot jsonb;
  content_hash text;
  prior_exists boolean := false;
  prior public.mar_authored_case_versions%rowtype;
begin
  if actor is null then raise exception 'MAR_AUTH_REQUIRED'; end if;
  select p.role, p.school_id into actor_role, actor_school
    from public.profiles p where p.id = actor;
  if actor_role is null then raise exception 'MAR_PROFILE_REQUIRED'; end if;
  if actor_role not in ('school_admin', 'super_admin') then raise exception 'MAR_ADMIN_REQUIRED'; end if;
  select r.patient_id, r.school_id into room_patient, room_school
    from public.rooms r where r.id = p_room_id for update;
  if room_patient is null or room_school is null then raise exception 'MAR_ROOM_NOT_FOUND'; end if;
  -- Only the room's owning school may publish. Availability grants use by
  -- another school, never authoring or publication rights.
  if actor_role <> 'super_admin' and actor_school is distinct from room_school then
    raise exception 'MAR_AUTHORING_SCOPE_MISMATCH';
  end if;
  perform pg_advisory_xact_lock(hashtext('mar-publish:' || p_room_id::text));
  select format('room-%s-mar-v%s', p_room_id,
    coalesce(max((substring(case_version from '-v([0-9]+)$'))::integer)
      filter (where case_version ~ '-v[0-9]+$'), 0) + 1)
    into version_name
    from public.mar_authored_case_versions where room_id = p_room_id;
  if requested is not null then version_name := requested; end if;
  select * into prior from public.mar_authored_case_versions
    where room_id = p_room_id and case_version = version_name for update;
  prior_exists := found;
  select coalesce(jsonb_agg(to_jsonb(o) order by o.id), '[]'::jsonb) into order_snapshot
    from public.medical_orders o
    where o.patient_id = room_patient and o.deleted_at is null
      and o.category = 'Medication' and (o.room_id = p_room_id or o.room_id is null)
      and o.assignment_id is null;
  select coalesce(jsonb_agg(to_jsonb(e) order by e.relative_offset_hours desc nulls last, e.occurrence_key), '[]'::jsonb) into event_snapshot
    from public.mar_administration_events e
    where e.patient_id = room_patient and e.deleted_at is null
      and e.room_id = p_room_id and e.assignment_id is null;
  content_hash := encode(digest(convert_to(order_snapshot::text || ':' || event_snapshot::text, 'utf8'), 'sha256'), 'hex');
  if prior_exists then
    if prior.content_hash is distinct from content_hash then raise exception 'MAR_AUTHORED_VERSION_IMMUTABLE'; end if;
    return jsonb_build_object('caseVersion', version_name, 'contentHash', content_hash,
      'orderCount', jsonb_array_length(prior.order_snapshot), 'eventCount', jsonb_array_length(prior.event_snapshot), 'reused', true);
  end if;
  insert into public.mar_authored_case_versions(room_id, patient_id, school_id, case_version, order_snapshot, event_snapshot, content_hash, created_by)
  values (p_room_id, room_patient, room_school, version_name, order_snapshot, event_snapshot, content_hash, actor);
  return jsonb_build_object('caseVersion', version_name, 'contentHash', content_hash,
    'orderCount', jsonb_array_length(order_snapshot), 'eventCount', jsonb_array_length(event_snapshot), 'reused', false);
end;
$$;

create or replace function public.get_mar_assignment_order_snapshot(p_assignment_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb; actor uuid := auth.uid(); actor_role text; actor_school uuid; assignment_school uuid; assignment_student uuid;
begin
  if actor is null then raise exception 'MAR_AUTH_REQUIRED'; end if;
  select p.role, p.school_id into actor_role, actor_school from public.profiles p where p.id = actor;
  if actor_role is null then raise exception 'MAR_AUTH_REQUIRED'; end if;
  select a.school_id, a.student_id into assignment_school, assignment_student from public.student_room_assignments a where a.id = p_assignment_id;
  if assignment_school is null then raise exception 'MAR_ASSIGNMENT_SNAPSHOT_NOT_FOUND'; end if;
  if actor is distinct from assignment_student
     and actor_role <> 'super_admin'
     and (actor_role <> 'school_admin' or actor_school is distinct from assignment_school) then
    raise exception 'MAR_ASSIGNMENT_SCOPE_MISMATCH';
  end if;
  select v.order_snapshot into result
    from public.student_room_assignments a
    join public.mar_authored_case_versions v on v.room_id = a.room_id and v.case_version = a.case_key_version
    join public.profiles learner on learner.id = a.student_id
    where a.id = p_assignment_id and learner.id is not null
      and a.school_id is not distinct from learner.school_id;
  if result is null then raise exception 'MAR_ASSIGNMENT_SNAPSHOT_NOT_FOUND'; end if;
  return result;
end;
$$;

revoke all on function public.mar_effective_school_allowed(uuid, uuid[], uuid) from public, anon;
revoke all on function public.publish_mar_case_version(integer, text) from public, anon;
revoke all on function public.get_mar_assignment_order_snapshot(uuid) from public, anon;
grant execute on function public.publish_mar_case_version(integer, text) to authenticated;
grant execute on function public.get_mar_assignment_order_snapshot(uuid) to authenticated;

create or replace function public.get_mar_normal_materialization_readiness()
returns jsonb language plpgsql security definer set search_path = public as $$
declare base jsonb; ready boolean;
begin
  select public.get_mar_readiness() into base;
  ready := coalesce((base->>'ready')::boolean, false)
    and to_regclass('public.mar_authored_case_versions') is not null
    and to_regclass('public.mar_assignment_materialization_operations') is not null
    and to_regprocedure('public.publish_mar_case_version(integer,text)') is not null
    and to_regprocedure('public.get_mar_assignment_order_snapshot(uuid)') is not null
    and to_regprocedure('public.create_assignment_with_mar_materialization(uuid,uuid,uuid,integer,uuid,text,timestamptz,timestamptz,timestamptz)') is not null
    and not has_function_privilege('authenticated', 'public.save_mar_history(uuid,integer,uuid,text,integer,jsonb)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.create_mar_baseline_version(uuid,text,jsonb)', 'EXECUTE');
  return jsonb_build_object('ready', ready, 'materializationVersion', case when ready then 3 else 0 end,
    'atomic', ready, 'requiresPublishedVersion', true, 'oldMutatorsRevoked', ready,
    'scopeContract', ready, 'frozenOrderReader', ready);
end;
$$;
revoke all on function public.get_mar_normal_materialization_readiness() from public, anon;
grant execute on function public.get_mar_normal_materialization_readiness() to authenticated;
