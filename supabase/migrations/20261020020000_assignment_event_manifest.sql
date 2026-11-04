-- Canonical, read-only assignment history for admin review, export, and feedback.
-- This function deliberately does not generate, assess, complete, or mutate data.
create or replace function public.get_assignment_event_manifest(p_assignment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment public.student_room_assignments%rowtype;
  v_profile public.profiles%rowtype;
  v_first_page timestamptz;
  v_first_page_id text;
  v_manifest jsonb;
begin
  select * into v_profile from public.profiles where id = auth.uid();
  if auth.role() is distinct from 'service_role'
     and (v_profile.id is null
       or (not coalesce(v_profile.is_admin, false)
           and coalesce(v_profile.role, '') not in ('school_admin', 'super_admin'))) then
    raise exception 'Assignment timeline is restricted to authorized administrators' using errcode = '42501';
  end if;

  select * into v_assignment
  from public.student_room_assignments
  where id = p_assignment_id;
  if v_assignment.id is null then
    raise exception 'Assignment not found' using errcode = 'P0002';
  end if;
  if coalesce(v_profile.role, '') = 'school_admin'
     and v_profile.school_id is distinct from v_assignment.school_id then
    raise exception 'Assignment is outside the administrator school scope' using errcode = '42501';
  end if;

  select m.created_at, m.id::text into v_first_page, v_first_page_id
  from public.chat_messages m
  where assignment_id = p_assignment_id
    and role in ('assistant', 'nurse')
    and content <> '<completed>'
  order by created_at asc, id asc
  limit 1;

  with raw_events as (
    -- Assignment creation and activation are explicit metadata events. The
    -- activation event is omitted when the persisted anchor is absent rather
    -- than being fabricated from a room date or render time.
    select jsonb_build_object(
      'event_id', 'assignment:' || v_assignment.id::text,
      'event_type', 'assignment_created',
      'actor', jsonb_build_object('role', 'system'),
      'channel', 'assignment',
      'service', null,
      'occurred_at', v_assignment.created_at,
      'timezone', 'UTC',
      'elapsed_seconds', case when v_first_page is null or v_assignment.created_at is null then null else extract(epoch from v_assignment.created_at - v_first_page) end,
      'sequence', null,
      'ordering_ambiguous', false,
      'content', jsonb_build_object('status', v_assignment.status, 'window_start', v_assignment.window_start, 'window_end', v_assignment.window_end),
      'links', jsonb_build_object('assignment_id', v_assignment.id),
      'provenance', jsonb_build_object('table', 'student_room_assignments', 'row_id', v_assignment.id, 'timestamp_field', 'created_at', 'recorded', true)
    ) as event_json, v_assignment.created_at as event_at, null::numeric as event_sequence, v_assignment.id::text as tie_id
    union all
    select jsonb_build_object(
      'event_id', 'activation:' || v_assignment.id::text,
      'event_type', 'assignment_activated',
      'actor', jsonb_build_object('role', 'system'),
      'channel', 'assignment', 'service', null,
      'occurred_at', v_assignment.scoring_start_at, 'timezone', 'UTC',
      'elapsed_seconds', case when v_first_page is null or v_assignment.scoring_start_at is null then null else extract(epoch from v_assignment.scoring_start_at - v_first_page) end, 'sequence', null, 'ordering_ambiguous', false,
      'content', jsonb_build_object('status', v_assignment.status),
      'links', jsonb_build_object('assignment_id', v_assignment.id),
      'provenance', jsonb_build_object('table', 'student_room_assignments', 'row_id', v_assignment.id, 'timestamp_field', 'scoring_start_at', 'recorded', true)
    ), v_assignment.scoring_start_at, null::numeric, v_assignment.id::text
    where v_assignment.scoring_start_at is not null
    union all
    select jsonb_build_object(
      'event_id', 'completion:' || v_assignment.id::text,
      'event_type', 'assignment_completed',
      'actor', jsonb_build_object('role', 'student'),
      'channel', 'assignment', 'service', null,
      'occurred_at', v_assignment.completed_at, 'timezone', 'UTC',
      'elapsed_seconds', case when v_first_page is null or v_assignment.completed_at is null then null else extract(epoch from v_assignment.completed_at - v_first_page) end,
      'sequence', null, 'ordering_ambiguous', false,
      'content', jsonb_build_object('status', v_assignment.status, 'completion_token_matched', v_assignment.completion_token_matched),
      'links', jsonb_build_object('assignment_id', v_assignment.id),
      'provenance', jsonb_build_object('table', 'student_room_assignments', 'row_id', v_assignment.id, 'timestamp_field', 'completed_at', 'recorded', true)
    ), v_assignment.completed_at, null::numeric, v_assignment.id::text
    where v_assignment.completed_at is not null
    union all
    select jsonb_build_object(
      'event_id', 'chat:' || m.id::text,
      'event_type', case when m.role::text in ('student', 'user') then 'student_message' else 'nurse_message' end,
      'actor', jsonb_build_object('role', m.role::text), 'channel', 'nurse', 'service', null,
      'occurred_at', m.created_at, 'timezone', 'UTC',
      'elapsed_seconds', case when v_first_page is null then null else extract(epoch from m.created_at - v_first_page) end,
      'sequence', null, 'ordering_ambiguous', false,
      'content', jsonb_build_object('text', m.content, 'triggered_completion', m.triggered_completion),
      'links', jsonb_build_object('assignment_id', m.assignment_id, 'message_id', m.id),
      'provenance', jsonb_build_object('table', 'chat_messages', 'row_id', m.id, 'timestamp_field', 'created_at', 'recorded', true)
    ), m.created_at, null::numeric, m.id::text
    from public.chat_messages m where m.assignment_id = p_assignment_id
    union all
    select jsonb_build_object(
      'event_id', 'patient-chat:' || m.id::text,
      'event_type', 'patient_message',
      'actor', jsonb_build_object('role', m.role), 'channel', 'patient', 'service', null,
      'occurred_at', m.created_at, 'timezone', 'UTC',
      'elapsed_seconds', case when v_first_page is null then null else extract(epoch from m.created_at - v_first_page) end,
      'sequence', null, 'ordering_ambiguous', false,
      'content', jsonb_build_object('text', m.content, 'role', m.role),
      'links', jsonb_build_object('assignment_id', m.assignment_id, 'message_id', m.id, 'reply_to_message_id', m.reply_to_client_message_id),
      'provenance', jsonb_build_object('table', 'patient_chat_messages', 'row_id', m.id, 'timestamp_field', 'created_at', 'recorded', true)
    ), m.created_at, null::numeric, m.id::text
    from public.patient_chat_messages m where m.assignment_id = p_assignment_id
    union all
    select jsonb_build_object(
      'event_id', 'consult-request:' || r.id::text,
      'event_type', 'consultant_request',
      'actor', jsonb_build_object('role', 'student'), 'channel', 'consultant',
      'service', jsonb_build_object('id', to_jsonb(r)->>'service_id', 'label', coalesce(to_jsonb(r)->>'service_label', to_jsonb(r)->>'specialty'), 'audience', to_jsonb(r)->>'audience', 'urgency', to_jsonb(r)->>'urgency'),
      'occurred_at', r.created_at, 'timezone', 'UTC',
      'elapsed_seconds', case when v_first_page is null then null else extract(epoch from r.created_at - v_first_page) end,
      'sequence', null, 'ordering_ambiguous', false,
      'content', jsonb_build_object('message', coalesce(to_jsonb(r)->>'message_text', to_jsonb(r)->>'clinical_question'), 'status', r.status, 'response', r.response, 'disposition', r.disposition),
      'links', jsonb_build_object('assignment_id', r.assignment_id, 'request_id', r.id, 'order_id', r.consult_order_id),
      'provenance', jsonb_build_object('table', 'consultant_requests', 'row_id', r.id, 'timestamp_field', 'created_at', 'recorded', true)
    ), r.created_at, null::numeric, r.id::text
    from public.consultant_requests r where r.assignment_id = p_assignment_id
    union all
    select jsonb_build_object(
      'event_id', 'consultant-message:' || m.id::text,
      'event_type', case when m.role = 'student' then 'consultant_message' else 'consultant_response' end,
      'actor', jsonb_build_object('role', m.role), 'channel', 'consultant',
      'service', jsonb_build_object('id', to_jsonb(m)->>'service_id', 'label', to_jsonb(m)->>'service_label', 'audience', to_jsonb(m)->>'audience', 'urgency', to_jsonb(m)->>'urgency'),
      'occurred_at', m.created_at, 'timezone', 'UTC',
      'elapsed_seconds', case when v_first_page is null then null else extract(epoch from m.created_at - v_first_page) end,
      'sequence', null, 'ordering_ambiguous', false,
      'content', jsonb_build_object('text', m.content),
      'links', jsonb_build_object('assignment_id', m.assignment_id, 'message_id', m.id, 'request_id', m.request_id, 'order_id', m.consult_order_id),
      'provenance', jsonb_build_object('table', 'consultant_chat_messages', 'row_id', m.id, 'timestamp_field', 'created_at', 'recorded', true)
    ), m.created_at, null::numeric, m.id::text
    from public.consultant_chat_messages m where m.assignment_id = p_assignment_id
    union all
    select jsonb_build_object(
      'event_id', 'order:' || o.id::text, 'event_type', 'order_placed',
      'actor', jsonb_build_object('role', coalesce(o.ordered_by, 'unknown')), 'channel', 'orders', 'service', null,
      'occurred_at', coalesce(o.order_time, o.created_at), 'timezone', 'UTC',
      'elapsed_seconds', case when v_first_page is null then null else extract(epoch from coalesce(o.order_time, o.created_at) - v_first_page) end,
      'sequence', null, 'ordering_ambiguous', false,
      'content', jsonb_build_object('category', o.category, 'name', o.order_name, 'dose', o.dose, 'route', o.route, 'frequency', o.frequency, 'priority', o.priority, 'status', o.status, 'instructions', o.instructions),
      'links', jsonb_build_object('assignment_id', o.assignment_id, 'order_id', o.id),
      'provenance', jsonb_build_object('table', 'medical_orders', 'row_id', o.id, 'timestamp_field', case when o.order_time is not null then 'order_time' else 'created_at' end, 'recorded', true)
    ), coalesce(o.order_time, o.created_at), null::numeric, o.id::text
    from public.medical_orders o where o.assignment_id = p_assignment_id
    union all
    select jsonb_build_object(
      'event_id', 'lab:' || l.id::text, 'event_type', 'lab_result',
      'actor', jsonb_build_object('role', coalesce(l.ordered_by, 'system')), 'channel', 'results', 'service', null,
      'occurred_at', coalesce(l.result_time, l.collection_time, l.created_at), 'timezone', 'UTC',
      'elapsed_seconds', case when v_first_page is null then null else extract(epoch from coalesce(l.result_time, l.collection_time, l.created_at) - v_first_page) end,
      'sequence', null, 'ordering_ambiguous', false,
      'content', jsonb_build_object('test_name', l.test_name, 'value', l.value, 'unit', l.unit, 'text_value', l.text_value, 'status', l.status, 'interpretation', l.interpretation),
      'links', jsonb_build_object('assignment_id', l.assignment_id, 'result_id', l.id),
      'provenance', jsonb_build_object('table', 'lab_results', 'row_id', l.id, 'timestamp_field', case when l.result_time is not null then 'result_time' else 'collection_time' end, 'recorded', true)
    ), coalesce(l.result_time, l.collection_time, l.created_at), null::numeric, l.id::text
    from public.lab_results l where l.assignment_id = p_assignment_id and l.deleted_at is null
    union all
    select jsonb_build_object(
      'event_id', 'vital:' || v.id::text, 'event_type', 'vital_observed',
      'actor', jsonb_build_object('role', 'system'), 'channel', 'vitals', 'service', null,
      'occurred_at', v.timestamp, 'timezone', 'UTC', 'elapsed_seconds', case when v_first_page is null then null else extract(epoch from v.timestamp - v_first_page) end,
      'sequence', null, 'ordering_ambiguous', false,
      'content', to_jsonb(v) - 'id' - 'assignment_id' - 'patient_id' - 'room_id' - 'school_id' - 'created_at' - 'updated_at' - 'deleted_at',
      'links', jsonb_build_object('assignment_id', v.assignment_id, 'vital_id', v.id),
      'provenance', jsonb_build_object('table', 'vital_signs', 'row_id', v.id, 'timestamp_field', 'timestamp', 'recorded', true)
    ), v.timestamp, null::numeric, v.id::text
    from public.vital_signs v where v.assignment_id = p_assignment_id and v.deleted_at is null
    union all
    select jsonb_build_object(
      'event_id', 'imaging:' || i.id::text, 'event_type', 'imaging_result',
      'actor', jsonb_build_object('role', coalesce(i.ordered_by, 'system')), 'channel', 'imaging', 'service', null,
      'occurred_at', coalesce(i.report_generated_at, i.order_time, i.created_at), 'timezone', 'UTC',
      'elapsed_seconds', case when v_first_page is null then null else extract(epoch from coalesce(i.report_generated_at, i.order_time, i.created_at) - v_first_page) end,
      'sequence', null, 'ordering_ambiguous', false,
      'content', jsonb_build_object('study_type', i.study_type, 'order_name', i.order_name, 'status', i.status, 'report', i.report, 'impression', i.impression),
      'links', jsonb_build_object('assignment_id', i.assignment_id, 'study_id', i.id),
      'provenance', jsonb_build_object('table', 'imaging_studies', 'row_id', i.id, 'timestamp_field', 'report_generated_at', 'recorded', true)
    ), coalesce(i.report_generated_at, i.order_time, i.created_at), null::numeric, i.id::text
    from public.imaging_studies i where i.assignment_id = p_assignment_id and i.deleted_at is null
    union all
    select jsonb_build_object(
      'event_id', 'action:' || a.id::text, 'event_type', 'bedside_action',
      'actor', jsonb_build_object('id', a.created_by, 'role', 'student'), 'channel', a.channel, 'service', null,
      'occurred_at', coalesce(a.occurred_at, a.created_at), 'timezone', 'UTC',
      'elapsed_seconds', case when v_first_page is null then null else extract(epoch from coalesce(a.occurred_at, a.created_at) - v_first_page) end,
      'sequence', null, 'ordering_ambiguous', false, 'content', jsonb_build_object('action_type', a.action_type, 'text', a.content),
      'links', jsonb_build_object('assignment_id', a.assignment_id, 'action_id', a.id),
      'provenance', jsonb_build_object('table', 'learner_action_events', 'row_id', a.id, 'timestamp_field', case when a.occurred_at is not null then 'occurred_at' else 'created_at' end, 'recorded', true)
    ), coalesce(a.occurred_at, a.created_at), null::numeric, a.id::text
    from public.learner_action_events a where a.assignment_id = p_assignment_id
    union all
    select jsonb_build_object(
      'event_id', 'note:' || n.id::text, 'event_type', 'progress_note',
      'actor', jsonb_build_object('role', coalesce(n.author, 'unknown')), 'channel', 'note', 'service', null,
      'occurred_at', coalesce(n.timestamp, n.updated_at, n.created_at), 'timezone', 'UTC',
      'elapsed_seconds', case when v_first_page is null then null else extract(epoch from coalesce(n.timestamp, n.updated_at, n.created_at) - v_first_page) end,
      'sequence', n.record_version, 'ordering_ambiguous', false,
      'content', jsonb_build_object('title', n.title, 'note_type', n.note_type, 'text', n.content, 'signed', n.signed, 'record_version', n.record_version),
      'links', jsonb_build_object('assignment_id', n.assignment_id, 'note_id', n.id),
      'provenance', jsonb_build_object('table', 'clinical_notes', 'row_id', n.id, 'timestamp_field', case when n.timestamp is not null then 'timestamp' else 'updated_at' end, 'recorded', true)
    ), coalesce(n.timestamp, n.updated_at, n.created_at), n.record_version::numeric, n.id::text
    from public.clinical_notes n where n.assignment_id = p_assignment_id and n.deleted_at is null
    union all
    select jsonb_build_object(
      'event_id', 'assignment-note:' || v_assignment.id::text, 'event_type', 'progress_note',
      'actor', jsonb_build_object('role', 'student'), 'channel', 'note', 'service', null,
      'occurred_at', v_assignment.completed_at, 'timezone', 'UTC',
      'elapsed_seconds', case when v_first_page is null or v_assignment.completed_at is null then null else extract(epoch from v_assignment.completed_at - v_first_page) end,
      'sequence', null, 'ordering_ambiguous', false,
      'content', jsonb_build_object('text', v_assignment.student_progress_note, 'timestamp_note', 'Completion time is recorded; note-save time is not persisted.'),
      'links', jsonb_build_object('assignment_id', v_assignment.id),
      'provenance', jsonb_build_object('table', 'student_room_assignments', 'row_id', v_assignment.id, 'timestamp_field', 'completed_at', 'recorded', true, 'timestamp_is_save_time', false)
    ), v_assignment.completed_at, null::numeric, v_assignment.id::text
    where nullif(trim(v_assignment.student_progress_note), '') is not null
    union all
    select jsonb_build_object(
      'event_id', 'hint:' || v_assignment.id::text || ':' || h.key,
      'event_type', 'hint_shown', 'actor', jsonb_build_object('role', 'student'), 'channel', 'hint', 'service', null,
      'occurred_at', nullif(h.value->>'viewedAt', '')::timestamptz, 'timezone', 'UTC',
      'elapsed_seconds', case when v_first_page is null or nullif(h.value->>'viewedAt', '') is null then null else extract(epoch from nullif(h.value->>'viewedAt', '')::timestamptz - v_first_page) end,
      'sequence', null, 'ordering_ambiguous', false,
      'content', jsonb_build_object('hint_key', h.key, 'view', h.value, 'note', 'Hint content is included only when persisted in the assignment view record.'),
      'links', jsonb_build_object('assignment_id', v_assignment.id),
      'provenance', jsonb_build_object('table', 'student_room_assignments', 'row_id', v_assignment.id, 'timestamp_field', 'completion_hint_views', 'recorded', true)
    ), nullif(h.value->>'viewedAt', '')::timestamptz, null::numeric, h.key
    from jsonb_each(coalesce(v_assignment.completion_hint_views, '{}'::jsonb)) h
    where jsonb_typeof(h.value) = 'object' and nullif(h.value->>'viewedAt', '') is not null
  ), marked as (
    select event_json, event_at, event_sequence, tie_id,
      count(*) over (partition by event_at) > 1 and bool_and(event_sequence is null) over (partition by event_at) as ambiguous_time
    from raw_events
  ), ordered as (
    select jsonb_set(event_json, '{ordering_ambiguous}', to_jsonb(coalesce(ambiguous_time, false)), true) as event_json, event_at, event_sequence, tie_id
    from marked
  )
  select jsonb_build_object(
    'manifest_version', 1,
    'assignment_id', v_assignment.id,
    'generated_at', timezone('utc', now()),
    'scoring_boundary', jsonb_build_object('first_page_event_id', case when v_first_page_id is null then null else 'chat:' || v_first_page_id end, 'scoring_start_at', v_assignment.scoring_start_at, 'note', 'The assignment timeline begins at creation; first nurse page remains the scoring boundary.'),
    'events', coalesce((select jsonb_agg(event_json order by event_at nulls last, event_sequence nulls last, tie_id) from ordered), '[]'::jsonb),
    'gaps', to_jsonb(array_remove(array[
      case when v_first_page is null then 'No first nurse page was recorded.' end,
      case when v_assignment.student_progress_note is not null and v_assignment.completed_at is not null then 'Assignment progress-note save time is not separately persisted; completion time is shown as an association, not an asserted save time.' end,
      case when exists (select 1 from jsonb_each(coalesce(v_assignment.completion_hint_views, '{}'::jsonb)) h where jsonb_typeof(h.value) = 'object' and nullif(h.value->>'viewedAt', '') is not null) then null else 'No persisted hint-view events were recorded.' end,
      'Same-time events without a recorded sequence are explicitly marked ambiguous; their display order is not a clinical assertion.'
    ], null)),
    'feedback', jsonb_build_object('latest_source_event_ids', (select source_event_ids from public.feedback_assessment_runs where assignment_id = p_assignment_id order by created_at desc limit 1), 'feedback_status', v_assignment.feedback_status)
  ) into v_manifest;
  return v_manifest;
end;
$$;

revoke all on function public.get_assignment_event_manifest(uuid) from public;
grant execute on function public.get_assignment_event_manifest(uuid) to authenticated;
comment on function public.get_assignment_event_manifest(uuid) is 'Read-only, assignment-scoped canonical history for admin evidence review, export, and feedback. Never generates or mutates clinical data.';
