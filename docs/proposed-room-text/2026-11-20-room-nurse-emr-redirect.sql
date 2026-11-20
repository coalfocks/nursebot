-- PROPOSED, NOT APPLIED. Review before running. Do not run against prod without Connor Yost's sign-off.
-- Purpose: align room-level CHANNEL BOUNDARIES text with the server policy in
-- supabase/functions/_shared/nurse-prompt.ts (answer directly when the nurse has the info).
-- Affects 49 rooms in prod (read 2026-11-20). Pinned assignments (student_room_assignments.scenario_baseline,
-- 64 rows contain the old sentence) are NOT touched by this and keep the old text; the server policy block
-- is authoritative over it, which is why the server change ships first.
-- Room 405 and 503-505 / ED 22 contain extra EMR language; see docs/proposed-room-text/README.md.

-- Dry run: which rooms would change
-- select id, room_number from rooms where coalesce(nurse_context, context) like '%direct those questions to the chart without quoting values or interpretations.%';

begin;
update rooms
set nurse_context = replace(nurse_context,
      'Detailed chart/lab/imaging sections below are authoring reference for the EHR, not nurse-chat knowledge; direct those questions to the chart without quoting values or interpretations.',
      'Documented vitals, intake/output, prior labs and imaging already resulted, and established history below are things the nurse knows; answer them directly when asked, giving units and timing and labeling each as baseline, current or pending. Refer to the EMR only for information not listed here. Do not offer interpretations or diagnoses.'),
    context = replace(context,
      'Detailed chart/lab/imaging sections below are authoring reference for the EHR, not nurse-chat knowledge; direct those questions to the chart without quoting values or interpretations.',
      'Documented vitals, intake/output, prior labs and imaging already resulted, and established history below are things the nurse knows; answer them directly when asked, giving units and timing and labeling each as baseline, current or pending. Refer to the EMR only for information not listed here. Do not offer interpretations or diagnoses.')
where coalesce(nurse_context, context) like '%direct those questions to the chart without quoting values or interpretations.%';
-- expect 49 rows
commit;
