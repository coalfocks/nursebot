-- REVIEW ONLY / UNAPPLIED.
-- Faculty study results are deliberately isolated from learner assignments and grades.
create table if not exists public.faculty_study_batches (
  id uuid primary key default gen_random_uuid(),
  batch_key text not null unique,
  manifest jsonb not null,
  manifest_sha256 text not null,
  prompt_version text not null,
  prompt_sha256 text not null,
  model text not null,
  protocol_version text not null,
  generator_revision text not null,
  evaluator_config_revision text not null,
  attempt_attestations jsonb not null default '[]'::jsonb,
  status text not null default 'prepared' check (status in ('prepared', 'running', 'completed', 'failed')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  lease_token uuid,
  lease_expires_at timestamptz,
  completed_at timestamptz,
  error jsonb
);

create table if not exists public.faculty_study_results (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.faculty_study_batches(id) on delete cascade,
  batch_ordinal integer not null check (batch_ordinal between 1 and 30),
  assignment_id uuid not null,
  historical_snapshot jsonb not null,
  frozen_input jsonb,
  result jsonb,
  canonical_result jsonb,
  raw_model_response jsonb,
  error jsonb,
  lease_token uuid,
  generated_at timestamptz,
  prompt_version text not null,
  model text not null,
  created_at timestamptz not null default now(),
  unique (batch_id, batch_ordinal),
  unique (batch_id, assignment_id)
);

alter table public.faculty_study_batches
  add column if not exists next_batch_ordinal integer;
alter table public.faculty_study_batches
  add column if not exists lease_expires_at timestamptz;
alter table public.faculty_study_batches
  add column if not exists lease_token uuid;
alter table public.faculty_study_results
  add column if not exists lease_token uuid;

create or replace function public.write_faculty_study_result_owned(
  p_batch_id uuid,
  p_batch_ordinal integer,
  p_lease_token uuid,
  p_assignment_id uuid,
  p_historical_snapshot jsonb,
  p_frozen_input jsonb,
  p_result jsonb,
  p_canonical_result jsonb,
  p_raw_model_response jsonb,
  p_error jsonb,
  p_prompt_version text,
  p_model text,
  p_generated_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  locked_status text;
  locked_lease_token uuid;
begin
  -- Claims/reclaims update this same row. Holding its lock through the result
  -- write serializes a live worker with stale-run recovery: a paused worker
  -- blocks reclaim, while a worker that lost the committed lease gets false
  -- before it can touch the result row.
  select b.status, b.lease_token
    into locked_status, locked_lease_token
    from public.faculty_study_batches b
    where b.id = p_batch_id
    for update;

  if locked_status is distinct from 'running' or locked_lease_token is distinct from p_lease_token then
    return false;
  end if;

  insert into public.faculty_study_results (
    batch_id, batch_ordinal, assignment_id, historical_snapshot, frozen_input,
    result, canonical_result, raw_model_response, error, lease_token,
    prompt_version, model, generated_at
  )
  select
    p_batch_id, p_batch_ordinal, p_assignment_id, p_historical_snapshot, p_frozen_input,
    p_result, p_canonical_result, p_raw_model_response, p_error, p_lease_token,
    p_prompt_version, p_model, p_generated_at
  where true
  on conflict (batch_id, batch_ordinal) do update set
    assignment_id = excluded.assignment_id,
    historical_snapshot = excluded.historical_snapshot,
    frozen_input = excluded.frozen_input,
    result = excluded.result,
    canonical_result = excluded.canonical_result,
    raw_model_response = excluded.raw_model_response,
    error = excluded.error,
    lease_token = excluded.lease_token,
    prompt_version = excluded.prompt_version,
    model = excluded.model,
    generated_at = excluded.generated_at
  where true;

  return found;
end;
$$;

revoke all on function public.write_faculty_study_result_owned(uuid, integer, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.write_faculty_study_result_owned(uuid, integer, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, timestamptz) to service_role;

alter table public.faculty_study_batches enable row level security;
alter table public.faculty_study_results enable row level security;
revoke all on public.faculty_study_batches from anon, authenticated;
revoke all on public.faculty_study_results from anon, authenticated;

comment on table public.faculty_study_batches is 'Isolated, owner-reviewed faculty study manifests; never a learner or grading record.';
comment on table public.faculty_study_results is 'Deidentified study output and per-attempt errors; no assignment or grade writes.';
