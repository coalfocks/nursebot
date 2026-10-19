-- Focused integrity repairs for disposable/live QA findings.
-- Existing rows are preserved; the new fields make new consultant pairs
-- deterministic and make failed result generation recoverable on the same order.

alter table public.consultant_chat_messages
  add column if not exists message_sequence smallint,
  add column if not exists request_receipt_at timestamptz;

update public.consultant_chat_messages
set message_sequence = case when role = 'student' then 1 when role = 'consultant' then 2 end
where request_id is not null and message_sequence is null;

update public.consultant_chat_messages m
set request_receipt_at = r.created_at
from public.consultant_requests r
where m.request_id = r.id
  and m.request_id is not null
  and m.request_receipt_at is null;

create unique index if not exists consultant_chat_messages_request_sequence_key
  on public.consultant_chat_messages(request_id, message_sequence)
  where request_id is not null and message_sequence is not null;

alter table public.medical_orders
  add column if not exists result_failure_reason text,
  add column if not exists result_attempt_key uuid,
  add column if not exists result_generation_status text not null default 'not_started';

alter table public.medical_orders
  drop constraint if exists medical_orders_result_generation_status_check;
alter table public.medical_orders
  add constraint medical_orders_result_generation_status_check
  check (result_generation_status in ('not_started', 'generating', 'failed', 'completed'));

comment on column public.medical_orders.result_failure_reason is
  'Durable, redacted reason the result generator rejected or failed for this order; retry uses the same order.';
comment on column public.medical_orders.result_attempt_key is
  'Stable result-generation attempt identity; retries do not create a second order.';
