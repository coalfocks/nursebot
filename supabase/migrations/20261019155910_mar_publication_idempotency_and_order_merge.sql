-- Append-only MAR publication correction. Apply only after 100009 -> 100013
-- and the separately reviewed 100014 -> 100016 chain. This migration adds a
-- durable, revision-bound publication operation; it does not alter old pins.

create table if not exists public.mar_publication_operations (
  request_id uuid primary key,
  room_id integer not null references public.rooms(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete restrict,
  expected_revision integer not null,
  expected_content_hash text,
  requested_case_version text,
  case_version text not null,
  content_hash text not null,
  order_snapshot jsonb not null,
  event_snapshot jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  constraint mar_publication_operation_arrays check (
    jsonb_typeof(order_snapshot) = 'array' and jsonb_typeof(event_snapshot) = 'array'
  )
);

alter table public.mar_publication_operations enable row level security;
revoke all on public.mar_publication_operations from authenticated;
grant select on public.mar_publication_operations to authenticated;
drop policy if exists "MAR publication operation scoped read" on public.mar_publication_operations;
create policy "MAR publication operation scoped read" on public.mar_publication_operations
for select to authenticated using (
  actor_id = auth.uid()
  or exists (
    select 1 from public.profiles p
    join public.rooms r on r.id = mar_publication_operations.room_id
    where p.id = auth.uid()
      and (p.role = 'super_admin' or (p.role = 'school_admin' and p.school_id = r.school_id))
  )
);

create or replace function public.publish_mar_case_version_atomic(
  p_request_id uuid,
  p_room_id integer,
  p_expected_revision integer,
  p_expected_content_hash text default null,
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
  version_name text;
  order_snapshot jsonb;
  event_snapshot jsonb;
  content_hash text;
  current_revision integer;
  prior public.mar_publication_operations%rowtype;
  existing public.mar_authored_case_versions%rowtype;
  reused boolean := false;
  result jsonb;
begin
  if actor is null then raise exception 'MAR_AUTH_REQUIRED'; end if;
  if p_request_id is null or p_room_id is null or p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'MAR_PUBLICATION_INVALID';
  end if;

  -- Authorization happens before request replay. A stolen request ID cannot be
  -- used to read or replay a prior publication from another scope.
  select p.role, p.school_id into actor_role, actor_school
  from public.profiles p where p.id = actor;
  if actor_role is null then raise exception 'MAR_ACTOR_NOT_FOUND'; end if;
  if actor_role not in ('school_admin', 'super_admin') then raise exception 'MAR_ADMIN_REQUIRED'; end if;
  select r.patient_id, r.school_id into room_patient, room_school
  from public.rooms r where r.id = p_room_id for update;
  if room_patient is null then raise exception 'MAR_ROOM_NOT_FOUND'; end if;
  if actor_role <> 'super_admin' and actor_school is distinct from room_school then
    raise exception 'MAR_SCHOOL_SCOPE_MISMATCH';
  end if;

  -- This is the same baseline scope row locked by save_mar_history_atomic.
  -- Publication therefore cannot capture Orders and MAR while an author save
  -- is changing the revision, and another tab cannot publish stale content.
  perform pg_advisory_xact_lock(hashtext('mar-authoring:' || p_room_id::text));
  perform pg_advisory_xact_lock(hashtext(p_request_id::text));
  select * into prior from public.mar_publication_operations where request_id = p_request_id for update;
  if found then
    if prior.room_id is distinct from p_room_id
      or prior.patient_id is distinct from room_patient
      or prior.actor_id is distinct from actor
      or prior.expected_revision is distinct from p_expected_revision
      or prior.expected_content_hash is distinct from p_expected_content_hash
      or prior.requested_case_version is distinct from p_case_version then
      raise exception 'MAR_PUBLICATION_RETRY_MISMATCH';
    end if;
    return prior.result;
  end if;

  insert into public.mar_history_revisions(patient_id, room_id, assignment_id, scope_key)
  values (room_patient, p_room_id, null, room_patient::text || ':' || p_room_id::text || ':baseline')
  on conflict (scope_key) do nothing;
  select revision into current_revision
  from public.mar_history_revisions
  where scope_key = room_patient::text || ':' || p_room_id::text || ':baseline'
  for update;
  if current_revision is distinct from p_expected_revision then
    raise exception 'MAR_PUBLICATION_REVISION_CONFLICT';
  end if;

  select coalesce(jsonb_agg(to_jsonb(o) order by o.id), '[]'::jsonb)
    into order_snapshot
  from public.medical_orders o
  where o.patient_id = room_patient
    and o.deleted_at is null
    and o.category = 'Medication'
    and (o.room_id = p_room_id or o.room_id is null)
    and o.assignment_id is null;
  select coalesce(jsonb_agg(to_jsonb(e) order by e.relative_offset_hours desc nulls last, e.occurrence_key), '[]'::jsonb)
    into event_snapshot
  from public.mar_administration_events e
  where e.patient_id = room_patient
    and e.deleted_at is null
    and e.room_id = p_room_id
    and e.assignment_id is null;
  content_hash := encode(digest(convert_to(order_snapshot::text || ':' || event_snapshot::text, 'utf8'), 'sha256'), 'hex');
  if p_expected_content_hash is not null and p_expected_content_hash is distinct from content_hash then
    raise exception 'MAR_PUBLICATION_CONTENT_CONFLICT';
  end if;

  version_name := nullif(btrim(p_case_version), '');
  if version_name is null then
    select format('room-%s-mar-v%s', p_room_id, coalesce(max((substring(case_version from '-v([0-9]+)$'))::integer) filter (where case_version ~ '-v[0-9]+$'), 0) + 1)
      into version_name
    from public.mar_authored_case_versions where room_id = p_room_id;
  end if;
  select * into existing from public.mar_authored_case_versions
  where room_id = p_room_id and case_version = version_name for update;
  if found and existing.content_hash is distinct from content_hash then
    raise exception 'MAR_AUTHORED_VERSION_IMMUTABLE';
  end if;
  if not found then
    insert into public.mar_authored_case_versions(room_id, patient_id, school_id, case_version, order_snapshot, event_snapshot, content_hash, created_by)
    values (p_room_id, room_patient, room_school, version_name, order_snapshot, event_snapshot, content_hash, actor);
  else
    reused := true;
  end if;

  result := jsonb_build_object(
    'caseVersion', version_name,
    'contentHash', content_hash,
    'orderCount', jsonb_array_length(order_snapshot),
    'eventCount', jsonb_array_length(event_snapshot),
    'revision', current_revision,
    'requestId', p_request_id,
    'reused', reused
  );
  insert into public.mar_publication_operations(
    request_id, room_id, patient_id, actor_id, expected_revision, expected_content_hash,
    requested_case_version, case_version, content_hash, order_snapshot, event_snapshot, result
  ) values (
    p_request_id, p_room_id, room_patient, actor, p_expected_revision, p_expected_content_hash,
    p_case_version, version_name, content_hash, order_snapshot, event_snapshot, result
  );
  return result;
end;
$$;

revoke all on function public.publish_mar_case_version_atomic(uuid, integer, integer, text, text) from public, anon;
grant execute on function public.publish_mar_case_version_atomic(uuid, integer, integer, text, text) to authenticated;
-- Do not leave the pre-atomic publisher as an alternate mutable path once the
-- durable publication contract is installed.
revoke all on function public.publish_mar_case_version(integer, text) from public, anon, authenticated;

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
    and to_regprocedure('public.get_mar_assignment_order_snapshot(uuid)') is not null
    and to_regprocedure('public.create_assignment_with_mar_materialization(uuid,uuid,uuid,integer,uuid,text,timestamptz,timestamptz,timestamptz)') is not null
    and to_regprocedure('public.mar_effective_school_allowed(uuid,uuid[],uuid)') is not null
    and not has_function_privilege('authenticated','public.save_mar_history(uuid,integer,uuid,text,integer,jsonb)','EXECUTE');
  return jsonb_build_object(
    'ready', ready,
    'materializationVersion', case when ready then 4 else 0 end,
    'atomic', ready,
    'baseReadiness', base,
    'requiresPublishedVersion', true,
    'publicationVersion', case when ready then 1 else 0 end,
    'scopeVersion', case when ready then 3 else 0 end,
    'oldMutatorsRevoked', ready
  );
end;
$$;
revoke all on function public.get_mar_normal_materialization_readiness() from public, anon;
grant execute on function public.get_mar_normal_materialization_readiness() to authenticated;
