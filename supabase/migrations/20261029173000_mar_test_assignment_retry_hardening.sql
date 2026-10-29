-- Harden replay of the test_user fresh-assignment envelope. A UUID collision
-- or lost response is only idempotent when every scoped input is identical.

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
  existing public.student_room_assignments%rowtype;
  snapshot public.manual_mar_assignment_snapshots%rowtype;
begin
  if actor is null then raise exception 'MAR_AUTH_REQUIRED'; end if;
  select role, school_id into actor_role, actor_school from public.profiles where id = actor;
  if actor_role <> 'test_user' then raise exception 'MAR_TEST_USER_REQUIRED'; end if;
  if p_assignment_id is null or p_room_id is null or nullif(btrim(p_case_version), '') is null then
    raise exception 'MAR_ASSIGNMENT_ENVELOPE_INVALID';
  end if;
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

  select * into existing from public.student_room_assignments where id = p_assignment_id for update;
  if found then
    if existing.student_id is distinct from actor
      or existing.assigned_by is distinct from actor
      or existing.room_id is distinct from p_room_id
      or existing.school_id is distinct from actor_school
      or existing.case_key_version is distinct from p_case_version
      or existing.is_sandbox is not true
      or existing.effective_date is distinct from p_effective_date
      or existing.window_start is distinct from p_window_start
      or existing.window_end is distinct from p_window_end then
      raise exception 'MAR_TEST_ASSIGNMENT_RETRY_MISMATCH';
    end if;
  else
    insert into public.student_room_assignments(
      id, student_id, room_id, assigned_by, status, effective_date,
      window_start, window_end, is_sandbox, school_id, case_key_version
    ) values (
      p_assignment_id, actor, p_room_id, actor, 'assigned', p_effective_date,
      p_window_start, p_window_end, true, actor_school, p_case_version
    );
  end if;

  select * into snapshot from public.manual_mar_assignment_snapshots where assignment_id = p_assignment_id;
  if not found then raise exception 'MAR_MANUAL_SNAPSHOT_NOT_MATERIALIZED'; end if;
  if snapshot.patient_id is distinct from room_patient
    or snapshot.room_id is distinct from p_room_id
    or snapshot.case_version is distinct from p_case_version
    or snapshot.source_packet_id is distinct from packet.id
    or snapshot.packet_revision is distinct from packet.revision
    or snapshot.events is distinct from packet.events then
    raise exception 'MAR_MANUAL_SNAPSHOT_SCOPE_MISMATCH';
  end if;
  return jsonb_build_object(
    'assignmentId', p_assignment_id,
    'caseVersion', snapshot.case_version,
    'source', 'manual_packet',
    'packetRevision', snapshot.packet_revision,
    'eventCount', jsonb_array_length(snapshot.events),
    'contentHash', snapshot.content_hash,
    'replayed', existing.id is not null
  );
end;
$$;
revoke all on function public.create_test_user_assignment_with_manual_snapshot(uuid, integer, text, timestamptz, timestamptz, timestamptz) from public, anon;
grant execute on function public.create_test_user_assignment_with_manual_snapshot(uuid, integer, text, timestamptz, timestamptz, timestamptz) to authenticated;
