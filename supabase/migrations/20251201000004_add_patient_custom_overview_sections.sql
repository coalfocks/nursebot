-- Add custom overview sections per patient to render bespoke cards on EMR overview
alter table public.patients
  add column if not exists custom_overview_sections jsonb;
