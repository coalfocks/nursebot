-- Append-only upgrade for production databases that already applied
-- 20261019060000_atomic_consultant_transport_v2.sql before the sequence
-- columns existed. Never edit or rerun the applied migration.
-- Depends on 20261019073000 and 20261019080000.

do $$
begin
  if to_regclass('public.consultant_chat_messages') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'consultant_chat_messages' and column_name = 'message_sequence')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'consultant_chat_messages' and column_name = 'request_receipt_at') then
    raise exception 'CONSULTANT_SEQUENCE_SCHEMA_NOT_READY: apply 20261019080000_qa_integrity_repairs.sql first';
  end if;
end;
$$;

create or replace function public.persist_consultant_response_v2(
  p_student_id uuid,
  p_assignment_id uuid,
  p_client_request_id uuid,
  p_patient_id uuid,
  p_room_id bigint,
  p_audience text,
  p_specialty text,
  p_message text,
  p_payload_hash text,
  p_response text,
  p_disposition text,
  p_lease_token uuid
)
returns table(
  result_request_id uuid,
  result_order_id uuid,
  result_status text,
  result_disposition text,
  result_response text,
  result_idempotent boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  existing public.consultant_requests%rowtype;
  episode public.medical_orders%rowtype;
  persisted_status text;
begin
  if p_student_id is null or p_assignment_id is null or p_client_request_id is null
     or p_patient_id is null or p_room_id is null or p_lease_token is null
     or nullif(trim(p_message), '') is null or nullif(trim(p_response), '') is null then
    raise exception 'Consultant finalize requires frozen request and response identity' using errcode = '22023';
  end if;
  if p_audience not in ('adult', 'pediatric') then
    raise exception 'Invalid consultant audience' using errcode = '22023';
  end if;
  if p_disposition not in ('routine_review', 'assumes_care') then
    raise exception 'Invalid consultant disposition' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.student_room_assignments a
    join public.rooms r on r.id = a.room_id
    where a.id = p_assignment_id and a.student_id = p_student_id
      and a.room_id = p_room_id and r.patient_id = p_patient_id
  ) then
    raise exception 'Consultant request is not linked to the authenticated assignment' using errcode = '42501';
  end if;

  select cr.* into existing
  from public.consultant_requests as cr
  where cr.assignment_id = p_assignment_id
    and cr.client_request_id = p_client_request_id
  for update;

  if existing.id is null then
    raise exception 'Consultant request ledger row is missing' using errcode = 'P0002';
  end if;
  if existing.payload_hash is distinct from p_payload_hash
     or existing.assignment_id <> p_assignment_id
     or existing.audience is distinct from p_audience
     or existing.specialty <> trim(p_specialty)
     or existing.message <> p_message then
    raise exception 'Frozen consultant request payload does not match' using errcode = '23P01';
  end if;
  if existing.status in ('answered', 'assumes_care') then
    return query select existing.id, existing.consult_order_id, existing.status,
      existing.disposition, existing.response, true;
    return;
  end if;
  if existing.status <> 'requested' or existing.lease_token is distinct from p_lease_token
     or existing.lease_expires_at is null or existing.lease_expires_at <= timezone('utc', now()) then
    raise exception 'Consultant request lease is no longer owned' using errcode = '55P03';
  end if;

  select mo.* into episode
  from public.medical_orders as mo
  where mo.assignment_id = p_assignment_id
    and mo.consult_audience = p_audience
    and mo.consult_service = trim(p_specialty)
    and mo.category = 'Consult'
    and mo.override_scope = 'assignment'
    and mo.status = 'Active'
    and mo.deleted_at is null
  order by mo.order_time asc, mo.id asc
  limit 1
  for update;

  if episode.id is null then
    insert into public.medical_orders (
      patient_id, assignment_id, room_id, school_id, override_scope, category,
      order_name, priority, status, ordered_by, order_time, instructions,
      consult_audience, consult_service
    )
    select p_patient_id, p_assignment_id, p_room_id, r.school_id, 'assignment', 'Consult',
      concat('Consult: ', trim(p_specialty)), null, 'Active', 'Student', timezone('utc', now()),
      null, p_audience, trim(p_specialty)
    from public.rooms as r where r.id = p_room_id
    on conflict (assignment_id, consult_audience, consult_service)
      where category = 'Consult' and override_scope = 'assignment'
        and status = 'Active' and deleted_at is null
        and assignment_id is not null
        and consult_audience is not null and consult_service is not null
    do update set consult_service = excluded.consult_service
    returning * into episode;
  end if;

  insert into public.consultant_chat_messages (
    assignment_id, request_id, role, content, specialty, urgency,
    audience, consult_order_id, message_sequence, request_receipt_at
  ) values
    (p_assignment_id, existing.id, 'student', p_message, trim(p_specialty), null,
     p_audience, episode.id, 1, existing.created_at),
    (p_assignment_id, existing.id, 'consultant', trim(p_response), trim(p_specialty), null,
     p_audience, episode.id, 2, existing.created_at)
  on conflict (request_id, role) where request_id is not null do nothing;

  persisted_status := case when p_disposition = 'assumes_care' then 'assumes_care' else 'answered' end;
  update public.consultant_requests as cr
  set response = trim(p_response), disposition = p_disposition,
      consult_order_id = episode.id, status = persisted_status,
      answered_at = timezone('utc', now()), lease_token = null, lease_expires_at = null
  where cr.id = existing.id and cr.status = 'requested' and cr.lease_token = p_lease_token;

  if not found then
    select cr.* into existing from public.consultant_requests as cr where cr.id = existing.id;
    if existing.status in ('answered', 'assumes_care') then
      return query select existing.id, existing.consult_order_id, existing.status,
        existing.disposition, existing.response, true;
      return;
    end if;
    raise exception 'Consultant request finalize lost its lease' using errcode = '55P03';
  end if;
  return query select existing.id, episode.id, persisted_status, p_disposition, trim(p_response), false;
end;
$$;

revoke all on function public.persist_consultant_response_v2(uuid, uuid, uuid, uuid, bigint, text, text, text, text, text, text, uuid) from public;
grant execute on function public.persist_consultant_response_v2(uuid, uuid, uuid, uuid, bigint, text, text, text, text, text, text, uuid) to service_role;

create or replace function public.consultant_transport_preflight()
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'ready', to_regprocedure('public.persist_consultant_response_v2(uuid,uuid,uuid,uuid,bigint,text,text,text,text,text,text,uuid)') is not null
      and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'consultant_chat_messages' and column_name = 'message_sequence')
      and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'consultant_chat_messages' and column_name = 'request_receipt_at'),
    'schemaVersion', 4, 'functionVersion', 4,
    'atomicPersistence', to_regprocedure('public.persist_consultant_response_v2(uuid,uuid,uuid,uuid,bigint,text,text,text,text,text,text,uuid)') is not null
  );
$$;
