-- Fix RLS policy for rooms table to allow super_admins to save rooms

-- This fix addresses the issue where super_admins cannot save rooms
-- because auth.uid() might not match profile.id in the RLS policy check

-- Update the policy to be more permissive for super_admins
DROP POLICY IF EXISTS "Admins manage rooms" ON public.rooms;

CREATE POLICY "Admins manage rooms"
ON public.rooms
FOR ALL
USING (
  -- Service role can do anything
  auth.role() = 'service_role'
  OR
  -- Super admins can manage ALL rooms without restriction
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'super_admin'
  )
  OR
  -- School admins can only manage rooms in their school
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'school_admin'
      AND p.school_id = rooms.school_id
  )
  OR
  -- Room is available to the user's school
  (
    rooms.available_school_ids IS NOT NULL
    AND auth.uid() IN (
      SELECT p.id FROM profiles p
      WHERE p.school_id = ANY(rooms.available_school_ids)
    )
  )
);

-- Add helpful comment
COMMENT ON POLICY "Admins manage rooms" ON public.rooms IS 'Allows service_role, super_admins (all rooms), school_admins (their school), and users with school access to manage rooms';
