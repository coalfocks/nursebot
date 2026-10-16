-- Prevent direct/API status changes from activating a scheduled learner attempt
-- before its window. Sandbox/practice assignments retain their explicit bypass.
CREATE OR REPLACE FUNCTION public.enforce_assignment_window_activation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'assigned'
    AND NEW.status IN ('in_progress', 'bedside')
    AND COALESCE(NEW.is_sandbox, false) = false
    AND NEW.window_start IS NOT NULL
    AND now() < NEW.window_start THEN
    RAISE EXCEPTION 'assignment_not_active: assignment window has not started'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_assignment_window_activation
  ON public.student_room_assignments;
CREATE TRIGGER enforce_assignment_window_activation
  BEFORE UPDATE OF status ON public.student_room_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_assignment_window_activation();
