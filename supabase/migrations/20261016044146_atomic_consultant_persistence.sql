-- Persist a consultant request, its assignment-scoped order, and both
-- conversation messages as one database transaction. The Edge Function still
-- owns authentication and model generation; this function owns exact-once
-- persistence and validates the authenticated learner identity it receives.

create or replace function public.persist_consultant_response(
  p_student_id uuid,
  p_assignment_id uuid,
  p_client_request_id uuid,
  p_patient_id uuid,
  p_room_id bigint,
  p_specialty text,
  p_summary text,
  p_clinical_question text,
  p_reason text,
  p_urgency text,
  p_response text,
  p_disposition text
)
returns table(
  request_id uuid,
  order_id uuid,
  status text,
  disposition text,
  response text,
  idempotent boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  existing public.consultant_requests%rowtype;
  inserted_order public.medical_orders%rowtype;
  persisted_status text;
begin
  if p_student_id is null or p_assignment_id is null or p_client_request_id is null
     or p_patient_id is null or p_room_id is null or nullif(trim(p_response), '') is null then
    raise exception 'Consultant persistence requires assignment, patient, request, and response identity' using errcode = '22023';
  end if;

  if p_urgency not in ('routine', 'urgent', 'emergent') then
    raise exception 'Invalid consultant urgency' using errcode = '22023';
  end if;
  if p_disposition not in ('routine_review', 'assumes_care') then
    raise exception 'Invalid consultant disposition' using errcode = '22023';
  end if;

  select cr.* into existing
  from public.consultant_requests cr
  where cr.assignment_id = p_assignment_id
    and cr.client_request_id = p_client_request_id
  for update;

  if existing.id is not null and existing.status in ('answered', 'assumes_care') then
    return query select existing.id, existing.consult_order_id, existing.status,
      existing.disposition, existing.response, true;
    return;
  end if;

  if not exists (
    select 1
    from public.student_room_assignments a
    join public.rooms r on r.id = a.room_id
    where a.id = p_assignment_id
      and a.student_id = p_student_id
      and a.room_id = p_room_id
      and r.patient_id = p_patient_id
  ) then
    raise exception 'Consultant request is not linked to the authenticated assignment' using errcode = '42501';
  end if;

  if existing.id is null then
    insert into public.consultant_requests (
      assignment_id, patient_id, room_id, specialty, summary,
      clinical_question, reason, urgency, client_request_id, status
    ) values (
      p_assignment_id, p_patient_id, p_room_id, trim(p_specialty), trim(p_summary),
      trim(p_clinical_question), trim(p_reason), p_urgency, p_client_request_id, 'requested'
    ) returning * into existing;
  else
    update public.consultant_requests
    set patient_id = p_patient_id,
        room_id = p_room_id,
        specialty = trim(p_specialty),
        summary = trim(p_summary),
        clinical_question = trim(p_clinical_question),
        reason = trim(p_reason),
        urgency = p_urgency,
        status = 'requested',
        response = null,
        disposition = 'routine_review',
        consult_order_id = null,
        answered_at = null
    where id = existing.id
    returning * into existing;
  end if;

  insert into public.medical_orders (
    patient_id, assignment_id, room_id, school_id, override_scope, category,
    order_name, priority, status, ordered_by, order_time, instructions
  )
  select p_patient_id, p_assignment_id, p_room_id, r.school_id, 'assignment', 'Consult',
    concat('Consult: ', trim(p_specialty)),
    case when p_urgency = 'emergent' then 'STAT' when p_urgency = 'urgent' then 'Urgent' else 'Routine' end,
    'Active', 'Student', timezone('utc', now()),
    concat('Summary: ', trim(p_summary), E'\nQuestion: ', trim(p_clinical_question), E'\nReason: ', trim(p_reason))
  from public.rooms r where r.id = p_room_id
  returning * into inserted_order;

  insert into public.consultant_chat_messages (
    assignment_id, request_id, role, content, specialty, urgency, consult_order_id
  ) values
    (p_assignment_id, existing.id, 'student',
     concat(trim(p_specialty), ' consult (', p_urgency, '): ', trim(p_summary), ' Question: ', trim(p_clinical_question), ' Reason: ', trim(p_reason)),
     trim(p_specialty), p_urgency, inserted_order.id),
    (p_assignment_id, existing.id, 'consultant', trim(p_response), trim(p_specialty), p_urgency, inserted_order.id);

  persisted_status := case when p_disposition = 'assumes_care' then 'assumes_care' else 'answered' end;
  update public.consultant_requests
  set response = trim(p_response), disposition = p_disposition,
      consult_order_id = inserted_order.id, status = persisted_status,
      answered_at = timezone('utc', now())
  where id = existing.id;

  return query select existing.id, inserted_order.id, persisted_status, p_disposition, trim(p_response), false;
end;
$$;

revoke all on function public.persist_consultant_response(uuid, uuid, uuid, uuid, bigint, text, text, text, text, text, text, text) from public;
grant execute on function public.persist_consultant_response(uuid, uuid, uuid, uuid, bigint, text, text, text, text, text, text, text) to service_role;

comment on function public.persist_consultant_response is
  'Exact-once transactional persistence for an authenticated learner consultant response; the caller must verify the bearer identity before passing p_student_id.';
