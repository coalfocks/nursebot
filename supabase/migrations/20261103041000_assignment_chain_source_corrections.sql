-- Source-only correction layered after 20261103035651.
-- This remains unapplied. It adds a prospective intent fence and replaces the
-- writer/reader functions without changing the existing MAR creator.

create table if not exists public.assignment_chain_intents (
  chain_id uuid primary key,
  ordered_assignment_ids uuid[] not null,
  envelope jsonb not null,
  envelope_hash text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint assignment_chain_intents_order_check check (
    cardinality(ordered_assignment_ids) = 3
    and ordered_assignment_ids[1] is distinct from ordered_assignment_ids[2]
    and ordered_assignment_ids[1] is distinct from ordered_assignment_ids[3]
    and ordered_assignment_ids[2] is distinct from ordered_assignment_ids[3]
  ),
  constraint assignment_chain_intents_envelope_check check (jsonb_typeof(envelope) = 'object')
);

alter table public.assignment_chain_intents enable row level security;
revoke all on public.assignment_chain_intents from public, anon, authenticated;

create or replace function public.begin_assignment_chain_intent(
  p_chain_id uuid,
  p_ordered_assignment_ids uuid[],
  p_envelope jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  actor_role text;
  envelope_hash text;
  prior public.assignment_chain_intents%rowtype;
  position integer;
  captured_room_id integer;
  room_patient uuid;
  room_continues_from integer;
  room_progress_note text;
  previous_room_id integer;
  first_patient uuid;
  authored_version text;
  authored_captured_at timestamptz;
begin
  if actor is null then raise exception 'ASSIGNMENT_CHAIN_AUTH_REQUIRED'; end if;
  select p.role into actor_role from public.profiles p where p.id = actor;
  if actor_role is null or actor_role not in ('school_admin', 'super_admin') then
    raise exception 'ASSIGNMENT_CHAIN_ADMIN_REQUIRED';
  end if;
  if p_chain_id is null or p_ordered_assignment_ids is null
     or cardinality(p_ordered_assignment_ids) <> 3
     or p_envelope is null or jsonb_typeof(p_envelope) <> 'object'
     or jsonb_typeof(p_envelope->'assignments') <> 'array'
     or jsonb_array_length(p_envelope->'assignments') <> 3 then
    raise exception 'ASSIGNMENT_CHAIN_INVALID';
  end if;
  envelope_hash := encode(extensions.digest(convert_to(p_envelope::text, 'utf8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtext('assignment-chain:' || p_chain_id::text));
  select * into prior from public.assignment_chain_intents where chain_id = p_chain_id for update;
  if found then
    if prior.created_by <> actor or prior.ordered_assignment_ids <> p_ordered_assignment_ids
       or prior.envelope_hash is distinct from envelope_hash then
      raise exception 'ASSIGNMENT_CHAIN_ENVELOPE_MISMATCH';
    end if;
    return jsonb_build_object('chainId', p_chain_id, 'envelopeHash', envelope_hash, 'replayed', true);
  end if;
  for position in 1..3 loop
    if p_envelope->'assignments'->(position - 1)->>'assignmentId' is distinct from p_ordered_assignment_ids[position]::text
       or p_envelope->'assignments'->(position - 1)->>'stage' is distinct from case position when 1 then 'A' when 2 then 'B' else 'C' end then
      raise exception 'ASSIGNMENT_CHAIN_ENVELOPE_MISMATCH';
    end if;
    captured_room_id := nullif(p_envelope->'assignments'->(position - 1)->>'roomId', '')::integer;
    authored_version := nullif(p_envelope->'assignments'->(position - 1)->>'authoredSourceVersion', '');
    authored_captured_at := nullif(p_envelope->'assignments'->(position - 1)->>'authoredCapturedAt', '')::timestamptz;
    if captured_room_id is null or authored_version is null or authored_captured_at is null then
      raise exception 'ASSIGNMENT_CHAIN_AUTHORED_SOURCE_MISMATCH';
    end if;
    select r.patient_id, r.continues_from, r.progress_note
      into room_patient, room_continues_from, room_progress_note
      from public.rooms r where r.id = captured_room_id for share;
    if room_patient is null then raise exception 'ASSIGNMENT_CHAIN_ROOM_NOT_FOUND'; end if;
    if position = 1 then
      first_patient := room_patient;
      if room_continues_from is not null then raise exception 'ASSIGNMENT_CHAIN_LINEAGE_MISMATCH'; end if;
    elsif room_patient is distinct from first_patient or room_continues_from is distinct from previous_room_id then
      raise exception 'ASSIGNMENT_CHAIN_LINEAGE_MISMATCH';
    end if;
    if p_envelope->'assignments'->(position - 1)->>'authoredProgressNote' is distinct from room_progress_note then
      raise exception 'ASSIGNMENT_CHAIN_AUTHORED_SOURCE_MISMATCH';
    end if;
    if not exists (
      select 1 from public.mar_authored_case_versions v
      where v.room_id = captured_room_id and v.case_version = authored_version
    ) then
      raise exception 'ASSIGNMENT_CHAIN_AUTHORED_SOURCE_MISMATCH';
    end if;
    previous_room_id := captured_room_id;
  end loop;
  insert into public.assignment_chain_intents(chain_id, ordered_assignment_ids, envelope, envelope_hash, created_by)
  values (p_chain_id, p_ordered_assignment_ids, p_envelope, envelope_hash, actor);
  return jsonb_build_object('chainId', p_chain_id, 'envelopeHash', envelope_hash, 'replayed', false);
end;
$$;

revoke all on function public.begin_assignment_chain_intent(uuid, uuid[], jsonb) from public, anon;
grant execute on function public.begin_assignment_chain_intent(uuid, uuid[], jsonb) to authenticated;

create or replace function public.create_assignment_chain_with_snapshots(
  p_chain_id uuid, p_ordered_assignment_ids uuid[], p_envelope jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid(); actor_role text; actor_school uuid;
  owner_id uuid; assignment_count integer; materialization_count integer;
  expected_window_start timestamptz; expected_window_end timestamptz;
  envelope_hash text; intent public.assignment_chain_intents%rowtype;
  prior public.assignment_chains%rowtype; snapshot_count integer;
  position integer;
begin
  if actor is null then raise exception 'ASSIGNMENT_CHAIN_AUTH_REQUIRED'; end if;
  select p.role, p.school_id into actor_role, actor_school from public.profiles p where p.id = actor;
  if actor_role is null or actor_role not in ('school_admin', 'super_admin') then
    raise exception 'ASSIGNMENT_CHAIN_ADMIN_REQUIRED';
  end if;
  if p_chain_id is null or p_ordered_assignment_ids is null
     or cardinality(p_ordered_assignment_ids) <> 3
     or p_envelope is null or jsonb_typeof(p_envelope) <> 'object'
     or jsonb_typeof(p_envelope->'assignments') <> 'array'
     or jsonb_array_length(p_envelope->'assignments') <> 3 then
    raise exception 'ASSIGNMENT_CHAIN_INVALID';
  end if;
  for position in 1..3 loop
    if p_envelope->'assignments'->(position - 1)->>'assignmentId' is distinct from p_ordered_assignment_ids[position]::text
       or p_envelope->'assignments'->(position - 1)->>'stage' is distinct from case position when 1 then 'A' when 2 then 'B' else 'C' end then
      raise exception 'ASSIGNMENT_CHAIN_ENVELOPE_MISMATCH';
    end if;
  end loop;
  envelope_hash := encode(extensions.digest(convert_to(p_envelope::text, 'utf8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtext('assignment-chain:' || p_chain_id::text));

  select * into intent from public.assignment_chain_intents where chain_id = p_chain_id for update;
  if not found or intent.created_by <> actor or intent.ordered_assignment_ids <> p_ordered_assignment_ids
     or intent.envelope_hash is distinct from envelope_hash then
    raise exception 'ASSIGNMENT_CHAIN_INTENT_REQUIRED';
  end if;

  -- Replay returns the immutable prior result before reading mutable rooms.
  select * into prior from public.assignment_chains where chain_id = p_chain_id for update;
  if found then
    if prior.created_by <> actor or prior.ordered_assignment_ids <> p_ordered_assignment_ids
       or prior.envelope_hash is distinct from envelope_hash then
      raise exception 'ASSIGNMENT_CHAIN_ENVELOPE_MISMATCH';
    end if;
    select count(*) into snapshot_count from public.assignment_chain_snapshots where chain_id = p_chain_id;
    if snapshot_count <> 3 then raise exception 'ASSIGNMENT_CHAIN_SNAPSHOT_INCOMPLETE'; end if;
    return jsonb_build_object('chainId', p_chain_id, 'envelopeHash', envelope_hash, 'replayed', true, 'complete', true);
  end if;

  -- The current creator uses assignment_id as request_id. Requiring exact,
  -- post-intent operations binds this package to the real prospective batch.
  select count(*) into materialization_count
  from public.mar_assignment_materialization_operations o
  join public.student_room_assignments a on a.id = o.assignment_id
  where o.assignment_id = any(p_ordered_assignment_ids)
    and o.request_id = o.assignment_id
    and o.actor_id = actor
    and o.created_at > intent.created_at
    and o.student_id = a.student_id
    and o.room_id = a.room_id
    and o.case_version = a.case_key_version
    and o.result->>'assignmentId' = a.id::text
    and o.result->>'caseVersion' = a.case_key_version
    and exists (
      select 1 from jsonb_array_elements(intent.envelope->'assignments') with ordinality expected(value, position)
      where expected.position = array_position(p_ordered_assignment_ids, o.assignment_id)
        and (expected.value->>'roomId')::integer = o.room_id
        and expected.value->>'authoredSourceVersion' = o.case_version
    );
  if materialization_count <> 3 then raise exception 'ASSIGNMENT_CHAIN_MATERIALIZATION_INCOMPLETE'; end if;

  select count(*) into assignment_count from unnest(p_ordered_assignment_ids) ids(id)
    join public.student_room_assignments a on a.id = ids.id;
  if assignment_count <> 3 then raise exception 'ASSIGNMENT_CHAIN_MATERIALIZATION_INCOMPLETE'; end if;
  select a.student_id into owner_id
    from unnest(p_ordered_assignment_ids) with ordinality ids(id, position)
    join public.student_room_assignments a on a.id = ids.id
    order by ids.position limit 1;
  select min(a.window_start), min(a.window_end)
    into expected_window_start, expected_window_end
    from unnest(p_ordered_assignment_ids) ids(id)
    join public.student_room_assignments a on a.id = ids.id;
  if owner_id is null then raise exception 'ASSIGNMENT_CHAIN_OWNER_MISSING'; end if;
  if exists (select 1 from unnest(p_ordered_assignment_ids) ids(id)
    join public.student_room_assignments a on a.id = ids.id
    where a.student_id is distinct from owner_id or a.window_start is distinct from expected_window_start
      or a.window_end is distinct from expected_window_end) then
    raise exception 'ASSIGNMENT_CHAIN_MEMBER_MISMATCH';
  end if;
  if actor_role <> 'super_admin' and exists (
    select 1 from public.student_room_assignments a join public.rooms r on r.id = a.room_id
    where a.id = any(p_ordered_assignment_ids)
      and (a.school_id is distinct from actor_school or r.school_id is distinct from actor_school)
  ) then raise exception 'ASSIGNMENT_CHAIN_SCHOOL_SCOPE_MISMATCH'; end if;

  -- Lock assignments for the final identity check. Authored content comes
  -- from the intent captured above, never from a mutable room reread.
  perform 1 from public.student_room_assignments a where a.id = any(p_ordered_assignment_ids) for update;

  insert into public.assignment_chains(chain_id, owner_id, ordered_assignment_ids, window_start, window_end, envelope, envelope_hash, created_by)
  values (p_chain_id, owner_id, p_ordered_assignment_ids, expected_window_start, expected_window_end, intent.envelope, envelope_hash, actor);
  insert into public.assignment_chain_snapshots(
    chain_id, target_assignment_id, source_assignment_id, target_stage, source_stage, source_room_id,
    authored_source_version, authored_content, authored_content_hash, authored_captured_at, created_by)
  select p_chain_id, target_spec.id, source_spec.id,
    case when target_spec.position = 2 then 'B' else 'C' end,
    case when source_spec.position = 1 then 'A' else 'B' end,
    (source_authored.value->>'roomId')::integer,
    source_authored.value->>'authoredSourceVersion',
    source_authored.value->>'authoredProgressNote',
    encode(extensions.digest(convert_to(coalesce(source_authored.value->>'authoredProgressNote', '') || ':' ||
      coalesce(source_authored.value->>'authoredSourceVersion', '') || ':' || coalesce(source_authored.value->>'roomId', ''), 'utf8'), 'sha256'), 'hex'),
    (source_authored.value->>'authoredCapturedAt')::timestamptz, actor
  from unnest(p_ordered_assignment_ids) with ordinality target_spec(id, position)
  join public.student_room_assignments target_assignment on target_assignment.id = target_spec.id
  join unnest(p_ordered_assignment_ids) with ordinality source_spec(id, position) on source_spec.position < target_spec.position
  join jsonb_array_elements(intent.envelope->'assignments') with ordinality source_authored(value, position)
    on source_authored.position = source_spec.position
  join public.student_room_assignments source_assignment
    on source_assignment.id = source_spec.id
    and source_assignment.room_id = (source_authored.value->>'roomId')::integer
  where target_spec.position > 1;
  select count(*) into snapshot_count from public.assignment_chain_snapshots where chain_id = p_chain_id;
  if snapshot_count <> 3 then raise exception 'ASSIGNMENT_CHAIN_SNAPSHOT_READBACK_MISMATCH'; end if;
  return jsonb_build_object('chainId', p_chain_id, 'envelopeHash', envelope_hash, 'replayed', false, 'complete', true);
end;
$$;

create or replace function public.get_assignment_chain_prior_stage_context(
  p_chain_id uuid, p_target_assignment_id uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid(); chain public.assignment_chains%rowtype;
  target_assignment public.student_room_assignments%rowtype;
  member_count integer; operation_count integer; prior_count integer; completed_prior_count integer; result jsonb;
begin
  if actor is null then raise exception 'ASSIGNMENT_CHAIN_AUTH_REQUIRED'; end if;
  select * into chain from public.assignment_chains where chain_id = p_chain_id and owner_id = actor;
  if not found then raise exception 'ASSIGNMENT_CHAIN_NOT_VISIBLE'; end if;
  select * into target_assignment from public.student_room_assignments where id = p_target_assignment_id and student_id = actor;
  if not found or not p_target_assignment_id = any(chain.ordered_assignment_ids) then raise exception 'ASSIGNMENT_CHAIN_NOT_VISIBLE'; end if;
  if target_assignment.status not in ('assigned', 'in_progress', 'bedside')
     or (target_assignment.effective_date is not null and target_assignment.effective_date > now()) then
    raise exception 'ASSIGNMENT_CHAIN_TARGET_NOT_ACTIVE';
  end if;
  select count(*) into member_count from public.student_room_assignments a where a.id = any(chain.ordered_assignment_ids) and a.student_id = actor;
  if member_count <> 3 then raise exception 'ASSIGNMENT_CHAIN_MATERIALIZATION_INCOMPLETE'; end if;
  select count(*) into operation_count
    from public.mar_assignment_materialization_operations o
    join public.student_room_assignments a on a.id = o.assignment_id
    join public.assignment_chain_intents i on i.chain_id = p_chain_id
    where o.assignment_id = any(chain.ordered_assignment_ids) and o.request_id = o.assignment_id
      and o.created_at > i.created_at and o.student_id = a.student_id and o.room_id = a.room_id
      and o.case_version = a.case_key_version and o.result->>'assignmentId' = a.id::text
      and o.result->>'caseVersion' = a.case_key_version
      and exists (
        select 1 from jsonb_array_elements(i.envelope->'assignments') with ordinality expected(value, position)
        where expected.position = array_position(chain.ordered_assignment_ids, o.assignment_id)
          and (expected.value->>'roomId')::integer = o.room_id
          and expected.value->>'authoredSourceVersion' = o.case_version
      );
  if operation_count <> 3 then raise exception 'ASSIGNMENT_CHAIN_MATERIALIZATION_INCOMPLETE'; end if;
  select coalesce(array_position(chain.ordered_assignment_ids, p_target_assignment_id) - 1, 0) into prior_count;
  select count(*) into completed_prior_count from unnest(chain.ordered_assignment_ids[1:greatest(prior_count, 0)]) prior(assignment_id)
    join public.student_room_assignments a on a.id = prior.assignment_id
    where a.student_id = actor and a.status = 'completed' and a.completed_at is not null;
  if completed_prior_count <> prior_count then raise exception 'ASSIGNMENT_CHAIN_PREDECESSOR_NOT_COMPLETED'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('chainId', s.chain_id, 'targetAssignmentId', s.target_assignment_id,
    'targetStage', s.target_stage, 'sourceAssignmentId', s.source_assignment_id, 'sourceRoomId', s.source_room_id,
    'sourceStage', s.source_stage, 'authoredSourceVersion', s.authored_source_version,
    'authoredCapturedAt', s.authored_captured_at, 'sourceCompletedAt', a.completed_at, 'content', s.authored_content)
    order by s.source_stage), '[]'::jsonb) into result
    from public.assignment_chain_snapshots s join public.student_room_assignments a on a.id = s.source_assignment_id and a.student_id = actor
    where s.chain_id = p_chain_id and s.target_assignment_id = p_target_assignment_id;
  if jsonb_array_length(result) <> prior_count then raise exception 'ASSIGNMENT_CHAIN_SNAPSHOT_INCOMPLETE'; end if;
  return result;
end;
$$;

-- Learners provide only their assignment ID; chain identity is resolved
-- server-side so the full envelope never crosses the client boundary.
create or replace function public.get_assignment_chain_prior_stage_context_for_assignment(
  p_target_assignment_id uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid(); chain_id uuid;
begin
  if actor is null then raise exception 'ASSIGNMENT_CHAIN_AUTH_REQUIRED'; end if;
  select c.chain_id into chain_id
  from public.assignment_chains c
  join public.student_room_assignments a on a.id = p_target_assignment_id and a.student_id = actor
  where c.owner_id = actor and p_target_assignment_id = any(c.ordered_assignment_ids)
  order by c.created_at desc limit 1;
  if chain_id is null then raise exception 'ASSIGNMENT_CHAIN_NOT_VISIBLE'; end if;
  return public.get_assignment_chain_prior_stage_context(chain_id, p_target_assignment_id);
end;
$$;

revoke all on function public.get_assignment_chain_prior_stage_context_for_assignment(uuid) from public, anon;
grant execute on function public.get_assignment_chain_prior_stage_context_for_assignment(uuid) to authenticated;

create or replace function public.get_assignment_chain_readiness()
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object('ready', to_regclass('public.assignment_chain_intents') is not null
    and to_regclass('public.assignment_chains') is not null and to_regclass('public.assignment_chain_snapshots') is not null
    and to_regprocedure('public.begin_assignment_chain_intent(uuid,uuid[],jsonb)') is not null
    and to_regprocedure('public.create_assignment_chain_with_snapshots(uuid,uuid[],jsonb)') is not null
    and to_regprocedure('public.get_assignment_chain_prior_stage_context(uuid,uuid)') is not null
    and to_regprocedure('public.get_assignment_chain_prior_stage_context_for_assignment(uuid)') is not null,
    'version', case when to_regclass('public.assignment_chain_intents') is not null then 2 else 0 end);
$$;
