-- Add effective_date column to student_room_assignments
ALTER TABLE student_room_assignments
ADD COLUMN effective_date timestamptz;

-- Add comment explaining the field
COMMENT ON COLUMN student_room_assignments.effective_date IS 'The date and time when the assignment becomes effective. After 1 hour from this time, the assignment will be automatically marked as complete.';

-- Create a function to check for assignments that should be auto-completed
CREATE OR REPLACE FUNCTION auto_complete_assignments()
RETURNS void AS $$
BEGIN
    -- Update assignments that have been effective for more than 1 hour
    UPDATE student_room_assignments
    SET 
        status = 'completed',
        updated_at = now(),
        feedback_status = 'pending'
    WHERE 
        status IN ('assigned', 'in_progress') AND
        effective_date IS NOT NULL AND
        effective_date <= (now() - interval '1 hour');
END;
$$ LANGUAGE plpgsql;

-- Create a cron job to run the auto-completion function every 5 minutes
SELECT cron.schedule(
    'auto-complete-assignments',  -- name of the cron job
    '*/5 * * * *',               -- every 5 minutes
    'SELECT auto_complete_assignments()'
);

-- Add comment explaining the cron job
COMMENT ON FUNCTION auto_complete_assignments() IS 'Automatically marks assignments as complete if they have been effective for more than 1 hour.'; 