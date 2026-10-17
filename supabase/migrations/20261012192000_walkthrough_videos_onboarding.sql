create table if not exists public.walkthrough_videos (
  id uuid primary key default gen_random_uuid(),
  version integer not null default 1,
  title text not null,
  description text not null default '',
  topic text not null,
  thumbnail_path text,
  video_path text,
  duration_seconds integer,
  captions_path text,
  transcript text not null default '',
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  processing_status text not null default 'pending' check (processing_status in ('pending', 'processing', 'ready', 'failed')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique(id, version)
);

create table if not exists public.walkthrough_courses (
  id uuid primary key default gen_random_uuid(),
  version integer not null default 1,
  title text not null,
  description text not null default '',
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  is_mandatory boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique(id, version)
);

create table if not exists public.walkthrough_course_items (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.walkthrough_courses(id) on delete cascade,
  course_version integer not null,
  video_id uuid not null references public.walkthrough_videos(id) on delete restrict,
  video_version integer not null,
  position integer not null,
  required boolean not null default true,
  unique(course_id, course_version, position),
  unique(course_id, course_version, video_id)
);

create table if not exists public.walkthrough_enrollments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.walkthrough_courses(id) on delete restrict,
  course_version integer not null,
  completed_at timestamptz,
  last_video_id uuid,
  last_position_seconds numeric not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique(user_id, course_id, course_version)
);

create table if not exists public.walkthrough_progress (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.walkthrough_enrollments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  video_id uuid not null references public.walkthrough_videos(id) on delete restrict,
  video_version integer not null,
  position_seconds numeric not null default 0,
  watched_intervals jsonb not null default '[]'::jsonb,
  completed_at timestamptz,
  last_activity_at timestamptz not null default timezone('utc', now()),
  unique(enrollment_id, video_id, video_version)
);

create table if not exists public.walkthrough_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  enrollment_id uuid references public.walkthrough_enrollments(id) on delete cascade,
  reason text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists walkthrough_progress_user_idx on public.walkthrough_progress(user_id, last_activity_at desc);
create index if not exists walkthrough_enrollments_user_idx on public.walkthrough_enrollments(user_id, updated_at desc);

alter table public.walkthrough_videos enable row level security;
alter table public.walkthrough_courses enable row level security;
alter table public.walkthrough_course_items enable row level security;
alter table public.walkthrough_enrollments enable row level security;
alter table public.walkthrough_progress enable row level security;
alter table public.walkthrough_overrides enable row level security;

create or replace function public.is_walkthrough_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role in ('school_admin', 'super_admin'));
$$;
create or replace function public.is_walkthrough_super_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'super_admin');
$$;

drop policy if exists "published walkthrough videos readable by admins" on public.walkthrough_videos;
create policy "published walkthrough videos readable by admins" on public.walkthrough_videos for select using (public.is_walkthrough_admin() and (status = 'published' or public.is_walkthrough_super_admin()));
drop policy if exists "super admins manage walkthrough videos" on public.walkthrough_videos;
create policy "super admins manage walkthrough videos" on public.walkthrough_videos for all using (public.is_walkthrough_super_admin()) with check (public.is_walkthrough_super_admin());
drop policy if exists "published walkthrough courses readable by admins" on public.walkthrough_courses;
create policy "published walkthrough courses readable by admins" on public.walkthrough_courses for select using (public.is_walkthrough_admin() and (status = 'published' or public.is_walkthrough_super_admin()));
drop policy if exists "super admins manage walkthrough courses" on public.walkthrough_courses;
create policy "super admins manage walkthrough courses" on public.walkthrough_courses for all using (public.is_walkthrough_super_admin()) with check (public.is_walkthrough_super_admin());
drop policy if exists "course items readable by admins" on public.walkthrough_course_items;
create policy "course items readable by admins" on public.walkthrough_course_items for select using (public.is_walkthrough_admin());
drop policy if exists "super admins manage course items" on public.walkthrough_course_items;
create policy "super admins manage course items" on public.walkthrough_course_items for all using (public.is_walkthrough_super_admin()) with check (public.is_walkthrough_super_admin());
drop policy if exists "admins read own walkthrough enrollment" on public.walkthrough_enrollments;
create policy "admins read own walkthrough enrollment" on public.walkthrough_enrollments for select using (user_id = auth.uid() or public.is_walkthrough_super_admin());
drop policy if exists "admins manage own walkthrough enrollment" on public.walkthrough_enrollments;
create policy "admins manage own walkthrough enrollment" on public.walkthrough_enrollments for all using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_walkthrough_admin());
drop policy if exists "admins read own walkthrough progress" on public.walkthrough_progress;
create policy "admins read own walkthrough progress" on public.walkthrough_progress for select using (user_id = auth.uid() or public.is_walkthrough_super_admin());
drop policy if exists "admins write own walkthrough progress" on public.walkthrough_progress;
create policy "admins write own walkthrough progress" on public.walkthrough_progress for all using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_walkthrough_admin());
drop policy if exists "super admins manage walkthrough overrides" on public.walkthrough_overrides;
create policy "super admins manage walkthrough overrides" on public.walkthrough_overrides for all using (public.is_walkthrough_super_admin()) with check (public.is_walkthrough_super_admin());

insert into storage.buckets (id, name, public) values ('walkthrough_videos', 'walkthrough_videos', false) on conflict (id) do nothing;
drop policy if exists "super admins upload walkthrough media" on storage.objects;
create policy "super admins upload walkthrough media" on storage.objects for insert with check (bucket_id = 'walkthrough_videos' and public.is_walkthrough_super_admin());
drop policy if exists "admins read walkthrough media" on storage.objects;
create policy "admins read walkthrough media" on storage.objects for select using (bucket_id = 'walkthrough_videos' and public.is_walkthrough_admin());
