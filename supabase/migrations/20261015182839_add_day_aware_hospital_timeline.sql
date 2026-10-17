alter table public.case_blueprints
  add column if not exists encounter_type text not null default 'inpatient'
    check (encounter_type in ('inpatient', 'ed', 'ld')),
  add column if not exists hospital_stay_days integer not null default 1
    check (hospital_stay_days between 1 and 3),
  add column if not exists hospital_timeline jsonb not null default '{"encounterType":"inpatient","stayDays":1,"priorContextHours":12,"entries":[]}'::jsonb;

alter table public.rooms
  add column if not exists encounter_type text not null default 'inpatient'
    check (encounter_type in ('inpatient', 'ed', 'ld')),
  add column if not exists hospital_stay_days integer not null default 1
    check (hospital_stay_days between 1 and 3),
  add column if not exists hospital_timeline jsonb not null default '{"encounterType":"inpatient","stayDays":1,"priorContextHours":12,"entries":[]}'::jsonb;

comment on column public.case_blueprints.hospital_timeline is 'Author-controlled dated pre-page chart context. Entries are excluded from learner action timelines and scoring.';
comment on column public.rooms.hospital_timeline is 'Published dated pre-page chart context. Entries are chart context only, not learner actions.';

create index if not exists case_blueprints_encounter_type_idx on public.case_blueprints(encounter_type);
create index if not exists rooms_encounter_type_idx on public.rooms(encounter_type);
