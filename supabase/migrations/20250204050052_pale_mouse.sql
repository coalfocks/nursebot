/*
  # Initial Schema for Medical Education Platform

  1. New Tables
    - `profiles`
      - Student profiles with study year and specialization
    - `specialties` 
      - Medical specialties available in the system
    - `cases`
      - Medical cases for practice
    - `case_responses`
      - Student responses to cases
    - `progress_tracking`
      - Track student progress through cases
    
  2. Security
    - Enable RLS on all tables
    - Add policies for authenticated access
*/

-- Create profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id),
  full_name text NOT NULL,
  study_year int NOT NULL CHECK (study_year BETWEEN 1 AND 7),
  specialization_interest text,
  is_admin boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create specialties table
CREATE TABLE IF NOT EXISTS specialties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Create cases table
CREATE TABLE IF NOT EXISTS cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  specialty_id uuid REFERENCES specialties(id),
  title text NOT NULL,
  description text NOT NULL,
  patient_history text NOT NULL,
  initial_vitals jsonb NOT NULL,
  difficulty_level text CHECK (difficulty_level IN ('beginner', 'intermediate', 'advanced')),
  expected_diagnosis text NOT NULL,
  expected_treatment text[] NOT NULL,
  created_by uuid REFERENCES profiles(id),
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create case responses table
CREATE TABLE IF NOT EXISTS case_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid REFERENCES cases(id),
  student_id uuid REFERENCES profiles(id),
  diagnosis text NOT NULL,
  treatment_plan text[] NOT NULL,
  ai_feedback text NOT NULL,
  accuracy_score float CHECK (accuracy_score BETWEEN 0 AND 100),
  time_taken interval NOT NULL,
  completed_at timestamptz DEFAULT now()
);

-- Create progress tracking table
CREATE TABLE IF NOT EXISTS progress_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid REFERENCES profiles(id),
  specialty_id uuid REFERENCES specialties(id),
  cases_completed int DEFAULT 0,
  average_score float DEFAULT 0,
  total_time_spent interval DEFAULT '0'::interval,
  last_activity_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE specialties ENABLE ROW LEVEL SECURITY;
ALTER TABLE cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE progress_tracking ENABLE ROW LEVEL SECURITY;

-- Policies

-- Profiles policies
CREATE POLICY "Users can view their own profile"
  ON profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id);

-- Specialties policies (readable by all authenticated users)
CREATE POLICY "Authenticated users can view specialties"
  ON specialties FOR SELECT
  TO authenticated
  USING (true);

-- Cases policies
CREATE POLICY "Authenticated users can view active cases"
  ON cases FOR SELECT
  TO authenticated
  USING (is_active = true);

CREATE POLICY "Admins can manage cases"
  ON cases FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.is_admin = true
  ));

-- Case responses policies
CREATE POLICY "Users can view their own responses"
  ON case_responses FOR SELECT
  TO authenticated
  USING (student_id = auth.uid());

CREATE POLICY "Users can create their own responses"
  ON case_responses FOR INSERT
  TO authenticated
  WITH CHECK (student_id = auth.uid());

-- Progress tracking policies
CREATE POLICY "Users can view their own progress"
  ON progress_tracking FOR SELECT
  TO authenticated
  USING (student_id = auth.uid());

-- Insert initial specialties
INSERT INTO specialties (name, description) VALUES
  ('Internal Medicine', 'General adult patient cases with chronic and acute conditions'),
  ('Pediatrics', 'Focus on child health, including common illnesses in pediatric patients'),
  ('Obstetrics and Gynecology', 'Pregnancy management, women''s health, and related conditions'),
  ('Surgery', 'Pre-op and post-op patient care, common surgical complications'),
  ('Psychiatry', 'Mental health cases such as depression, anxiety, and substance abuse'),
  ('Emergency Medicine', 'Acute and urgent care scenarios like trauma, heart attacks, and strokes');

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_cases_updated_at
  BEFORE UPDATE ON cases
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();