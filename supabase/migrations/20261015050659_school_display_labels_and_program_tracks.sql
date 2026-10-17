-- Expand-only rollout for display labels and learner program tracks.
-- Stable school IDs/slugs remain the authorization and integration keys.

alter table public.schools
  add column if not exists display_name text,
  add column if not exists enabled_programs text[] not null default array['medical']::text[];

alter table public.schools
  drop constraint if exists schools_enabled_programs_check;
alter table public.schools
  add constraint schools_enabled_programs_check
  check (cardinality(enabled_programs) > 0 and enabled_programs <@ array['medical', 'nursing']::text[]);

-- Human-readable SOM labels are keyed by immutable IDs; canonical names/slugs stay unchanged.
update public.schools
set display_name = case
  when name ilike '% som' or name ilike '%-som' or name ilike '%soma' then name
  else name || ' SOM'
end
where id in (
  '14122901-c0f8-4b4e-adc7-6d385f3bba76',
  '05e89b88-af93-4ad5-8a3b-d632007ffa74',
  '25d99c7f-feb3-42b8-8785-dce08995bae5',
  '627fa1ba-1556-4a05-946d-305624a45e5d',
  '9c50eb60-2ddd-4eeb-beb7-972f1313c237',
  'f92ee295-55ec-4393-988c-0f2ed2950f6b',
  '9461e8c8-238d-47a7-85c6-a8d5141b8cb6'
)
and (display_name is null or display_name !~* '(^|[ -])SOM$');

create index if not exists schools_display_name_idx on public.schools (display_name);

alter table public.profiles
  add column if not exists learner_program text;

alter table public.rooms
  add column if not exists learner_program text not null default 'medical';

alter table public.student_room_assignments
  add column if not exists learner_program text not null default 'medical';

alter table public.profiles
  drop constraint if exists profiles_learner_program_check;
alter table public.profiles
  add constraint profiles_learner_program_check
  check (learner_program is null or learner_program in ('medical', 'nursing'));

alter table public.rooms
  drop constraint if exists rooms_learner_program_check;
alter table public.rooms
  add constraint rooms_learner_program_check
  check (learner_program in ('medical', 'nursing'));

alter table public.student_room_assignments
  drop constraint if exists assignments_learner_program_check;
alter table public.student_room_assignments
  add constraint assignments_learner_program_check
  check (learner_program in ('medical', 'nursing'));

-- Deterministic expand/backfill: existing physician content remains medical.
update public.profiles
set learner_program = 'medical'
where role in ('student', 'test_user') and learner_program is null;

update public.profiles
set learner_program = null
where role not in ('student', 'test_user');

update public.rooms
set learner_program = 'medical'
where learner_program is null;

update public.student_room_assignments a
set learner_program = coalesce(r.learner_program, 'medical')
from public.rooms r
where r.id = a.room_id and a.learner_program is distinct from r.learner_program;

create table if not exists public.program_track_change_audit (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  school_id uuid references public.schools(id) on delete set null,
  changed_by uuid references public.profiles(id) on delete set null,
  previous_program text,
  next_program text not null check (next_program in ('medical', 'nursing')),
  reason text not null,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists profiles_learner_program_idx on public.profiles (school_id, learner_program);
create index if not exists rooms_learner_program_idx on public.rooms (school_id, learner_program);
create index if not exists assignments_learner_program_idx on public.student_room_assignments (school_id, learner_program);
create index if not exists program_track_audit_profile_idx on public.program_track_change_audit (profile_id, created_at desc);

alter table public.program_track_change_audit enable row level security;
drop policy if exists "Admins read program track audit" on public.program_track_change_audit;
create policy "Admins read program track audit"
on public.program_track_change_audit for select
to authenticated
using (
  exists (
    select 1 from public.profiles viewer
    where viewer.id = (select auth.uid())
      and viewer.role in ('school_admin', 'super_admin')
      and (viewer.role = 'super_admin' or viewer.school_id = program_track_change_audit.school_id)
  )
);

drop policy if exists "Admins insert program track audit" on public.program_track_change_audit;
create policy "Admins insert program track audit"
on public.program_track_change_audit for insert
to authenticated
with check (
  exists (
    select 1 from public.profiles actor
    where actor.id = (select auth.uid())
      and actor.role in ('school_admin', 'super_admin')
      and (actor.role = 'super_admin' or actor.school_id = program_track_change_audit.school_id)
  )
);

create or replace function public.change_learner_program(
  target_profile_id uuid,
  next_program text,
  change_reason text
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles;
  target public.profiles;
  previous_program text;
begin
  select * into actor from public.profiles where id = (select auth.uid());
  select * into target from public.profiles where id = target_profile_id;
  if actor.id is null or actor.role not in ('school_admin', 'super_admin') then
    raise exception 'Only school admins or superadmins can change learner programs';
  end if;
  if target.id is null or target.role not in ('student', 'test_user') then
    raise exception 'Only learner accounts can have a learner program';
  end if;
  if next_program not in ('medical', 'nursing') then
    raise exception 'Invalid learner program';
  end if;
  if actor.role <> 'super_admin' and actor.school_id is distinct from target.school_id then
    raise exception 'School boundary violation';
  end if;
  if not exists (
    select 1 from public.schools school
    where school.id = target.school_id and next_program = any(school.enabled_programs)
  ) then
    raise exception 'That program is not enabled for the learner school';
  end if;
  previous_program := target.learner_program;
  update public.profiles set learner_program = next_program where id = target.id returning * into target;
  insert into public.program_track_change_audit (profile_id, school_id, changed_by, previous_program, next_program, reason)
  values (target.id, target.school_id, actor.id, previous_program, next_program,
    coalesce(nullif(trim(change_reason), ''), 'Program corrected by school administrator'));
  return target;
end;
$$;

revoke execute on function public.change_learner_program(uuid, text, text) from public;
grant execute on function public.change_learner_program(uuid, text, text) to authenticated;

create or replace function public.enforce_program_track_consistency()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  room_program text;
  student_program text;
begin
  select learner_program into room_program from public.rooms where id = new.room_id;
  select learner_program into student_program from public.profiles where id = new.student_id;
  if room_program is null or student_program is null or room_program <> student_program then
    raise exception 'Assignment program must match both the room and learner program';
  end if;
  new.learner_program := room_program;
  return new;
end;
$$;

drop trigger if exists assignments_program_consistency on public.student_room_assignments;
create trigger assignments_program_consistency
before insert or update of room_id, student_id, learner_program
on public.student_room_assignments
for each row execute function public.enforce_program_track_consistency();

-- Defense in depth: assignment reads and room reads must agree on the learner track.
drop policy if exists "Students view assigned rooms" on public.rooms;
create policy "Students view assigned rooms"
on public.rooms for select
to authenticated
using (
  exists (
    select 1
    from public.student_room_assignments assignment
    join public.profiles learner on learner.id = assignment.student_id
    where assignment.room_id = rooms.id
      and assignment.student_id = (select auth.uid())
      and assignment.learner_program = rooms.learner_program
      and learner.learner_program = rooms.learner_program
  )
);

comment on column public.schools.display_name is 'Presentation label only; never use for authorization or integration joins.';
comment on column public.profiles.learner_program is 'Learner track independent from account role and school tenancy.';
comment on column public.rooms.learner_program is 'Track owning this room; legacy rooms are medical.';
comment on column public.student_room_assignments.learner_program is 'Track snapshot; must match the assigned room and learner.';
