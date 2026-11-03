alter table public.medical_orders
  add column if not exists lab_generation_status text not null default 'not_started',
  add column if not exists lab_generation_error text,
  add column if not exists lab_generation_attempted_at timestamptz;

alter table public.medical_orders
  add constraint medical_orders_lab_generation_status_check
  check (lab_generation_status in ('not_started', 'generating', 'completed', 'failed'));

alter table public.lab_results
  add column if not exists source_order_id uuid references public.medical_orders(id) on delete set null;

create unique index if not exists lab_results_source_order_test_unique
  on public.lab_results (source_order_id, test_name)
  where source_order_id is not null and deleted_at is null;
