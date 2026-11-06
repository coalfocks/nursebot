-- Narrow role/read-path contract for the two fresh QA surfaces.
-- This migration does not repin or rewrite an existing assignment.

alter table public.mar_authored_case_versions
  add column if not exists source_packet_id uuid references public.manual_mar_packets(id) on delete restrict,
  add column if not exists source_packet_revision integer;

-- Explicitly bridges an accepted manual packet into a NEW immutable authored
-- version. It reads the packet; it never rewrites or repopulates it. The
-- normal-assignment RPC can then materialize the same canonical events that
-- the manual reader displays.
create or replace function public.publish_mar_case_version_from_manual_packet(
  p_room_id integer,
  p_case_version text default null
) returns jsonb
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
  packet public.manual_mar_packets%rowtype;
  version_name text;
  event_snapshot jsonb;
  order_snapshot jsonb := '[]'::jsonb;
  content_hash text;
  prior public.mar_authored_case_versions%rowtype;
begin
  if actor is null then raise exception 'MAR_AUTH_REQUIRED'; end if;
  select role, school_id into actor_role, actor_school from public.profiles where id = actor;
  if actor_role not in ('school_admin', 'super_admin') then raise exception 'MAR_ADMIN_REQUIRED'; end if;
  select patient_id, school_id, available_school_ids into room_patient, room_school, available_schools from public.rooms where id = p_room_id;
  if room_patient is null then raise exception 'MAR_ROOM_NOT_FOUND'; end if;
  if actor_role <> 'super_admin' and not public.mar_effective_school_allowed(room_school, available_schools, actor_school) then raise exception 'MAR_SCHOOL_SCOPE_MISMATCH'; end if;
  select * into packet from public.manual_mar_packets
   where patient_id = room_patient and room_id = p_room_id
   order by updated_at desc, revision desc limit 1;
  if not found then raise exception 'MAR_MANUAL_PACKET_NOT_PUBLISHED'; end if;
  version_name := coalesce(nullif(btrim(p_case_version), ''), format('room-%s-manual-r%s', p_room_id, packet.revision));
  select coalesce(jsonb_agg(jsonb_build_object(
    'occurrence_key', value->>'occurrenceKey',
    'relative_offset_hours', value->'relativeOffsetHours',
    'administered_at', value->'administeredAt',
    'medication_name', value->>'medicationName',
    'ordered_dose', value->>'orderedDose',
    'administered_dose', value->>'administeredDose',
    'unit', value->>'unit', 'route', value->>'route',
    'frequency', value->>'frequency', 'category', value->>'category',
    'status', value->>'status', 'simulated_clinician', value->>'simulatedClinician',
    'reason', value->>'reason', 'prn_indication', value->>'prnIndication',
    'response', value->>'response', 'infusion_details', value->'infusionDetails',
    'source', coalesce(value->>'source', 'authored_scenario'),
    'actor_label', value->>'actorLabel'
  ) order by value->>'occurrenceKey'), '[]'::jsonb)
    into event_snapshot from jsonb_array_elements(packet.events) value;
  content_hash := encode(extensions.digest(convert_to(order_snapshot::text || ':' || event_snapshot::text, 'utf8'), 'sha256'), 'hex');
  select * into prior from public.mar_authored_case_versions where room_id = p_room_id and case_version = version_name;
  if found then
    if prior.content_hash is distinct from content_hash or prior.source_packet_id is distinct from packet.id or prior.source_packet_revision is distinct from packet.revision then raise exception 'MAR_AUTHORED_VERSION_IMMUTABLE'; end if;
    return jsonb_build_object('caseVersion', version_name, 'sourcePacketId', packet.id, 'sourcePacketRevision', packet.revision, 'eventCount', jsonb_array_length(event_snapshot), 'contentHash', content_hash, 'reused', true);
  end if;
  insert into public.mar_authored_case_versions(room_id, patient_id, school_id, case_version, order_snapshot, event_snapshot, content_hash, created_by, source_packet_id, source_packet_revision)
  values (p_room_id, room_patient, room_school, version_name, order_snapshot, event_snapshot, content_hash, actor, packet.id, packet.revision);
  return jsonb_build_object('caseVersion', version_name, 'sourcePacketId', packet.id, 'sourcePacketRevision', packet.revision, 'eventCount', jsonb_array_length(event_snapshot), 'contentHash', content_hash, 'reused', false);
end;
$$;
revoke all on function public.publish_mar_case_version_from_manual_packet(integer, text) from public, anon;
grant execute on function public.publish_mar_case_version_from_manual_packet(integer, text) to authenticated;

create or replace function public.get_mar_eligible_case_version(p_room_id integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  actor_role text;
  actor_school uuid;
  room_school uuid;
  available_schools uuid[];
  room_patient uuid;
  version_name text;
  packet_revision integer;
  event_count integer;
begin
  if actor is null then raise exception 'MAR_AUTH_REQUIRED'; end if;
  select role, school_id into actor_role, actor_school from public.profiles where id = actor;
  if actor_role <> 'test_user' then raise exception 'MAR_TEST_USER_REQUIRED'; end if;
  select patient_id, school_id, available_school_ids
    into room_patient, room_school, available_schools
    from public.rooms where id = p_room_id;
  if room_patient is null then raise exception 'MAR_ROOM_NOT_FOUND'; end if;
  if not public.mar_effective_school_allowed(room_school, available_schools, actor_school) then
    raise exception 'MAR_TEST_ROOM_SCOPE_MISMATCH';
  end if;

  -- The sandbox reader is deliberately sourced from the accepted manual
  -- packet. It must not require the admin-only authored-version publication
  -- RPC and it must not fall back to mutable room authoring.
  select case_version, revision, jsonb_array_length(events)
    into version_name, packet_revision, event_count
    from public.manual_mar_packets
   where room_id = p_room_id and patient_id = room_patient
   order by updated_at desc, revision desc
   limit 1;
  if version_name is null then
    raise exception 'MAR_MANUAL_PACKET_NOT_PUBLISHED';
  end if;
  return jsonb_build_object(
    'caseVersion', version_name,
    'source', 'manual_packet',
    'packetRevision', packet_revision,
    'eventCount', event_count
  );
end;
$$;
revoke all on function public.get_mar_eligible_case_version(integer) from public, anon;
grant execute on function public.get_mar_eligible_case_version(integer) to authenticated;

create or replace function public.get_manual_mar_readiness()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ready boolean;
begin
  ready := to_regclass('public.manual_mar_packets') is not null
    and to_regclass('public.manual_mar_assignment_snapshots') is not null
    and to_regprocedure('public.manual_mar_snapshot_new_assignment()') is not null
    and to_regprocedure('public.get_manual_mar_packet(uuid,integer,uuid,text)') is not null;
  return jsonb_build_object('available', ready, 'ready', ready, 'schemaVersion', case when ready then 2 else 0 end, 'automaticGeneration', false, 'immutableAssignmentSnapshots', ready);
end;
$$;
revoke all on function public.get_manual_mar_readiness() from public, anon;
grant execute on function public.get_manual_mar_readiness() to authenticated;

create or replace function public.create_test_user_assignment_with_manual_snapshot(
  p_assignment_id uuid,
  p_room_id integer,
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
  actor_school uuid;
  room_school uuid;
  available_schools uuid[];
  room_patient uuid;
  packet public.manual_mar_packets%rowtype;
  snapshot public.manual_mar_assignment_snapshots%rowtype;
begin
  if actor is null then raise exception 'MAR_AUTH_REQUIRED'; end if;
  select role, school_id into actor_role, actor_school from public.profiles where id = actor;
  if actor_role <> 'test_user' then raise exception 'MAR_TEST_USER_REQUIRED'; end if;
  select patient_id, school_id, available_school_ids
    into room_patient, room_school, available_schools
    from public.rooms where id = p_room_id for share;
  if room_patient is null then raise exception 'MAR_ROOM_NOT_FOUND'; end if;
  if not public.mar_effective_school_allowed(room_school, available_schools, actor_school) then
    raise exception 'MAR_TEST_ROOM_SCOPE_MISMATCH';
  end if;
  select * into packet from public.manual_mar_packets
   where patient_id = room_patient and room_id = p_room_id and case_version = p_case_version;
  if not found then raise exception 'MAR_MANUAL_PACKET_NOT_PUBLISHED'; end if;
  if p_assignment_id is null then raise exception 'MAR_ASSIGNMENT_ID_REQUIRED'; end if;

  insert into public.student_room_assignments(
    id, student_id, room_id, assigned_by, status, effective_date,
    window_start, window_end, is_sandbox, school_id, case_key_version
  ) values (
    p_assignment_id, actor, p_room_id, actor, 'assigned', p_effective_date,
    p_window_start, p_window_end, true, actor_school, p_case_version
  ) on conflict (id) do nothing;

  select * into snapshot from public.manual_mar_assignment_snapshots where assignment_id = p_assignment_id;
  if not found then raise exception 'MAR_MANUAL_SNAPSHOT_NOT_MATERIALIZED'; end if;
  return jsonb_build_object(
    'assignmentId', p_assignment_id,
    'caseVersion', snapshot.case_version,
    'source', 'manual_packet',
    'packetRevision', snapshot.packet_revision,
    'eventCount', jsonb_array_length(snapshot.events),
    'contentHash', snapshot.content_hash
  );
end;
$$;
revoke all on function public.create_test_user_assignment_with_manual_snapshot(uuid, integer, text, timestamptz, timestamptz, timestamptz) from public, anon;
grant execute on function public.create_test_user_assignment_with_manual_snapshot(uuid, integer, text, timestamptz, timestamptz, timestamptz) to authenticated;

create or replace function public.get_mar_assignment_reader(p_assignment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  actor_role text;
  assignment public.student_room_assignments%rowtype;
  room public.rooms%rowtype;
  available_schools uuid[];
  manual_snapshot public.manual_mar_assignment_snapshots%rowtype;
  automatic_snapshot public.mar_assignment_baseline_versions%rowtype;
begin
  if actor is null then raise exception 'MAR_AUTH_REQUIRED'; end if;
  select role into actor_role from public.profiles where id = actor;
  select * into assignment from public.student_room_assignments where id = p_assignment_id;
  if not found then raise exception 'MAR_ASSIGNMENT_NOT_FOUND'; end if;
  select * into room from public.rooms where id = assignment.room_id;
  available_schools := room.available_school_ids;
  if actor_role in ('student', 'test_user') and assignment.student_id <> actor then raise exception 'MAR_ASSIGNMENT_SCOPE_MISMATCH'; end if;
  if actor_role = 'school_admin' and not public.mar_effective_school_allowed(room.school_id, available_schools, (select school_id from public.profiles where id = actor)) then raise exception 'MAR_SCHOOL_SCOPE_MISMATCH'; end if;
  if actor_role not in ('student', 'test_user', 'school_admin', 'super_admin') then raise exception 'MAR_ASSIGNMENT_SCOPE_MISMATCH'; end if;

  select * into manual_snapshot from public.manual_mar_assignment_snapshots where assignment_id = p_assignment_id;
  if found then
    return jsonb_build_object('reader', 'manual', 'caseVersion', manual_snapshot.case_version, 'packetRevision', manual_snapshot.packet_revision, 'eventCount', jsonb_array_length(manual_snapshot.events), 'contentHash', manual_snapshot.content_hash);
  end if;
  select * into automatic_snapshot from public.mar_assignment_baseline_versions where assignment_id = p_assignment_id;
  if found then
    return jsonb_build_object('reader', 'automatic', 'caseVersion', automatic_snapshot.case_version, 'eventCount', jsonb_array_length(automatic_snapshot.event_snapshot), 'contentHash', automatic_snapshot.content_hash);
  end if;
  return jsonb_build_object('reader', 'unavailable');
end;
$$;
revoke all on function public.get_mar_assignment_reader(uuid) from public, anon;
grant execute on function public.get_mar_assignment_reader(uuid) to authenticated;
