-- Additive library audience separation and a stable, opt-in Room 00 launch contract.
-- This migration does not create or modify any case/room/patient record.

alter table public.walkthrough_videos
  drop constraint if exists walkthrough_videos_audience_check;
alter table public.walkthrough_videos
  add constraint walkthrough_videos_audience_check
  check (audience in ('admin', 'student', 'test_room', 'both'));

alter table public.walkthrough_courses
  drop constraint if exists walkthrough_courses_audience_check;
alter table public.walkthrough_courses
  add constraint walkthrough_courses_audience_check
  check (audience in ('admin', 'student', 'test_room', 'both'));

alter table public.student_room_assignments
  add column if not exists is_sandbox boolean not null default false;
create index if not exists student_room_assignments_official_idx
  on public.student_room_assignments (student_id, created_at desc)
  where is_sandbox = false;
create unique index if not exists student_room_assignments_sandbox_once_idx
  on public.student_room_assignments (student_id, room_id)
  where is_sandbox = true;

create table if not exists public.walkthrough_sandbox_launches (
  slug text primary key,
  room_id bigint unique references public.rooms(id) on delete restrict,
  enabled boolean not null default false,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);
alter table public.walkthrough_sandbox_launches enable row level security;
drop policy if exists "sandbox launch configuration readable by authenticated users" on public.walkthrough_sandbox_launches;
create policy "sandbox launch configuration readable by authenticated users"
on public.walkthrough_sandbox_launches for select to authenticated
using (enabled = true);
drop policy if exists "admins manage sandbox launch configuration" on public.walkthrough_sandbox_launches;
create policy "admins manage sandbox launch configuration"
on public.walkthrough_sandbox_launches for all to authenticated
using (public.is_walkthrough_admin())
with check (public.is_walkthrough_admin());

insert into public.walkthrough_sandbox_launches (slug, room_id, enabled)
values ('practice-room-00', null, false)
on conflict (slug) do nothing;

drop policy if exists "Students launch configured sandbox assignments" on public.student_room_assignments;
create policy "Students launch configured sandbox assignments"
on public.student_room_assignments for insert to authenticated
with check (
  student_id = (select auth.uid())
  and is_sandbox = true
  and exists (
    select 1
    from public.profiles learner
    join public.walkthrough_sandbox_launches launch on launch.room_id = student_room_assignments.room_id
    join public.rooms sandbox_room on sandbox_room.id = launch.room_id
    where learner.id = (select auth.uid())
      and learner.role = 'student'
      and learner.school_id = student_room_assignments.school_id
      and learner.learner_program = sandbox_room.learner_program
      and launch.slug = 'practice-room-00'
      and launch.enabled = true
      and sandbox_room.is_active = true
  )
);

-- Student-facing course publication accepts only the matching audience. Test-room
-- material is never eligible for ordinary student courses.
create or replace function public.validate_walkthrough_course_publication()
returns trigger language plpgsql as $$
begin
  if new.status = 'published' then
    if not exists (
      select 1 from public.walkthrough_course_items item
      where item.course_id = new.id and item.course_version = new.version and item.required
    ) then
      raise exception 'walkthrough_course_requires_items: add at least one required reviewed video before publishing';
    end if;
    if exists (
      select 1
      from public.walkthrough_course_items item
      join public.walkthrough_videos video on video.id = item.video_id and video.version = item.video_version
      where item.course_id = new.id and item.course_version = new.version
        and (
          video.status <> 'published'
          or (new.audience = 'admin' and video.audience not in ('admin', 'both'))
          or (new.audience = 'student' and video.audience not in ('student', 'both'))
          or (new.audience = 'test_room' and video.audience <> 'test_room')
          or (new.audience = 'both' and video.audience not in ('both'))
          or (new.audience in ('student', 'both') and not video.onboarding_eligible)
          or public.walkthrough_transcript_has_unsafe_password_advice(video.transcript)
        )
    ) then
      raise exception 'walkthrough_course_invalid_item: every course item must be a published, audience-compatible, and safe video';
    end if;
  end if;
  return new;
end;
$$;

drop policy if exists "published walkthrough videos readable by students" on public.walkthrough_videos;
create policy "published walkthrough videos readable by students"
on public.walkthrough_videos for select to authenticated
using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'student')
  and status = 'published' and audience in ('student', 'both')
);
drop policy if exists "published walkthrough videos readable by test users" on public.walkthrough_videos;
create policy "published walkthrough videos readable by test users"
on public.walkthrough_videos for select to authenticated
using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'test_user')
  and status = 'published' and audience = 'test_room'
);

drop policy if exists "published walkthrough courses readable by students" on public.walkthrough_courses;
create policy "published walkthrough courses readable by students"
on public.walkthrough_courses for select to authenticated
using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'student')
  and status = 'published' and audience in ('student', 'both')
);
drop policy if exists "published walkthrough courses readable by test users" on public.walkthrough_courses;
create policy "published walkthrough courses readable by test users"
on public.walkthrough_courses for select to authenticated
using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'test_user')
  and status = 'published' and audience = 'test_room'
);

drop policy if exists "course items readable by admins" on public.walkthrough_course_items;
create policy "course items readable by admins" on public.walkthrough_course_items for select to authenticated
using (
  public.is_walkthrough_admin()
  or exists (
    select 1 from public.walkthrough_courses course
    join public.profiles viewer on viewer.id = (select auth.uid())
    where course.id = course_id and course.version = course_version and course.status = 'published'
      and ((viewer.role = 'student' and course.audience in ('student', 'both'))
        or (viewer.role = 'test_user' and course.audience = 'test_room'))
  )
);

comment on column public.student_room_assignments.is_sandbox is 'Sandbox attempt excluded from official assignment analytics; linked by immutable room_id.';
comment on table public.walkthrough_sandbox_launches is 'Stable-ID launch configuration. Room 00 is registered separately; this table never authors the case.';

drop policy if exists "admins read walkthrough media" on storage.objects;
create policy "role-scoped walkthrough media readable" on storage.objects
for select to authenticated using (
  bucket_id = 'walkthrough_videos' and (
    public.is_walkthrough_super_admin()
    or exists (
      select 1 from public.walkthrough_videos video
      join public.profiles viewer on viewer.id = (select auth.uid())
      where video.video_path = name and video.status = 'published'
        and ((viewer.role = 'school_admin' and video.audience in ('admin', 'both'))
          or (viewer.role = 'student' and video.audience in ('student', 'both'))
          or (viewer.role = 'test_user' and video.audience = 'test_room'))
    )
  )
);

-- Reconcile the existing preview course without touching any clinical case data.
-- The trial-case video is retained as Test Room content; the student path uses
-- assigned-case orientation and ends with the full sandbox walkthrough.
do $$
declare
  trial_video uuid;
  trial_version integer;
  test_course uuid;
begin
  select id, version into trial_video, trial_version
  from public.walkthrough_videos
  where lower(title) like '%trial%'
     or lower(learning_objective) like '%trial%'
  order by updated_at desc nulls last
  limit 1;

  if trial_video is not null then
    update public.walkthrough_videos
    set audience = 'test_room', onboarding_eligible = false, updated_at = timezone('utc'::text, now())
    where id = trial_video and version = trial_version;

    select id into test_course from public.walkthrough_courses where title = 'Test Room Learning Library' limit 1;
    if test_course is null then
      insert into public.walkthrough_courses (title, description, audience, status, is_mandatory)
      values ('Test Room Learning Library', 'Trial-account and setup practice for test users only.', 'test_room', 'draft', false)
      returning id into test_course;
    else
      update public.walkthrough_courses
      set audience = 'test_room', description = 'Trial-account and setup practice for test users only.', is_mandatory = false
      where id = test_course;
    end if;
    delete from public.walkthrough_course_items where course_id = test_course;
    insert into public.walkthrough_course_items (course_id, course_version, video_id, video_version, position, required)
    values (test_course, 1, trial_video, trial_version, 0, true);
    update public.walkthrough_courses set status = 'published', is_mandatory = false where id = test_course;
  end if;
end $$;

update public.walkthrough_videos
set title = regexp_replace(title, '^\\s*[0-9]+\\s*(\\||[.):\\-])\\s*', ''),
    updated_at = timezone('utc'::text, now())
where title ~ '^\\s*[0-9]+\\s*(\\||[.):\\-])';

-- Keep the preview course's internal video IDs and position metadata stable,
-- but remove the trial case and make the full walkthrough its final module.
delete from public.walkthrough_course_items
where course_id = '4e6bdaf6-50b6-4f2f-9a61-5efb6e0d4c71'::uuid
  and video_id in (select id from public.walkthrough_videos where audience = 'test_room');
update public.walkthrough_course_items
set position = case
  when video_id = '623d49a5-3400-4d32-9a84-3a82b536841c'::uuid then 1
  when video_id = 'a25d3424-afdf-42a4-b8e3-ea8652c78e2e'::uuid then 2
  when video_id = '1a004bd9-a257-4fd5-a285-f72ddd501e78'::uuid then 3
  when video_id = '06216dc8-3420-49c3-a10c-dee8455a47db'::uuid then 4
  when video_id = '4580468f-2aec-4fff-9444-6a7ed50ddc9e'::uuid then 5
  else position
end,
required = true
where course_id = '4e6bdaf6-50b6-4f2f-9a61-5efb6e0d4c71'::uuid;
update public.walkthrough_videos
set title = 'Full start-to-finish sandbox case walkthrough',
    description = 'Practice the complete student workflow from case start through formative feedback in the fictional sandbox room.',
    updated_at = timezone('utc'::text, now())
where id = '4580468f-2aec-4fff-9444-6a7ed50ddc9e'::uuid;
