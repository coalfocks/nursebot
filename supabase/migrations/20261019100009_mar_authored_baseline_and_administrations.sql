-- Additive MAR event layer. Medication orders remain orders; this table records
-- only explicit authored/simulated administrations and never auto-populates
-- from learner-created orders.
create table if not exists public.mar_administration_events (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  room_id integer references public.rooms(id) on delete cascade,
  assignment_id uuid references public.student_room_assignments(id) on delete cascade,
  order_id uuid references public.medical_orders(id) on delete set null,
  case_version text not null,
  occurrence_key text not null,
  relative_offset_hours numeric(5,2),
  administered_at timestamptz,
  medication_name text not null,
  ordered_dose text,
  administered_dose text,
  unit text,
  route text,
  frequency text,
  category text not null default 'scheduled' check (category in ('scheduled','prn','one_time','infusion')),
  status text not null default 'Not documented' check (status in ('Given','Held','Refused','Not given','Started','Rate changed','Stopped','Not documented')),
  simulated_clinician text,
  reason text,
  prn_indication text,
  response text,
  infusion_details jsonb,
  source text not null default 'authored_scenario' check (source in ('authored_scenario','simulation','learner')),
  actor_id uuid references auth.users(id) on delete set null,
  actor_label text,
  record_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint mar_scope_check check (
    (assignment_id is not null and room_id is not null)
    or (assignment_id is null and room_id is not null)
  ),
  constraint mar_time_check check (
    relative_offset_hours is null or (relative_offset_hours >= 0 and relative_offset_hours <= 72)
  )
);

create unique index if not exists mar_event_occurrence_identity
  on public.mar_administration_events (
    patient_id,
    coalesce(room_id, 0),
    coalesce(assignment_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(order_id, '00000000-0000-0000-0000-000000000000'::uuid),
    case_version,
    occurrence_key
  )
  where deleted_at is null;

create index if not exists mar_event_scope_time_idx
  on public.mar_administration_events(patient_id, room_id, assignment_id, relative_offset_hours, administered_at)
  where deleted_at is null;

create table if not exists public.mar_history_revisions (
  patient_id uuid not null references public.patients(id) on delete cascade,
  room_id integer not null references public.rooms(id) on delete cascade,
  assignment_id uuid references public.student_room_assignments(id) on delete cascade,
  scope_key text primary key,
  revision integer not null default 0,
  updated_at timestamptz not null default now()
);

-- First explicit save for a NEW assignment creates the immutable MAR
-- materialization record. Learner reads use assignment events only; they never
-- fall back to this room's mutable baseline.
create table if not exists public.mar_assignment_baselines (
  assignment_id uuid primary key references public.student_room_assignments(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  room_id integer not null references public.rooms(id) on delete cascade,
  case_version text not null,
  source text not null default 'authored_scenario' check (source = 'authored_scenario'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.mar_assignment_baselines enable row level security;
grant select on public.mar_assignment_baselines to authenticated;
create policy "MAR assignment baseline scoped read" on public.mar_assignment_baselines
for select to authenticated using (
  exists (select 1 from public.student_room_assignments a where a.id = assignment_id and a.student_id = auth.uid())
  or exists (
    select 1 from public.profiles p join public.rooms r on r.id = mar_assignment_baselines.room_id
    where p.id = auth.uid() and (p.role = 'super_admin' or (p.role = 'school_admin' and p.school_id = r.school_id))
  )
);

alter table public.mar_administration_events enable row level security;
alter table public.mar_history_revisions enable row level security;
grant select, insert, update on public.mar_administration_events, public.mar_history_revisions to authenticated;

-- Direct table writes are deliberately unavailable. The RPC below is the only
-- path that can establish assignment/patient/order/version lineage and bump a
-- revision atomically.
revoke insert, update, delete on public.mar_administration_events, public.mar_history_revisions from authenticated;

drop policy if exists "MAR authenticated read" on public.mar_administration_events;
create policy "MAR authenticated read" on public.mar_administration_events
for select to authenticated using (
  exists (
    select 1 from public.student_room_assignments a
    join public.rooms r on r.id = a.room_id
    where a.id = mar_administration_events.assignment_id
      and a.student_id = auth.uid()
      and r.patient_id = mar_administration_events.patient_id
      and r.id = mar_administration_events.room_id
      and coalesce(a.case_key_version, a.scenario_baseline_version::text) = mar_administration_events.case_version
  )
  or exists (
    select 1 from public.profiles p
    join public.rooms r on r.id = mar_administration_events.room_id
    where p.id = auth.uid()
      and (p.role = 'super_admin' or (p.role = 'school_admin' and p.school_id = r.school_id))
      and r.patient_id = mar_administration_events.patient_id
  )
);

drop policy if exists "MAR admins write" on public.mar_administration_events;
create policy "MAR admins write" on public.mar_administration_events
for all to authenticated using (
  exists (
    select 1 from public.profiles p join public.rooms r on r.id = mar_administration_events.room_id
    where p.id = auth.uid()
      and (p.role = 'super_admin' or (p.role = 'school_admin' and p.school_id = r.school_id))
      and r.patient_id = mar_administration_events.patient_id
  )
) with check (
  exists (
    select 1 from public.profiles p join public.rooms r on r.id = mar_administration_events.room_id
    where p.id = auth.uid()
      and (p.role = 'super_admin' or (p.role = 'school_admin' and p.school_id = r.school_id))
      and r.patient_id = mar_administration_events.patient_id
  )
);

drop policy if exists "MAR revisions authenticated read" on public.mar_history_revisions;
create policy "MAR revisions authenticated read" on public.mar_history_revisions
for select to authenticated using (
  exists (select 1 from public.student_room_assignments a where a.id = mar_history_revisions.assignment_id and a.student_id = auth.uid() and a.room_id = mar_history_revisions.room_id)
  or exists (
    select 1 from public.profiles p join public.rooms r on r.id = mar_history_revisions.room_id
    where p.id = auth.uid() and (p.role = 'super_admin' or (p.role = 'school_admin' and p.school_id = r.school_id))
  )
);

drop policy if exists "MAR revision admins write" on public.mar_history_revisions;
create policy "MAR revision admins write" on public.mar_history_revisions
for all to authenticated using (
  exists (
    select 1 from public.profiles p join public.rooms r on r.id = mar_history_revisions.room_id
    where p.id = auth.uid()
      and (p.role = 'super_admin' or (p.role = 'school_admin' and p.school_id = r.school_id))
  )
) with check (
  exists (
    select 1 from public.profiles p join public.rooms r on r.id = mar_history_revisions.room_id
    where p.id = auth.uid()
      and (p.role = 'super_admin' or (p.role = 'school_admin' and p.school_id = r.school_id))
  )
);

create or replace function public.save_mar_history(
  p_patient_id uuid,
  p_room_id integer,
  p_assignment_id uuid,
  p_case_version text,
  p_expected_revision integer,
  p_events jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
  scope_key_value text := p_patient_id::text || ':' || p_room_id::text || ':' || coalesce(p_assignment_id::text, 'baseline');
  current_revision integer;
  next_revision integer;
begin
  select role into actor_role from public.profiles where id = auth.uid();
  if actor_role not in ('school_admin', 'super_admin') then
    raise exception 'MAR_ADMIN_REQUIRED';
  end if;
  if p_room_id is null or jsonb_typeof(p_events) <> 'array' or p_case_version is null or btrim(p_case_version) = '' then
    raise exception 'MAR_INVALID_BATCH';
  end if;
  if not exists (select 1 from public.rooms r where r.id = p_room_id and r.patient_id = p_patient_id
    and (actor_role = 'super_admin' or exists (select 1 from public.profiles p where p.id = auth.uid() and p.school_id = r.school_id))) then
    raise exception 'MAR_ROOM_PATIENT_MISMATCH';
  end if;
  if p_assignment_id is not null and not exists (
    select 1 from public.student_room_assignments a
    join public.rooms r on r.id = a.room_id
    where a.id = p_assignment_id and a.room_id = p_room_id and r.patient_id = p_patient_id
      and coalesce(a.case_key_version, a.scenario_baseline_version::text) = p_case_version and a.school_id = r.school_id
  ) then
    raise exception 'MAR_ASSIGNMENT_ROOM_MISMATCH';
  end if;

  if p_assignment_id is null and actor_role <> 'super_admin' and not exists (
    select 1 from public.rooms r join public.profiles p on p.id = auth.uid()
    where r.id = p_room_id and r.school_id = p.school_id
  ) then raise exception 'MAR_SCHOOL_SCOPE_MISMATCH'; end if;

  if p_assignment_id is not null and exists (
    select 1 from public.mar_assignment_baselines b
    where b.assignment_id = p_assignment_id and b.case_version is distinct from p_case_version
  ) then raise exception 'MAR_CASE_VERSION_IMMUTABLE'; end if;
  if p_assignment_id is not null then
    insert into public.mar_assignment_baselines(assignment_id, patient_id, room_id, case_version, created_by)
    values (p_assignment_id, p_patient_id, p_room_id, p_case_version, auth.uid())
    on conflict (assignment_id) do nothing;
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_events) value
    where (value->>'caseVersion') is null or coalesce(value->>'caseVersion', p_case_version) <> p_case_version
      or nullif(value->>'orderId','') is not null and not exists (
        select 1 from public.medical_orders o
        where o.id = (value->>'orderId')::uuid and o.patient_id = p_patient_id
          and o.room_id = p_room_id and (o.assignment_id is null or o.assignment_id = p_assignment_id)
      )
      or nullif(value->>'relativeOffsetHours','') is not null and ((value->>'relativeOffsetHours')::numeric < 0 or (value->>'relativeOffsetHours')::numeric > 72)
  ) then raise exception 'MAR_LINEAGE_MISMATCH'; end if;

  insert into public.mar_history_revisions(patient_id, room_id, assignment_id, scope_key)
  values (p_patient_id, p_room_id, p_assignment_id, scope_key_value)
  on conflict (scope_key) do nothing;
  select revision into current_revision from public.mar_history_revisions where scope_key = scope_key_value for update;
  if current_revision is distinct from coalesce(p_expected_revision, current_revision) then
    raise exception 'MAR_REVISION_CONFLICT';
  end if;
  next_revision := current_revision + 1;

  insert into public.mar_administration_events (
    id, patient_id, room_id, assignment_id, order_id, case_version, occurrence_key,
    relative_offset_hours, administered_at, medication_name, ordered_dose, administered_dose,
    unit, route, frequency, category, status, simulated_clinician, reason, prn_indication,
    response, infusion_details, source, actor_id, actor_label, record_version
  )
  select
    coalesce(nullif(value->>'id','')::uuid, gen_random_uuid()), p_patient_id, p_room_id, p_assignment_id,
    nullif(value->>'orderId','')::uuid, coalesce(value->>'caseVersion', p_case_version), value->>'occurrenceKey',
    nullif(value->>'relativeOffsetHours','')::numeric, nullif(value->>'administeredAt','')::timestamptz,
    value->>'medicationName', value->>'orderedDose', value->>'administeredDose', value->>'unit', value->>'route',
    value->>'frequency', coalesce(value->>'category','scheduled'), coalesce(value->>'status','Not documented'),
    value->>'simulatedClinician', value->>'reason', value->>'prnIndication', value->>'response', value->'infusionDetails',
    coalesce(value->>'source','authored_scenario'), auth.uid(), value->>'actorLabel', next_revision
  from jsonb_array_elements(p_events) value
  on conflict (patient_id, coalesce(room_id, 0), coalesce(assignment_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(order_id, '00000000-0000-0000-0000-000000000000'::uuid), case_version, occurrence_key)
  where deleted_at is null
  do update set
    case_version = excluded.case_version,
    relative_offset_hours = excluded.relative_offset_hours,
    administered_at = excluded.administered_at,
    ordered_dose = excluded.ordered_dose,
    administered_dose = excluded.administered_dose,
    unit = excluded.unit,
    route = excluded.route,
    frequency = excluded.frequency,
    category = excluded.category,
    status = excluded.status,
    simulated_clinician = excluded.simulated_clinician,
    reason = excluded.reason,
    prn_indication = excluded.prn_indication,
    response = excluded.response,
    infusion_details = excluded.infusion_details,
    actor_id = excluded.actor_id,
    actor_label = excluded.actor_label,
    record_version = next_revision,
    updated_at = now();

  update public.mar_history_revisions set revision = next_revision, updated_at = now() where scope_key = scope_key_value;
  return jsonb_build_object('scopeKey', scope_key_value, 'revision', next_revision);
end;
$$;

revoke all on function public.save_mar_history(uuid, integer, uuid, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.save_mar_history(uuid, integer, uuid, text, integer, jsonb) to authenticated;

create or replace function public.get_mar_history_revision(p_patient_id uuid, p_room_id integer, p_assignment_id uuid)
returns integer
language sql
security invoker
set search_path = public
as $$
  select coalesce((select revision from public.mar_history_revisions where scope_key = p_patient_id::text || ':' || p_room_id::text || ':' || coalesce(p_assignment_id::text, 'baseline')), 0);
$$;
revoke all on function public.get_mar_history_revision(uuid, integer, uuid) from public, anon;
grant execute on function public.get_mar_history_revision(uuid, integer, uuid) to authenticated;
