drop policy if exists "Test users read eligible rooms" on public.rooms;

create policy "Test users read eligible rooms"
on public.rooms
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'test_user'
      and p.learner_program = rooms.learner_program
      and (
        p.school_id = rooms.school_id
        or rooms.available_school_ids = '{}'
        or (rooms.available_school_ids is not null and p.school_id = any(rooms.available_school_ids))
      )
      and coalesce(rooms.is_active, true) = true
  )
);
