-- Enable the net extension for HTTP requests
CREATE EXTENSION IF NOT EXISTS "net" WITH SCHEMA "extensions";

-- Add comment explaining the extension
COMMENT ON EXTENSION "net" IS 'Enables HTTP requests from PostgreSQL for cron jobs'; 