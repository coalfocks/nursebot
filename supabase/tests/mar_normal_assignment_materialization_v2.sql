-- Disposable-only v2 fixture. It expects a disposable database containing
-- 100009..100015 and real auth/profile/room fixtures. It never repairs an
-- existing assignment and never writes clinical content.
\set ON_ERROR_STOP on
\if :{?admin_sub}
\else
  \echo 'admin_sub is required'
  \quit 2
\endif
\if :{?student_sub}
\else
  \echo 'student_sub is required'
  \quit 2
\endif
\if :{?room_id}
\else
  \echo 'room_id is required'
  \quit 2
\endif
\if :{?assignment_id}
\else
  \echo 'assignment_id is required'
  \quit 2
\endif
\if :{?request_id}
\else
  \echo 'request_id is required'
  \quit 2
\endif

select set_config('request.jwt.claim.sub', :'admin_sub', false);
select set_config('mar.test.student_id', :'student_sub', false);
select set_config('mar.test.room_id', :'room_id', false);
do $$ declare readiness jsonb; begin
  readiness := public.get_mar_normal_materialization_readiness();
  if coalesce((readiness->>'ready')::boolean, false) is not true
     or (readiness->>'materializationVersion')::integer < 2
     or coalesce((readiness->>'atomic')::boolean, false) is not true then
    raise exception 'MAR_V2_READINESS_FAILED: %', readiness;
  end if;
end $$;

-- The disposable runner seeds one order with no administration and one
-- authored administration before this authenticated fixture starts.
select public.publish_mar_case_version(:room_id::integer, null);

select set_config('mar.test.assignment_id', :'assignment_id', false);
select set_config('mar.test.request_id', :'request_id', false);
select set_config('mar.test.effective_date', '2026-10-19T12:00:00Z', false);
select set_config('mar.test.window_start', '2026-10-19T12:00:00Z', false);
select set_config('mar.test.window_end', '2026-10-19T13:00:00Z', false);
select public.create_assignment_with_mar_materialization(
  :'request_id'::uuid, :'assignment_id'::uuid, :'student_sub'::uuid, :room_id::integer,
  (select school_id from public.profiles where id = :'student_sub'::uuid),
  (select case_version from public.mar_authored_case_versions where room_id = :room_id::integer order by created_at desc limit 1),
  current_setting('mar.test.effective_date')::timestamptz,
  current_setting('mar.test.window_start')::timestamptz,
  current_setting('mar.test.window_end')::timestamptz
);

do $$ declare assignment_count integer; snapshot_count integer; event_count integer; operation_count integer; begin
  select count(*) into assignment_count from public.student_room_assignments where id = current_setting('mar.test.assignment_id')::uuid;
  select count(*) into snapshot_count from public.mar_assignment_baseline_versions where assignment_id = current_setting('mar.test.assignment_id')::uuid;
  select count(*) into event_count from public.mar_administration_events where assignment_id = current_setting('mar.test.assignment_id')::uuid;
  select count(*) into operation_count from public.mar_assignment_materialization_operations where assignment_id = current_setting('mar.test.assignment_id')::uuid;
  if assignment_count <> 1 or snapshot_count <> 1 or operation_count <> 1 then
    raise exception 'MAR_V2_INSERT_COUNTS_FAILED: assignment=% snapshot=% operation=%', assignment_count, snapshot_count, operation_count;
  end if;
  if event_count < 1 then raise exception 'MAR_V2_NONEMPTY_EVENT_FIXTURE_FAILED'; end if;
end $$;

select set_config('request.jwt.claim.sub', :'student_sub', false);
do $$ declare frozen_order_count integer; begin
  select jsonb_array_length(public.get_mar_assignment_order_snapshot(current_setting('mar.test.assignment_id')::uuid)) into frozen_order_count;
  if frozen_order_count < 1 then raise exception 'MAR_V2_FROZEN_ORDER_READ_FAILED'; end if;
end $$;
select set_config('request.jwt.claim.sub', :'admin_sub', false);

-- Exact replay succeeds; a changed envelope under the same request is rejected.
select public.create_assignment_with_mar_materialization(
  :'request_id'::uuid, :'assignment_id'::uuid, :'student_sub'::uuid, :room_id::integer,
  (select school_id from public.profiles where id = :'student_sub'::uuid),
  (select case_version from public.mar_authored_case_versions where room_id = :room_id::integer order by created_at desc limit 1),
  current_setting('mar.test.effective_date')::timestamptz,
  current_setting('mar.test.window_start')::timestamptz,
  current_setting('mar.test.window_end')::timestamptz
);
do $$ begin
  begin
    perform public.create_assignment_with_mar_materialization(
      current_setting('mar.test.request_id')::uuid, current_setting('mar.test.assignment_id')::uuid, current_setting('mar.test.student_id')::uuid, current_setting('mar.test.room_id')::integer,
      (select school_id from public.profiles where id = current_setting('mar.test.student_id')::uuid),
      (select case_version from public.mar_authored_case_versions where room_id = current_setting('mar.test.room_id')::integer order by created_at desc limit 1),
      current_setting('mar.test.effective_date')::timestamptz + interval '1 minute',
      current_setting('mar.test.window_start')::timestamptz,
      current_setting('mar.test.window_end')::timestamptz
    );
    raise exception 'MAR_V2_CHANGED_ENVELOPE_ACCEPTED';
  exception when others then
    if sqlerrm not like '%MAR_MATERIALIZATION_RETRY_MISMATCH%' then raise; end if;
  end;
end $$;

-- A different request ID may not attach to an existing assignment.
do $$ begin
  begin
    perform public.create_assignment_with_mar_materialization(
      gen_random_uuid(), current_setting('mar.test.assignment_id')::uuid, current_setting('mar.test.student_id')::uuid, current_setting('mar.test.room_id')::integer,
      (select school_id from public.profiles where id = current_setting('mar.test.student_id')::uuid),
      (select case_version from public.mar_authored_case_versions where room_id = current_setting('mar.test.room_id')::integer order by created_at desc limit 1),
      current_setting('mar.test.effective_date')::timestamptz,
      current_setting('mar.test.window_start')::timestamptz,
      current_setting('mar.test.window_end')::timestamptz
    );
    raise exception 'MAR_V2_EXISTING_ASSIGNMENT_ACCEPTED';
  exception when others then
    if sqlerrm not like '%MAR_ASSIGNMENT_ALREADY_EXISTS%' then raise; end if;
  end;
end $$;

select 'MAR_V2_FIXTURE_PASS' as result,
  (select count(*) from public.student_room_assignments where id = current_setting('mar.test.assignment_id')::uuid) as assignments,
  (select count(*) from public.mar_assignment_baseline_versions where assignment_id = current_setting('mar.test.assignment_id')::uuid) as snapshots,
  (select count(*) from public.mar_administration_events where assignment_id = current_setting('mar.test.assignment_id')::uuid) as events,
  (select count(*) from public.mar_assignment_materialization_operations where assignment_id = current_setting('mar.test.assignment_id')::uuid) as operations;
