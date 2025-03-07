-- Create an enum for message roles
CREATE TYPE message_role AS ENUM ('student', 'assistant');

-- Create the chat messages table
CREATE TABLE chat_messages (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    assignment_id uuid NOT NULL REFERENCES student_room_assignments(id) ON DELETE CASCADE,
    role message_role NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    
    -- Additional metadata that might be useful
    tokens_used integer, -- Track token usage if we need it for API costs
    triggered_completion boolean DEFAULT false, -- Track if this message triggered completion
    
    -- Ensure messages are ordered correctly
    CONSTRAINT valid_content CHECK (length(trim(content)) > 0)
);

-- Add indexes for common queries
CREATE INDEX chat_messages_assignment_id_idx ON chat_messages(assignment_id);
CREATE INDEX chat_messages_created_at_idx ON chat_messages(created_at);

-- Add a comment explaining the table
COMMENT ON TABLE chat_messages IS 'Stores individual chat messages between students and the AI assistant for each room assignment';

-- Add RLS policies
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- Students can view their own messages
CREATE POLICY "Students can view their own chat messages"
ON chat_messages FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM student_room_assignments a
        WHERE a.id = chat_messages.assignment_id
        AND a.student_id = auth.uid()
    )
);

-- Students can insert messages for their own assignments
CREATE POLICY "Students can insert their own messages"
ON chat_messages FOR INSERT
WITH CHECK (
    role = 'student' AND
    EXISTS (
        SELECT 1 FROM student_room_assignments a
        WHERE a.id = chat_messages.assignment_id
        AND a.student_id = auth.uid()
    )
);

-- Admins can view all messages
CREATE POLICY "Admins can view all chat messages"
ON chat_messages FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.id = auth.uid()
        AND p.is_admin = true
    )
);

-- Create a function to check for completion token
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
                status = 'completed'
            WHERE id = NEW.assignment_id;
            
            -- Mark this message as having triggered completion
            NEW.triggered_completion = true;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to check for completion token in new messages
CREATE TRIGGER check_completion_token_trigger
    BEFORE INSERT ON chat_messages
    FOR EACH ROW
    EXECUTE FUNCTION check_completion_token(); 