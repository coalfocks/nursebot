-- Add multi-select support for room specialties and school availability
ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS specialty_ids uuid[],
  ADD COLUMN IF NOT EXISTS available_school_ids uuid[];

-- Backfill arrays with existing single values
UPDATE public.rooms
SET specialty_ids = (
  SELECT ARRAY_AGG(DISTINCT value)
  FROM unnest(array_cat(coalesce(specialty_ids, '{}'::uuid[]), ARRAY[specialty_id])) AS value
)
WHERE specialty_id IS NOT NULL;

UPDATE public.rooms
SET available_school_ids = (
  SELECT ARRAY_AGG(DISTINCT value)
  FROM unnest(array_cat(coalesce(available_school_ids, '{}'::uuid[]), ARRAY[school_id])) AS value
)
WHERE school_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rooms_available_school_ids
  ON public.rooms USING GIN (available_school_ids);

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
          AND p.school_id = ANY(rooms.available_school_ids)
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
          AND p.school_id = ANY(rooms.available_school_ids)
        )
      )
  )
);
