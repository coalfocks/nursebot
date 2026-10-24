\set ON_ERROR_STOP on
\timing on
begin;
update public.faculty_study_batches
set lease_token = :'lease_b', started_at = now(), lease_expires_at = now() + interval '15 minutes'
where id = :'batch_id' and status = 'running' and lease_token = :'lease_a';
select public.write_faculty_study_result_owned(
  :'batch_id', 1, :'lease_b', :'assignment_id',
  '{"owner":"B"}'::jsonb, '{"frozen":"B"}'::jsonb,
  '{"score":5}'::jsonb, '{"score":5}'::jsonb, '{"raw":"B"}'::jsonb,
  null, 'rubric-v4', 'study-model', '2026-10-24T01:02:00Z'::timestamptz
) as b_write;
commit;
