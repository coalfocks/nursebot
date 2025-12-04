-- Add intake/output summary to patients for overview editing
alter table public.patients
  add column if not exists intake_output jsonb;
