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

-- The historical UNIQUE(scope, room_id, version) treats NULL room_id values as
-- distinct, so two global versions could race into the same version number.
-- Normalize the scope identity and enforce uniqueness at the database boundary.
alter table public.feedback_evaluator_configs
  add column if not exists scope_identity text generated always as (
    case when scope = 'global' then 'global' else 'room:' || room_id::text end
  ) stored;

do $$
begin
  if exists (
    select 1
    from public.feedback_evaluator_configs
    group by scope_identity, version
    having count(*) > 1
  ) then
    raise exception 'EVALUATOR_VERSION_COLLISION: resolve duplicate scope_identity/version rows before applying Feedback Studio migration';
  end if;
end;
$$;

create unique index if not exists feedback_evaluator_configs_scope_identity_version_key
  on public.feedback_evaluator_configs(scope_identity, version);

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
  scope_lock text;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin') then
    raise exception 'Only super administrators can activate evaluator versions';
  end if;
  select * into selected from public.feedback_evaluator_configs where id = p_config_id for update;
  if selected.id is null then raise exception 'Evaluator version not found'; end if;
  scope_lock := selected.scope_identity;
  perform pg_advisory_xact_lock(hashtextextended(scope_lock, 0));
  if selected.status = 'archived' then
    raise exception 'Cannot activate an archived evaluator version; create a new immutable draft';
  end if;
  if btrim(selected.evaluator_prompt) = '' then
    raise exception 'Evaluator prompt cannot be empty';
  end if;
  if jsonb_typeof(selected.scoring_anchors) <> 'object'
     or not (selected.scoring_anchors ?& array[
       'focused_information_gathering',
       'closed_loop_team_communication',
       'efficiency_deduction',
       'orders_monitoring_quality',
       'clinical_reasoning_documentation',
       'safety_deduction'
     ]) then
    raise exception 'Scoring anchors must contain the six canonical component keys';
  end if;
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

create or replace function public.create_feedback_evaluator_draft(
  p_scope text,
  p_room_id bigint,
  p_evaluator_prompt text,
  p_scoring_anchors jsonb
)
returns public.feedback_evaluator_configs
language plpgsql
security definer
set search_path = public
as $$
declare
  next_version integer;
  scope_key text;
  created public.feedback_evaluator_configs;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin') then
    raise exception 'Only super administrators can create evaluator versions';
  end if;
  if p_scope not in ('global', 'room') or (p_scope = 'global' and p_room_id is not null) or (p_scope = 'room' and p_room_id is null) then
    raise exception 'Invalid evaluator scope';
  end if;
  if btrim(coalesce(p_evaluator_prompt, '')) = '' then raise exception 'Evaluator prompt cannot be empty'; end if;
  if jsonb_typeof(coalesce(p_scoring_anchors, '{}'::jsonb)) <> 'object'
     or not (p_scoring_anchors ?& array[
       'focused_information_gathering', 'closed_loop_team_communication',
       'efficiency_deduction', 'orders_monitoring_quality',
       'clinical_reasoning_documentation', 'safety_deduction'
     ]) then
    raise exception 'Scoring anchors must contain the six canonical component keys';
  end if;
  scope_key := case when p_scope = 'global' then 'global' else 'room:' || p_room_id::text end;
  perform pg_advisory_xact_lock(hashtextextended(scope_key, 0));
  select coalesce(max(version), 0) + 1 into next_version
    from public.feedback_evaluator_configs where scope_identity = scope_key;
  insert into public.feedback_evaluator_configs(scope, room_id, version, status, evaluator_prompt, scoring_anchors, created_by)
    values (p_scope, p_room_id, next_version, 'draft', p_evaluator_prompt, p_scoring_anchors, auth.uid())
    returning * into created;
  return created;
end;
$$;

revoke all on function public.create_feedback_evaluator_draft(text, bigint, text, jsonb) from public;
grant execute on function public.create_feedback_evaluator_draft(text, bigint, text, jsonb) to authenticated;

revoke all on function public.activate_feedback_evaluator_config(uuid) from public;
grant execute on function public.activate_feedback_evaluator_config(uuid) to authenticated;

alter table public.feedback_assessment_runs
  add column if not exists evaluator_config_id uuid references public.feedback_evaluator_configs(id),
  add column if not exists evaluator_version integer;

comment on table public.feedback_evaluator_configs is 'Versioned global and room-specific evaluator prompt/anchor configuration; clinical case prompts remain in rooms.';
