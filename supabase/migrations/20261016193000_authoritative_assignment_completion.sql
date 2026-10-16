-- Explicit, auditable assignment completion.
-- Depends only on student_room_assignments, profiles, and existing auth.uid().
-- Does not delete or rewrite chat, orders, notes, labs, or feedback evidence.

alter table public.student_room_assignments
  add column if not exists completion_source text,
  add column if not exists completion_actor_id uuid references auth.users(id),
  add column if not exists completion_request_id uuid;

create table if not exists public.assignment_completion_audit (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.student_room_assignments(id) on delete cascade,
  request_id uuid not null,
  action text not null check (action in ('complete', 'restore_to_active')),
  actor_user_id uuid not null references auth.users(id),
  actor_role text not null,
  previous_status text,
  next_status text not null,
  completion_source text,
  created_at timestamptz not null default timezone('utc', now()),
  unique (assignment_id, request_id, action)
);

create index if not exists assignment_completion_audit_assignment_idx
  on public.assignment_completion_audit(assignment_id, created_at desc);

alter table public.assignment_completion_audit enable row level security;
drop policy if exists "Admins read completion audit" on public.assignment_completion_audit;
create policy "Admins read completion audit"
  on public.assignment_completion_audit for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and (p.is_admin = true or p.role in ('school_admin', 'super_admin'))));

drop policy if exists "Service role writes completion audit" on public.assignment_completion_audit;
create policy "Service role writes completion audit"
  on public.assignment_completion_audit for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create or replace function public.assignment_completion_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'completed' and coalesce(old.status, '') <> 'completed' then
    if current_setting('app.assignment_completion_transition', true) <> 'allowed'
      or new.completed_at is null
      or new.completion_source is null
      or new.completion_actor_id is null
      or new.completion_request_id is null then
      raise exception 'Assignment completion must use the authoritative completion transition';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists assignment_completion_guard_trigger on public.student_room_assignments;
create trigger assignment_completion_guard_trigger
  before update on public.student_room_assignments
  for each row execute function public.assignment_completion_guard();

create or replace function public.complete_student_room_assignment(
  p_assignment_id uuid,
  p_client_request_id uuid,
  p_completion_source text,
  p_progress_note text
)
returns public.student_room_assignments
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles%rowtype;
  current_assignment public.student_room_assignments%rowtype;
  result_assignment public.student_room_assignments%rowtype;
begin
  if p_completion_source <> 'voluntary_finish' then
    raise exception 'Unsupported completion source';
  end if;
  if nullif(trim(coalesce(p_progress_note, '')), '') is null then
    raise exception 'A progress note is required to complete an assignment';
  end if;

  select * into actor from public.profiles where id = auth.uid();
  if actor.id is null then raise exception 'Authenticated actor required'; end if;
  select * into current_assignment from public.student_room_assignments where id = p_assignment_id for update;
  if current_assignment.id is null then raise exception 'Assignment not found'; end if;
  if actor.id <> current_assignment.student_id and not (actor.is_admin = true or actor.role in ('school_admin', 'super_admin')) then
    raise exception 'Not authorized to complete this assignment';
  end if;
  if current_assignment.status = 'cancelled' then raise exception 'Cancelled assignments cannot be completed'; end if;

  if exists (select 1 from public.assignment_completion_audit where assignment_id = p_assignment_id and request_id = p_client_request_id and action = 'complete') then
    return current_assignment;
  end if;
  if current_assignment.status = 'completed' then
    raise exception 'Assignment is already completed';
  end if;

  perform set_config('app.assignment_completion_transition', 'allowed', true);
  update public.student_room_assignments
    set status = 'completed', feedback_status = 'pending', completed_at = timezone('utc', now()),
        student_progress_note = trim(p_progress_note), completion_source = p_completion_source,
        completion_actor_id = auth.uid(), completion_request_id = p_client_request_id,
        feedback_error = null, updated_at = timezone('utc', now())
    where id = p_assignment_id
    returning * into result_assignment;

  insert into public.assignment_completion_audit(assignment_id, request_id, action, actor_user_id, actor_role, previous_status, next_status, completion_source)
    values (p_assignment_id, p_client_request_id, 'complete', auth.uid(), coalesce(actor.role, 'unknown'), current_assignment.status, 'completed', p_completion_source);
  return result_assignment;
end;
$$;

create or replace function public.restore_invalid_completion_to_active(
  p_assignment_id uuid,
  p_client_request_id uuid
)
returns public.student_room_assignments
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles%rowtype;
  current_assignment public.student_room_assignments%rowtype;
  result_assignment public.student_room_assignments%rowtype;
begin
  select * into actor from public.profiles where id = auth.uid();
  if actor.id is null or not (actor.is_admin = true or actor.role in ('school_admin', 'super_admin')) then raise exception 'Administrator authorization required'; end if;
  select * into current_assignment from public.student_room_assignments where id = p_assignment_id for update;
  if current_assignment.id is null then raise exception 'Assignment not found'; end if;
  if not current_assignment.is_sandbox then raise exception 'Only synthetic assignments may be repaired by this action'; end if;
  if current_assignment.status <> 'completed' or (current_assignment.completed_at is not null and current_assignment.completion_source is not null and current_assignment.completion_actor_id is not null and current_assignment.completion_request_id is not null) then
    raise exception 'Assignment is not an invalid completion state';
  end if;
  if exists (select 1 from public.assignment_completion_audit where assignment_id = p_assignment_id and request_id = p_client_request_id and action = 'restore_to_active') then return current_assignment; end if;

  perform set_config('app.assignment_completion_transition', 'allowed', true);
  update public.student_room_assignments set status = 'in_progress', feedback_status = 'failed', feedback_error = 'Invalid completion restored to active by administrator; evidence preserved.', updated_at = timezone('utc', now()) where id = p_assignment_id returning * into result_assignment;
  insert into public.assignment_completion_audit(assignment_id, request_id, action, actor_user_id, actor_role, previous_status, next_status)
    values (p_assignment_id, p_client_request_id, 'restore_to_active', auth.uid(), coalesce(actor.role, 'unknown'), current_assignment.status, 'in_progress');
  return result_assignment;
end;
$$;

revoke all on function public.complete_student_room_assignment(uuid, uuid, text, text) from public;
grant execute on function public.complete_student_room_assignment(uuid, uuid, text, text) to authenticated;
revoke all on function public.restore_invalid_completion_to_active(uuid, uuid) from public;
grant execute on function public.restore_invalid_completion_to_active(uuid, uuid) to authenticated;
