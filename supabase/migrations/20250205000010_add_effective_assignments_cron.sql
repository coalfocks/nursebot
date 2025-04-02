-- Create a cron job to process effective assignments every minute
SELECT cron.schedule(
    'process-effective-assignments',  -- name of the cron job
    '* * * * *',                     -- every minute
    'SELECT net.http_post(url := ''https://lvpbwtfvairspufrashl.supabase.co/functions/v1/process-effective-assignments'', headers := ''{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx2cGJ3dGZ2YWlyc3B1ZnJhc2hsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzg2NDU0MTgsImV4cCI6MjA1NDIyMTQxOH0.1AzQAkaNMovPVJxE16XlLLxV18PtfXtA6goCdtihofc"}''::jsonb)'
);

