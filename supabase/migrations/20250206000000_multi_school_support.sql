-- Ensure pgcrypto is available for UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Core tenant table
CREATE TABLE IF NOT EXISTS schools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  timezone text DEFAULT 'UTC',
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

COMMENT ON TABLE schools IS 'Top-level institution / tenant records for multi-school deployments.';
COMMENT ON COLUMN schools.slug IS 'URL-friendly unique identifier for the school.';
COMMENT ON COLUMN schools.timezone IS 'IANA timezone identifier used for scheduling and reporting.';

-- Profile role + school affiliation
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES schools(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS role text CHECK (role IN ('student', 'school_admin', 'super_admin')) DEFAULT 'student';

COMMENT ON COLUMN profiles.school_id IS 'Primary school affiliation for the user (nullable for super admins).';
COMMENT ON COLUMN profiles.role IS 'Application role used for authorization (student, school_admin, super_admin).';

-- Scope existing domain tables by school
ALTER TABLE specialties
  ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES schools(id) ON DELETE CASCADE;

ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES schools(id) ON DELETE CASCADE;

ALTER TABLE student_room_assignments
  ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES schools(id) ON DELETE CASCADE;

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES schools(id) ON DELETE CASCADE;

-- Seed a default school and backfill existing data
DO $$
DECLARE
  default_school_id uuid;
BEGIN
  INSERT INTO schools (name, slug, timezone)
  VALUES ('ATSU-SOMA', 'atsu-soma', 'America/Phoenix')
  ON CONFLICT (slug) DO UPDATE
    SET name = EXCLUDED.name,
        timezone = EXCLUDED.timezone
  RETURNING id INTO default_school_id;

  IF default_school_id IS NULL THEN
    SELECT id INTO default_school_id FROM schools WHERE slug = 'atsu-soma';
  END IF;

  -- Ensure profile roles reflect legacy is_admin flag
  UPDATE profiles
  SET role = CASE
    WHEN is_admin IS TRUE THEN 'school_admin'
    ELSE 'student'
  END
  WHERE role IS NULL OR role NOT IN ('student', 'school_admin', 'super_admin');

  -- Backfill missing school references
  UPDATE profiles SET school_id = COALESCE(school_id, default_school_id);
  UPDATE specialties SET school_id = COALESCE(school_id, default_school_id);
  UPDATE rooms SET school_id = COALESCE(school_id, default_school_id);
  UPDATE student_room_assignments SET school_id = COALESCE(school_id, default_school_id);
  UPDATE chat_messages SET school_id = COALESCE(school_id, default_school_id);

  -- Provide a transitional default so existing inserts continue to work until the app sends explicit school_ids
  EXECUTE format('ALTER TABLE profiles ALTER COLUMN school_id SET DEFAULT ''%s''::uuid', default_school_id);
  EXECUTE format('ALTER TABLE specialties ALTER COLUMN school_id SET DEFAULT ''%s''::uuid', default_school_id);
  EXECUTE format('ALTER TABLE rooms ALTER COLUMN school_id SET DEFAULT ''%s''::uuid', default_school_id);
  EXECUTE format('ALTER TABLE student_room_assignments ALTER COLUMN school_id SET DEFAULT ''%s''::uuid', default_school_id);
  EXECUTE format('ALTER TABLE chat_messages ALTER COLUMN school_id SET DEFAULT ''%s''::uuid', default_school_id);
END $$;

ALTER TABLE profiles ALTER COLUMN role SET NOT NULL;
ALTER TABLE specialties ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE rooms ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE student_room_assignments ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE chat_messages ALTER COLUMN school_id SET NOT NULL;

-- Helpful indexes for tenant filtering
CREATE INDEX IF NOT EXISTS idx_profiles_school_id ON profiles(school_id);
CREATE INDEX IF NOT EXISTS idx_specialties_school_id ON specialties(school_id);
CREATE INDEX IF NOT EXISTS idx_rooms_school_id ON rooms(school_id);
CREATE INDEX IF NOT EXISTS idx_assignments_school_id ON student_room_assignments(school_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_school_id ON chat_messages(school_id);

-- Keep chat message school_id aligned with its assignment
CREATE OR REPLACE FUNCTION set_chat_message_school_id()
RETURNS trigger AS $$
BEGIN
  IF NEW.school_id IS NULL THEN
    SELECT school_id INTO NEW.school_id
    FROM student_room_assignments
    WHERE id = NEW.assignment_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS chat_messages_set_school_id ON chat_messages;
CREATE TRIGGER chat_messages_set_school_id
  BEFORE INSERT ON chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION set_chat_message_school_id();

-- Ensure assignments inherit the student''s school when not provided
CREATE OR REPLACE FUNCTION set_assignment_school_id()
RETURNS trigger AS $$
BEGIN
  IF NEW.school_id IS NULL THEN
    SELECT school_id INTO NEW.school_id
    FROM profiles
    WHERE id = NEW.student_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS assignments_set_school_id ON student_room_assignments;
CREATE TRIGGER assignments_set_school_id
  BEFORE INSERT OR UPDATE ON student_room_assignments
  FOR EACH ROW
  WHEN (NEW.school_id IS NULL)
  EXECUTE FUNCTION set_assignment_school_id();

-- Multi-school RLS for assignments
ALTER TABLE student_room_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students view own assignments" ON student_room_assignments;
DROP POLICY IF EXISTS "Admins manage assignments" ON student_room_assignments;

CREATE POLICY "Students view own assignments"
ON student_room_assignments
FOR SELECT
USING (student_id = auth.uid());

CREATE POLICY "Admins manage assignments"
ON student_room_assignments
FOR ALL
USING (
  auth.role() = 'service_role'
  OR EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('school_admin', 'super_admin')
      AND (
        p.role = 'super_admin'
        OR p.school_id = student_room_assignments.school_id
      )
  )
)
WITH CHECK (
  auth.role() = 'service_role'
  OR EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('school_admin', 'super_admin')
      AND (
        p.role = 'super_admin'
        OR p.school_id = student_room_assignments.school_id
      )
  )
);

-- Multi-school RLS for rooms
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students view assigned rooms" ON rooms;
DROP POLICY IF EXISTS "Admins manage rooms" ON rooms;

CREATE POLICY "Students view assigned rooms"
ON rooms
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM student_room_assignments sra
    WHERE sra.room_id = rooms.id
      AND sra.student_id = auth.uid()
  )
);

CREATE POLICY "Admins manage rooms"
ON rooms
FOR ALL
USING (
  auth.role() = 'service_role'
  OR EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('school_admin', 'super_admin')
      AND (
        p.role = 'super_admin'
        OR p.school_id = rooms.school_id
      )
  )
)
WITH CHECK (
  auth.role() = 'service_role'
  OR EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('school_admin', 'super_admin')
      AND (
        p.role = 'super_admin'
        OR p.school_id = rooms.school_id
      )
  )
);

-- Multi-school RLS for specialties
ALTER TABLE specialties ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students view specialties" ON specialties;
DROP POLICY IF EXISTS "Admins manage specialties" ON specialties;

CREATE POLICY "Students view specialties"
ON specialties
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM rooms r
    JOIN student_room_assignments sra ON sra.room_id = r.id
    WHERE r.specialty_id = specialties.id
      AND sra.student_id = auth.uid()
  )
);

CREATE POLICY "Admins manage specialties"
ON specialties
FOR ALL
USING (
  auth.role() = 'service_role'
  OR EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('school_admin', 'super_admin')
      AND (
        p.role = 'super_admin'
        OR p.school_id = specialties.school_id
      )
  )
)
WITH CHECK (
  auth.role() = 'service_role'
  OR EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('school_admin', 'super_admin')
      AND (
        p.role = 'super_admin'
        OR p.school_id = specialties.school_id
      )
  )
);

-- Refresh chat message RLS to rely on role + school scoping
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students can view their own chat messages" ON chat_messages;
DROP POLICY IF EXISTS "Students can insert their own messages" ON chat_messages;
DROP POLICY IF EXISTS "Users can view messages for their assignments" ON chat_messages;
DROP POLICY IF EXISTS "Users can insert messages for their assignments" ON chat_messages;
DROP POLICY IF EXISTS "Admins can view all chat messages" ON chat_messages;

-- Students can read their own assignment messages
CREATE POLICY "Students read own chat messages"
ON chat_messages
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM student_room_assignments sra
    WHERE sra.id = chat_messages.assignment_id
      AND sra.student_id = auth.uid()
  )
);

-- Students can write messages for their assignments
CREATE POLICY "Students write own chat messages"
ON chat_messages
FOR INSERT
WITH CHECK (
  role = 'student'
  AND EXISTS (
    SELECT 1 FROM student_room_assignments sra
    WHERE sra.id = chat_messages.assignment_id
      AND sra.student_id = auth.uid()
  )
);

-- School admins can view messages scoped to their school
CREATE POLICY "School admins read school chat messages"
ON chat_messages
FOR SELECT
USING (
  auth.role() = 'service_role'
  OR EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('school_admin', 'super_admin')
      AND (
        p.role = 'super_admin'
        OR p.school_id = chat_messages.school_id
      )
  )
);

-- Allow assistant/system inserts via service role while preserving student constraints
CREATE POLICY "Service role writes chat messages"
ON chat_messages
FOR INSERT
WITH CHECK (auth.role() = 'service_role');
