-- Do not auto-complete assignments from assistant message content.
-- Completion is now an explicit UI flow that saves completed_at + student_progress_note.
CREATE OR REPLACE FUNCTION check_completion_token()
RETURNS trigger AS $$
BEGIN
    IF NEW.role = 'assistant' AND NEW.content LIKE '%<completed>%' THEN
        -- Keep tracking explicit completion markers for analytics/back-compat.
        IF COALESCE(NEW.triggered_completion, false) = true THEN
            UPDATE student_room_assignments
            SET completion_token_matched = true
            WHERE id = NEW.assignment_id;

            NEW.triggered_completion = true;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
