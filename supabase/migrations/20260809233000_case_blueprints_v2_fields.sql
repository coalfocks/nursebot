alter table public.case_blueprints
  add column if not exists bedside_requirement text not null default 'no'
    check (bedside_requirement in ('yes', 'no', 'situational')),
  add column if not exists consults text,
  add column if not exists room_number text,
  add column if not exists patient_chat_enabled boolean not null default false,
  add column if not exists generation_package jsonb,
  add column if not exists generation_status text not null default 'not_generated'
    check (generation_status in ('not_generated', 'generated', 'failed')),
  add column if not exists generation_error text,
  add column if not exists generated_at timestamp with time zone;

update public.case_blueprints
set bedside_requirement = case
  when bedside_required is true then 'yes'
  else 'no'
end
where bedside_requirement = 'no'
  and bedside_required is true;

comment on column public.case_blueprints.bedside_requirement is
  'Post-case feedback verdict for whether the learner should go bedside: yes, no, or situational.';
comment on column public.case_blueprints.consults is
  'Free-text consult notes/specifications to generate into the EMR package.';
comment on column public.case_blueprints.room_number is
  'Room number to apply automatically when this blueprint becomes a room.';
comment on column public.case_blueprints.patient_chat_enabled is
  'Whether bedside patient chat should be generated when the patient is able to participate.';
comment on column public.case_blueprints.generation_package is
  'Previewable generated Nurse Althea v2 room package derived from the case blueprint.';
comment on column public.case_blueprints.generation_status is
  'Current status of the generated preview package.';
comment on column public.case_blueprints.generation_error is
  'Last generation error visible to admins.';
comment on column public.case_blueprints.generated_at is
  'Timestamp for the most recent generated preview package.';

alter table public.rooms
  add column if not exists bedside_requirement text not null default 'situational'
    check (bedside_requirement in ('yes', 'no', 'situational'));

comment on column public.rooms.bedside_requirement is
  'Post-case feedback verdict for whether the learner should go bedside: yes, no, or situational.';
