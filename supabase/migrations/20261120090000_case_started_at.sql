-- Case Start timestamp for analytics duration (Complete − Case Start, elapsed time including pauses).
-- Additive nullable column plus a server-side trigger, so the start is atomic with the first real
-- transition to in_progress. There is no separate client write that can fail or be lost on tab close.
-- Historical attempts remain null and are excluded from timing averages with an explicit reason.
alter table public.student_room_assignments
  add column if not exists case_started_at timestamptz;

comment on column public.student_room_assignments.case_started_at is 'Case Start: set by trigger in the same statement that first moves the assignment to in_progress. Set once; never overwritten or client-supplied. Null for attempts that pre-date start tracking.';

create or replace function public.student_room_assignments_case_timestamps()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    -- Never trust a client-supplied start.
    new.case_started_at := case when new.status = 'in_progress' then now() else null end;
    return new;
  end if;

  -- Case Start: once set it is immutable; otherwise only the first transition into in_progress sets it (server clock).
  if old.case_started_at is not null then
    new.case_started_at := old.case_started_at;
  elsif new.status = 'in_progress' and old.status is distinct from 'in_progress' then
    new.case_started_at := now();
  else
    new.case_started_at := null;
  end if;

  -- Complete is stamped by the server clock on the first transition into completed. Until now the browser
  -- wrote completed_at from its own clock (ChatInterface.completeAssignment), so Start (server) and Complete
  -- (client) could disagree by clock skew; a client-supplied value is ignored on that transition. This also covers
  -- paths that complete an assignment without sending completed_at at all.
  if new.status = 'completed' and old.status is distinct from 'completed' then
    new.completed_at := now();
  -- Original completion time is preserved: reruns, feedback regeneration, or a repeated completion write
  -- on an already-completed assignment cannot move or clear it. (On prod, 15 completed rows had their
  -- completed_at moved by a second completion on the same row; this stops that.)
  elsif old.status = 'completed' and old.completed_at is not null and new.status = 'completed' then
    new.completed_at := old.completed_at;
  end if;

  return new;
end;
$$;

drop trigger if exists student_room_assignments_case_timestamps on public.student_room_assignments;
create trigger student_room_assignments_case_timestamps
  before insert or update on public.student_room_assignments
  for each row execute function public.student_room_assignments_case_timestamps();
