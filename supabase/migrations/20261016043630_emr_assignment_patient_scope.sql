-- Student EMR patient reads must be assignment-scoped before rows leave the
-- database. The old authenticated policy exposed every patient row, making a
-- client-side is_sandbox filter ineffective as an access boundary.

drop policy if exists "allow authenticated read" on public.patients;
drop policy if exists "allow authenticated write" on public.patients;
drop policy if exists "EMR users read assigned patients" on public.patients;
drop policy if exists "EMR admins manage patients" on public.patients;

create policy "EMR users read assigned patients"
on public.patients
for select to authenticated
using (
  exists (
    select 1
    from public.student_room_assignments assignment
    join public.rooms room on room.id = assignment.room_id
    where assignment.student_id = (select auth.uid())
      and room.patient_id = patients.id
  )
  or exists (
    select 1
    from public.profiles profile
    where profile.id = (select auth.uid())
      and profile.role in ('school_admin', 'super_admin')
      and (
        profile.role = 'super_admin'
        or profile.school_id is not distinct from patients.school_id
      )
  )
);

create policy "EMR admins manage patients"
on public.patients
for all to authenticated
using (
  exists (
    select 1
    from public.profiles profile
    where profile.id = (select auth.uid())
      and profile.role in ('school_admin', 'super_admin')
      and (
        profile.role = 'super_admin'
        or profile.school_id is not distinct from patients.school_id
      )
  )
)
with check (
  exists (
    select 1
    from public.profiles profile
    where profile.id = (select auth.uid())
      and profile.role in ('school_admin', 'super_admin')
      and (
        profile.role = 'super_admin'
        or profile.school_id is not distinct from patients.school_id
      )
  )
);

comment on policy "EMR users read assigned patients" on public.patients is
  'Learners can read only patients linked through their own room assignments; the UI must further query the active assignment.';
