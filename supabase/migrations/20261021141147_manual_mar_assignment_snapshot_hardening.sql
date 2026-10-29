-- Append-only hardening for the manual MAR contract. Existing packets and
-- assignment pins are preserved; only genuinely new assignments receive a
-- snapshot of the packet revision that existed when they were created.

create table if not exists public.manual_mar_assignment_snapshots (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null unique references public.student_room_assignments(id) on delete cascade,
  source_packet_id uuid,
  patient_id uuid not null references public.patients(id) on delete cascade,
  room_id integer not null references public.rooms(id) on delete cascade,
  case_version text not null,
  packet_revision integer not null check (packet_revision >= 1),
  events jsonb not null check (jsonb_typeof(events) = 'array'),
  content_hash text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

alter table public.manual_mar_assignment_snapshots enable row level security;
revoke all on public.manual_mar_assignment_snapshots from anon, authenticated;

alter table public.manual_mar_packet_audit
  add column if not exists patient_id uuid,
  add column if not exists room_id integer,
  add column if not exists case_version text,
  add column if not exists expected_revision integer,
  add column if not exists payload_hash text;

do $$
begin
  if exists (select 1 from public.manual_mar_packet_audit where patient_id is null or room_id is null or case_version is null or expected_revision is null or payload_hash is null) then
    raise exception 'MANUAL_MAR_AUDIT_ENVELOPE_INCOMPLETE';
  end if;
end $$;

alter table public.manual_mar_packet_audit
  alter column patient_id set not null,
  alter column room_id set not null,
  alter column case_version set not null,
  alter column expected_revision set not null,
  alter column payload_hash set not null;

create or replace function public.manual_mar_snapshot_new_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  packet public.manual_mar_packets%rowtype;
  assignment_case_version text := new.case_key_version;
  room_patient uuid;
begin
  -- Never reinterpret scenario_baseline_version as a manual MAR case key.
  if assignment_case_version is null or btrim(assignment_case_version) = '' then
    return new;
  end if;
  select patient_id into room_patient from public.rooms where id = new.room_id;
  if room_patient is null then return new; end if;
  select * into packet
    from public.manual_mar_packets
   where patient_id = room_patient
     and room_id = new.room_id
     and case_version = assignment_case_version;
  if not found then return new; end if;
  insert into public.manual_mar_assignment_snapshots(
    assignment_id, source_packet_id, patient_id, room_id, case_version,
    packet_revision, events, content_hash, created_by
  ) values (
    new.id, packet.id, room_patient, new.room_id, assignment_case_version,
    packet.revision, packet.events,
    md5(packet.patient_id::text || '|' || packet.room_id::text || '|' || packet.case_version || '|' || packet.revision::text || '|' || packet.events::text),
    packet.created_by
  ) on conflict (assignment_id) do nothing;
  return new;
end;
$$;

drop trigger if exists manual_mar_snapshot_assignment_insert on public.student_room_assignments;
create trigger manual_mar_snapshot_assignment_insert
after insert on public.student_room_assignments
for each row execute function public.manual_mar_snapshot_new_assignment();

create or replace function public.get_manual_mar_packet(
  p_patient_id uuid,
  p_room_id integer,
  p_assignment_id uuid,
  p_case_version text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  actor_role text;
  room_patient uuid;
  room_school uuid;
  packet public.manual_mar_packets%rowtype;
  snapshot public.manual_mar_assignment_snapshots%rowtype;
begin
  if actor is null then raise exception 'MANUAL_MAR_AUTH_REQUIRED'; end if;
  select role into actor_role from public.profiles where id = actor;
  if actor_role is null then raise exception 'MANUAL_MAR_ACTOR_NOT_FOUND'; end if;
  select patient_id, school_id into room_patient, room_school from public.rooms where id = p_room_id;
  if room_patient is distinct from p_patient_id then raise exception 'MANUAL_MAR_ROOM_PATIENT_MISMATCH'; end if;
  if p_assignment_id is null then
    if actor_role not in ('school_admin', 'super_admin') then raise exception 'MANUAL_MAR_ADMIN_REQUIRED'; end if;
    if actor_role <> 'super_admin' and not exists (select 1 from public.profiles where id = actor and school_id = room_school) then raise exception 'MANUAL_MAR_SCHOOL_SCOPE_MISMATCH'; end if;
    select * into packet from public.manual_mar_packets where patient_id = p_patient_id and room_id = p_room_id and case_version = p_case_version;
    if not found then return null; end if;
    return jsonb_build_object('id', packet.id, 'patientId', packet.patient_id, 'roomId', packet.room_id, 'caseVersion', packet.case_version, 'revision', packet.revision, 'events', packet.events, 'updatedAt', packet.updated_at);
  end if;
  if not exists (select 1 from public.student_room_assignments a where a.id = p_assignment_id and a.student_id = actor and a.room_id = p_room_id and a.case_key_version = p_case_version and exists (select 1 from public.rooms r where r.id = a.room_id and r.patient_id = p_patient_id)) then
    raise exception 'MANUAL_MAR_ASSIGNMENT_SCOPE_MISMATCH';
  end if;
  select * into snapshot from public.manual_mar_assignment_snapshots where assignment_id = p_assignment_id;
  if not found then return null; end if;
  if snapshot.patient_id is distinct from p_patient_id or snapshot.room_id is distinct from p_room_id or snapshot.case_version is distinct from p_case_version then raise exception 'MANUAL_MAR_SNAPSHOT_SCOPE_MISMATCH'; end if;
  return jsonb_build_object('id', snapshot.id, 'patientId', snapshot.patient_id, 'roomId', snapshot.room_id, 'caseVersion', snapshot.case_version, 'revision', snapshot.packet_revision, 'events', snapshot.events, 'updatedAt', snapshot.created_at);
end;
$$;

create or replace function public.save_manual_mar_packet(
  p_request_id uuid,
  p_patient_id uuid,
  p_room_id integer,
  p_case_version text,
  p_expected_revision integer,
  p_events jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  actor_role text;
  room_patient uuid;
  room_school uuid;
  packet public.manual_mar_packets%rowtype;
  prior_audit public.manual_mar_packet_audit%rowtype;
  next_revision integer;
  request_hash text;
begin
  if actor is null then raise exception 'MANUAL_MAR_AUTH_REQUIRED'; end if;
  select role into actor_role from public.profiles where id = actor;
  if actor_role is null or actor_role not in ('school_admin', 'super_admin') then raise exception 'MANUAL_MAR_ADMIN_REQUIRED'; end if;
  if p_request_id is null or p_patient_id is null or p_room_id is null or nullif(btrim(p_case_version), '') is null or p_expected_revision is null or p_expected_revision < 0 then raise exception 'MANUAL_MAR_INVALID_REQUEST'; end if;
  perform public.manual_mar_validate_events(p_events);
  request_hash := md5(p_patient_id::text || '|' || p_room_id::text || '|' || p_case_version || '|' || p_expected_revision::text || '|' || p_events::text);
  select patient_id, school_id into room_patient, room_school from public.rooms where id = p_room_id;
  if room_patient is distinct from p_patient_id then raise exception 'MANUAL_MAR_ROOM_PATIENT_MISMATCH'; end if;
  if actor_role <> 'super_admin' and not exists (select 1 from public.profiles where id = actor and school_id = room_school) then raise exception 'MANUAL_MAR_SCHOOL_SCOPE_MISMATCH'; end if;
  perform pg_advisory_xact_lock(hashtext('manual-mar-request:' || p_request_id::text));
  select * into prior_audit from public.manual_mar_packet_audit where request_id = p_request_id for update;
  if found then
    if prior_audit.actor_id is distinct from actor or prior_audit.patient_id is distinct from p_patient_id or prior_audit.room_id is distinct from p_room_id or prior_audit.case_version is distinct from p_case_version or prior_audit.expected_revision is distinct from p_expected_revision or prior_audit.payload_hash is distinct from request_hash or prior_audit.events is distinct from p_events then
      raise exception 'MANUAL_MAR_RETRY_PAYLOAD_MISMATCH';
    end if;
    return jsonb_build_object('packetId', prior_audit.packet_id, 'revision', prior_audit.next_revision, 'caseVersion', prior_audit.case_version);
  end if;
  perform pg_advisory_xact_lock(hashtext('manual-mar:' || p_patient_id::text || ':' || p_room_id::text || ':' || p_case_version));
  select * into packet from public.manual_mar_packets where patient_id = p_patient_id and room_id = p_room_id and case_version = p_case_version for update;
  if not found then
    if p_expected_revision <> 0 then raise exception 'MANUAL_MAR_REVISION_CONFLICT'; end if;
    insert into public.manual_mar_packets(patient_id, room_id, case_version, revision, events, created_by) values (p_patient_id, p_room_id, p_case_version, 1, p_events, actor) returning * into packet;
  else
    if packet.revision <> p_expected_revision then raise exception 'MANUAL_MAR_REVISION_CONFLICT'; end if;
    next_revision := packet.revision + 1;
    update public.manual_mar_packets set revision = next_revision, events = p_events, updated_at = now(), created_by = actor where id = packet.id returning * into packet;
  end if;
  insert into public.manual_mar_packet_audit(packet_id, request_id, prior_revision, next_revision, events, actor_id, patient_id, room_id, case_version, expected_revision, payload_hash)
    values (packet.id, p_request_id, packet.revision - 1, packet.revision, p_events, actor, p_patient_id, p_room_id, p_case_version, p_expected_revision, request_hash);
  return jsonb_build_object('packetId', packet.id, 'revision', packet.revision, 'caseVersion', packet.case_version);
end;
$$;

revoke all on function public.manual_mar_snapshot_new_assignment() from public, anon, authenticated;
revoke all on function public.get_manual_mar_packet(uuid, integer, uuid, text) from public, anon;
revoke all on function public.save_manual_mar_packet(uuid, uuid, integer, text, integer, jsonb) from public, anon;
grant execute on function public.get_manual_mar_packet(uuid, integer, uuid, text) to authenticated;
grant execute on function public.save_manual_mar_packet(uuid, uuid, integer, text, integer, jsonb) to authenticated;
