-- Allow specialties to be global (school_id = null) or school-specific
ALTER TABLE specialties ALTER COLUMN school_id DROP NOT NULL;
