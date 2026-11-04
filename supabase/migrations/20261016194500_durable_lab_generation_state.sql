-- Durable, retryable generation state for assignment-scoped lab orders.
-- This migration does not alter existing result rows or rewrite historical QA data.
alter table public.medical_orders
  add column if not exists lab_generation_status text not null default 'not_requested',
  add column if not exists lab_generation_request_id text,
  add column if not exists lab_generation_error text,
  add column if not exists lab_generation_attempts integer not null default 0,
  add column if not exists lab_generation_updated_at timestamptz;

alter table public.medical_orders
  drop constraint if exists medical_orders_lab_generation_status_check;

alter table public.medical_orders
  add constraint medical_orders_lab_generation_status_check
  check (lab_generation_status in ('not_requested', 'generating', 'succeeded', 'failed'));

alter table public.lab_results
  add column if not exists order_id uuid references public.medical_orders(id) on delete set null;

create index if not exists medical_orders_lab_generation_request_idx
  on public.medical_orders (lab_generation_request_id)
  where lab_generation_request_id is not null;

create unique index if not exists lab_results_order_test_active_idx
  on public.lab_results (order_id, test_name)
  where order_id is not null and deleted_at is null;

comment on column public.medical_orders.lab_generation_status is
  'Durable assignment lab generation state. Failed means retry the existing order; never place another order.';
comment on column public.medical_orders.lab_generation_request_id is
  'Stable client request identity for retries of this order.';
comment on column public.lab_results.order_id is
  'The medical order that produced this result; null is retained for legacy/unlinked results.';
