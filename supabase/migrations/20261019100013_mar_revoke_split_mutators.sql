-- MAR v4 follow-up. 100012 remains byte-identical to the reviewed atomic
-- snapshot migration. This append-only migration retires the two historical
-- mutators after the atomic path is installed; read RPCs remain available.
revoke all on function public.save_mar_history(uuid, integer, uuid, text, integer, jsonb) from public, anon, authenticated;
revoke all on function public.create_mar_baseline_version(uuid, text, jsonb) from public, anon, authenticated;

create or replace function public.get_mar_readiness()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ready boolean;
begin
  ready := to_regclass('public.mar_administration_events') is not null
    and to_regclass('public.mar_assignment_baseline_versions') is not null
    and to_regclass('public.mar_save_operations') is not null
    and to_regprocedure('public.save_mar_history_atomic(uuid,uuid,integer,uuid,text,integer,jsonb)') is not null
    and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'mar_save_operations' and column_name = 'expected_revision')
    and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'mar_save_operations' and column_name = 'actor_id')
    and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mar_administration_events' and policyname = 'MAR authenticated read')
    and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mar_history_revisions' and policyname = 'MAR revisions authenticated read')
    and not has_function_privilege('authenticated', 'public.save_mar_history(uuid,integer,uuid,text,integer,jsonb)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.create_mar_baseline_version(uuid,text,jsonb)', 'EXECUTE');
  return jsonb_build_object('ready', ready, 'schemaVersion', case when ready then 4 else 0 end, 'functionVersion', case when ready then 4 else 0 end, 'atomicPersistence', ready);
end;
$$;
revoke all on function public.get_mar_readiness() from public, anon;
grant execute on function public.get_mar_readiness() to authenticated;
