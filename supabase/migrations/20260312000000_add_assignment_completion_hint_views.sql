alter table public.student_room_assignments
  add column if not exists completion_hint_views jsonb not null default '{}'::jsonb;

comment on column public.student_room_assignments.completion_hint_views is
  'Tracks which completion hints a student explicitly revealed before finishing the case, keyed by hint name with viewedAt timestamps.';
