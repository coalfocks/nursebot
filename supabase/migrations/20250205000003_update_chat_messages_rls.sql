-- Drop existing policies
DROP POLICY IF EXISTS "Users can view messages for their assignments" ON chat_messages;
DROP POLICY IF EXISTS "Users can insert messages for their assignments" ON chat_messages;

-- Create new policies
CREATE POLICY "Users can view messages for their assignments"
ON chat_messages
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM student_room_assignments sra
    WHERE sra.id = chat_messages.assignment_id
    AND sra.student_id = auth.uid()
  )
);

CREATE POLICY "Users can insert messages for their assignments"
ON chat_messages
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM student_room_assignments sra
    WHERE sra.id = assignment_id
    AND sra.student_id = auth.uid()
  )
); 