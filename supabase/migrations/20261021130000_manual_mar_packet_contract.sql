-- Additive manual MAR fallback. This migration intentionally does not reference
-- mar_administration_events, get_mar_readiness(), or medical_orders.

create table if not exists public.manual_mar_packets (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  room_id integer not null references public.rooms(id) on delete cascade,
  case_version text not null,
  revision integer not null default 0 check (revision >= 0),
  events jsonb not null default '[]'::jsonb check (jsonb_typeof(events) = 'array'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (patient_id, room_id, case_version)
);

create table if not exists public.manual_mar_packet_audit (
  id uuid primary key default gen_random_uuid(),
  packet_id uuid not null references public.manual_mar_packets(id) on delete cascade,
  request_id uuid not null unique,
  prior_revision integer not null,
  next_revision integer not null,
  events jsonb not null check (jsonb_typeof(events) = 'array'),
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

alter table public.manual_mar_packets enable row level security;
alter table public.manual_mar_packet_audit enable row level security;
revoke all on public.manual_mar_packets, public.manual_mar_packet_audit from anon, authenticated;

create or replace function public.manual_mar_validate_events(p_events jsonb)
returns void language plpgsql immutable as $$
declare
  event jsonb;
  hours numeric;
begin
  if jsonb_typeof(p_events) <> 'array' then raise exception 'MANUAL_MAR_EVENTS_ARRAY_REQUIRED'; end if;
  for event in select value from jsonb_array_elements(p_events) loop
    if jsonb_typeof(event) <> 'object' then raise exception 'MANUAL_MAR_EVENT_OBJECT_REQUIRED'; end if;
    if coalesce(nullif(btrim(event->>'medicationName'), ''), '') = '' then raise exception 'MANUAL_MAR_MEDICATION_REQUIRED'; end if;
    if coalesce(nullif(btrim(event->>'occurrenceKey'), ''), '') = '' then raise exception 'MANUAL_MAR_OCCURRENCE_REQUIRED'; end if;
    if event->>'category' not in ('scheduled', 'prn', 'one_time', 'infusion') then raise exception 'MANUAL_MAR_CATEGORY_INVALID'; end if;
    if event->>'status' not in ('Given', 'Held', 'Refused', 'Not given', 'Started', 'Rate changed', 'Stopped', 'Not documented') then raise exception 'MANUAL_MAR_STATUS_INVALID'; end if;
    if event ? 'source' and event->>'source' = 'learner' then raise exception 'MANUAL_MAR_LEARNER_SOURCE_REJECTED'; end if;
    if event ? 'source' and event->>'source' not in ('authored_scenario', 'simulation') then raise exception 'MANUAL_MAR_SOURCE_INVALID'; end if;
    if event ? 'orderId' and nullif(event->>'orderId', '') is not null then raise exception 'MANUAL_MAR_ORDER_ID_NOT_ALLOWED'; end if;
    if event ? 'relativeOffsetHours' and event->'relativeOffsetHours' <> 'null' and jsonb_typeof(event->'relativeOffsetHours') <> 'number' then raise exception 'MANUAL_MAR_RELATIVE_HOURS_INVALID'; end if;
    if event ? 'relativeOffsetHours' and event->'relativeOffsetHours' <> 'null' then
      hours := (event->>'relativeOffsetHours')::numeric;
      if hours < 0 or hours > 72 then raise exception 'MANUAL_MAR_RELATIVE_HOURS_INVALID'; end if;
    end if;
  end loop;
end;
$$;

create or replace function public.get_manual_mar_readiness()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return jsonb_build_object('available', true, 'ready', true, 'schemaVersion', 1, 'automaticGeneration', false);
end;
$$;

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
begin
  if actor is null then raise exception 'MANUAL_MAR_AUTH_REQUIRED'; end if;
  select role into actor_role from public.profiles where id = actor;
  select patient_id, school_id into room_patient, room_school from public.rooms where id = p_room_id;
  if room_patient is distinct from p_patient_id then raise exception 'MANUAL_MAR_ROOM_PATIENT_MISMATCH'; end if;
  if p_assignment_id is null then
    if actor_role not in ('school_admin', 'super_admin') then raise exception 'MANUAL_MAR_ADMIN_REQUIRED'; end if;
    if actor_role <> 'super_admin' and not exists (select 1 from public.profiles where id = actor and school_id = room_school) then raise exception 'MANUAL_MAR_SCHOOL_SCOPE_MISMATCH'; end if;
  else
    if not exists (select 1 from public.student_room_assignments a where a.id = p_assignment_id and a.student_id = actor and a.room_id = p_room_id and coalesce(a.case_key_version, a.scenario_baseline_version::text) = p_case_version and exists (select 1 from public.rooms r where r.id = a.room_id and r.patient_id = p_patient_id)) then
      raise exception 'MANUAL_MAR_ASSIGNMENT_SCOPE_MISMATCH';
    end if;
  end if;
  select * into packet from public.manual_mar_packets where patient_id = p_patient_id and room_id = p_room_id and case_version = p_case_version;
  if not found then return null; end if;
  return jsonb_build_object('id', packet.id, 'patientId', packet.patient_id, 'roomId', packet.room_id, 'caseVersion', packet.case_version, 'revision', packet.revision, 'events', packet.events, 'updatedAt', packet.updated_at);
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
begin
  if actor is null then raise exception 'MANUAL_MAR_AUTH_REQUIRED'; end if;
  select role into actor_role from public.profiles where id = actor;
  if actor_role not in ('school_admin', 'super_admin') then raise exception 'MANUAL_MAR_ADMIN_REQUIRED'; end if;
  if p_request_id is null or p_patient_id is null or p_room_id is null or nullif(btrim(p_case_version), '') is null or p_expected_revision is null or p_expected_revision < 0 then raise exception 'MANUAL_MAR_INVALID_REQUEST'; end if;
  perform public.manual_mar_validate_events(p_events);
  select patient_id, school_id into room_patient, room_school from public.rooms where id = p_room_id;
  if room_patient is distinct from p_patient_id then raise exception 'MANUAL_MAR_ROOM_PATIENT_MISMATCH'; end if;
  if actor_role <> 'super_admin' and not exists (select 1 from public.profiles where id = actor and school_id = room_school) then raise exception 'MANUAL_MAR_SCHOOL_SCOPE_MISMATCH'; end if;
  perform pg_advisory_xact_lock(hashtext('manual-mar:' || p_patient_id::text || ':' || p_room_id::text || ':' || p_case_version));
  select * into prior_audit from public.manual_mar_packet_audit where request_id = p_request_id;
  if found then
    return jsonb_build_object('packetId', prior_audit.packet_id, 'revision', prior_audit.next_revision, 'caseVersion', p_case_version);
  end if;
  select * into packet from public.manual_mar_packets where patient_id = p_patient_id and room_id = p_room_id and case_version = p_case_version for update;
  if not found then
    if p_expected_revision <> 0 then raise exception 'MANUAL_MAR_REVISION_CONFLICT'; end if;
    insert into public.manual_mar_packets(patient_id, room_id, case_version, revision, events, created_by)
      values (p_patient_id, p_room_id, p_case_version, 1, p_events, actor) returning * into packet;
  else
    if packet.revision <> p_expected_revision then raise exception 'MANUAL_MAR_REVISION_CONFLICT'; end if;
    next_revision := packet.revision + 1;
    update public.manual_mar_packets set revision = next_revision, events = p_events, updated_at = now(), created_by = actor where id = packet.id returning * into packet;
  end if;
  insert into public.manual_mar_packet_audit(packet_id, request_id, prior_revision, next_revision, events, actor_id)
    values (packet.id, p_request_id, packet.revision - 1, packet.revision, p_events, actor)
    on conflict (request_id) do nothing;
  return jsonb_build_object('packetId', packet.id, 'revision', packet.revision, 'caseVersion', packet.case_version);
end;
$$;

revoke all on function public.manual_mar_validate_events(jsonb) from public, anon, authenticated;
revoke all on function public.get_manual_mar_readiness() from public, anon;
revoke all on function public.get_manual_mar_packet(uuid, integer, uuid, text) from public, anon;
revoke all on function public.save_manual_mar_packet(uuid, uuid, integer, text, integer, jsonb) from public, anon;
grant execute on function public.get_manual_mar_readiness() to authenticated;
grant execute on function public.get_manual_mar_packet(uuid, integer, uuid, text) to authenticated;
grant execute on function public.save_manual_mar_packet(uuid, uuid, integer, text, integer, jsonb) to authenticated;
