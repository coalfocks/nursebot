-- The existing course/course-item relationship is the normalized many-to-many
-- audience assignment. A video can appear once in each canonical course.
alter table public.walkthrough_courses
  add column if not exists organizer_key text;

create unique index if not exists walkthrough_courses_organizer_key_uidx
  on public.walkthrough_courses (organizer_key)
  where organizer_key is not null;

-- Stable organizer courses are additive. Existing courses and their items are
-- intentionally retained for compatibility with enrollment and completion data.
insert into public.walkthrough_courses
  (organizer_key, title, description, audience, status, is_mandatory)
values
  ('test_room', 'Test Room Accounts', 'Walkthroughs for Test Room accounts.', 'test_room', 'draft', false),
  ('admin', 'Administrators', 'Administrator walkthroughs.', 'admin', 'draft', false),
  ('student', 'Students', 'Student walkthroughs.', 'student', 'draft', false)
on conflict (organizer_key) where organizer_key is not null do nothing;

-- Keep canonical course audience values aligned with their stable role keys.
update public.walkthrough_courses set audience = organizer_key
where organizer_key in ('test_room', 'admin', 'student')
  and audience is distinct from organizer_key;

-- Backfill legacy video audience values into each matching course. The video
-- itself is never duplicated; a course item links to its existing ID/version.
with target_courses as (
  select id, version, organizer_key
  from public.walkthrough_courses
  where organizer_key in ('test_room', 'admin', 'student')
), eligible as (
  select video.id, video.version, course.id as course_id,
         course.version as course_version, course.organizer_key,
         row_number() over (
           partition by course.id
           order by video.topic, video.title, video.id
         ) - 1 + coalesce((
           select max(existing.position) + 1
           from public.walkthrough_course_items existing
           where existing.course_id = course.id and existing.course_version = course.version
         ), 0) as position
  from public.walkthrough_videos video
  join target_courses course on
    (course.organizer_key = 'admin' and video.audience in ('admin', 'both')) or
    (course.organizer_key = 'student' and video.audience in ('student', 'both')) or
    (course.organizer_key = 'test_room' and video.audience = 'test_room')
  where video.status = 'published'
)
insert into public.walkthrough_course_items
  (course_id, course_version, video_id, video_version, position, required)
select course_id, course_version, id, version, position,
       organizer_key <> 'student' or exists (
         select 1 from public.walkthrough_videos video
         where video.id = eligible.id and video.version = eligible.version
           and video.onboarding_eligible
       )
from eligible
on conflict (course_id, course_version, video_id) do nothing;

-- Only publish a canonical list when it already meets the same publication
-- checks enforced below. This avoids changing visibility for incomplete data.
update public.walkthrough_courses course
set status = 'published', updated_at = timezone('utc'::text, now())
where course.organizer_key in ('test_room', 'admin', 'student')
  and exists (
    select 1 from public.walkthrough_course_items item
    join public.walkthrough_videos video
      on video.id = item.video_id and video.version = item.video_version
    where item.course_id = course.id and item.course_version = course.version
      and video.status = 'published'
      and not public.walkthrough_transcript_has_unsafe_password_advice(video.transcript)
      and (course.organizer_key <> 'student' or not item.required or video.onboarding_eligible)
  )
  and not exists (
    select 1 from public.walkthrough_course_items item
    join public.walkthrough_videos video
      on video.id = item.video_id and video.version = item.video_version
    where item.course_id = course.id and item.course_version = course.version
      and (video.status <> 'published'
        or public.walkthrough_transcript_has_unsafe_password_advice(video.transcript)
        or (course.organizer_key = 'student' and item.required and not video.onboarding_eligible))
  );

create or replace function public.validate_walkthrough_course_publication()
returns trigger language plpgsql as $$
begin
  if new.status = 'published' then
    if not exists (
      select 1 from public.walkthrough_course_items item
      where item.course_id = new.id and item.course_version = new.version
    ) then
      raise exception 'walkthrough_course_requires_items: add at least one reviewed video before publishing';
    end if;
    if new.is_mandatory and not exists (
      select 1 from public.walkthrough_course_items item
      where item.course_id = new.id and item.course_version = new.version and item.required
    ) then
      raise exception 'walkthrough_course_requires_items: mandatory courses need at least one required video';
    end if;
    if exists (
      select 1
      from public.walkthrough_course_items item
      join public.walkthrough_videos video
        on video.id = item.video_id and video.version = item.video_version
      where item.course_id = new.id and item.course_version = new.version
        and (video.status <> 'published'
          or (new.audience = 'student' and item.required and not video.onboarding_eligible)
          or public.walkthrough_transcript_has_unsafe_password_advice(video.transcript))
    ) then
      raise exception 'walkthrough_course_invalid_item: every course item must be published and safe, and required student items must be onboarding eligible';
    end if;
  end if;
  return new;
end;
$$;

-- Atomically save an order and optionally publish it. Item membership is the
-- authoritative audience assignment; optional student references remain
-- available without becoming part of an onboarding gate.
create or replace function public.organize_walkthrough_course(
  p_course_id uuid,
  p_video_ids uuid[],
  p_publish boolean default true
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  target public.walkthrough_courses%rowtype;
  supplied_count integer;
  valid_count integer;
begin
  if not public.is_walkthrough_super_admin() then
    raise exception 'walkthrough_course_forbidden';
  end if;

  select * into target
  from public.walkthrough_courses
  where id = p_course_id and organizer_key in ('admin', 'student', 'test_room')
  for update;
  if not found then raise exception 'walkthrough_course_not_found'; end if;

  supplied_count := coalesce(cardinality(p_video_ids), 0);
  if (select count(distinct video_id) from unnest(coalesce(p_video_ids, '{}'::uuid[])) as ids(video_id)) <> supplied_count then
    raise exception 'walkthrough_course_duplicate_video';
  end if;
  select count(*) into valid_count
  from public.walkthrough_videos video
  where video.id = any(coalesce(p_video_ids, '{}'::uuid[]))
    and video.status = 'published'
    and not public.walkthrough_transcript_has_unsafe_password_advice(video.transcript);
  if valid_count <> supplied_count then
    raise exception 'walkthrough_course_invalid_item: select only published videos with reviewed safe transcripts';
  end if;

  update public.walkthrough_courses
  set status = 'draft', updated_at = timezone('utc'::text, now())
  where id = target.id and version = target.version;
  delete from public.walkthrough_course_items
  where course_id = target.id and course_version = target.version;

  insert into public.walkthrough_course_items
    (course_id, course_version, video_id, video_version, position, required)
  select target.id, target.version, video.id, video.version,
         ids.ordinality - 1,
         target.organizer_key <> 'student' or video.onboarding_eligible
  from unnest(coalesce(p_video_ids, '{}'::uuid[])) with ordinality as ids(video_id, ordinality)
  join public.walkthrough_videos video on video.id = ids.video_id;

  if p_publish then
    update public.walkthrough_courses
    set status = 'published', updated_at = timezone('utc'::text, now())
    where id = target.id and version = target.version;
  end if;
end;
$$;

revoke all on function public.organize_walkthrough_course(uuid, uuid[], boolean) from public;
grant execute on function public.organize_walkthrough_course(uuid, uuid[], boolean) to authenticated;

-- RLS grants access through a matching published course item. Test accounts
-- remain isolated from student content, and superadmins retain management.
drop policy if exists "published walkthrough videos readable by admins" on public.walkthrough_videos;
create policy "published walkthrough videos readable by admins" on public.walkthrough_videos
for select to authenticated using (
  public.is_walkthrough_super_admin() or (
    public.is_walkthrough_admin() and status = 'published' and exists (
      select 1 from public.walkthrough_course_items item
      join public.walkthrough_courses course
        on course.id = item.course_id and course.version = item.course_version
      where item.video_id = walkthrough_videos.id
        and item.video_version = walkthrough_videos.version
        and course.status = 'published' and course.audience in ('admin', 'both')
    )
  )
);

drop policy if exists "published walkthrough videos readable by students" on public.walkthrough_videos;
drop policy if exists "published walkthrough videos readable by test users" on public.walkthrough_videos;
create policy "published walkthrough videos readable by students" on public.walkthrough_videos
for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'student')
  and status = 'published' and exists (
    select 1 from public.walkthrough_course_items item
    join public.walkthrough_courses course
      on course.id = item.course_id and course.version = item.course_version
    where item.video_id = walkthrough_videos.id
      and item.video_version = walkthrough_videos.version
      and course.status = 'published' and course.audience in ('student', 'both')
  )
);
create policy "published walkthrough videos readable by test users" on public.walkthrough_videos
for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'test_user')
  and status = 'published' and exists (
    select 1 from public.walkthrough_course_items item
    join public.walkthrough_courses course
      on course.id = item.course_id and course.version = item.course_version
    where item.video_id = walkthrough_videos.id
      and item.video_version = walkthrough_videos.version
      and course.status = 'published' and course.audience = 'test_room'
  )
);

drop policy if exists "published walkthrough courses readable by admins" on public.walkthrough_courses;
create policy "published walkthrough courses readable by admins" on public.walkthrough_courses
for select to authenticated using (
  public.is_walkthrough_super_admin() or
  (public.is_walkthrough_admin() and status = 'published' and audience in ('admin', 'both'))
);
drop policy if exists "published walkthrough courses readable by students" on public.walkthrough_courses;
create policy "published walkthrough courses readable by students" on public.walkthrough_courses
for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'student')
  and status = 'published' and audience in ('student', 'both')
);
drop policy if exists "published walkthrough courses readable by test users" on public.walkthrough_courses;
create policy "published walkthrough courses readable by test users" on public.walkthrough_courses
for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'test_user')
  and status = 'published' and audience = 'test_room'
);

drop policy if exists "course items readable by admins" on public.walkthrough_course_items;
create policy "course items readable by admins" on public.walkthrough_course_items
for select to authenticated using (
  public.is_walkthrough_super_admin() or public.is_walkthrough_admin() or exists (
    select 1 from public.walkthrough_courses course
    join public.profiles viewer on viewer.id = (select auth.uid())
    where course.id = walkthrough_course_items.course_id
      and course.version = walkthrough_course_items.course_version
      and course.status = 'published'
      and ((viewer.role = 'student' and course.audience in ('student', 'both'))
        or (viewer.role = 'test_user' and course.audience = 'test_room'))
  )
);

drop policy if exists "admins read walkthrough media" on storage.objects;
drop policy if exists "role-scoped walkthrough media readable" on storage.objects;
create policy "role-scoped walkthrough media readable" on storage.objects
for select to authenticated using (
  bucket_id = 'walkthrough_videos' and (
    public.is_walkthrough_super_admin() or exists (
      select 1 from public.walkthrough_videos video
      join public.walkthrough_course_items item
        on item.video_id = video.id and item.video_version = video.version
      join public.walkthrough_courses course
        on course.id = item.course_id and course.version = item.course_version
      join public.profiles viewer on viewer.id = (select auth.uid())
      where video.video_path = name and video.status = 'published'
        and course.status = 'published'
        and ((viewer.role = 'school_admin' and course.audience in ('admin', 'both'))
          or (viewer.role = 'student' and course.audience in ('student', 'both'))
          or (viewer.role = 'test_user' and course.audience = 'test_room'))
    )
  )
);

comment on column public.walkthrough_videos.audience is 'Legacy audience retained for compatibility. Published course item membership is authoritative.';
comment on column public.walkthrough_courses.organizer_key is 'Stable role key for the three super-admin organizer courses.';
