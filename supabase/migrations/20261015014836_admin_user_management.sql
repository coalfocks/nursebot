-- Superadmin-only audit trail for account and tenant-scope changes.
create table if not exists public.admin_user_audit (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  target_user_id uuid references auth.users(id) on delete set null,
  email text not null,
  action text not null check (action in ('invite', 'scope_update', 'disable', 'enable')),
  school_id uuid references public.schools(id) on delete set null,
  role text,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists idx_admin_user_audit_target on public.admin_user_audit(target_user_id, created_at desc);
create index if not exists idx_admin_user_audit_actor on public.admin_user_audit(actor_user_id, created_at desc);

alter table public.admin_user_audit enable row level security;

drop policy if exists "Super admins read admin user audit" on public.admin_user_audit;
create policy "Super admins read admin user audit"
on public.admin_user_audit
for select
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'super_admin'
  )
);

drop policy if exists "Service role writes admin user audit" on public.admin_user_audit;
create policy "Service role writes admin user audit"
on public.admin_user_audit
for insert
to service_role
with check (true);

comment on table public.admin_user_audit is
  'Immutable audit records for superadmin account invitation, scope, and disable/enable actions.';
