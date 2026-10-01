-- Do not let effective dates complete assignments or trigger grading.
-- Assignments must be explicitly completed by the learner workflow.

DO $$
DECLARE
  cron_job_id bigint;
BEGIN
  SELECT jobid INTO cron_job_id
  FROM cron.job
  WHERE jobname = 'auto-complete-assignments';

  IF cron_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(cron_job_id);
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.auto_complete_assignments();

COMMENT ON COLUMN public.student_room_assignments.effective_date IS
  'The date and time when the assignment becomes effective. It does not complete the assignment; completion requires an explicit learner action.';
