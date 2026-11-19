-- Historical baseline for an assignment: the patient's medications and active orders as
-- they were when the case started. Written once at activation by the server, never edited.
-- Attempts activated before this table existed have no row, and the feedback packet must
-- report their baseline as unavailable. Never fill a missing snapshot from the current chart.
create table if not exists public.assignment_baseline_snapshots (
  assignment_id uuid primary key references public.student_room_assignments(id) on delete cascade,
  room_id bigint references public.rooms(id) on delete set null,
  captured_at timestamptz not null default now(),
  baseline_version text not null,
  source text not null check (source in ('activation', 'backfill_verified')),
  medications jsonb not null default '[]'::jsonb,
  active_orders jsonb not null default '[]'::jsonb,
  -- Confirmed absence is an explicit empty list with a captured_at; unknown values are never stored as [].
  constraint baseline_snapshot_lists_are_arrays check (jsonb_typeof(medications) = 'array' and jsonb_typeof(active_orders) = 'array')
);

comment on table public.assignment_baseline_snapshots is
  'Verified historical baseline (medications and active orders) for one assignment. Reference context only; not learner work.';

alter table public.assignment_baseline_snapshots enable row level security;

-- Writes are server-only (service role). Learners do not read or write baselines directly.
revoke all on public.assignment_baseline_snapshots from anon, authenticated;
grant select on public.assignment_baseline_snapshots to authenticated;

create policy "admins can read assignment baseline snapshots"
  on public.assignment_baseline_snapshots for select
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and (p.is_admin = true or p.role in ('school_admin', 'super_admin'))
  ));
