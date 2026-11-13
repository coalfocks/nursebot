-- Allow the existing superadmin audit trail to record school creation.
alter table public.admin_user_audit
  drop constraint if exists admin_user_audit_action_check;

alter table public.admin_user_audit
  add constraint admin_user_audit_action_check
  check (action in ('invite', 'scope_update', 'disable', 'enable', 'create_school'));

comment on table public.admin_user_audit is
  'Immutable audit records for superadmin school creation, account invitation, scope, and disable/enable actions.';
