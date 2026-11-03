-- Executable disposable contract for the actual prospective chain RPCs.
-- Run only against fixtures/assignment-chain-bootstrap.sql. It does not
-- connect to or mutate any target/project database.

\set ON_ERROR_STOP on
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000202', false);

-- Begin and materialize are separate transactions because the finalizer
-- requires operation.created_at > immutable intent.created_at.
do $$
declare result jsonb; begin
  perform public.publish_mar_case_version(401, 'chain-401-v1');
  perform public.publish_mar_case_version(402, 'chain-402-v1');
  perform public.publish_mar_case_version(403, 'chain-403-v1');
  result := public.begin_assignment_chain_intent(
    '00000000-0000-0000-0000-000000000401',
    array['00000000-0000-0000-0000-000000004401'::uuid, '00000000-0000-0000-0000-000000004402'::uuid, '00000000-0000-0000-0000-000000004403'::uuid],
    jsonb_build_object(
      'version', 1, 'chainId', '00000000-0000-0000-0000-000000000401', 'ownerId', '00000000-0000-0000-0000-000000000204',
      'windowStart', '2000-01-01T09:00:00Z', 'windowEnd', '2099-01-01T10:00:00Z',
      'assignments', jsonb_build_array(
        jsonb_build_object('assignmentId', '00000000-0000-0000-0000-000000004401', 'stage', 'A', 'roomId', 401, 'authoredSourceVersion', 'chain-401-v1', 'authoredProgressNote', 'Authored A', 'authoredCapturedAt', '2099-01-01T08:00:00Z'),
        jsonb_build_object('assignmentId', '00000000-0000-0000-0000-000000004402', 'stage', 'B', 'roomId', 402, 'authoredSourceVersion', 'chain-402-v1', 'authoredProgressNote', 'Authored B', 'authoredCapturedAt', '2099-01-01T08:01:00Z'),
        jsonb_build_object('assignmentId', '00000000-0000-0000-0000-000000004403', 'stage', 'C', 'roomId', 403, 'authoredSourceVersion', 'chain-403-v1', 'authoredProgressNote', 'Authored C', 'authoredCapturedAt', '2099-01-01T08:02:00Z')
      )
    )
  );
  if coalesce((result->>'replayed')::boolean, true) then raise exception 'intent unexpectedly replayed: %', result; end if;
end $$;

do $$
declare result jsonb; position integer; begin
  for position in 1..3 loop
    result := public.create_assignment_with_mar_materialization(
      ('00000000-0000-0000-0000-00000000440' || position)::uuid,
      ('00000000-0000-0000-0000-00000000440' || position)::uuid,
      '00000000-0000-0000-0000-000000000204', 400 + position,
      '00000000-0000-0000-0000-000000000002', format('chain-%s-v1', 400 + position),
      '2000-01-01T09:00:00Z', '2000-01-01T09:00:00Z', '2099-01-01T10:00:00Z'
    );
    if result->>'assignmentId' <> ('00000000-0000-0000-0000-00000000440' || position) then raise exception 'materialization identity mismatch: %', result; end if;
  end loop;
end $$;

do $$
declare result jsonb; begin
  result := public.create_assignment_chain_with_snapshots(
    '00000000-0000-0000-0000-000000000401',
    array['00000000-0000-0000-0000-000000004401'::uuid, '00000000-0000-0000-0000-000000004402'::uuid, '00000000-0000-0000-0000-000000004403'::uuid],
    jsonb_build_object(
      'version', 1, 'chainId', '00000000-0000-0000-0000-000000000401', 'ownerId', '00000000-0000-0000-0000-000000000204',
      'windowStart', '2000-01-01T09:00:00Z', 'windowEnd', '2099-01-01T10:00:00Z',
      'assignments', jsonb_build_array(
        jsonb_build_object('assignmentId', '00000000-0000-0000-0000-000000004401', 'stage', 'A', 'roomId', 401, 'authoredSourceVersion', 'chain-401-v1', 'authoredProgressNote', 'Authored A', 'authoredCapturedAt', '2099-01-01T08:00:00Z'),
        jsonb_build_object('assignmentId', '00000000-0000-0000-0000-000000004402', 'stage', 'B', 'roomId', 402, 'authoredSourceVersion', 'chain-402-v1', 'authoredProgressNote', 'Authored B', 'authoredCapturedAt', '2099-01-01T08:01:00Z'),
        jsonb_build_object('assignmentId', '00000000-0000-0000-0000-000000004403', 'stage', 'C', 'roomId', 403, 'authoredSourceVersion', 'chain-403-v1', 'authoredProgressNote', 'Authored C', 'authoredCapturedAt', '2099-01-01T08:02:00Z')
      )
    )
  );
  if result->>'complete' <> 'true' or result->>'replayed' <> 'false' then raise exception 'shared/global chain did not finalize: %', result; end if;
  reset role;
  if (select count(*) from public.assignment_chain_snapshots where chain_id = '00000000-0000-0000-0000-000000000401') <> 3 then raise exception 'expected three persisted predecessor snapshots'; end if;
end $$;

do $$
declare context jsonb; begin
  reset role;
  update public.student_room_assignments set status = 'completed', completed_at = '2099-01-01T09:30:00Z' where id = '00000000-0000-0000-0000-000000004401';
  set role authenticated;
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000204', false);
  select public.get_assignment_chain_prior_stage_context_for_assignment('00000000-0000-0000-0000-000000004402') into context;
  if jsonb_array_length(context) <> 1 or context->0->>'sourceAssignmentId' <> '00000000-0000-0000-0000-000000004401' or context->0->>'content' <> 'Authored A' then raise exception 'eligible learner reader mismatch: %', context; end if;
end $$;

do $$
declare before_chains integer; before_snapshots integer; begin
  reset role;
  select count(*) into before_chains from public.assignment_chains;
  select count(*) into before_snapshots from public.assignment_chain_snapshots;
  set role authenticated;
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000205', false);
  begin
    perform public.get_assignment_chain_prior_stage_context_for_assignment('00000000-0000-0000-0000-000000004402');
    raise exception 'foreign learner unexpectedly received predecessor context';
  exception when others then
    if sqlerrm <> 'ASSIGNMENT_CHAIN_NOT_VISIBLE' then raise; end if;
  end;
  reset role;
  if (select count(*) from public.assignment_chains) <> before_chains or (select count(*) from public.assignment_chain_snapshots) <> before_snapshots then raise exception 'foreign learner denial changed persisted chain state'; end if;
end $$;

select 'actual shared/global chain finalization, authenticated reader gating, and foreign learner denial passed' as result;
