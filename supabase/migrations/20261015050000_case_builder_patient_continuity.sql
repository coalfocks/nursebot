alter table public.case_blueprints
  add column if not exists source_patient_id uuid references public.patients(id) on delete set null,
  add column if not exists continues_from_room_id integer references public.rooms(id) on delete set null;

create index if not exists case_blueprints_source_patient_idx
  on public.case_blueprints(source_patient_id);

comment on column public.case_blueprints.source_patient_id is
  'Optional synthetic patient to reuse for a later case part; never inferred from prose.';
comment on column public.case_blueprints.continues_from_room_id is
  'Optional prior room for continuity; publishing preserves the prior room and links the new room to it.';
