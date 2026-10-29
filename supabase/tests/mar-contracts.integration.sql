-- Actual RPC/reader proof against the minimal disposable fixture. This is
-- synthetic contract evidence, not production data or RLS/auth-service proof.

do $$
declare
  packet jsonb;
  result jsonb;
  reader jsonb;
  source_event jsonb;
  snapshot_event jsonb;
  materialized_event jsonb;
begin
  -- Admin manual readback is the source of truth and remains untouched.
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000102', false);
  packet := public.get_manual_mar_packet('00000000-0000-0000-0000-000000001204', 204, null, 'accepted-manual-v1');
  if jsonb_array_length(packet->'events') <> 7 then raise exception 'admin Room 204 packet count mismatch: %', packet; end if;

  -- test_user uses the scoped manual lookup and atomic snapshot RPC.
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000103', false);
  result := public.get_mar_eligible_case_version(204);
  if result->>'caseVersion' <> 'accepted-manual-v1' or result->>'source' <> 'manual_packet' then raise exception 'test_user lookup mismatch: %', result; end if;
  result := public.create_test_user_assignment_with_manual_snapshot(
    '00000000-0000-0000-0000-000000002204', 204, 'accepted-manual-v1',
    '2026-10-29T17:00:00Z', '2026-10-29T17:00:00Z', null
  );
  if result->>'eventCount' <> '7' or result->>'packetRevision' <> '1' then raise exception 'test_user snapshot mismatch: %', result; end if;
  reader := public.get_mar_assignment_reader('00000000-0000-0000-0000-000000002204');
  if reader->>'reader' <> 'manual' then raise exception 'test_user reader mismatch: %', reader; end if;
  result := public.create_test_user_assignment_with_manual_snapshot(
    '00000000-0000-0000-0000-000000002204', 204, 'accepted-manual-v1',
    '2026-10-29T17:00:00Z', '2026-10-29T17:00:00Z', null
  );
  if coalesce((result->>'replayed')::boolean, false) is not true or result->>'packetRevision' <> '1' then raise exception 'same-body replay mismatch: %', result; end if;

  -- The same role-scoped path preserves the accepted 8-event ED 20 packet and
  -- 4-event Room 304 packet; compare frozen JSON values, not just counts.
  for source_event in
    select jsonb_build_object('room', 20, 'assignment', '00000000-0000-0000-0000-000000002020', 'expected', 8)
    union all select jsonb_build_object('room', 304, 'assignment', '00000000-0000-0000-0000-000000003040', 'expected', 4)
  loop
    result := public.create_test_user_assignment_with_manual_snapshot(
      (source_event->>'assignment')::uuid, (source_event->>'room')::integer, 'accepted-manual-v1',
      '2026-10-29T17:00:00Z', '2026-10-29T17:00:00Z', null
    );
    if (result->>'eventCount')::integer <> (source_event->>'expected')::integer then raise exception 'test_user packet count mismatch: %', result; end if;
    select events into snapshot_event from public.manual_mar_assignment_snapshots where assignment_id = (source_event->>'assignment')::uuid;
    select events into packet from public.manual_mar_packets where room_id = (source_event->>'room')::integer and case_version = 'accepted-manual-v1';
    if snapshot_event is distinct from packet then raise exception 'test_user source/snapshot value mismatch for room %', source_event->>'room'; end if;
  end loop;

  begin
    perform public.create_test_user_assignment_with_manual_snapshot(
      '00000000-0000-0000-0000-000000002204', 304, 'accepted-manual-v1',
      '2026-10-29T17:00:00Z', '2026-10-29T17:00:00Z', null
    );
    raise exception 'changed envelope was accepted';
  exception when others then
    if sqlerrm <> 'MAR_TEST_ASSIGNMENT_RETRY_MISMATCH' then raise; end if;
  end;

  -- Normal learner path: admin publication reads the accepted packet, then
  -- the actual materialization RPC creates its immutable assignment snapshot
  -- and assignment-scoped events. No direct inserts stand in for the RPC.
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000102', false);
  result := public.publish_mar_case_version_from_manual_packet(204, 'normal-from-accepted-v1');
  if result->>'eventCount' <> '7' then raise exception 'normal publication mismatch: %', result; end if;
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000102', false);
  result := public.create_assignment_with_mar_materialization(
    '00000000-0000-0000-0000-000000002304', '00000000-0000-0000-0000-000000002304',
    '00000000-0000-0000-0000-000000000104', 204, '00000000-0000-0000-0000-000000000001',
    'normal-from-accepted-v1', '2026-10-29T17:00:00Z', '2026-10-29T17:00:00Z', null
  );
  if result->>'eventCount' <> '7' then raise exception 'normal materialization mismatch: %', result; end if;
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000104', false);
  reader := public.get_mar_assignment_reader('00000000-0000-0000-0000-000000002304');
  if reader->>'reader' <> 'automatic' then raise exception 'normal reader mismatch: %', reader; end if;

  select value into source_event from public.manual_mar_packets p cross join lateral jsonb_array_elements(p.events) value where p.room_id = 204 and p.case_version = 'accepted-manual-v1' order by value->>'occurrenceKey' limit 1;
  select to_jsonb(e) into materialized_event from public.mar_administration_events e where e.assignment_id = '00000000-0000-0000-0000-000000002304' order by e.occurrence_key limit 1;
  if materialized_event->>'medication_name' <> source_event->>'medicationName'
     or materialized_event->>'ordered_dose' <> source_event->>'orderedDose'
     or materialized_event->>'status' <> source_event->>'status'
     or materialized_event->>'reason' is distinct from source_event->>'reason' then
    raise exception 'source-to-materialized event field mismatch: source %, materialized %', source_event, materialized_event;
  end if;

  -- Normal creation uses the same accepted packet provenance for ED 20 and
  -- Room 304 through the actual publication and materialization RPCs.
  for source_event in
    select jsonb_build_object('room', 20, 'assignment', '00000000-0000-0000-0000-000000004020', 'expected', 8)
    union all select jsonb_build_object('room', 304, 'assignment', '00000000-0000-0000-0000-000000004304', 'expected', 4)
  loop
    perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000102', false);
    result := public.publish_mar_case_version_from_manual_packet((source_event->>'room')::integer, 'normal-from-accepted-v1');
    if (result->>'eventCount')::integer <> (source_event->>'expected')::integer then raise exception 'normal publication count mismatch: %', result; end if;
    result := public.create_assignment_with_mar_materialization(
      (source_event->>'assignment')::uuid, (source_event->>'assignment')::uuid,
      '00000000-0000-0000-0000-000000000104', (source_event->>'room')::integer,
      '00000000-0000-0000-0000-000000000001', 'normal-from-accepted-v1',
      '2026-10-29T17:00:00Z', '2026-10-29T17:00:00Z', null
    );
    if (result->>'eventCount')::integer <> (source_event->>'expected')::integer then raise exception 'normal materialization count mismatch: %', result; end if;
  end loop;

  -- A later author revision must not change the frozen test snapshot.
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000103', false);
  select events into snapshot_event from public.manual_mar_assignment_snapshots where assignment_id = '00000000-0000-0000-0000-000000002204';
  update public.manual_mar_packets set revision = 2, events = events || jsonb_build_array(jsonb_build_object('occurrenceKey', 'later-edit')), updated_at = now() where room_id = 204 and case_version = 'accepted-manual-v1';
  result := public.create_test_user_assignment_with_manual_snapshot(
    '00000000-0000-0000-0000-000000002204', 204, 'accepted-manual-v1',
    '2026-10-29T17:00:00Z', '2026-10-29T17:00:00Z', null
  );
  if result->>'packetRevision' <> '1' or (select events from public.manual_mar_assignment_snapshots where assignment_id = '00000000-0000-0000-0000-000000002204') is distinct from snapshot_event then raise exception 'frozen snapshot changed on replay'; end if;
end $$;

select 'actual RPC, role-scoped reader, replay, and provenance assertions passed' as result;
