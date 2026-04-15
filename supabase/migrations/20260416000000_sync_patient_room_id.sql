-- Auto-sync patient.room_id when rooms.patient_id changes
-- This prevents the data drift between rooms.patient_id and patients.room_id

-- Function to sync patient.room_id AFTER a room is updated or inserted
CREATE OR REPLACE FUNCTION public.sync_patient_room_id()
RETURNS TRIGGER AS $$
BEGIN
  -- If patient_id changed or this is a new room with a patient_id
  IF NEW.patient_id IS DISTINCT FROM OLD.patient_id OR (TG_OP = 'INSERT' AND NEW.patient_id IS NOT NULL) THEN
    -- Clear room_id on the old patient (if patient was reassigned)
    IF OLD.patient_id IS NOT NULL AND OLD.patient_id IS DISTINCT FROM NEW.patient_id THEN
      UPDATE public.patients SET room_id = NULL WHERE id = OLD.patient_id;
    END IF;
    
    -- Set room_id on the new patient
    IF NEW.patient_id IS NOT NULL THEN
      UPDATE public.patients SET room_id = NEW.id WHERE id = NEW.patient_id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to clear patient.room_id when a room is deleted
CREATE OR REPLACE FUNCTION public.clear_patient_room_id()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.patient_id IS NOT NULL THEN
    UPDATE public.patients SET room_id = NULL WHERE id = OLD.patient_id;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create triggers
DROP TRIGGER IF EXISTS sync_patient_room_on_room_update ON public.rooms;
CREATE TRIGGER sync_patient_room_on_room_update
  AFTER UPDATE OF patient_id ON public.rooms
  FOR EACH ROW EXECUTE FUNCTION public.sync_patient_room_id();

DROP TRIGGER IF EXISTS sync_patient_room_on_room_insert ON public.rooms;
CREATE TRIGGER sync_patient_room_on_room_insert
  AFTER INSERT ON public.rooms
  FOR EACH ROW 
  WHEN (NEW.patient_id IS NOT NULL)
  EXECUTE FUNCTION public.sync_patient_room_id();

DROP TRIGGER IF EXISTS clear_patient_room_on_room_delete ON public.rooms;
CREATE TRIGGER clear_patient_room_on_room_delete
  AFTER DELETE ON public.rooms
  FOR EACH ROW 
  WHEN (OLD.patient_id IS NOT NULL)
  EXECUTE FUNCTION public.clear_patient_room_id();

-- Backfill: ensure all existing room→patient links are synced
-- Only update patients whose room_id doesn't match their room's patient_id
UPDATE public.patients p
SET room_id = r.id
FROM public.rooms r
WHERE r.patient_id = p.id
  AND (p.room_id IS NULL OR p.room_id != r.id)
  AND p.deleted_at IS NULL;
