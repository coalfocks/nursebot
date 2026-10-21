-- Review packet only; intentionally not applied in this change.
-- Production has these partial unique indexes:
--   (room_id, timeline_entry_id)
--   WHERE room_id IS NOT NULL AND timeline_entry_id IS NOT NULL AND deleted_at IS NULL
-- The live function omitted room_id IS NOT NULL from all four conflict targets,
-- causing SQLSTATE 42P10 before any chart row was materialized.
--
-- Preflight required before apply:
-- 1. Confirm the exact function identity and all four current conflict targets.
-- 2. Confirm the four index names/predicates above and that no duplicate live
--    (room_id, timeline_entry_id) rows exist under those predicates.
-- 3. Confirm the authenticated execute grant and existing RLS/policy surface.
-- 4. Apply in a transaction, then invoke only against a disposable authored
--    timeline and verify one room update plus one row per provenance key.
-- Stop/rollback: if any preflight, grant, or duplicate check fails, do not
-- apply. If applied and verification fails, restore the prior function body
-- with CREATE OR REPLACE only; do not drop indexes or rewrite chart data.

do $$
declare
  v_definition text;
  v_stale_target text := 'where timeline_entry_id is not null and deleted_at is null';
begin
  select pg_get_functiondef(p.oid)
    into v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'materialize_hospital_timeline'
    and pg_get_function_identity_arguments(p.oid) = 'p_room_id integer, p_patient_id uuid, p_school_id uuid, p_case_blueprint_id uuid, p_timeline jsonb, p_nurse_context text, p_generated_at timestamp with time zone';

  if v_definition is null then
    raise exception 'materialize_hospital_timeline function was not found';
  end if;

  -- The live body uses `deleted_at is null`; retain the token as a guard
  -- against silently rewriting an unexpected function version.
  if length(v_definition) - length(replace(v_definition, v_stale_target, '')) <> 4 * length(v_stale_target) then
    raise exception 'Expected stale conflict target was not found; stop for manual review';
  end if;

  v_definition := replace(
    v_definition,
    v_stale_target,
    'where room_id is not null and timeline_entry_id is not null and deleted_at is null'
  );
  execute v_definition;
end
$$;
