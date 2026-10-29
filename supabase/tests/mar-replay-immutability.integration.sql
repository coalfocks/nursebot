-- Focused regression for 20261029173000.
-- Run after the reviewed baseline fixture and exact 170000/173000 contracts
-- are installed, with psql --set ON_ERROR_STOP=1. This intentionally edits
-- the mutable packet after assignment creation; it never edits an old
-- assignment or snapshot.

\set ON_ERROR_STOP on

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000103', false);

do $$
declare
  first_result jsonb;
  replay_result jsonb;
  frozen_events jsonb;
begin
  first_result := public.create_test_user_assignment_with_manual_snapshot(
    '00000000-0000-0000-0000-000000002205', 204, 'accepted-manual-v1',
    '2026-10-29T17:00:00Z', '2026-10-29T17:00:00Z', null
  );
  if first_result->>'packetRevision' <> '1' or first_result->>'eventCount' <> '7' then
    raise exception 'initial manual snapshot was not revision 1 with 7 events: %', first_result;
  end if;

  select events into frozen_events
    from public.manual_mar_assignment_snapshots
   where assignment_id = '00000000-0000-0000-0000-000000002205';

  -- Simulate a later author save under the same case key. This is valid
  -- mutable authoring state and must not rewrite the assignment snapshot.
  update public.manual_mar_packets
     set revision = 2,
         events = events || jsonb_build_array(jsonb_build_object(
           'occurrenceKey', 'author-edit-only', 'medicationName', 'Later edit')),
         updated_at = now()
   where room_id = 204 and case_version = 'accepted-manual-v1';

  replay_result := public.create_test_user_assignment_with_manual_snapshot(
    '00000000-0000-0000-0000-000000002205', 204, 'accepted-manual-v1',
    '2026-10-29T17:00:00Z', '2026-10-29T17:00:00Z', null
  );
  if coalesce((replay_result->>'replayed')::boolean, false) is not true
     or replay_result->>'packetRevision' <> '1'
     or replay_result->>'eventCount' <> '7' then
    raise exception 'replay followed mutable packet instead of frozen snapshot: %', replay_result;
  end if;
  if (select events from public.manual_mar_assignment_snapshots
      where assignment_id = '00000000-0000-0000-0000-000000002205') is distinct from frozen_events then
    raise exception 'replay changed the immutable assignment snapshot';
  end if;
end $$;

do $$
begin
  perform public.create_test_user_assignment_with_manual_snapshot(
    '00000000-0000-0000-0000-000000002205', 304, 'accepted-manual-v1',
    '2026-10-29T17:00:00Z', '2026-10-29T17:00:00Z', null
  );
  raise exception 'expected exact assignment-envelope rejection';
exception when others then
  if sqlerrm <> 'MAR_TEST_ASSIGNMENT_RETRY_MISMATCH' then raise; end if;
end $$;

select 'mar replay immutability regression passed' as result;
