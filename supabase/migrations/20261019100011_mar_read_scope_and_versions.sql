-- MAR follow-up for environments that already applied 100009 and 100010.
-- This is additive and must be applied only after those migrations have been
-- reviewed. It closes the upgrade-path read-policy gap and records immutable
-- authored snapshots without changing existing attempts or pins.

drop policy if exists "MAR authenticated read" on public.mar_administration_events;
create policy "MAR authenticated read" on public.mar_administration_events
for select to authenticated using (
  exists (
    select 1
    from public.student_room_assignments a
    join public.rooms r on r.id = a.room_id
    where a.id = mar_administration_events.assignment_id
      and a.student_id = auth.uid()
      and r.id = mar_administration_events.room_id
      and r.patient_id = mar_administration_events.patient_id
      and coalesce(a.case_key_version, a.scenario_baseline_version::text) = mar_administration_events.case_version
  )
  or exists (
    select 1
    from public.profiles p
    join public.rooms r on r.id = mar_administration_events.room_id
    where p.id = auth.uid()
      and r.patient_id = mar_administration_events.patient_id
      and (
        p.role = 'super_admin'
        or (p.role = 'school_admin' and p.school_id = r.school_id)
      )
  )
);

drop policy if exists "MAR revisions authenticated read" on public.mar_history_revisions;
create policy "MAR revisions authenticated read" on public.mar_history_revisions
for select to authenticated using (
  exists (
    select 1 from public.student_room_assignments a
    where a.id = mar_history_revisions.assignment_id
      and a.student_id = auth.uid()
      and a.room_id = mar_history_revisions.room_id
  )
  or exists (
    select 1 from public.profiles p
    join public.rooms r on r.id = mar_history_revisions.room_id
    where p.id = auth.uid()
      and (p.role = 'super_admin' or (p.role = 'school_admin' and p.school_id = r.school_id))
  )
);

create table if not exists public.mar_assignment_baseline_versions (
  assignment_id uuid not null references public.student_room_assignments(id) on delete cascade,
  case_version text not null,
  patient_id uuid not null references public.patients(id) on delete cascade,
  room_id integer not null references public.rooms(id) on delete cascade,
  event_snapshot jsonb not null,
  content_hash text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (assignment_id, case_version),
  constraint mar_baseline_snapshot_array check (jsonb_typeof(event_snapshot) = 'array')
);

alter table public.mar_assignment_baseline_versions enable row level security;
revoke all on public.mar_assignment_baseline_versions from authenticated;
grant select on public.mar_assignment_baseline_versions to authenticated;
create policy "MAR immutable baseline version scoped read" on public.mar_assignment_baseline_versions
for select to authenticated using (
  exists (
    select 1 from public.student_room_assignments a
    where a.id = assignment_id and a.student_id = auth.uid()
  )
  or exists (
    select 1 from public.profiles p
    join public.rooms r on r.id = mar_assignment_baseline_versions.room_id
    where p.id = auth.uid()
      and (p.role = 'super_admin' or (p.role = 'school_admin' and p.school_id = r.school_id))
  )
);

create or replace function public.create_mar_baseline_version(
  p_assignment_id uuid,
  p_case_version text,
  p_event_snapshot jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
  target record;
  digest text;
begin
  select p.role into actor_role from public.profiles p where p.id = auth.uid();
  if actor_role not in ('school_admin', 'super_admin') then raise exception 'MAR_ADMIN_REQUIRED'; end if;
  if p_case_version is null or btrim(p_case_version) = '' or jsonb_typeof(p_event_snapshot) <> 'array' then
    raise exception 'MAR_INVALID_BASELINE_VERSION';
  end if;
  select a.id, a.room_id, r.patient_id, r.school_id into target
  from public.student_room_assignments a join public.rooms r on r.id = a.room_id
  where a.id = p_assignment_id;
  if not found then raise exception 'MAR_ASSIGNMENT_NOT_FOUND'; end if;
  if actor_role <> 'super_admin' and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.school_id = target.school_id) then
    raise exception 'MAR_SCHOOL_SCOPE_MISMATCH';
  end if;
  digest := encode(digest(convert_to(p_event_snapshot::text, 'utf8'), 'sha256'), 'hex');
  insert into public.mar_assignment_baseline_versions(assignment_id, case_version, patient_id, room_id, event_snapshot, content_hash, created_by)
  values (p_assignment_id, p_case_version, target.patient_id, target.room_id, p_event_snapshot, digest, auth.uid())
  on conflict (assignment_id, case_version) do nothing;
  if not exists (select 1 from public.mar_assignment_baseline_versions where assignment_id = p_assignment_id and case_version = p_case_version and content_hash = digest) then
    raise exception 'MAR_BASELINE_VERSION_IMMUTABLE';
  end if;
  return jsonb_build_object('assignmentId', p_assignment_id, 'caseVersion', p_case_version, 'contentHash', digest);
end;
$$;

revoke all on function public.create_mar_baseline_version(uuid, text, jsonb) from public, anon;
grant execute on function public.create_mar_baseline_version(uuid, text, jsonb) to authenticated;

comment on table public.mar_assignment_baseline_versions is
  'Append-only authored MAR snapshots. A case version is immutable; changed schedules require a new version and explicit diff/materialization.';
