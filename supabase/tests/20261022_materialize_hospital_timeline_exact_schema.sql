\set ON_ERROR_STOP on
\echo '== exact-schema materialize_hospital_timeline review runner =='
\echo 'schema: restored production public schema dump; database: disposable PostgreSQL'

select 'preflight function' as check,
  to_regprocedure('public.materialize_hospital_timeline(integer,uuid,uuid,uuid,jsonb,text,timestamptz)') is not null as passed;
select 'preflight four partial indexes' as check, count(*) = 4 as passed
from pg_index i
join pg_class c on c.oid = i.indexrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('clinical_notes_room_timeline_entry_uidx', 'lab_results_room_timeline_entry_uidx', 'vital_signs_room_timeline_entry_uidx', 'imaging_studies_room_timeline_entry_uidx')
  and pg_get_expr(i.indpred, i.indrelid) like '%room_id IS NOT NULL%'
  and pg_get_expr(i.indpred, i.indrelid) like '%timeline_entry_id IS NOT NULL%'
  and pg_get_expr(i.indpred, i.indrelid) like '%deleted_at IS NULL%';
select 'preflight authenticated grant' as check,
  has_function_privilege('authenticated', 'public.materialize_hospital_timeline(integer,uuid,uuid,uuid,jsonb,text,timestamptz)', 'execute') as passed;
select 'preflight function column contract' as check,
  count(*) = 3 as passed
from information_schema.columns
where table_schema = 'public'
  and ((table_name = 'clinical_notes' and column_name = 'case_blueprint_id')
    or (table_name = 'lab_results' and column_name = 'case_blueprint_id')
    or (table_name = 'imaging_studies' and column_name = 'case_blueprint_id'));

set session_replication_role = replica;
insert into public.schools (id, name, slug) values ('00000000-0000-4000-8000-000000000001', 'Isolated Review School', 'isolated-review');
insert into public.rooms (id, room_number, school_id, learner_program, bedside_requirement, patient_id)
values (900001, 'ISOLATED-42P10', '00000000-0000-4000-8000-000000000001', 'medical', 'situational', '00000000-0000-4000-8000-000000000002');
insert into public.patients (id, school_id, room_id, mrn, first_name, last_name, date_of_birth, gender)
values ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 900001, 'ISOLATED-42P10', 'Isolated', 'Fixture', '1990-01-01', 'Other');
set session_replication_role = origin;

\set timeline '{"encounterType":"inpatient","stayDays":1,"entries":[{"id":"note-1","kind":"admission","hospitalDay":1,"relativeHoursBeforeEncounter":24,"title":"Admission","content":"Exact-schema fixture"},{"id":"lab-1","kind":"lab","hospitalDay":1,"relativeHoursBeforeEncounter":18,"title":"CBC","content":"WBC","analyte":"WBC","value":"7","unit":"K/uL"},{"id":"vital-1","kind":"vital","hospitalDay":1,"relativeHoursBeforeEncounter":12,"title":"Vitals","content":"Stable","vitals":{"heartRate":72}},{"id":"image-1","kind":"imaging","hospitalDay":1,"relativeHoursBeforeEncounter":6,"title":"Chest study","content":"No acute finding","studyType":"Chest radiograph","report":"No acute finding"}]}'
create temp table _runner_timeline (value jsonb);
insert into _runner_timeline values (:'timeline'::jsonb);

do $$
begin
  begin
    perform public.materialize_hospital_timeline(900001, '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', null, (select value from _runner_timeline), 'isolated runner', now());
    raise exception 'before-migration call unexpectedly succeeded';
  exception when sqlstate '42P10' then
    raise notice 'BEFORE 42P10: PASS';
  end;
end
$$;

\echo '== applying exact unchanged 20261021224401 only inside disposable database =='
\i :migration_file

do $$
declare result jsonb;
begin
  begin
    result := public.materialize_hospital_timeline(900001, '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', null, (select value from _runner_timeline), 'isolated runner', now());
  exception when undefined_column then
    raise exception 'EXACT_SCHEMA_CONTRACT_MISMATCH: function references a column absent from the restored production schema; all-four-branch/retry proof is blocked until owner review';
  end;
  if (result->>'notes')::int <> 1 or (result->>'labs')::int <> 1 or (result->>'vitals')::int <> 1 or (result->>'imaging')::int <> 1 then
    raise exception 'after-migration row-type counts were not 1/1/1/1: %', result;
  end if;
  raise notice 'AFTER all four branches: PASS (%).', result;
end
$$;

select 'after first call row counts' as check,
  (select count(*) from public.clinical_notes where room_id = 900001 and timeline_entry_id = 'note-1') = 1
  and (select count(*) from public.lab_results where room_id = 900001 and timeline_entry_id = 'lab-1') = 1
  and (select count(*) from public.vital_signs where room_id = 900001 and timeline_entry_id = 'vital-1') = 1
  and (select count(*) from public.imaging_studies where room_id = 900001 and timeline_entry_id = 'image-1') = 1 as passed;

select public.materialize_hospital_timeline(900001, '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', null, (select value from _runner_timeline), 'isolated runner retry', now());
select 'retry no duplicates' as check,
  (select count(*) from public.clinical_notes where room_id = 900001 and timeline_entry_id = 'note-1') = 1
  and (select count(*) from public.lab_results where room_id = 900001 and timeline_entry_id = 'lab-1') = 1
  and (select count(*) from public.vital_signs where room_id = 900001 and timeline_entry_id = 'vital-1') = 1
  and (select count(*) from public.imaging_studies where room_id = 900001 and timeline_entry_id = 'image-1') = 1 as passed;

\echo '== rollback capture check: restore captured prior function body in disposable database =='
\i :prior_file
select 'rollback stale target restored' as check,
  (length(pg_get_functiondef('public.materialize_hospital_timeline(integer,uuid,uuid,uuid,jsonb,text,timestamptz)'::regprocedure))
   - length(replace(pg_get_functiondef('public.materialize_hospital_timeline(integer,uuid,uuid,uuid,jsonb,text,timestamptz)'::regprocedure), 'where timeline_entry_id is not null and deleted_at is null', ''))) > 0 as passed;
\echo '== exact-schema runner PASS =='
