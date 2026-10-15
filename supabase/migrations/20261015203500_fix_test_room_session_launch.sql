-- Test-room sessions are explicitly sandbox assignments. Keep the existing
-- on-demand launcher isolated from graded assignments and tenant-scoped.

drop policy if exists "Test users create sandbox assignments" on public.student_room_assignments;
create policy "Test users create sandbox assignments"
on public.student_room_assignments
for insert to authenticated
with check (
  student_id = (select auth.uid())
  and is_sandbox = true
  and exists (
    select 1
    from public.profiles learner
    join public.rooms room on room.id = public.student_room_assignments.room_id
    where learner.id = (select auth.uid())
      and learner.role = 'test_user'
      and public.student_room_assignments.school_id = learner.school_id
      and coalesce(room.is_active, true) = true
      and (
        room.school_id = learner.school_id
        or room.available_school_ids = '{}'
        or (room.available_school_ids is not null and learner.school_id = any(room.available_school_ids))
      )
      and room.learner_program = learner.learner_program
  )
);

comment on policy "Test users create sandbox assignments" on public.student_room_assignments
  is 'Allows only authenticated test users to create one explicitly sandboxed, school/program-eligible room session.';
