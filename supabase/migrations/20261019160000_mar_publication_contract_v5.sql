-- MAR publication contract v5. Append-only and disposable-review only until
-- the owner approves the complete 100009..100017 rollout.
-- The preview hash is the exact Orders+MAR capture used by publication. A
-- stale tab therefore fails closed instead of publishing mixed content.

create or replace function public.get_mar_publication_preview(p_room_id integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  actor_role text;
  actor_school uuid;
  room_patient uuid;
  room_school uuid;
  available_schools uuid[];
  current_revision integer;
  order_snapshot jsonb;
  event_snapshot jsonb;
  content_hash text;
begin
  if actor is null then raise exception 'MAR_AUTH_REQUIRED'; end if;
  select p.role, p.school_id into actor_role, actor_school
  from public.profiles p where p.id = actor;
  if actor_role is null then raise exception 'MAR_ACTOR_NOT_FOUND'; end if;
  if actor_role not in ('school_admin', 'super_admin') then raise exception 'MAR_ADMIN_REQUIRED'; end if;
  select r.patient_id, r.school_id, r.available_school_ids
    into room_patient, room_school, available_schools
  from public.rooms r where r.id = p_room_id;
  if room_patient is null then raise exception 'MAR_ROOM_NOT_FOUND'; end if;
  if actor_role <> 'super_admin' and actor_school is distinct from room_school then
    raise exception 'MAR_SCHOOL_SCOPE_MISMATCH';
  end if;

  select coalesce(max(h.revision), 0) into current_revision
  from public.mar_history_revisions h
  where h.patient_id = room_patient and h.room_id = p_room_id
    and h.assignment_id is null
    and h.scope_key = room_patient::text || ':' || p_room_id::text || ':baseline';
  select coalesce(jsonb_agg(to_jsonb(o) order by o.id), '[]'::jsonb)
    into order_snapshot
  from public.medical_orders o
  where o.patient_id = room_patient and o.deleted_at is null
    and o.category = 'Medication' and (o.room_id = p_room_id or o.room_id is null)
    and o.assignment_id is null;
  select coalesce(jsonb_agg(to_jsonb(e) order by e.relative_offset_hours desc nulls last, e.occurrence_key), '[]'::jsonb)
    into event_snapshot
  from public.mar_administration_events e
  where e.patient_id = room_patient and e.deleted_at is null
    and e.room_id = p_room_id and e.assignment_id is null;
  content_hash := encode(digest(convert_to(order_snapshot::text || ':' || event_snapshot::text, 'utf8'), 'sha256'), 'hex');
  return jsonb_build_object(
    'roomId', p_room_id,
    'patientId', room_patient,
    'revision', current_revision,
    'contentHash', content_hash,
    'orderCount', jsonb_array_length(order_snapshot),
    'eventCount', jsonb_array_length(event_snapshot),
    'contractVersion', 5
  );
end;
$$;

revoke all on function public.get_mar_publication_preview(integer) from public, anon;
grant execute on function public.get_mar_publication_preview(integer) to authenticated;

create or replace function public.get_mar_normal_materialization_readiness()
returns jsonb language plpgsql security definer set search_path = public as $$
declare base jsonb; ready boolean;
begin
  select public.get_mar_readiness() into base;
  ready := coalesce((base->>'ready')::boolean,false)
    and coalesce((base->>'schemaVersion')::integer,0) >= 4
    and to_regclass('public.mar_authored_case_versions') is not null
    and to_regclass('public.mar_assignment_materialization_operations') is not null
    and to_regclass('public.mar_publication_operations') is not null
    and to_regprocedure('public.publish_mar_case_version_atomic(uuid,integer,integer,text,text)') is not null
    and to_regprocedure('public.get_mar_publication_preview(integer)') is not null
    and to_regprocedure('public.get_mar_assignment_order_snapshot(uuid)') is not null
    and to_regprocedure('public.create_assignment_with_mar_materialization(uuid,uuid,uuid,integer,uuid,text,timestamptz,timestamptz,timestamptz)') is not null
    and to_regprocedure('public.mar_effective_school_allowed(uuid,uuid[],uuid)') is not null
    and not has_function_privilege('authenticated','public.save_mar_history(uuid,integer,uuid,text,integer,jsonb)','EXECUTE');
  return jsonb_build_object(
    'ready', ready,
    'materializationVersion', case when ready then 5 else 0 end,
    'atomic', ready,
    'baseReadiness', base,
    'requiresPublishedVersion', true,
    'publicationVersion', case when ready then 2 else 0 end,
    'scopeVersion', case when ready then 3 else 0 end,
    'oldMutatorsRevoked', ready,
    'publicationPreviewVersion', case when ready then 5 else 0 end
  );
end;
$$;
revoke all on function public.get_mar_normal_materialization_readiness() from public, anon;
grant execute on function public.get_mar_normal_materialization_readiness() to authenticated;
