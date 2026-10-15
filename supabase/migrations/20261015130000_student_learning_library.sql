alter table public.walkthrough_videos
  add column if not exists learning_objective text not null default '',
  add column if not exists onboarding_eligible boolean not null default true;

alter table public.walkthrough_courses
  add column if not exists audience text not null default 'admin';

alter table public.walkthrough_courses
  drop constraint if exists walkthrough_courses_audience_check;

alter table public.walkthrough_courses
  add constraint walkthrough_courses_audience_check
  check (audience in ('admin', 'student', 'both'));

alter table public.walkthrough_progress
  add column if not exists completion_method text not null default 'acknowledgment';

alter table public.walkthrough_progress
  drop constraint if exists walkthrough_progress_completion_method_check;

alter table public.walkthrough_progress
  add constraint walkthrough_progress_completion_method_check
  check (completion_method in ('acknowledgment', 'ended'));

create or replace function public.can_view_walkthrough_user(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_user_id = auth.uid()
    or public.is_walkthrough_super_admin()
    or exists (
      select 1
      from public.profiles viewer
      join public.profiles target on target.id = target_user_id
      where viewer.id = auth.uid()
        and viewer.role = 'school_admin'
        and viewer.school_id is not null
        and viewer.school_id = target.school_id
    );
$$;

drop policy if exists "published walkthrough courses readable by students" on public.walkthrough_courses;
create policy "published walkthrough courses readable by students" on public.walkthrough_courses
for select using (public.is_walkthrough_student() and status = 'published' and audience in ('student', 'both'));

drop policy if exists "course items readable by admins" on public.walkthrough_course_items;
create policy "course items readable by admins" on public.walkthrough_course_items
for select using (
  public.is_walkthrough_admin()
  or (public.is_walkthrough_student() and exists (
    select 1 from public.walkthrough_courses course
    where course.id = course_id and course.version = course_version
      and course.status = 'published' and course.audience in ('student', 'both')
  ))
);

drop policy if exists "admins read own walkthrough enrollment" on public.walkthrough_enrollments;
create policy "admins read own walkthrough enrollment" on public.walkthrough_enrollments
for select using (public.can_view_walkthrough_user(user_id));

drop policy if exists "admins manage own walkthrough enrollment" on public.walkthrough_enrollments;
create policy "learners manage own walkthrough enrollment" on public.walkthrough_enrollments
for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "admins read own walkthrough progress" on public.walkthrough_progress;
create policy "admins read walkthrough progress" on public.walkthrough_progress
for select using (public.can_view_walkthrough_user(user_id));

drop policy if exists "admins write own walkthrough progress" on public.walkthrough_progress;
create policy "learners write own walkthrough progress" on public.walkthrough_progress
for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.validate_walkthrough_course_publication()
returns trigger
language plpgsql
as $$
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
          or (new.audience in ('admin', 'both') and video.audience not in ('admin', 'both'))
          or (new.audience in ('student', 'both') and video.audience not in ('student', 'both'))
          or (new.audience in ('student', 'both') and not video.onboarding_eligible)
          or public.walkthrough_transcript_has_unsafe_password_advice(video.transcript)
        )
    ) then
      raise exception 'walkthrough_course_invalid_item: every course item must be published, audience-compatible, and safe';
    end if;
  end if;
  return new;
end;
$$;

comment on table public.walkthrough_courses is 'Versioned admin or student learning courses. Student mandatory courses gate assigned cases.';
comment on column public.walkthrough_videos.onboarding_eligible is 'If false, the video remains available as optional reference but cannot be required in student onboarding.';
