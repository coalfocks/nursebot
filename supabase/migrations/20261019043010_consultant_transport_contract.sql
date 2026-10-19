-- Consultant transport contract v2.
--
-- Preflight/dependency contract:
--   * this migration must be applied before the v2 consultant-chat function;
--   * the v2 function must report the same contract version before the portal
--     reads audience columns or sends a request;
--   * atomic persistence across request/order/messages remains a separate
--     dependency. The Edge Function keeps compensating cleanup until a
--     reviewed transaction/RPC is provided.
--
-- Rollback (before enabling the v2 portal, while no v2 rows exist):
--   drop index if exists public.medical_orders_active_consult_episode_key;
--   alter table public.consultant_requests alter column urgency set not null;
--   alter table public.consultant_requests drop column if exists payload_snapshot;
--   alter table public.consultant_requests drop column if exists payload_hash;
--   alter table public.medical_orders drop column if exists consult_audience;
--   alter table public.medical_orders drop column if exists consult_service;
--   drop function if exists public.consultant_transport_preflight();
-- Existing consultant request/message/order rows are preserved; do not delete
-- or backfill legacy transcripts as part of rollback.

alter table public.consultant_requests
  add column if not exists payload_snapshot jsonb,
  add column if not exists payload_hash text;

alter table public.medical_orders
  add column if not exists consult_audience text,
  add column if not exists consult_service text;

alter table public.consultant_requests
  alter column urgency drop not null;

do $$
begin
  alter table public.medical_orders
    add constraint medical_orders_consult_audience_check
    check (consult_audience is null or consult_audience in ('adult', 'pediatric'));
exception when duplicate_object then null;
end $$;

create unique index if not exists medical_orders_active_consult_episode_key
  on public.medical_orders (assignment_id, consult_audience, consult_service)
  where category = 'Consult'
    and override_scope = 'assignment'
    and status = 'Active'
    and deleted_at is null
    and assignment_id is not null
    and consult_audience is not null
    and consult_service is not null;

create index if not exists consultant_chat_messages_thread_idx
  on public.consultant_chat_messages (assignment_id, audience, specialty, created_at, id);

create or replace function public.consultant_transport_preflight()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'ready', true,
    'schemaVersion', 2,
    'functionVersion', 2,
    'atomicPersistence', 'separate_dependency'
  );
$$;

revoke all on function public.consultant_transport_preflight() from public;
grant execute on function public.consultant_transport_preflight() to authenticated;

comment on column public.consultant_requests.payload_snapshot is
  'Frozen v2 consultant payload. It is never replaced on a clientRequestId retry.';
comment on column public.consultant_requests.payload_hash is
  'SHA-256 of the canonical assignment/audience/service/exact-message payload.';
comment on column public.medical_orders.consult_audience is
  'Population key for a consultant episode; null on non-consult and legacy orders.';
comment on column public.medical_orders.consult_service is
  'Canonical consultant directory value for a consultant episode.';
