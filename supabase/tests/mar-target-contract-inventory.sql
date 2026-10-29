-- READ-ONLY target inventory. Run with a connection that can inspect catalog
-- metadata; do not run migration files from this script.
select current_database() as database_name, current_user as database_role;

select n.nspname as schema_name, c.relname as relation_name,
       c.relkind as relation_kind
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in (
     'manual_mar_packets', 'manual_mar_assignment_snapshots',
     'mar_authored_case_versions', 'mar_assignment_baseline_versions',
     'mar_assignment_materialization_operations', 'mar_administration_events',
     'student_room_assignments'
   )
 order by c.relname;

select p.oid::regprocedure as function_signature,
       pg_get_function_result(p.oid) as result_type,
       case when p.prosecdef then 'security definer' else 'security invoker' end as execution_mode
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in (
     'get_manual_mar_readiness', 'get_mar_normal_materialization_readiness',
     'get_mar_eligible_case_version', 'get_manual_mar_packet',
     'create_test_user_assignment_with_manual_snapshot',
     'publish_mar_case_version_from_manual_packet',
     'create_assignment_with_mar_materialization', 'get_mar_assignment_reader'
   )
 order by p.proname, p.oid::regprocedure::text;

select t.tgname, n.nspname as schema_name, c.relname as relation_name,
       not t.tgisinternal as user_trigger
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname = 'student_room_assignments'
   and t.tgname = 'manual_mar_snapshot_assignment_insert';

select case
         when to_regprocedure('public.create_test_user_assignment_with_manual_snapshot(uuid,integer,text,timestamptz,timestamptz,timestamptz)') is null then false
         else has_function_privilege('authenticated', to_regprocedure('public.create_test_user_assignment_with_manual_snapshot(uuid,integer,text,timestamptz,timestamptz,timestamptz)'), 'EXECUTE')
       end as test_user_rpc_callable,
       case
         when to_regprocedure('public.create_assignment_with_mar_materialization(uuid,uuid,uuid,integer,uuid,text,timestamptz,timestamptz,timestamptz)') is null then false
         else has_function_privilege('authenticated', to_regprocedure('public.create_assignment_with_mar_materialization(uuid,uuid,uuid,integer,uuid,text,timestamptz,timestamptz,timestamptz)'), 'EXECUTE')
       end as normal_rpc_callable;

-- Supabase-managed migration history, when present. Missing rows are evidence
-- for review only; this query never applies or replays anything.
select version, name
  from supabase_migrations.schema_migrations
 where version in (
   '20261019100009', '20261019100010', '20261019100011',
   '20261019100012', '20261019100013', '20261019100014',
   '20261019100015', '20261021130000', '20261021141147',
   '20261029170000', '20261029173000'
 )
 order by version;
