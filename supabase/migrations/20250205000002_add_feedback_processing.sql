-- Add feedback processing status to track the state of feedback generation
CREATE TYPE feedback_status AS ENUM ('pending', 'processing', 'completed', 'failed');

-- Add feedback-related columns to student_room_assignments
ALTER TABLE student_room_assignments
ADD COLUMN feedback_status feedback_status DEFAULT 'pending',
ADD COLUMN feedback_error text, -- Store any errors that occur during feedback generation
ADD COLUMN nurse_feedback jsonb, -- Store structured feedback data
ADD COLUMN feedback_generated_at timestamp with time zone;

-- Create a function to trigger feedback generation when completion is detected
CREATE OR REPLACE FUNCTION trigger_feedback_generation()
RETURNS trigger AS $$
BEGIN
    -- When an assignment is marked as completed and has a completion token match
    IF NEW.status = 'completed' AND NEW.completion_token_matched = true AND 
       (OLD.status != 'completed' OR OLD.completion_token_matched = false) THEN
        -- Set feedback status to pending
        NEW.feedback_status := 'pending';
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to initiate feedback generation when room is completed
CREATE TRIGGER trigger_feedback_generation_trigger
    BEFORE UPDATE ON student_room_assignments
    FOR EACH ROW
    EXECUTE FUNCTION trigger_feedback_generation();

-- Update the check_completion_token function to handle feedback status
CREATE OR REPLACE FUNCTION check_completion_token()
RETURNS trigger AS $$
BEGIN
    -- Only check assistant messages
    IF NEW.role = 'assistant' THEN
        -- Check if message contains the completion token
        IF NEW.content LIKE '%<completed>%' THEN
            -- Update the assignment
            UPDATE student_room_assignments
            SET completion_token_matched = true,
                status = 'completed',
                feedback_status = 'pending'
            WHERE id = NEW.assignment_id;
            
            -- Mark this message as having triggered completion
            NEW.triggered_completion = true;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON COLUMN student_room_assignments.nurse_feedback IS 'Structured feedback data from the nurse evaluator, including scoring, comments, and suggestions'; 