-- Add completed_at column to student_room_assignments
ALTER TABLE student_room_assignments
ADD COLUMN completed_at timestamptz;

-- Add comment explaining the field
COMMENT ON COLUMN student_room_assignments.completed_at IS 'The date and time when the assignment was completed';

-- Update existing completed assignments to set completed_at
UPDATE student_room_assignments
SET completed_at = updated_at
WHERE status = 'completed'; 