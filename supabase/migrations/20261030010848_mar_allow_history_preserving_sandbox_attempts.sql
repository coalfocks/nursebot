-- A sandbox assignment UUID is the retry identity. The former partial unique
-- index allowed only one sandbox row per student/room, which made the
-- history-preserving "Start fresh" flow impossible. Keep actor/school/snapshot
-- checks in the RPC and retain a non-unique lookup index for the dashboard.
drop index if exists public.student_room_assignments_sandbox_once_idx;

create index if not exists student_room_assignments_sandbox_lookup_idx
  on public.student_room_assignments (student_id, room_id, created_at desc)
  where is_sandbox = true;

comment on index public.student_room_assignments_sandbox_lookup_idx is
  'Multiple history-preserving sandbox attempts are allowed; assignment UUID is the retry identity.';
