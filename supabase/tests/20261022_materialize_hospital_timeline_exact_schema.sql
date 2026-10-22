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
select 'preflight anon denied' as check,
  not has_function_privilege('anon', 'public.materialize_hospital_timeline(integer,uuid,uuid,uuid,jsonb,text,timestamptz)', 'execute') as passed;
select 'preflight chart RLS' as check,
  count(*) = 4 and bool_and(c.relrowsecurity) as passed
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('clinical_notes','lab_results','vital_signs','imaging_studies');
select 'preflight authenticated chart grants' as check,
  bool_and(has_table_privilege('authenticated', format('public.%s', table_name), 'SELECT,INSERT,UPDATE')) as passed
from (values ('clinical_notes'),('lab_results'),('vital_signs'),('imaging_studies')) as chart(table_name);
select 'preflight authenticated author-scope policies' as check,
  count(*) = 4 as passed
from pg_policies
where schemaname = 'public'
  and policyname = 'allow authenticated write'
  and tablename in ('clinical_notes','lab_results','vital_signs','imaging_studies');
select 'preflight function column contract' as check,
  count(*) = 3 as passed
from information_schema.columns
where table_schema = 'public'
  and ((table_name = 'clinical_notes' and column_name = 'case_blueprint_id')
    or (table_name = 'lab_results' and column_name = 'case_blueprint_id')
    or (table_name = 'imaging_studies' and column_name = 'case_blueprint_id'));

\echo '== production branch column/type readback before compatibility packet =='
with referenced(table_name, column_name) as (
  values
    ('clinical_notes','patient_id'),('clinical_notes','room_id'),('clinical_notes','school_id'),('clinical_notes','case_blueprint_id'),('clinical_notes','override_scope'),('clinical_notes','timeline_entry_id'),('clinical_notes','relative_offset_hours'),('clinical_notes','note_type'),('clinical_notes','title'),('clinical_notes','content'),('clinical_notes','author'),('clinical_notes','timestamp'),('clinical_notes','signed'),('clinical_notes','deleted_at'),
    ('lab_results','patient_id'),('lab_results','room_id'),('lab_results','school_id'),('lab_results','case_blueprint_id'),('lab_results','override_scope'),('lab_results','timeline_entry_id'),('lab_results','relative_offset_hours'),('lab_results','test_name'),('lab_results','value'),('lab_results','value_type'),('lab_results','text_value'),('lab_results','unit'),('lab_results','status'),('lab_results','lifecycle_status'),('lab_results','collection_time'),('lab_results','result_time'),('lab_results','ordered_by'),('lab_results','deleted_at'),
    ('vital_signs','patient_id'),('vital_signs','room_id'),('vital_signs','school_id'),('vital_signs','override_scope'),('vital_signs','timeline_entry_id'),('vital_signs','relative_offset_hours'),('vital_signs','timestamp'),('vital_signs','temperature'),('vital_signs','blood_pressure_systolic'),('vital_signs','blood_pressure_diastolic'),('vital_signs','heart_rate'),('vital_signs','respiratory_rate'),('vital_signs','oxygen_saturation'),('vital_signs','pain'),('vital_signs','deleted_at'),
    ('imaging_studies','patient_id'),('imaging_studies','room_id'),('imaging_studies','school_id'),('imaging_studies','case_blueprint_id'),('imaging_studies','override_scope'),('imaging_studies','timeline_entry_id'),('imaging_studies','relative_offset_hours'),('imaging_studies','order_name'),('imaging_studies','study_type'),('imaging_studies','status'),('imaging_studies','ordered_by'),('imaging_studies','order_time'),('imaging_studies','report'),('imaging_studies','report_generated_at'),('imaging_studies','deleted_at')
)
select r.table_name, r.column_name, c.data_type, c.udt_name, c.is_nullable
from referenced r left join information_schema.columns c
  on c.table_schema='public' and c.table_name=r.table_name and c.column_name=r.column_name
order by r.table_name, r.column_name;

set session_replication_role = replica;
insert into public.schools (id, name, slug) values ('00000000-0000-4000-8000-000000000001', 'Isolated Review School', 'isolated-review');
insert into public.rooms (id, room_number, school_id, learner_program, bedside_requirement, patient_id)
values (900001, 'ISOLATED-42P10', '00000000-0000-4000-8000-000000000001', 'medical', 'situational', '00000000-0000-4000-8000-000000000002');
insert into public.patients (id, school_id, room_id, mrn, first_name, last_name, date_of_birth, gender)
values ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 900001, 'ISOLATED-42P10', 'Isolated', 'Fixture', '1990-01-01', 'Other');
set session_replication_role = origin;
create temp table _initial_room_state as
select hospital_timeline, hospital_stay_days, encounter_type, nurse_context
from public.rooms where id = 900001;

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
declare v_sqlstate text; v_sqlerrm text;
begin
  begin
    perform public.materialize_hospital_timeline(900001, '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', null, (select value from _runner_timeline), 'compatibility probe', now());
    raise exception 'pre-compatibility call unexpectedly succeeded';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_sqlerrm = message_text;
    if v_sqlstate <> '42703' or v_sqlerrm not like '%case_blueprint_id%lab_results%' then
      raise exception 'unexpected pre-compatibility mismatch: SQLSTATE=% SQLERRM=%', v_sqlstate, v_sqlerrm;
    end if;
    raise notice 'AFTER 224401 PRE-COMPATIBILITY: PASS (SQLSTATE=% SQLERRM=%)', v_sqlstate, v_sqlerrm;
  end;
end
$$;

\echo '== applying separately reviewable lab provenance compatibility packet inside disposable database =='
\i :compatibility_file

select 'post-compatibility lab blueprint column' as check,
  (select data_type = 'uuid' from information_schema.columns
   where table_schema = 'public' and table_name = 'lab_results' and column_name = 'case_blueprint_id') as passed;

do $$
declare v_sqlstate text; v_sqlerrm text;
begin
  begin
    perform public.materialize_hospital_timeline(900001, '00000000-0000-4000-8000-000000000099', '00000000-0000-4000-8000-000000000001', null, (select value from _runner_timeline), 'wrong patient should rollback', now());
    raise exception 'intended scope failure unexpectedly succeeded';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_sqlerrm = message_text;
    if v_sqlstate <> 'P0001' or v_sqlerrm not like 'Timeline publish link mismatch%' then
      raise exception 'unexpected intended failure: SQLSTATE=% SQLERRM=%', v_sqlstate, v_sqlerrm;
    end if;
    raise notice 'INTENDED FAILURE ROLLBACK: PASS (SQLSTATE=% SQLERRM=%)', v_sqlstate, v_sqlerrm;
  end;
end
$$;

select 'intended failure zero residue' as check,
  (select count(*) from public.clinical_notes where room_id = 900001) = 0
  and (select count(*) from public.lab_results where room_id = 900001) = 0
  and (select count(*) from public.vital_signs where room_id = 900001) = 0
  and (select count(*) from public.imaging_studies where room_id = 900001) = 0
  and (select (r.hospital_timeline, r.hospital_stay_days, r.encounter_type, r.nurse_context)
       is not distinct from (s.hospital_timeline, s.hospital_stay_days, s.encounter_type, s.nurse_context)
       from public.rooms r cross join _initial_room_state s where r.id = 900001) as passed;

do $$
declare result jsonb; v_sqlstate text; v_sqlerrm text;
begin
  begin
    result := public.materialize_hospital_timeline(900001, '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', null, (select value from _runner_timeline), 'isolated runner', now());
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_sqlerrm = message_text;
    raise exception 'EXACT_SCHEMA_CONTRACT_MISMATCH: SQLSTATE=% SQLERRM=%', v_sqlstate, v_sqlerrm;
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
