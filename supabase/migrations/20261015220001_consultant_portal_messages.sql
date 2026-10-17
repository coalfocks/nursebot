-- Consultant portal is a separate learner interaction channel. It must not be
-- mixed into nurse chat or official feedback message history.
create table if not exists public.consultant_chat_messages (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.student_room_assignments(id) on delete cascade,
  role text not null check (role in ('student', 'consultant')),
  content text not null check (length(trim(content)) > 0),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists consultant_chat_messages_assignment_created_idx
  on public.consultant_chat_messages(assignment_id, created_at);

alter table public.consultant_chat_messages enable row level security;

drop policy if exists "consultant chat owner can read" on public.consultant_chat_messages;
create policy "consultant chat owner can read"
  on public.consultant_chat_messages for select
  using (exists (
    select 1 from public.student_room_assignments a
    where a.id = consultant_chat_messages.assignment_id
      and a.student_id = auth.uid()
  ));

drop policy if exists "consultant chat owner can write" on public.consultant_chat_messages;
create policy "consultant chat owner can write"
  on public.consultant_chat_messages for insert
  with check (
    role = 'student' and exists (
      select 1 from public.student_room_assignments a
      where a.id = consultant_chat_messages.assignment_id
        and a.student_id = auth.uid()
    )
  );

drop policy if exists "admins can read consultant chat" on public.consultant_chat_messages;
create policy "admins can read consultant chat"
  on public.consultant_chat_messages for select
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_admin = true
  ));
