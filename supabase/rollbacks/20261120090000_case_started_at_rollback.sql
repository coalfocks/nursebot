-- Rollback for supabase/migrations/20261120090000_case_started_at.sql
-- NOT in supabase/migrations on purpose: it must never run as part of a normal deploy. Run manually only.
--
-- What it undoes:
--   1. the before insert/update trigger (stops server-side Case Start and server-side completed_at stamping)
--   2. the trigger function
--   3. the case_started_at column (all recorded Case Start values are lost; export first if you need them)
-- It does not touch completed_at values already written, and it does not change any other column or trigger.
--
-- Optional export before running:
--   select id, case_started_at from public.student_room_assignments where case_started_at is not null;
--
-- After running, also remove the migration record so a later db push can re-apply it:
--   delete from supabase_migrations.schema_migrations where version = '20261120090000';
-- And roll the frontend back to the previous release (the analytics page tolerates a missing column, so the
-- current frontend keeps working with the column absent).

begin;
drop trigger if exists student_room_assignments_case_timestamps on public.student_room_assignments;
drop function if exists public.student_room_assignments_case_timestamps();
alter table public.student_room_assignments drop column if exists case_started_at;
commit;
