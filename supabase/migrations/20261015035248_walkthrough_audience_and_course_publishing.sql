alter table public.walkthrough_videos
  add column if not exists audience text not null default 'admin';

alter table public.walkthrough_videos
  drop constraint if exists walkthrough_videos_audience_check;

alter table public.walkthrough_videos
  add constraint walkthrough_videos_audience_check
  check (audience in ('admin', 'student', 'both'));

create or replace function public.is_walkthrough_student()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('student', 'test_user')
  );
$$;

create or replace function public.walkthrough_transcript_has_unsafe_password_advice(value text)
returns boolean
language sql
immutable
as $$
  select coalesce(value, '') ~* '(same[[:space:]]+(initial|default|shared)[[:space:]]+password|shared[[:space:]]+password|all[[:space:]]+students|password[[:space:]]+for[[:space:]]+all[[:space:]]+students|one[[:space:]]+password[[:space:]]+for[[:space:]]+everyone)';
$$;

create or replace function public.validate_walkthrough_video_publication()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'published' and public.walkthrough_transcript_has_unsafe_password_advice(new.transcript) then
    raise exception 'walkthrough_video_unsafe_password_advice: remove shared-password instructions before publishing';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_walkthrough_video_publication on public.walkthrough_videos;
create trigger validate_walkthrough_video_publication
before insert or update of status, transcript on public.walkthrough_videos
for each row execute function public.validate_walkthrough_video_publication();

create or replace function public.validate_walkthrough_course_publication()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'published' then
    if not exists (
      select 1 from public.walkthrough_course_items item
      where item.course_id = new.id and item.course_version = new.version
    ) then
      raise exception 'walkthrough_course_requires_items: add at least one reviewed video before publishing';
    end if;
    if exists (
      select 1
      from public.walkthrough_course_items item
      join public.walkthrough_videos video on video.id = item.video_id and video.version = item.video_version
      where item.course_id = new.id and item.course_version = new.version
        and (video.status <> 'published' or video.audience not in ('admin', 'both')
          or public.walkthrough_transcript_has_unsafe_password_advice(video.transcript))
    ) then
      raise exception 'walkthrough_course_invalid_item: every course item must be a published, safe administrator video';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists validate_walkthrough_course_publication on public.walkthrough_courses;
create trigger validate_walkthrough_course_publication
before insert or update of status on public.walkthrough_courses
for each row execute function public.validate_walkthrough_course_publication();

drop policy if exists "published walkthrough videos readable by admins" on public.walkthrough_videos;
create policy "published walkthrough videos readable by admins" on public.walkthrough_videos
for select using (
  public.is_walkthrough_admin() and (status = 'published' or public.is_walkthrough_super_admin())
  and (audience in ('admin', 'both') or public.is_walkthrough_super_admin())
);

drop policy if exists "published walkthrough videos readable by students" on public.walkthrough_videos;
create policy "published walkthrough videos readable by students" on public.walkthrough_videos
for select using (public.is_walkthrough_student() and status = 'published' and audience in ('student', 'both'));

drop policy if exists "admins read walkthrough media" on storage.objects;
create policy "admins read walkthrough media" on storage.objects
for select using (
  bucket_id = 'walkthrough_videos' and (
    public.is_walkthrough_super_admin()
    or exists (
      select 1 from public.walkthrough_videos video
      where video.video_path = name and video.status = 'published'
        and ((public.is_walkthrough_admin() and video.audience in ('admin', 'both'))
          or (public.is_walkthrough_student() and video.audience in ('student', 'both')))
    )
  )
);

comment on column public.walkthrough_videos.audience is 'Published audience: admin, student, or both. RLS enforces visibility.';
