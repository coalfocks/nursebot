-- Surgical authorization boundary for the MAR-unavailable disposable QA path.
-- This does not alter existing assignments, pins, rooms, or learner school scope.

alter table public.student_room_assignments
  add column if not exists disposable_qa boolean not null default false;

create table if not exists public.disposable_qa_authorized_learners (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  enabled boolean not null default true,
  note text not null default 'Explicitly authorized synthetic QA learner',
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.disposable_qa_authorized_learners enable row level security;
revoke all on public.disposable_qa_authorized_learners from anon, authenticated;

insert into public.disposable_qa_authorized_learners(profile_id)
values ('1b895dcc-d329-4b31-8735-2059b986ae96'::uuid)
on conflict (profile_id) do update set enabled = true;

create or replace function public.can_create_disposable_qa_assignment(
  requested_student_id uuid,
  requested_room_id bigint,
  requested_school_id uuid
) returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles actor
    join public.profiles learner on learner.id = requested_student_id
    join public.disposable_qa_authorized_learners allowlist
      on allowlist.profile_id = learner.id and allowlist.enabled
    join public.rooms room on room.id = requested_room_id
    where actor.id = auth.uid()
      and actor.role = 'super_admin'
      and learner.role = 'student'
      and requested_school_id = learner.school_id
      and room.is_active = true
      and room.learner_program = learner.learner_program
      and (
        room.school_id = learner.school_id
        or room.available_school_ids = '{}'
        or (room.available_school_ids is not null and learner.school_id = any(room.available_school_ids))
      )
  );
$$;

create or replace function public.is_authorized_disposable_qa_assignment(requested_assignment_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.student_room_assignments assignment
    join public.profiles learner on learner.id = assignment.student_id
    join public.disposable_qa_authorized_learners allowlist
      on allowlist.profile_id = learner.id and allowlist.enabled
    join public.rooms room on room.id = assignment.room_id
    where assignment.id = requested_assignment_id
      and assignment.disposable_qa = true
      and learner.role = 'student'
      and assignment.school_id = learner.school_id
      and room.is_active = true
      and room.learner_program = learner.learner_program
      and (
        room.school_id = learner.school_id
        or room.available_school_ids = '{}'
        or (room.available_school_ids is not null and learner.school_id = any(room.available_school_ids))
      )
  );
$$;

revoke all on function public.can_create_disposable_qa_assignment(uuid, bigint, uuid) from public, anon;
grant execute on function public.can_create_disposable_qa_assignment(uuid, bigint, uuid) to authenticated;
revoke all on function public.is_authorized_disposable_qa_assignment(uuid) from public, anon;
grant execute on function public.is_authorized_disposable_qa_assignment(uuid) to authenticated;

drop policy if exists "Admins manage assignments" on public.student_room_assignments;
create policy "Admins manage assignments"
on public.student_room_assignments for all
using (
  auth.role() = 'service_role'
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('school_admin', 'super_admin')
      and (p.role = 'super_admin' or p.school_id = student_room_assignments.school_id)
  )
)
with check (
  (auth.role() = 'service_role' or exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('school_admin', 'super_admin')
      and (p.role = 'super_admin' or p.school_id = student_room_assignments.school_id)
  ))
  and (not disposable_qa or public.can_create_disposable_qa_assignment(student_id, room_id, school_id))
);

comment on table public.disposable_qa_authorized_learners is
  'Explicit allow-list for the superadmin-only MAR-unavailable disposable QA path; not a general learner role.';
