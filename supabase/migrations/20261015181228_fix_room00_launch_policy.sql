drop policy if exists "Students launch configured sandbox assignments" on public.student_room_assignments;

create policy "Students launch configured sandbox assignments"
on public.student_room_assignments for insert to authenticated
with check (
  student_id = (select auth.uid())
  and is_sandbox = true
  and exists (
    select 1
    from public.profiles learner
    join public.walkthrough_sandbox_launches launch
      on launch.room_id = public.student_room_assignments.room_id
    join public.rooms sandbox_room on sandbox_room.id = launch.room_id
    where learner.id = (select auth.uid())
      and learner.role = 'student'
      and learner.school_id = public.student_room_assignments.school_id
      and learner.learner_program = sandbox_room.learner_program
      and launch.slug = 'practice-room-00'
      and launch.enabled = true
      and sandbox_room.is_active = true
  )
);
