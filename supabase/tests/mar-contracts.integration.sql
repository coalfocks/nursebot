-- Executed against the minimal disposable fixture, not production.
-- Run with ON_ERROR_STOP=1 after loading the fixture and the two reviewed
-- contract migrations. Every assertion below is scoped to synthetic IDs.

\set ON_ERROR_STOP on

-- Admin reads the accepted packet without changing it.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000102', false);
select jsonb_array_length((public.get_manual_mar_packet(
  '00000000-0000-0000-0000-000000001204', 204, null, 'accepted-manual-v1'
))->'events') = 7 as admin_204_packet_is_7;
select jsonb_array_length((public.get_manual_mar_packet(
  '00000000-0000-0000-0000-000000001020', 20, null, 'accepted-manual-v1'
))->'events') = 8 as admin_ed20_packet_is_8;
select jsonb_array_length((public.get_manual_mar_packet(
  '00000000-0000-0000-0000-000000001304', 304, null, 'accepted-manual-v1'
))->'events') = 4 as admin_304_packet_is_4;

-- test_user gets only the eligible-room lookup and cannot use the admin
-- publication contract.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000103', false);
select (public.get_mar_eligible_case_version(204)->>'caseVersion') = 'accepted-manual-v1' as test_user_lookup;
do $$
begin
  perform public.get_mar_eligible_case_version(999);
  raise exception 'expected missing-room failure';
exception when others then
  if sqlerrm not in ('MAR_ROOM_NOT_FOUND', 'MAR_TEST_ROOM_SCOPE_MISMATCH') then raise; end if;
end $$;

-- Fresh test_user creation, replay after a lost response, and changed-envelope
-- rejection all use the same assignment ID.
select public.create_test_user_assignment_with_manual_snapshot(
  '00000000-0000-0000-0000-000000002204', 204, 'accepted-manual-v1',
  '2026-10-29T17:00:00Z', '2026-10-29T17:00:00Z', null
)->>'eventCount' = '7' as test_user_fresh_snapshot;
select (public.create_test_user_assignment_with_manual_snapshot(
  '00000000-0000-0000-0000-000000002204', 204, 'accepted-manual-v1',
  '2026-10-29T17:00:00Z', '2026-10-29T17:00:00Z', null
)->>'replayed')::boolean as test_user_same_body_replay;
do $$
begin
  perform public.create_test_user_assignment_with_manual_snapshot(
    '00000000-0000-0000-0000-000000002204', 304, 'accepted-manual-v1',
    '2026-10-29T17:00:00Z', '2026-10-29T17:00:00Z', null
  );
  raise exception 'expected retry mismatch';
exception when others then
  if sqlerrm <> 'MAR_TEST_ASSIGNMENT_RETRY_MISMATCH' then raise; end if;
end $$;
select (public.get_mar_assignment_reader('00000000-0000-0000-0000-000000002204')->>'reader') = 'manual' as test_user_manual_reader;

-- Explicit provenance bridge creates a NEW normal-path immutable version from
-- the accepted packet, without changing that packet.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000102', false);
select (public.publish_mar_case_version_from_manual_packet(204, 'normal-from-accepted-v1')->>'eventCount') = '7' as normal_204_provenance;
select (public.publish_mar_case_version_from_manual_packet(20, 'normal-from-accepted-v1')->>'eventCount') = '8' as normal_ed20_provenance;
select (public.publish_mar_case_version_from_manual_packet(304, 'normal-from-accepted-v1')->>'eventCount') = '4' as normal_304_provenance;

-- Normal learner reader uses an immutable automatic snapshot; it does not
-- fall through to the manual room packet.
insert into public.student_room_assignments(
  id, student_id, room_id, assigned_by, status, school_id, case_key_version
) values (
  '00000000-0000-0000-0000-000000002304',
  '00000000-0000-0000-0000-000000000104', 204,
  '00000000-0000-0000-0000-000000000102', 'assigned',
  '00000000-0000-0000-0000-000000000001', 'normal-from-accepted-v1'
);
insert into public.mar_assignment_baseline_versions(
  assignment_id, case_version, patient_id, room_id, event_snapshot, content_hash, created_by
) values (
  '00000000-0000-0000-0000-000000002304', 'normal-from-accepted-v1',
  '00000000-0000-0000-0000-000000001204', 204,
  (select event_snapshot from public.mar_authored_case_versions where room_id = 204 and case_version = 'normal-from-accepted-v1'),
  'fixture-hash', '00000000-0000-0000-0000-000000000102'
);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000104', false);
select (public.get_mar_assignment_reader('00000000-0000-0000-0000-000000002304')->>'reader') = 'automatic' as normal_learner_automatic_reader;

-- Exact materialized/provenance readback, including dose/status/time/reason
-- fields from the accepted packet.
select r.id, r.room_number, p.case_version, p.revision,
       jsonb_array_length(p.events) as saved_events,
       count(e.value) filter (where e.value ? 'medicationName'
         and e.value ? 'orderedDose'
         and e.value ? 'administeredDose'
         and e.value ? 'status'
         and e.value ? 'administeredAt'
         and e.value ? 'reason') as complete_events
from public.rooms r
join public.manual_mar_packets p on p.room_id = r.id
cross join lateral jsonb_array_elements(p.events) e(value)
where r.id in (204, 20, 304)
group by r.id, r.room_number, p.case_version, p.revision, p.events
order by r.id;
