-- Disposable-only publication contract fixture. It expects the exact reviewed
-- 100009..100017 chain and an authored room with revision 0.
\set ON_ERROR_STOP on
select set_config('request.jwt.claim.sub', :'admin_sub', false);
select set_config('mar.test.room_id', :'room_id', false);
select set_config('mar.test.request_id', gen_random_uuid()::text, false);

do $$ declare readiness jsonb; begin
  readiness := public.get_mar_normal_materialization_readiness();
  if coalesce((readiness->>'ready')::boolean, false) is not true
     or (readiness->>'materializationVersion')::integer < 4
     or coalesce((readiness->>'atomic')::boolean, false) is not true
     or (readiness->>'publicationVersion')::integer < 1 then
    raise exception 'MAR_PUBLICATION_READINESS_FAILED: %', readiness;
  end if;
end $$;

set role authenticated;
select public.publish_mar_case_version_atomic(
  current_setting('mar.test.request_id')::uuid,
  current_setting('mar.test.room_id')::integer,
  0, null, null
);
select public.publish_mar_case_version_atomic(
  current_setting('mar.test.request_id')::uuid,
  current_setting('mar.test.room_id')::integer,
  0, null, null
);
reset role;

do $$ declare operation_count integer; version_count integer; begin
  select count(*) into operation_count
    from public.mar_publication_operations
    where request_id = current_setting('mar.test.request_id')::uuid;
  select count(*) into version_count
    from public.mar_authored_case_versions
    where room_id = current_setting('mar.test.room_id')::integer
      and case_version = (
        select result->>'caseVersion' from public.mar_publication_operations
        where request_id = current_setting('mar.test.request_id')::uuid
      );
  if operation_count <> 1 or version_count <> 1 then
    raise exception 'MAR_PUBLICATION_REPLAY_DUPLICATED: operations=% versions=%', operation_count, version_count;
  end if;
end $$;

-- A separate author save advances the shared baseline revision after the
-- publication. The original request must still replay its committed result,
-- while a new request with the stale expected revision must conflict.
set role authenticated;
select public.save_mar_history_atomic(
  gen_random_uuid(),
  (select patient_id from public.rooms where id = current_setting('mar.test.room_id')::integer),
  current_setting('mar.test.room_id')::integer,
  null,
  'baseline-v1',
  0,
  jsonb_build_array(jsonb_build_object(
    'caseVersion', 'baseline-v1', 'occurrenceKey', 'publication-revision-bump',
    'relativeOffsetHours', 4, 'orderId', (select id from public.medical_orders where room_id = current_setting('mar.test.room_id')::integer limit 1),
    'medicationName', 'Disposable authored medication', 'status', 'Given'
  ))
);
select public.publish_mar_case_version_atomic(
  current_setting('mar.test.request_id')::uuid,
  current_setting('mar.test.room_id')::integer,
  0, null, null
);
reset role;
do $$ begin
  begin
    perform public.publish_mar_case_version_atomic(
      gen_random_uuid(), current_setting('mar.test.room_id')::integer, 0, null, null
    );
    raise exception 'MAR_PUBLICATION_STALE_REVISION_ACCEPTED';
  exception when others then
    if sqlerrm not like '%MAR_PUBLICATION_REVISION_CONFLICT%' then raise; end if;
  end;
end $$;

set role authenticated;
do $$ begin
  begin
    perform public.publish_mar_case_version_atomic(
      current_setting('mar.test.request_id')::uuid,
      current_setting('mar.test.room_id')::integer,
      0, 'changed-envelope', null
    );
    raise exception 'MAR_PUBLICATION_CHANGED_ENVELOPE_ACCEPTED';
  exception when others then
    if sqlerrm not like '%MAR_PUBLICATION_RETRY_MISMATCH%' then raise; end if;
  end;
end $$;
reset role;

select 'MAR_PUBLICATION_FIXTURE_PASS' as result,
  (select count(*) from public.mar_publication_operations where request_id = current_setting('mar.test.request_id')::uuid) as operations,
  (select count(*) from public.mar_authored_case_versions where room_id = current_setting('mar.test.room_id')::integer) as authored_versions;
