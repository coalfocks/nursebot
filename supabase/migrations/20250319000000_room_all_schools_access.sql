-- Update room access policy to handle "All Schools" (empty array means available to all schools)
DROP POLICY IF EXISTS "Admins manage rooms" ON public.rooms;

CREATE POLICY "Admins manage rooms"
ON public.rooms
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
        OR (
          rooms.available_school_ids IS NOT NULL
          AND (
            -- Empty array means available to all schools
            rooms.available_school_ids = '{}'
            OR p.school_id = ANY(rooms.available_school_ids)
          )
        )
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
        OR (
          rooms.available_school_ids IS NOT NULL
          AND (
            -- Empty array means available to all schools
            rooms.available_school_ids = '{}'
            OR p.school_id = ANY(rooms.available_school_ids)
          )
        )
      )
  )
);
