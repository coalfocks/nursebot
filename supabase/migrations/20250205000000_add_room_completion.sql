-- Add completion_token to rooms table with a fixed value
ALTER TABLE rooms
ADD COLUMN completion_token text NOT NULL DEFAULT '<completed>';

-- Add comment to explain the field
COMMENT ON COLUMN rooms.completion_token IS 'The fixed token "<completed>" that the AI must include in its response to mark the room as completed';

-- Update existing room assignments table to track completion token matches
ALTER TABLE student_room_assignments
ADD COLUMN completion_token_matched boolean DEFAULT false; 