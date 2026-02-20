-- Fix Creighton school migration to use exact match instead of partial LIKE match

-- This addresses the issue where the migration used a partial LIKE query
-- which could select the wrong school if multiple schools had "Creighton" in the name

-- Revert any incorrect assignments from the bad migration
-- This finds any assignments where the school_id was set incorrectly
DO $$
DECLARE
  v_correct_creighton_id UUID;
  v_wrong_assignments_count INT;
BEGIN
  -- Get the correct Creighton University ID using exact match
  SELECT id INTO v_correct_creighton_id
  FROM schools
  WHERE name = 'Creighton University'
    AND slug = 'creighton'
  LIMIT 1;

  RAISE NOTICE 'Correct Creighton ID: %', v_correct_creighton_id;

  -- Count potentially wrong assignments (this is informational)
  SELECT COUNT(*) INTO v_wrong_assignments_count
  FROM rooms
  WHERE school_id != v_correct_creighton_id
    AND room_number IN (506, 507, 508, 509, 510);
  
  RAISE NOTICE 'Found % potentially wrong room assignments', v_wrong_assignments_count;

  -- Note: We don't automatically revert assignments without knowing the original values
  -- This migration documents the issue and provides the correct school_id
END $$;

-- Create a function to safely assign rooms to Creighton in the future
CREATE OR REPLACE FUNCTION assign_room_to_creighton(p_room_number INT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_creighton_id UUID;
BEGIN
  -- Always use exact match for Creighton University
  SELECT id INTO v_creighton_id
  FROM schools
  WHERE name = 'Creighton University'
    AND slug = 'creighton'
  LIMIT 1;

  IF v_creighton_id IS NULL THEN
    RAISE EXCEPTION 'Creighton University not found';
  END IF;

  UPDATE rooms
  SET school_id = v_creighton_id
  WHERE room_number = p_room_number;

  RETURN TRUE;
END;
$$;

-- Add comment documenting the fix
COMMENT ON FUNCTION assign_room_to_creighton(INT) IS 'Safely assigns a room to Creighton University using exact name match instead of partial LIKE';
