-- Minimal disposable bootstrap for the prospective assignment-chain contract.
-- This is intentionally separate from the production migration ledger.

\i /repo/supabase/tests/fixtures/mar-baseline-schema.sql

alter table public.rooms
  add column if not exists continues_from integer references public.rooms(id),
  add column if not exists progress_note text,
  add column if not exists updated_at timestamptz not null default now();
alter table public.student_room_assignments
  add column if not exists completed_at timestamptz;

insert into public.schools values
  ('00000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000003');
insert into auth.users values
  ('00000000-0000-0000-0000-000000000202'),
  ('00000000-0000-0000-0000-000000000204'),
  ('00000000-0000-0000-0000-000000000205'),
  ('00000000-0000-0000-0000-000000000206');
insert into public.profiles values
  ('00000000-0000-0000-0000-000000000202', 'school_admin', '00000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000204', 'student', '00000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000205', 'student', '00000000-0000-0000-0000-000000000003'),
  ('00000000-0000-0000-0000-000000000206', 'school_admin', '00000000-0000-0000-0000-000000000003');
insert into public.patients values
  ('00000000-0000-0000-0000-000000001401', 'Synthetic chain patient');
insert into public.rooms(id, room_number, patient_id, school_id, available_school_ids, continues_from, progress_note, updated_at)
values
  (401, '401', '00000000-0000-0000-0000-000000001401', '00000000-0000-0000-0000-000000000001', '{}', null, 'Authored A', '2099-01-01T08:00:00Z'),
  (402, '402', '00000000-0000-0000-0000-000000001401', '00000000-0000-0000-0000-000000000001', '{}', 401, 'Authored B', '2099-01-01T08:01:00Z'),
  (403, '403', '00000000-0000-0000-0000-000000001401', '00000000-0000-0000-0000-000000000001', '{}', 402, 'Authored C', '2099-01-01T08:02:00Z');

-- Ordered source manifest. Keep this list explicit so the test cannot
-- accidentally consume the target project's migration history.
\i /repo/supabase/migrations/20261019100009_mar_authored_baseline_and_administrations.sql
\i /repo/supabase/migrations/20261019100010_mar_authorized_scope_materialization.sql
\i /repo/supabase/migrations/20261019100011_mar_read_scope_and_versions.sql
\i /repo/supabase/migrations/20261019100012_mar_atomic_snapshot_save.sql
\i /repo/supabase/migrations/20261019100013_mar_revoke_split_mutators.sql
\i /repo/supabase/migrations/20261019100014_mar_normal_assignment_materialization.sql
\i /repo/supabase/migrations/20261019100015_mar_materialization_scope_and_snapshot_reader.sql
\i /repo/supabase/migrations/20261103035651_assignment_chain_snapshots_prospective.sql
\i /repo/supabase/migrations/20261103041000_assignment_chain_source_corrections.sql
