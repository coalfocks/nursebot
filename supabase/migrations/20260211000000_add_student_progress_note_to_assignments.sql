alter table public.student_room_assignments
  add column if not exists student_progress_note text;

comment on column public.student_room_assignments.student_progress_note is 'Student-authored progress note captured at assignment completion; not part of EMR clinical notes.';
