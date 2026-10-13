-- Authoring-only room configuration for patient conversation and safe room edits.
-- Existing nurse/EMR context remains unchanged.
alter table public.rooms
  add column if not exists record_version integer,
  add column if not exists patient_conversation_prompt text,
  add column if not exists patient_conversation_enabled boolean not null default true,
  add column if not exists patient_participation_reason text,
  add column if not exists patient_speaker_type text not null default 'patient';

update public.rooms
set record_version = 1
where record_version is null;

alter table public.rooms
  alter column record_version set default 1,
  alter column record_version set not null,
  add constraint rooms_patient_speaker_type_check
    check (patient_speaker_type in ('patient', 'caregiver')),
  add constraint rooms_record_version_positive
    check (record_version > 0);

create or replace function public.bump_room_record_version()
returns trigger
language plpgsql
as $$
begin
  new.record_version = old.record_version + 1;
  return new;
end;
$$;

drop trigger if exists rooms_bump_record_version on public.rooms;
create trigger rooms_bump_record_version
before update on public.rooms
for each row execute function public.bump_room_record_version();

comment on column public.rooms.record_version is
  'Optimistic-concurrency token for authoring room configuration.';
comment on column public.rooms.patient_conversation_prompt is
  'Patient/caregiver-facing facts and communication prompt; excludes evaluator-only context.';
comment on column public.rooms.patient_conversation_enabled is
  'Whether the patient/caregiver participates in bedside conversation.';
comment on column public.rooms.patient_participation_reason is
  'Authored explanation for limited or disabled patient participation.';
comment on column public.rooms.patient_speaker_type is
  'Conversation speaker: patient or caregiver.';
