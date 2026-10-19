-- MAR v4 append-only upgrade. Apply only after 100009 -> 100010 -> 100011.
-- This migration is intentionally not included in any automatic push. It makes
-- snapshot allocation, revision validation, materialization, and retry identity
-- one transaction so a failed second RPC cannot leave orphaned metadata.

create table if not exists public.mar_save_operations (
  request_id uuid primary key,
  patient_id uuid not null references public.patients(id) on delete cascade,
  room_id integer not null references public.rooms(id) on delete cascade,
  assignment_id uuid references public.student_room_assignments(id) on delete cascade,
  case_version text not null,
  content_hash text not null,
  result jsonb not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.mar_save_operations enable row level security;
revoke all on public.mar_save_operations from authenticated;
grant select on public.mar_save_operations to authenticated;
create policy "MAR save operation scoped read" on public.mar_save_operations
for select to authenticated using (
  exists (select 1 from public.student_room_assignments a where a.id = assignment_id and a.student_id = auth.uid())
  or exists (
    select 1 from public.profiles p join public.rooms r on r.id = mar_save_operations.room_id
    where p.id = auth.uid() and (p.role = 'super_admin' or (p.role = 'school_admin' and p.school_id = r.school_id))
  )
);

create or replace function public.get_mar_readiness()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ready boolean;
begin
  ready := to_regclass('public.mar_administration_events') is not null
    and to_regclass('public.mar_assignment_baseline_versions') is not null
    and to_regclass('public.mar_save_operations') is not null
    and to_regprocedure('public.save_mar_history_atomic(uuid,uuid,integer,uuid,text,integer,jsonb)') is not null
    and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mar_administration_events' and policyname = 'MAR authenticated read')
    and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mar_history_revisions' and policyname = 'MAR revisions authenticated read');
  return jsonb_build_object('ready', ready, 'schemaVersion', case when ready then 4 else 0 end, 'atomicPersistence', ready);
end;
$$;
revoke all on function public.get_mar_readiness() from public, anon;
grant execute on function public.get_mar_readiness() to authenticated;

create or replace function public.save_mar_history_atomic(
  p_request_id uuid,
  p_patient_id uuid,
  p_room_id integer,
  p_assignment_id uuid,
  p_case_version text,
  p_expected_revision integer,
  p_events jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  actor_role text;
  scope_key_value text := p_patient_id::text || ':' || p_room_id::text || ':' || coalesce(p_assignment_id::text, 'baseline');
  current_revision integer;
  next_revision integer;
  v_content_hash text;
  prior public.mar_save_operations%rowtype;
  result jsonb;
begin
  select role into actor_role from public.profiles where id = auth.uid();
  if actor_role not in ('school_admin', 'super_admin') then raise exception 'MAR_ADMIN_REQUIRED'; end if;
  if p_request_id is null or p_room_id is null or p_case_version is null or btrim(p_case_version) = '' or jsonb_typeof(p_events) <> 'array' then
    raise exception 'MAR_INVALID_BATCH';
  end if;
  v_content_hash := encode(digest(convert_to(p_events::text || ':' || p_case_version, 'utf8'), 'sha256'), 'hex');
  select * into prior from public.mar_save_operations where request_id = p_request_id for update;
  if found then
    if prior.content_hash is distinct from v_content_hash then raise exception 'MAR_RETRY_PAYLOAD_MISMATCH'; end if;
    return prior.result;
  end if;
  if not exists (select 1 from public.rooms r where r.id = p_room_id and r.patient_id = p_patient_id
    and (actor_role = 'super_admin' or exists (select 1 from public.profiles p where p.id = auth.uid() and p.school_id = r.school_id))) then
    raise exception 'MAR_ROOM_PATIENT_MISMATCH';
  end if;
  if p_assignment_id is not null and not exists (
    select 1 from public.student_room_assignments a join public.rooms r on r.id = a.room_id
    where a.id = p_assignment_id and a.room_id = p_room_id and r.patient_id = p_patient_id
      and coalesce(a.case_key_version, a.scenario_baseline_version::text) = p_case_version
  ) then raise exception 'MAR_ASSIGNMENT_ROOM_MISMATCH'; end if;
  if exists (select 1 from jsonb_array_elements(p_events) value where
    coalesce(value->>'caseVersion', p_case_version) <> p_case_version
    or nullif(value->>'relativeOffsetHours','') is not null and ((value->>'relativeOffsetHours')::numeric <= 0 or (value->>'relativeOffsetHours')::numeric > 72)
    or nullif(value->>'orderId','') is not null and not exists (select 1 from public.medical_orders o where o.id = (value->>'orderId')::uuid and o.patient_id = p_patient_id and o.room_id = p_room_id and (o.assignment_id is null or o.assignment_id = p_assignment_id))) then
    raise exception 'MAR_LINEAGE_MISMATCH';
  end if;

  -- The snapshot and its materialized rows are created before the operation is
  -- recorded, all inside this transaction. Any later exception rolls back all.
  if p_assignment_id is not null then
    insert into public.mar_assignment_baseline_versions(assignment_id, case_version, patient_id, room_id, event_snapshot, content_hash, created_by)
    values (p_assignment_id, p_case_version, p_patient_id, p_room_id, p_events, v_content_hash, auth.uid())
    on conflict (assignment_id, case_version) do nothing;
    if exists (select 1 from public.mar_assignment_baseline_versions b where b.assignment_id = p_assignment_id and b.case_version = p_case_version and b.content_hash <> v_content_hash) then
      raise exception 'MAR_BASELINE_VERSION_IMMUTABLE';
    end if;
  end if;
  insert into public.mar_history_revisions(patient_id, room_id, assignment_id, scope_key)
  values (p_patient_id, p_room_id, p_assignment_id, scope_key_value) on conflict (scope_key) do nothing;
  select revision into current_revision from public.mar_history_revisions where scope_key = scope_key_value for update;
  if current_revision is distinct from coalesce(p_expected_revision, current_revision) then raise exception 'MAR_REVISION_CONFLICT'; end if;
  next_revision := current_revision + 1;
  insert into public.mar_administration_events (
    id, patient_id, room_id, assignment_id, order_id, case_version, occurrence_key, relative_offset_hours, administered_at,
    medication_name, ordered_dose, administered_dose, unit, route, frequency, category, status, simulated_clinician, reason,
    prn_indication, response, infusion_details, source, actor_id, actor_label, record_version)
  select coalesce(nullif(value->>'id','')::uuid, gen_random_uuid()), p_patient_id, p_room_id, p_assignment_id,
    nullif(value->>'orderId','')::uuid, p_case_version, value->>'occurrenceKey', nullif(value->>'relativeOffsetHours','')::numeric,
    nullif(value->>'administeredAt','')::timestamptz, value->>'medicationName', value->>'orderedDose', value->>'administeredDose',
    value->>'unit', value->>'route', value->>'frequency', coalesce(value->>'category','scheduled'), coalesce(value->>'status','Not documented'),
    value->>'simulatedClinician', value->>'reason', value->>'prnIndication', value->>'response', value->'infusionDetails',
    coalesce(value->>'source','authored_scenario'), auth.uid(), value->>'actorLabel', next_revision
  from jsonb_array_elements(p_events) value
  on conflict (patient_id, coalesce(room_id, 0), coalesce(assignment_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(order_id, '00000000-0000-0000-0000-000000000000'::uuid), case_version, occurrence_key) where deleted_at is null
  do update set relative_offset_hours = excluded.relative_offset_hours, administered_at = excluded.administered_at, ordered_dose = excluded.ordered_dose,
    administered_dose = excluded.administered_dose, unit = excluded.unit, route = excluded.route, frequency = excluded.frequency,
    category = excluded.category, status = excluded.status, simulated_clinician = excluded.simulated_clinician, reason = excluded.reason,
    prn_indication = excluded.prn_indication, response = excluded.response, infusion_details = excluded.infusion_details,
    actor_id = excluded.actor_id, actor_label = excluded.actor_label, record_version = next_revision, updated_at = now();
  update public.mar_history_revisions set revision = next_revision, updated_at = now() where scope_key = scope_key_value;
  result := jsonb_build_object('scopeKey', scope_key_value, 'revision', next_revision, 'caseVersion', p_case_version, 'contentHash', v_content_hash);
  insert into public.mar_save_operations(request_id, patient_id, room_id, assignment_id, case_version, content_hash, result, created_by)
  values (p_request_id, p_patient_id, p_room_id, p_assignment_id, p_case_version, v_content_hash, result, auth.uid());
  return result;
end;
$$;
revoke all on function public.save_mar_history_atomic(uuid, uuid, integer, uuid, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.save_mar_history_atomic(uuid, uuid, integer, uuid, text, integer, jsonb) to authenticated;
