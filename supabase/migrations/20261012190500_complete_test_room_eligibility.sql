-- Test-room access uses the same available-to-school semantics as admin room
-- access. Empty available_school_ids means all schools; a populated array is an
-- explicit allow-list. No role is broadened beyond the existing test_user role.
drop policy if exists "Test users read rooms" on public.rooms;
create policy "Test users read eligible rooms" on public.rooms for select
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'test_user'
      and (
        p.school_id = rooms.school_id
        or rooms.available_school_ids = '{}'
        or (rooms.available_school_ids is not null and p.school_id = any(rooms.available_school_ids))
      )
      and coalesce(rooms.is_active, true) = true
  )
);

drop policy if exists "Test users read specialties" on public.specialties;
create policy "Test users read eligible specialties" on public.specialties for select
using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'test_user'
    and (p.school_id = specialties.school_id or specialties.school_id is null))
);
