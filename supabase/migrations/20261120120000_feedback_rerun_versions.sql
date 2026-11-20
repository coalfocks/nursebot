-- Versioned feedback reruns for admin comparison. NOT APPLIED: reviewed with the PR, applied at deploy.
-- A rerun never touches student_room_assignments or feedback_assessment_runs. It is stored here as a NEW
-- version next to the original. Promoting a version to the official result is a separate confirmed action
-- (promote-feedback-rerun edge function) that first records what it replaced in promotion_backup.
-- Rollback: see the DOWN block at the bottom (safe while nothing has been promoted; promoted rows hold the
-- prior official result in promotion_backup).

create table if not exists public.feedback_rerun_versions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.student_room_assignments(id) on delete cascade,
  school_id uuid,
  requested_by uuid references auth.users(id) on delete set null,
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  technical_incomplete boolean not null default false,
  result jsonb,
  provenance jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  promoted_at timestamptz,
  promoted_by uuid references auth.users(id) on delete set null,
  promotion_backup jsonb
);

create index if not exists feedback_rerun_versions_assignment_idx
  on public.feedback_rerun_versions (assignment_id, created_at desc);

alter table public.feedback_rerun_versions enable row level security;

-- Admin read only. Learners never see compare-only versions. All writes go through edge functions (service role).
drop policy if exists "Admins can read school feedback rerun versions" on public.feedback_rerun_versions;
create policy "Admins can read school feedback rerun versions"
  on public.feedback_rerun_versions for select to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.role = 'super_admin' or (p.role = 'school_admin' and p.school_id = feedback_rerun_versions.school_id))
  ));

revoke insert, update, delete on public.feedback_rerun_versions from anon, authenticated;

comment on table public.feedback_rerun_versions is
  'Compare-only feedback reruns stored beside (never over) the saved grade. promoted_at is set only by the explicit promote action.';

-- DOWN (manual): drop table if exists public.feedback_rerun_versions;
