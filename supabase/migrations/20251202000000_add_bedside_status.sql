ALTER TABLE student_room_assignments
  DROP CONSTRAINT IF EXISTS student_room_assignments_status_check;

ALTER TABLE student_room_assignments
  ADD CONSTRAINT student_room_assignments_status_check
  CHECK (status IN ('assigned', 'in_progress', 'bedside', 'completed'));
