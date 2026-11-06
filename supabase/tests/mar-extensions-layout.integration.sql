-- Namespace-compatibility proof for the reviewed MAR delta.
-- Run after mar-baseline-schema.sql and migrations 09-15, 170000, 173000.
-- The fixture installs pgcrypto in extensions, matching Supabase production.
-- This script invokes the real publication/materialization/readers as the
-- authenticated database role; it does not write to a target project.

\set ON_ERROR_STOP on

set role authenticated;

do $$
declare
  result jsonb;
  reader jsonb;
begin
  -- Admin publication and normal materialization must resolve extensions.digest.
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000102', false);
  result := public.publish_mar_case_version_from_manual_packet(204, 'extensions-layout-v1');
  if result->>'eventCount' <> '7' or result->>'sourcePacketRevision' <> '1' then
    raise exception 'extensions-layout publication mismatch: %', result;
  end if;

  result := public.create_assignment_with_mar_materialization(
    '00000000-0000-0000-0000-000000009204',
    '00000000-0000-0000-0000-000000009204',
    '00000000-0000-0000-0000-000000000104',
    204,
    '00000000-0000-0000-0000-000000000001',
    'extensions-layout-v1',
    '2026-10-29T17:00:00Z',
    '2026-10-29T17:00:00Z',
    null
  );
  if result->>'eventCount' <> '7' then
    raise exception 'extensions-layout materialization mismatch: %', result;
  end if;

  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000104', false);
  reader := public.get_mar_assignment_reader('00000000-0000-0000-0000-000000009204');
  if reader->>'reader' <> 'automatic' or reader->>'caseVersion' <> 'extensions-layout-v1' then
    raise exception 'extensions-layout normal reader mismatch: %', reader;
  end if;

  -- Test-user creation and the manual reader use the same installed setup.
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000103', false);
  result := public.get_mar_eligible_case_version(204);
  if result->>'caseVersion' <> 'accepted-manual-v1' then
    raise exception 'extensions-layout eligible lookup mismatch: %', result;
  end if;
  result := public.create_test_user_assignment_with_manual_snapshot(
    '00000000-0000-0000-0000-000000009205',
    204,
    'accepted-manual-v1',
    '2026-10-29T17:00:00Z',
    '2026-10-29T17:00:00Z',
    null
  );
  if result->>'eventCount' <> '7' or result->>'packetRevision' <> '1' then
    raise exception 'extensions-layout test-user snapshot mismatch: %', result;
  end if;
  reader := public.get_mar_assignment_reader('00000000-0000-0000-0000-000000009205');
  if reader->>'reader' <> 'manual' or reader->>'caseVersion' <> 'accepted-manual-v1' then
    raise exception 'extensions-layout manual reader mismatch: %', reader;
  end if;

  -- Grading provenance must not be stored in case_key_version.  Simulate the
  -- legitimate post-grading metadata update on both fresh assignments while
  -- retaining the frozen MAR key and snapshot contents.
  reset role;
  update public.student_room_assignments
  set assessment_version = 'evaluation-key-v2'
  where id in (
    '00000000-0000-0000-0000-000000009204',
    '00000000-0000-0000-0000-000000009205'
  );
  if (select count(*) from public.student_room_assignments
      where id = '00000000-0000-0000-0000-000000009204'
        and case_key_version <> 'extensions-layout-v1') <> 0
     or (select count(*) from public.student_room_assignments
      where id = '00000000-0000-0000-0000-000000009205'
        and case_key_version <> 'accepted-manual-v1') <> 0 then
    raise exception 'post-grading update changed MAR keys';
  end if;
  if (select count(*) from public.student_room_assignments
      where id in ('00000000-0000-0000-0000-000000009204', '00000000-0000-0000-0000-000000009205')
        and assessment_version = 'evaluation-key-v2') <> 2 then
    raise exception 'post-grading evaluation provenance was not saved';
  end if;

  -- The assignment-scoped student reader must still see all seven immutable
  -- events; it is security-definer because the event table is not directly
  -- writable/readable by arbitrary authenticated clients.
  set role authenticated;
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000104', false);
  reader := public.get_mar_assignment_reader('00000000-0000-0000-0000-000000009204');
  if reader->>'reader' <> 'automatic' or reader->>'caseVersion' <> 'extensions-layout-v1'
     or reader->>'eventCount' <> '7' then
    raise exception 'normal reader changed after grading metadata update: %', reader;
  end if;

  -- The test_user snapshot reader must retain the same seven values and key.
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000103', false);
  reader := public.get_mar_assignment_reader('00000000-0000-0000-0000-000000009205');
  if reader->>'reader' <> 'manual' or reader->>'caseVersion' <> 'accepted-manual-v1'
     or reader->>'eventCount' <> '7' then
    raise exception 'test_user reader changed after grading metadata update: %', reader;
  end if;

  -- Frozen replay remains valid after evaluation provenance changes.  These
  -- calls must validate the committed MAR envelope, not mutable grading data.
  result := public.create_test_user_assignment_with_manual_snapshot(
    '00000000-0000-0000-0000-000000009205', 204, 'accepted-manual-v1',
    '2026-10-29T17:00:00Z', '2026-10-29T17:00:00Z', null
  );
  if coalesce((result->>'replayed')::boolean, false) is not true
     or result->>'packetRevision' <> '1' then
    raise exception 'test_user replay failed after grading metadata update: %', result;
  end if;

  reset role;
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000102', false);
  result := public.create_assignment_with_mar_materialization(
    '00000000-0000-0000-0000-000000009204',
    '00000000-0000-0000-0000-000000009204',
    '00000000-0000-0000-0000-000000000104',
    204,
    '00000000-0000-0000-0000-000000000001',
    'extensions-layout-v1',
    '2026-10-29T17:00:00Z',
    '2026-10-29T17:00:00Z',
    null
  );
  if result->>'eventCount' <> '7'
     or result->>'caseVersion' <> 'extensions-layout-v1'
     or result->>'assignmentId' <> '00000000-0000-0000-0000-000000009204' then
    raise exception 'normal replay failed after grading metadata update: %', result;
  end if;
end $$;

select 'extensions-schema authenticated MAR publication/materialization/readers passed' as result;
