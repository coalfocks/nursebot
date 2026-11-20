-- Regression for 20261120090000_case_started_at.sql.
-- Run against a scratch database that has public.student_room_assignments(id, status, completed_at, case_started_at)
-- and the migration applied, with psql --set ON_ERROR_STOP=1. Never run against prod.
\set ON_ERROR_STOP on

do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  c uuid := gen_random_uuid();
  started timestamptz;
  completed timestamptz;
begin
  insert into public.student_room_assignments (id, status) values (a, 'assigned');
  insert into public.student_room_assignments (id, status) values (c, 'assigned');
  if (select case_started_at from public.student_room_assignments where id = a) is not null then
    raise exception 'assigned insert must not have a start';
  end if;

  -- Client-supplied start on a non-transition update is ignored.
  update public.student_room_assignments set case_started_at = '2000-01-01' where id = a;
  if (select case_started_at from public.student_room_assignments where id = a) is not null then
    raise exception 'client-supplied start must be ignored before in_progress';
  end if;

  -- First transition sets the start atomically, server-side, with a client value ignored.
  update public.student_room_assignments set status = 'in_progress', case_started_at = '2000-01-01' where id = a;
  select case_started_at into started from public.student_room_assignments where id = a;
  if started is null or started < now() - interval '1 minute' then
    raise exception 'first in_progress transition must set server start, got %', started;
  end if;

  -- Reload / repeated writes never move it.
  update public.student_room_assignments set status = 'in_progress' where id = a;
  update public.student_room_assignments set case_started_at = null where id = a;
  if (select case_started_at from public.student_room_assignments where id = a) is distinct from started then
    raise exception 'case_started_at must be immutable once set';
  end if;

  -- Complete is server time on the first transition; a client-supplied value is ignored.
  update public.student_room_assignments set status = 'completed', completed_at = '2000-01-01T00:00:00Z' where id = a;
  select completed_at into completed from public.student_room_assignments where id = a;
  if completed is null or completed < now() - interval '1 minute' then
    raise exception 'first completion must use server time, got %', completed;
  end if;

  -- Completion timestamp preserved across reruns / second completion on the same row.
  update public.student_room_assignments set status = 'completed', completed_at = '2026-11-21T10:00:00Z' where id = a;
  update public.student_room_assignments set completed_at = null where id = a;
  if (select completed_at from public.student_room_assignments where id = a) is distinct from completed then
    raise exception 'completed_at must be preserved once completed';
  end if;

  -- A completion that never went through in_progress (e.g. CaseManager) still gets a server Complete and no start.
  update public.student_room_assignments set status = 'completed' where id = c;
  if (select completed_at from public.student_room_assignments where id = c) is null
     or (select case_started_at from public.student_room_assignments where id = c) is not null then
    raise exception 'direct completion must set Complete and leave Start null';
  end if;

  -- Insert directly as in_progress also gets a server start.
  insert into public.student_room_assignments (id, status, case_started_at) values (b, 'in_progress', '2000-01-01');
  if (select case_started_at from public.student_room_assignments where id = b) < now() - interval '1 minute' then
    raise exception 'insert as in_progress must use server time';
  end if;
end $$;
