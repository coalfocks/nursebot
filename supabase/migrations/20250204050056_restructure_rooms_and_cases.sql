-- First, let's enhance the rooms table to include medical details
ALTER TABLE rooms 
  ADD COLUMN IF NOT EXISTS specialty_id uuid REFERENCES specialties(id),
  ADD COLUMN IF NOT EXISTS difficulty_level text CHECK (difficulty_level IN ('beginner', 'intermediate', 'advanced')),
  ADD COLUMN IF NOT EXISTS expected_diagnosis text,
  ADD COLUMN IF NOT EXISTS expected_treatment text[],
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Create a trigger for rooms updated_at
CREATE TRIGGER update_rooms_updated_at
  BEFORE UPDATE ON rooms
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Now create the student_room_assignments table (replacing cases)
CREATE TABLE IF NOT EXISTS student_room_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid REFERENCES profiles(id) NOT NULL,
  room_id integer REFERENCES rooms(id) NOT NULL,
  assigned_by uuid REFERENCES profiles(id) NOT NULL,
  status text CHECK (status IN ('assigned', 'in_progress', 'completed')) DEFAULT 'assigned',
  due_date timestamptz,
  feedback text,
  grade numeric CHECK (grade >= 0 AND grade <= 100),
  diagnosis text,
  treatment_plan text[],
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create trigger for assignments updated_at
CREATE TRIGGER update_assignments_updated_at
  BEFORE UPDATE ON student_room_assignments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Drop the old cases and case_responses tables
DROP TABLE IF EXISTS case_responses CASCADE;
DROP TABLE IF EXISTS cases CASCADE; 