-- Drop the due_date column as we're now using window-based scheduling
-- The effective_date will be calculated as a random time within the window

-- Drop the column
ALTER TABLE student_room_assignments
DROP COLUMN IF EXISTS due_date;

-- Update comment on effective_date to clarify it's calculated from the window
COMMENT ON COLUMN student_room_assignments.effective_date IS 'The randomly calculated activation time within the window. This is when the case becomes active for the student and the auto-completion timer starts.';

-- Update comments on window columns to clarify their purpose
COMMENT ON COLUMN student_room_assignments.window_start IS 'The start of the time window. Cases will be randomly activated between this time and window_end for each student.';
COMMENT ON COLUMN student_room_assignments.window_end IS 'The end of the time window. Cases will be randomly activated between window_start and this time for each student.';
