-- Add test_user role and test-user RLS access for room testing
ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('student', 'school_admin', 'super_admin', 'test_user'));

COMMENT ON COLUMN profiles.role IS 'Application role used for authorization (student, school_admin, super_admin, test_user).';

-- Allow test users to read rooms in their school
DROP POLICY IF EXISTS "Test users read rooms" ON rooms;
CREATE POLICY "Test users read rooms"
ON rooms
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'test_user'
      AND (p.school_id = rooms.school_id)
  )
);

-- Allow test users to read specialties in their school
DROP POLICY IF EXISTS "Test users read specialties" ON specialties;
CREATE POLICY "Test users read specialties"
ON specialties
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'test_user'
      AND (p.school_id = specialties.school_id)
  )
);

-- Allow test users to manage their own assignments
DROP POLICY IF EXISTS "Test users create assignments" ON student_room_assignments;
DROP POLICY IF EXISTS "Test users update own assignments" ON student_room_assignments;
DROP POLICY IF EXISTS "Test users delete own assignments" ON student_room_assignments;

CREATE POLICY "Test users create assignments"
ON student_room_assignments
FOR INSERT
WITH CHECK (
  student_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'test_user'
      AND (p.school_id = student_room_assignments.school_id OR student_room_assignments.school_id IS NULL)
  )
);

CREATE POLICY "Test users update own assignments"
ON student_room_assignments
FOR UPDATE
USING (
  student_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'test_user'
      AND (p.school_id = student_room_assignments.school_id OR student_room_assignments.school_id IS NULL)
  )
)
WITH CHECK (
  student_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'test_user'
      AND (p.school_id = student_room_assignments.school_id OR student_room_assignments.school_id IS NULL)
  )
);

CREATE POLICY "Test users delete own assignments"
ON student_room_assignments
FOR DELETE
USING (
  student_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'test_user'
      AND (p.school_id = student_room_assignments.school_id OR student_room_assignments.school_id IS NULL)
  )
);

-- Allow test users to delete their own chat messages
DROP POLICY IF EXISTS "Test users delete own chat messages" ON chat_messages;
CREATE POLICY "Test users delete own chat messages"
ON chat_messages
FOR DELETE
USING (
  EXISTS (
    SELECT 1
    FROM student_room_assignments sra
    JOIN profiles p ON p.id = auth.uid()
    WHERE sra.id = chat_messages.assignment_id
      AND sra.student_id = auth.uid()
      AND p.role = 'test_user'
      AND (p.school_id = chat_messages.school_id OR chat_messages.school_id IS NULL)
  )
);
