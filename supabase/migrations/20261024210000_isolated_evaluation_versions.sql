-- REVIEW ONLY / UNAPPLIED.
-- Persistent per-attempt NEW-FORMAT evaluations. This is separate from learner
-- feedback, grades, assignments, and the existing frozen-30 study tables.
create table if not exists public.faculty_evaluation_versions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null,
  version integer not null check (version > 0),
  idempotency_key text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'error', 'blocked')),
  input_snapshot jsonb not null,
  frozen_input jsonb,
  result jsonb,
  canonical_result jsonb,
  raw_model_response jsonb,
  artifacts jsonb,
  prompt_version text not null,
  prompt_sha256 text not null,
  evaluator_spec_version text not null,
  evaluator_spec_hash text not null,
  evaluator_config_revision text not null,
  model text not null,
  generator_revision text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  lease_token uuid,
  lease_expires_at timestamptz,
  error jsonb,
  unique (assignment_id, version),
  unique (assignment_id, idempotency_key)
);

create unique index if not exists faculty_evaluation_versions_one_active
  on public.faculty_evaluation_versions (assignment_id)
  where status in ('queued', 'running');

create or replace function public.queue_faculty_evaluation_version(
  p_assignment_id uuid,
  p_idempotency_key text,
  p_created_by uuid,
  p_input_snapshot jsonb,
  p_frozen_input jsonb,
  p_prompt_version text,
  p_prompt_sha256 text,
  p_evaluator_spec_version text,
  p_evaluator_spec_hash text,
  p_evaluator_config_revision text,
  p_model text,
  p_generator_revision text,
  p_status text default 'queued',
  p_error jsonb default null
) returns public.faculty_evaluation_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.faculty_evaluation_versions;
  queued public.faculty_evaluation_versions;
  next_version integer;
begin
  perform 1 from public.student_room_assignments where id = p_assignment_id for update;
  if not found then raise exception 'ASSIGNMENT_NOT_FOUND'; end if;

  select * into existing
    from public.faculty_evaluation_versions
    where assignment_id = p_assignment_id and idempotency_key = p_idempotency_key;
  if found then return existing; end if;

  select * into queued
    from public.faculty_evaluation_versions
    where assignment_id = p_assignment_id and status in ('queued', 'running')
    order by version desc limit 1;
  if found then return queued; end if;

  select coalesce(max(version), 0) + 1 into next_version
    from public.faculty_evaluation_versions
    where assignment_id = p_assignment_id;

  insert into public.faculty_evaluation_versions (
    assignment_id, version, idempotency_key, status, input_snapshot, frozen_input,
    prompt_version, prompt_sha256, evaluator_spec_version, evaluator_spec_hash,
    evaluator_config_revision, model, generator_revision, created_by, error
  ) values (
    p_assignment_id, next_version, p_idempotency_key, p_status, p_input_snapshot, p_frozen_input,
    p_prompt_version, p_prompt_sha256, p_evaluator_spec_version, p_evaluator_spec_hash,
    p_evaluator_config_revision, p_model, p_generator_revision, p_created_by, p_error
  ) returning * into existing;
  return existing;
end;
$$;

revoke all on function public.queue_faculty_evaluation_version(uuid, text, uuid, jsonb, jsonb, text, text, text, text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.queue_faculty_evaluation_version(uuid, text, uuid, jsonb, jsonb, text, text, text, text, text, text, text, text, jsonb) to service_role;

alter table public.faculty_evaluation_versions enable row level security;
revoke all on public.faculty_evaluation_versions from anon, authenticated;

comment on table public.faculty_evaluation_versions is 'Isolated versioned faculty NEW-FORMAT evaluations; never a learner feedback or grading record.';
