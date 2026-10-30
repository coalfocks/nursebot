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
end $$;

select 'extensions-schema authenticated MAR publication/materialization/readers passed' as result;
