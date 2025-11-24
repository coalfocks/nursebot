-- Add configuration for EMR orders/labs on rooms
alter table public.rooms
  add column if not exists orders_config jsonb;
