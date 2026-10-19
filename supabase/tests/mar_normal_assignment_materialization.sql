-- Disposable-only normal path fixture. Run after 100009..100013 and 100014
-- on a fresh database with the fixture roles/data loaded. It must never be
-- pointed at production or an established assignment.
begin;
select set_config('app.test.request_id', gen_random_uuid()::text, true);
select set_config('app.test.assignment_id', gen_random_uuid()::text, true);
select set_config('app.test.case_version', 'room-disposable-mar-v1', true);

-- The harness supplies a school-admin JWT and disposable student/room IDs.
select public.create_assignment_with_mar_materialization(
  current_setting('app.test.request_id')::uuid,
  current_setting('app.test.assignment_id')::uuid,
  current_setting('app.test.student_id')::uuid,
  current_setting('app.test.room_id')::integer,
  current_setting('app.test.school_id')::uuid,
  current_setting('app.test.case_version'),
  now(), now(), now() + interval '50 minutes'
) as materialization_result;

do $$
declare
  assignment_count integer;
  version_count integer;
  event_count integer;
  replay jsonb;
begin
  select count(*) into assignment_count from public.student_room_assignments where id = current_setting('app.test.assignment_id')::uuid;
  select count(*) into version_count from public.mar_assignment_baseline_versions where assignment_id = current_setting('app.test.assignment_id')::uuid;
  select count(*) into event_count from public.mar_administration_events where assignment_id = current_setting('app.test.assignment_id')::uuid;
  if assignment_count <> 1 or version_count <> 1 then raise exception 'NORMAL_MATERIALIZATION_COUNTS:%:%', assignment_count, version_count; end if;
  replay := public.create_assignment_with_mar_materialization(
    current_setting('app.test.request_id')::uuid,
    current_setting('app.test.assignment_id')::uuid,
    current_setting('app.test.student_id')::uuid,
    current_setting('app.test.room_id')::integer,
    current_setting('app.test.school_id')::uuid,
    current_setting('app.test.case_version'), now(), now(), now() + interval '50 minutes');
  if (select count(*) from public.student_room_assignments where id = current_setting('app.test.assignment_id')::uuid) <> 1 then raise exception 'NORMAL_REPLAY_DUPLICATED_ASSIGNMENT'; end if;
  if (select count(*) from public.mar_administration_events where assignment_id = current_setting('app.test.assignment_id')::uuid) <> event_count then raise exception 'NORMAL_REPLAY_DUPLICATED_EVENTS'; end if;
end;
$$;
rollback;
