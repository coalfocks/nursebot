-- Break the RLS cycle between rooms and student_room_assignments.
-- Assignment INSERT policies must not query rooms directly because room SELECT
-- policies consult assignments. These security-definer checks read the related
-- rows with the function owner privileges and expose only a boolean decision.

create or replace function public.can_create_test_room_sandbox_assignment(
  requested_student_id uuid,
  requested_room_id bigint,
  requested_school_id uuid
)
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1
    from public.profiles learner
    join public.rooms room on room.id = requested_room_id
    where learner.id = (select auth.uid())
      and requested_student_id = learner.id
      and learner.role = 'test_user'
      and requested_school_id = learner.school_id
      and coalesce(room.is_active, true) = true
      and (
        room.school_id = learner.school_id
        or room.available_school_ids = '{}'
        or (room.available_school_ids is not null and learner.school_id = any(room.available_school_ids))
      )
      and room.learner_program = learner.learner_program
  );
$$;

create or replace function public.can_launch_configured_student_sandbox(
  requested_student_id uuid,
  requested_room_id bigint,
  requested_school_id uuid
)
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1
    from public.profiles learner
    join public.walkthrough_sandbox_launches launch
      on launch.room_id = requested_room_id
     and launch.slug = 'practice-room-00'
     and launch.enabled = true
    join public.rooms room on room.id = launch.room_id
    where learner.id = (select auth.uid())
      and requested_student_id = learner.id
      and learner.role = 'student'
      and requested_school_id = learner.school_id
      and coalesce(room.is_active, true) = true
      and room.learner_program = learner.learner_program
  );
$$;

revoke all on function public.can_create_test_room_sandbox_assignment(uuid, bigint, uuid) from public;
grant execute on function public.can_create_test_room_sandbox_assignment(uuid, bigint, uuid) to authenticated;
revoke all on function public.can_launch_configured_student_sandbox(uuid, bigint, uuid) from public;
grant execute on function public.can_launch_configured_student_sandbox(uuid, bigint, uuid) to authenticated;

drop policy if exists "Test users create sandbox assignments" on public.student_room_assignments;
create policy "Test users create sandbox assignments"
on public.student_room_assignments
for insert to authenticated
with check (
  is_sandbox = true
  and public.can_create_test_room_sandbox_assignment(student_id, room_id, school_id)
);

drop policy if exists "Students launch configured sandbox assignments" on public.student_room_assignments;
create policy "Students launch configured sandbox assignments"
on public.student_room_assignments
for insert to authenticated
with check (
  is_sandbox = true
  and public.can_launch_configured_student_sandbox(student_id, room_id, school_id)
);

comment on function public.can_create_test_room_sandbox_assignment(uuid, bigint, uuid)
  is 'RLS-safe eligibility check for a test-user sandbox room session; avoids rooms/assignment policy recursion.';
comment on function public.can_launch_configured_student_sandbox(uuid, bigint, uuid)
  is 'RLS-safe eligibility check for the configured student practice-room launch.';
