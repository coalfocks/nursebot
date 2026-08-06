-- Test-user sessions are assignment-scoped sandbox records. Keep their writes
-- explicit and limited to assignments owned by the authenticated test user.

drop policy if exists "Test users manage own medical orders" on public.medical_orders;
create policy "Test users manage own medical orders"
on public.medical_orders
for all
using (
  exists (
    select 1
    from public.student_room_assignments assignment
    join public.profiles profile on profile.id = auth.uid()
    where assignment.id = medical_orders.assignment_id
      and assignment.student_id = auth.uid()
      and profile.role = 'test_user'
  )
)
with check (
  assignment_id is not null
  and exists (
    select 1
    from public.student_room_assignments assignment
    join public.profiles profile on profile.id = auth.uid()
    where assignment.id = medical_orders.assignment_id
      and assignment.student_id = auth.uid()
      and profile.role = 'test_user'
  )
);

drop policy if exists "Test users manage own lab results" on public.lab_results;
create policy "Test users manage own lab results"
on public.lab_results
for all
using (
  exists (
    select 1
    from public.student_room_assignments assignment
    join public.profiles profile on profile.id = auth.uid()
    where assignment.id = lab_results.assignment_id
      and assignment.student_id = auth.uid()
      and profile.role = 'test_user'
  )
)
with check (
  assignment_id is not null
  and exists (
    select 1
    from public.student_room_assignments assignment
    join public.profiles profile on profile.id = auth.uid()
    where assignment.id = lab_results.assignment_id
      and assignment.student_id = auth.uid()
      and profile.role = 'test_user'
  )
);
