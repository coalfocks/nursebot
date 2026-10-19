-- One-box consultant transport. Legacy structured columns remain readable for
-- existing requests, while new requests carry the learner's exact message.
alter table public.consultant_requests
  add column if not exists message text,
  add column if not exists audience text;

alter table public.consultant_requests
  alter column summary drop not null,
  alter column clinical_question drop not null,
  alter column reason drop not null;

alter table public.consultant_chat_messages
  add column if not exists audience text;

alter table public.consultant_requests
  drop constraint if exists consultant_requests_audience_check;
alter table public.consultant_requests
  add constraint consultant_requests_audience_check
  check (audience is null or audience in ('adult', 'pediatric'));

alter table public.consultant_chat_messages
  drop constraint if exists consultant_chat_messages_audience_check;
alter table public.consultant_chat_messages
  add constraint consultant_chat_messages_audience_check
  check (audience is null or audience in ('adult', 'pediatric'));
