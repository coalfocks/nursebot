-- Shift to patient-first EMR model with room/assignment overrides

-- Rooms now reference a baseline patient record.
alter table public.rooms
  add column if not exists patient_id uuid references public.patients (id);

-- Shared helpers for override scoping
do $$
begin
  -- Clinical notes
  alter table public.clinical_notes
    add column if not exists assignment_id uuid,
    add column if not exists room_id integer references public.rooms (id),
    add column if not exists override_scope text not null default 'baseline',
    add constraint clinical_notes_override_scope_check check (override_scope in ('baseline', 'room', 'assignment')),
    add constraint clinical_notes_assignment_scope_check check (override_scope <> 'assignment' or assignment_id is not null),
    add constraint clinical_notes_room_scope_check check (override_scope <> 'room' or room_id is not null);
exception when others then null;
end $$;

do $$
begin
  -- Lab results
  alter table public.lab_results
    add column if not exists room_id integer references public.rooms (id),
    add column if not exists override_scope text not null default 'baseline',
    add constraint lab_results_override_scope_check check (override_scope in ('baseline', 'room', 'assignment')),
    add constraint lab_results_assignment_scope_check check (override_scope <> 'assignment' or assignment_id is not null),
    add constraint lab_results_room_scope_check check (override_scope <> 'room' or room_id is not null);
exception when others then null;
end $$;

do $$
begin
  -- Vital signs
  alter table public.vital_signs
    add column if not exists assignment_id uuid,
    add column if not exists room_id integer references public.rooms (id),
    add column if not exists override_scope text not null default 'baseline',
    add constraint vital_signs_override_scope_check check (override_scope in ('baseline', 'room', 'assignment')),
    add constraint vital_signs_assignment_scope_check check (override_scope <> 'assignment' or assignment_id is not null),
    add constraint vital_signs_room_scope_check check (override_scope <> 'room' or room_id is not null);
exception when others then null;
end $$;

do $$
begin
  -- Medical orders
  alter table public.medical_orders
    add column if not exists room_id integer references public.rooms (id),
    add column if not exists override_scope text not null default 'baseline',
    add constraint medical_orders_override_scope_check check (override_scope in ('baseline', 'room', 'assignment')),
    add constraint medical_orders_assignment_scope_check check (override_scope <> 'assignment' or assignment_id is not null),
    add constraint medical_orders_room_scope_check check (override_scope <> 'room' or room_id is not null);
exception when others then null;
end $$;

-- Backfill the new room→patient relationship from legacy patient.room_id
update public.rooms r
set patient_id = p.id
from public.patients p
where p.room_id = r.id
  and r.patient_id is null;

-- Build a lookup for room context by patient
create temporary table if not exists tmp_patient_room as
select
  p.id as patient_id,
  p.room_id as legacy_room_id,
  r.id as linked_room_id
from public.patients p
left join public.rooms r on r.patient_id = p.id;

-- Helper to pick a room id (new then legacy)
create or replace function public._resolve_room_id(p_patient_id uuid) returns integer as $$
  select coalesce(tr.linked_room_id, tr.legacy_room_id)::integer
  from tmp_patient_room tr
  where tr.patient_id = p_patient_id
  limit 1;
$$ language sql stable;

-- Backfill scopes for lab results
update public.lab_results l
set room_id = coalesce(l.room_id, public._resolve_room_id(l.patient_id)),
    override_scope = case
      when l.assignment_id is not null then 'assignment'
      when coalesce(l.room_id, public._resolve_room_id(l.patient_id)) is not null then 'room'
      else 'baseline'
    end;

-- Backfill scopes for vital signs
update public.vital_signs v
set room_id = coalesce(v.room_id, public._resolve_room_id(v.patient_id)),
    override_scope = case
      when v.assignment_id is not null then 'assignment'
      when coalesce(v.room_id, public._resolve_room_id(v.patient_id)) is not null then 'room'
      else 'baseline'
    end;

-- Backfill scopes for medical orders
update public.medical_orders m
set room_id = coalesce(m.room_id, public._resolve_room_id(m.patient_id)),
    override_scope = case
      when m.assignment_id is not null then 'assignment'
      when coalesce(m.room_id, public._resolve_room_id(m.patient_id)) is not null then 'room'
      else 'baseline'
    end;

-- Backfill scopes for clinical notes
update public.clinical_notes c
set room_id = coalesce(c.room_id, public._resolve_room_id(c.patient_id)),
    override_scope = case
      when c.assignment_id is not null then 'assignment'
      when coalesce(c.room_id, public._resolve_room_id(c.patient_id)) is not null then 'room'
      else 'baseline'
    end;

-- Cleanup temp helper
drop function if exists public._resolve_room_id(uuid);
drop table if exists tmp_patient_room;

comment on table public.rooms is 'Patient rooms; now reference a baseline patient via patient_id';
comment on column public.clinical_notes.override_scope is 'baseline = patient default; room = room-level override; assignment = student interaction';
comment on column public.lab_results.override_scope is 'baseline = patient default; room = room-level override; assignment = student interaction';
comment on column public.vital_signs.override_scope is 'baseline = patient default; room = room-level override; assignment = student interaction';
comment on column public.medical_orders.override_scope is 'baseline = patient default; room = room-level override; assignment = student interaction';
