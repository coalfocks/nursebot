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
  for position in 1..3 loop
    if p_envelope->'assignments'->(position - 1)->>'assignmentId' is distinct from p_ordered_assignment_ids[position]::text
       or p_envelope->'assignments'->(position - 1)->>'stage' is distinct from case position when 1 then 'A' when 2 then 'B' else 'C' end then
      raise exception 'ASSIGNMENT_CHAIN_ENVELOPE_MISMATCH';
    end if;
  end loop;
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
  position integer; room_id_for_position integer; room_version_for_position text;
  room_content_for_position text;
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
    and o.result->>'caseVersion' = a.case_key_version;
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

  -- Lock the same source rows that are validated and captured below.
  perform 1 from public.student_room_assignments a join public.rooms r on r.id = a.room_id
    where a.id = any(p_ordered_assignment_ids) for update of a, r;
  for position in 1..3 loop
    select a.room_id, coalesce(a.case_key_version, a.scenario_baseline_version::text, 'room-' || a.room_id::text), r.progress_note
      into room_id_for_position, room_version_for_position, room_content_for_position
      from public.student_room_assignments a join public.rooms r on r.id = a.room_id
      where a.id = p_ordered_assignment_ids[position];
    if p_envelope->'assignments'->(position - 1)->>'roomId' is distinct from room_id_for_position::text
       or p_envelope->'assignments'->(position - 1)->>'authoredSourceVersion' is distinct from room_version_for_position
       or p_envelope->'assignments'->(position - 1)->>'authoredProgressNote' is distinct from room_content_for_position then
      raise exception 'ASSIGNMENT_CHAIN_AUTHORED_SOURCE_MISMATCH';
    end if;
  end loop;

  insert into public.assignment_chains(chain_id, owner_id, ordered_assignment_ids, window_start, window_end, envelope, envelope_hash, created_by)
  values (p_chain_id, owner_id, p_ordered_assignment_ids, expected_window_start, expected_window_end, intent.envelope, envelope_hash, actor);
  insert into public.assignment_chain_snapshots(
    chain_id, target_assignment_id, source_assignment_id, target_stage, source_stage, source_room_id,
    authored_source_version, authored_content, authored_content_hash, authored_captured_at, created_by)
  select p_chain_id, target_spec.id, source_spec.id,
    case when target_spec.position = 2 then 'B' else 'C' end,
    case when source_spec.position = 1 then 'A' else 'B' end,
    source_assignment.room_id,
    coalesce(source_assignment.case_key_version, source_assignment.scenario_baseline_version::text, 'room-' || source_assignment.room_id::text),
    source_room.progress_note,
    encode(extensions.digest(convert_to(coalesce(source_room.progress_note, '') || ':' ||
      coalesce(source_assignment.case_key_version, source_assignment.scenario_baseline_version::text, 'room-' || source_assignment.room_id::text) || ':' || source_assignment.room_id::text, 'utf8'), 'sha256'), 'hex'),
    coalesce(source_room.updated_at, source_assignment.created_at, now()), actor
  from unnest(p_ordered_assignment_ids) with ordinality target_spec(id, position)
  join public.student_room_assignments target_assignment on target_assignment.id = target_spec.id
  join unnest(p_ordered_assignment_ids) with ordinality source_spec(id, position) on source_spec.position < target_spec.position
  join public.student_room_assignments source_assignment on source_assignment.id = source_spec.id
  join public.rooms source_room on source_room.id = source_assignment.room_id
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
      and o.result->>'caseVersion' = a.case_key_version;
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

create or replace function public.get_assignment_chain_readiness()
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object('ready', to_regclass('public.assignment_chain_intents') is not null
    and to_regclass('public.assignment_chains') is not null and to_regclass('public.assignment_chain_snapshots') is not null
    and to_regprocedure('public.begin_assignment_chain_intent(uuid,uuid[],jsonb)') is not null
    and to_regprocedure('public.create_assignment_chain_with_snapshots(uuid,uuid[],jsonb)') is not null
    and to_regprocedure('public.get_assignment_chain_prior_stage_context(uuid,uuid)') is not null,
    'version', case when to_regclass('public.assignment_chain_intents') is not null then 2 else 0 end);
$$;
