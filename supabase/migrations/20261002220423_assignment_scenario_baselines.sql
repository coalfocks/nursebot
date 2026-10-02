-- Pin the room scenario at assignment creation so learner sessions are stable
-- even when an administrator later edits the reusable room definition.
alter table public.student_room_assignments
  add column if not exists scenario_baseline jsonb,
  add column if not exists scenario_baseline_version integer;

create or replace function public.pin_assignment_scenario_baseline()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  select to_jsonb(r) - 'updated_at'
    into new.scenario_baseline
  from public.rooms r
  where r.id = new.room_id;

  if new.scenario_baseline is not null and new.scenario_baseline_version is null then
    new.scenario_baseline_version := 1;
  end if;

  return new;
end;
$$;

drop trigger if exists pin_assignment_scenario_baseline on public.student_room_assignments;
create trigger pin_assignment_scenario_baseline
  before insert on public.student_room_assignments
  for each row execute function public.pin_assignment_scenario_baseline();

create or replace function public.prevent_assignment_scenario_baseline_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.scenario_baseline is distinct from old.scenario_baseline
    or new.scenario_baseline_version is distinct from old.scenario_baseline_version then
    raise exception 'assignment scenario baseline is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_assignment_scenario_baseline_change on public.student_room_assignments;
create trigger prevent_assignment_scenario_baseline_change
  before update on public.student_room_assignments
  for each row execute function public.prevent_assignment_scenario_baseline_change();

comment on column public.student_room_assignments.scenario_baseline is
  'Immutable room snapshot used by this learner assignment; null means legacy live-room fallback.';
comment on column public.student_room_assignments.scenario_baseline_version is
  'Version of the immutable scenario snapshot format.';
