-- Add UPDATE policy for students to complete their own assignments
-- This was missing, causing "Error completing assignment" when students tried to save progress notes

DROP POLICY IF EXISTS "Students update own assignments" ON student_room_assignments;

CREATE POLICY "Students update own assignments"
ON student_room_assignments
FOR UPDATE
USING (
  student_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('student', 'test_user')
      AND (p.school_id = student_room_assignments.school_id OR student_room_assignments.school_id IS NULL)
  )
)
WITH CHECK (
  student_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('student', 'test_user')
      AND (p.school_id = student_room_assignments.school_id OR student_room_assignments.school_id IS NULL)
  )
);
