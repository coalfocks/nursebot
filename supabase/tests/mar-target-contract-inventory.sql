-- READ-ONLY target inventory. Run with a connection that can inspect catalog
-- metadata; do not run migration files from this script. Every expected
-- function is represented even when absent.
select current_database() as database_name, current_user as database_role;

select n.nspname as schema_name, c.relname as relation_name,
       c.relkind as relation_kind, c.relrowsecurity, c.relforcerowsecurity,
       pg_get_userbyid(c.relowner) as relation_owner
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

select table_name, column_name, ordinal_position, data_type, udt_name,
       is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public'
   and table_name in (
     'manual_mar_packets', 'manual_mar_assignment_snapshots',
     'mar_authored_case_versions', 'mar_assignment_baseline_versions',
     'mar_assignment_materialization_operations', 'mar_administration_events',
     'student_room_assignments'
   )
 order by table_name, ordinal_position;

with expected(signature) as (values
  ('public.get_manual_mar_readiness()'),
  ('public.get_mar_readiness()'),
  ('public.get_mar_normal_materialization_readiness()'),
  ('public.get_mar_eligible_case_version(integer)'),
  ('public.get_manual_mar_packet(uuid,integer,uuid,text)'),
  ('public.create_test_user_assignment_with_manual_snapshot(uuid,integer,text,timestamptz,timestamptz,timestamptz)'),
  ('public.publish_mar_case_version_from_manual_packet(integer,text)'),
  ('public.create_assignment_with_mar_materialization(uuid,uuid,uuid,integer,uuid,text,timestamptz,timestamptz,timestamptz)'),
  ('public.get_mar_assignment_reader(uuid)')
)
select e.signature as expected_signature,
       p.oid is not null as installed,
       case when p.oid is null then null else pg_get_function_result(p.oid) end as result_type,
       case when p.oid is null then null
            when p.prosecdef then 'security definer' else 'security invoker' end as execution_mode,
       case when p.oid is null then null else pg_get_functiondef(p.oid) end as definition,
       case when p.oid is null then false
            else has_function_privilege('authenticated', p.oid, 'EXECUTE') end as authenticated_execute
  from expected e
  left join pg_proc p on p.oid = to_regprocedure(e.signature)::oid
 order by e.signature;

select routine_name, specific_name, grantee, privilege_type
  from information_schema.routine_privileges
 where routine_schema = 'public'
   and routine_name in (
     'get_manual_mar_readiness', 'get_mar_readiness',
     'get_mar_normal_materialization_readiness', 'get_mar_eligible_case_version',
     'get_manual_mar_packet', 'create_test_user_assignment_with_manual_snapshot',
     'publish_mar_case_version_from_manual_packet',
     'create_assignment_with_mar_materialization', 'get_mar_assignment_reader'
   )
 order by routine_name, specific_name, grantee, privilege_type;

select table_name, grantee, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public'
   and table_name in (
     'manual_mar_packets', 'manual_mar_assignment_snapshots',
     'mar_authored_case_versions', 'mar_assignment_baseline_versions',
     'mar_assignment_materialization_operations', 'mar_administration_events',
     'student_room_assignments'
   )
 order by table_name, grantee, privilege_type;

select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
  from pg_policies
 where schemaname = 'public'
   and tablename in (
     'manual_mar_packets', 'manual_mar_assignment_snapshots',
     'mar_authored_case_versions', 'mar_assignment_baseline_versions',
     'mar_assignment_materialization_operations', 'mar_administration_events',
     'student_room_assignments'
   )
 order by tablename, policyname;

select t.tgname, n.nspname as schema_name, c.relname as relation_name,
       not t.tgisinternal as user_trigger,
       pg_get_triggerdef(t.oid) as trigger_definition,
       pg_get_functiondef(t.tgfoid) as trigger_function_definition
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in (
     'student_room_assignments', 'manual_mar_packets',
     'manual_mar_assignment_snapshots', 'mar_authored_case_versions',
     'mar_administration_events'
   )
   and not t.tgisinternal
 order by c.relname, t.tgname;

-- Compatibility summary for the two creation RPCs. Missing signatures return
-- false rather than aborting inventory execution.
select case when to_regprocedure('public.create_test_user_assignment_with_manual_snapshot(uuid,integer,text,timestamptz,timestamptz,timestamptz)') is null then false else has_function_privilege('authenticated', to_regprocedure('public.create_test_user_assignment_with_manual_snapshot(uuid,integer,text,timestamptz,timestamptz,timestamptz)'), 'EXECUTE') end as test_user_rpc_callable,
       case when to_regprocedure('public.create_assignment_with_mar_materialization(uuid,uuid,uuid,integer,uuid,text,timestamptz,timestamptz,timestamptz)') is null then false else has_function_privilege('authenticated', to_regprocedure('public.create_assignment_with_mar_materialization(uuid,uuid,uuid,integer,uuid,text,timestamptz,timestamptz,timestamptz)'), 'EXECUTE') end as normal_rpc_callable;

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
