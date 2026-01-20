-- Add absolute time window fields to student_room_assignments
-- This allows assignments to have a defined start/end window for scheduling

ALTER TABLE student_room_assignments
  ADD COLUMN IF NOT EXISTS window_start timestamptz,
  ADD COLUMN IF NOT EXISTS window_end timestamptz;

COMMENT ON COLUMN student_room_assignments.window_start IS 'Absolute start of the assignment time window. Assignments should not become active before this time.';
COMMENT ON COLUMN student_room_assignments.window_end IS 'Absolute end of the assignment time window. Assignments should ideally be completed by this time.';
