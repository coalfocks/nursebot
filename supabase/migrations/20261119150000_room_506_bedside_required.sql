-- Room 506 (severe alcohol withdrawal with delirium): bedside evaluation is REQUIRED.
--
-- NOT APPLIED TO PRODUCTION. This migration is prepared in the PR for review. Apply it only
-- with Connor Yost's approval, and apply it BEFORE (or in the same deploy as) setting the
-- ALTHEA_BEDSIDE_TELEMETRY_SINCE function secret, so that the case config is live when bedside
-- capture starts. The -1 information-gathering adjustment only applies to attempts activated at or
-- after that telemetry timestamp, and only when bedside capture is complete (see
-- supabase/functions/_shared/althea-evidence-packet.ts). Earlier attempts are never penalized.
--
-- Changes (idempotent; guarded on room id 62 and room_number '506'):
--   1. rooms.bedside_requirement = 'yes' (learner sidebar shows "Going bedside was Yes").
--   2. emr_context.evaluation.bedsideExpectation = 'required' and bedsideRule = acute_alcohol_withdrawal_info_gathering.
--      Existing leniencyMultiplier is preserved.
--   3. rooms.case_goals gains a learner-facing requirement sentence (the sidebar "Case Goals" section).
--
-- Revert (if needed): set bedside_requirement back to 'situational', remove evaluation.bedsideExpectation
-- and evaluation.bedsideRule from emr_context, and remove the appended "Bedside evaluation is required" paragraph.

do $$
declare
  v_ctx jsonb;
  v_evaluation jsonb;
  v_goals text;
  v_sentence constant text := E'\n\nBedside evaluation is required for this patient. Go to the bedside and assess the patient in person; the simulated bedside assessment is recorded as part of this case.';
begin
  select emr_context::jsonb, case_goals into v_ctx, v_goals
  from public.rooms
  where id = 62 and room_number::text = '506';

  if not found then
    raise notice 'Room 506 (id 62) not found; no change made';
    return;
  end if;

  v_evaluation := coalesce(v_ctx -> 'evaluation', '{}'::jsonb)
    || jsonb_build_object('bedsideExpectation', 'required', 'bedsideRule', 'acute_alcohol_withdrawal_info_gathering');

  update public.rooms
  set
    bedside_requirement = 'yes',
    emr_context = jsonb_set(v_ctx, '{evaluation}', v_evaluation)::text,
    case_goals = case
      when coalesce(v_goals, '') like '%Bedside evaluation is required for this patient.%' then v_goals
      else coalesce(v_goals, '') || v_sentence
    end
  where id = 62 and room_number::text = '506';
end
$$;
