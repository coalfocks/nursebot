\set ON_ERROR_STOP on
\timing on
begin;
select status, lease_token from public.faculty_study_batches where id = :'batch_id' for update;
select 'A holds the batch-row lock after its ownership snapshot' as event;
select pg_sleep(3);
select public.write_faculty_study_result_owned(
  :'batch_id', 1, :'lease_a', :'assignment_id',
  '{"owner":"A"}'::jsonb, '{"frozen":"A"}'::jsonb,
  '{"score":1}'::jsonb, '{"score":1}'::jsonb, '{"raw":"A"}'::jsonb,
  null, 'rubric-v4', 'study-model', '2026-10-24T01:00:00Z'::timestamptz
) as a_initial_write;
commit;

select pg_sleep(1);
select public.write_faculty_study_result_owned(
  :'batch_id', 1, :'lease_a', :'assignment_id',
  '{"owner":"A-late"}'::jsonb, '{"frozen":"A-late"}'::jsonb,
  '{"score":99}'::jsonb, '{"score":99}'::jsonb, '{"raw":"A-late"}'::jsonb,
  null, 'rubric-v4', 'study-model', '2026-10-24T01:01:00Z'::timestamptz
) as a_late_write;
