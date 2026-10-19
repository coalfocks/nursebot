-- Additive evaluator authoring. This does not alter existing room prompts,
-- attempts, scores, or feedback rows.
create table if not exists public.feedback_evaluator_configs (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('global', 'room')),
  room_id bigint references public.rooms(id) on delete cascade,
  version integer not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  evaluator_prompt text not null default '',
  scoring_anchors jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint feedback_evaluator_scope_room_ck check ((scope = 'global' and room_id is null) or (scope = 'room' and room_id is not null)),
  unique (scope, room_id, version)
);

create index if not exists feedback_evaluator_configs_lookup_idx
  on public.feedback_evaluator_configs(scope, room_id, status, version desc);

alter table public.feedback_evaluator_configs enable row level security;

drop policy if exists "Admins can read evaluator configs" on public.feedback_evaluator_configs;
create policy "Admins can read evaluator configs"
  on public.feedback_evaluator_configs for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('super_admin', 'school_admin')));

drop policy if exists "Super admins can create evaluator configs" on public.feedback_evaluator_configs;
create policy "Super admins can create evaluator configs"
  on public.feedback_evaluator_configs for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin'));

drop policy if exists "Super admins can update evaluator configs" on public.feedback_evaluator_configs;
create policy "Super admins can update evaluator configs"
  on public.feedback_evaluator_configs for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin'));

create or replace function public.activate_feedback_evaluator_config(p_config_id uuid)
returns public.feedback_evaluator_configs
language plpgsql
security definer
set search_path = public
as $$
declare
  selected public.feedback_evaluator_configs;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin') then
    raise exception 'Only super administrators can activate evaluator versions';
  end if;
  select * into selected from public.feedback_evaluator_configs where id = p_config_id for update;
  if selected.id is null then raise exception 'Evaluator version not found'; end if;
  update public.feedback_evaluator_configs
    set status = 'archived', updated_at = now()
    where scope = selected.scope and room_id is not distinct from selected.room_id and status = 'active';
  update public.feedback_evaluator_configs
    set status = 'active', updated_at = now()
    where id = p_config_id
    returning * into selected;
  return selected;
end;
$$;

revoke all on function public.activate_feedback_evaluator_config(uuid) from public;
grant execute on function public.activate_feedback_evaluator_config(uuid) to authenticated;

alter table public.feedback_assessment_runs
  add column if not exists evaluator_config_id uuid references public.feedback_evaluator_configs(id),
  add column if not exists evaluator_version integer;

comment on table public.feedback_evaluator_configs is 'Versioned global and room-specific evaluator prompt/anchor configuration; clinical case prompts remain in rooms.';
