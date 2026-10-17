alter table public.rooms
  add column if not exists case_blueprint_id uuid
    references public.case_blueprints(id) on delete set null;

create index if not exists idx_rooms_case_blueprint_id
  on public.rooms(case_blueprint_id);

create unique index if not exists rooms_school_case_blueprint_published_uidx
  on public.rooms(school_id, case_blueprint_id)
  where case_blueprint_id is not null;

comment on column public.rooms.case_blueprint_id is
  'Source case blueprint for idempotent publishing; null for rooms created outside Case Builder.';

alter table public.clinical_notes
  add column if not exists case_blueprint_id uuid
    references public.case_blueprints(id) on delete set null,
  add column if not exists case_publish_key text;

alter table public.imaging_studies
  add column if not exists case_blueprint_id uuid
    references public.case_blueprints(id) on delete set null;

create index if not exists idx_clinical_notes_case_blueprint_id
  on public.clinical_notes(case_blueprint_id);

create index if not exists idx_imaging_studies_case_blueprint_id
  on public.imaging_studies(case_blueprint_id);

create unique index if not exists clinical_notes_case_publish_uidx
  on public.clinical_notes(patient_id, case_blueprint_id, case_publish_key)
  where case_blueprint_id is not null and case_publish_key is not null;

create unique index if not exists imaging_studies_case_publish_uidx
  on public.imaging_studies(patient_id, case_blueprint_id, order_name)
  where case_blueprint_id is not null and order_name is not null;
