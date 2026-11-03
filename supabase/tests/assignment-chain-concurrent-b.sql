\set ON_ERROR_STOP on
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000202', false);
do $$
begin
  perform public.begin_assignment_chain_intent(
    '00000000-0000-0000-0000-000000000502',
    array['00000000-0000-0000-0000-000000004701'::uuid, '00000000-0000-0000-0000-000000004702'::uuid, '00000000-0000-0000-0000-000000004703'::uuid],
    jsonb_build_object(
      'version', 1, 'chainId', '00000000-0000-0000-0000-000000000502', 'ownerId', '00000000-0000-0000-0000-000000000204',
      'windowStart', '2000-01-01T09:00:00Z', 'windowEnd', '2099-01-01T10:00:00Z',
      'assignments', jsonb_build_array(
        jsonb_build_object('assignmentId', '00000000-0000-0000-0000-000000004701', 'stage', 'A', 'roomId', 401, 'authoredSourceVersion', 'chain-401-v1', 'authoredProgressNote', 'Authored A', 'authoredCapturedAt', '2099-01-01T08:00:00Z'),
        jsonb_build_object('assignmentId', '00000000-0000-0000-0000-000000004702', 'stage', 'B', 'roomId', 402, 'authoredSourceVersion', 'chain-402-v1', 'authoredProgressNote', 'Authored B', 'authoredCapturedAt', '2099-01-01T08:01:00Z'),
        jsonb_build_object('assignmentId', '00000000-0000-0000-0000-000000004703', 'stage', 'C', 'roomId', 403, 'authoredSourceVersion', 'chain-403-v1', 'authoredProgressNote', 'Authored C', 'authoredCapturedAt', '2099-01-01T08:02:00Z')
      )
    )
  );
  raise notice 'contender=granted chain=502';
exception when others then
  if sqlerrm <> 'ASSIGNMENT_CHAIN_MEMBER_CONFLICT' then raise; end if;
  raise notice 'contender=denied chain=502';
end $$;
