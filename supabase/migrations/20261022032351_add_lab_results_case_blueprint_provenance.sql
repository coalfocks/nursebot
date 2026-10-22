-- Review-only compatibility packet for the exact dependency exposed by the
-- unchanged 20261021224401 function.  This is intentionally separate from
-- that conflict-target repair and remains unapplied in production.
--
-- The live materializer's lab branch writes case_blueprint_id, while the
-- restored production schema has that provenance column on clinical_notes and
-- imaging_studies but not lab_results.  Add the same nullable UUID provenance
-- contract, foreign key, and lookup index; do not invent data or alter old
-- chart rows.
alter table public.lab_results
  add column if not exists case_blueprint_id uuid
    references public.case_blueprints(id) on delete set null;

create index if not exists idx_lab_results_case_blueprint_id
  on public.lab_results(case_blueprint_id);

comment on column public.lab_results.case_blueprint_id is
  'Source case blueprint for idempotent authored timeline publishing; null for lab results created outside Case Builder.';
