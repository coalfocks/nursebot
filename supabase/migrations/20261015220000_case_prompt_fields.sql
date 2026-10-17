-- Additive authoring fields for explicit patient and consultant behavior.
-- Existing rooms and blueprints remain valid; NULL means no override authored.
alter table public.case_blueprints
  add column if not exists patient_conversation_prompt text,
  add column if not exists consultant_response_prompt text;

alter table public.rooms
  add column if not exists consultant_response_prompt text;

comment on column public.case_blueprints.patient_conversation_prompt is
  'Author-controlled patient persona, history, and answer boundaries for bedside chat.';
comment on column public.case_blueprints.consultant_response_prompt is
  'Author-controlled consultant portal response behavior and boundaries.';
comment on column public.rooms.consultant_response_prompt is
  'Published consultant portal response behavior and boundaries.';
