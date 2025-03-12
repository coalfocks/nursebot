-- Add notification fields to student_room_assignments table
ALTER TABLE student_room_assignments
ADD COLUMN notification_sent boolean,
ADD COLUMN notification_sent_at timestamptz;

-- Add comments explaining the fields
COMMENT ON COLUMN student_room_assignments.notification_sent IS 'Whether an SMS notification was successfully sent when the assignment became effective';
COMMENT ON COLUMN student_room_assignments.notification_sent_at IS 'When the SMS notification was sent'; 