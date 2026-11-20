-- Case Start timestamp for analytics duration (Complete − Case Start).
-- Additive and nullable. Written once by the learner app when an assigned case first moves to in_progress
-- (guarded by "case_started_at is null"). Feedback reruns never touch this column.
-- Historical attempts remain null and are excluded from timing averages with an explicit reason.
alter table public.student_room_assignments
  add column if not exists case_started_at timestamptz;

comment on column public.student_room_assignments.case_started_at is 'Case Start: when the learner first opened this assigned case. Set once; never overwritten. Null for attempts that pre-date start tracking.';
