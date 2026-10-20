-- Consultant routing identity is additive. Existing rows remain readable as
-- legacy/unclassified; new writes must carry a canonical service and audience.
alter table public.consultant_requests
  add column if not exists service_id text,
  add column if not exists service_label text,
  add column if not exists audience text,
  add column if not exists message_text text;

alter table public.consultant_chat_messages
  add column if not exists service_id text,
  add column if not exists service_label text,
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

create index if not exists consultant_requests_assignment_service_idx
  on public.consultant_requests(assignment_id, audience, service_id, created_at);
create index if not exists consultant_chat_messages_assignment_service_idx
  on public.consultant_chat_messages(assignment_id, audience, service_id, created_at, id);

comment on column public.consultant_requests.service_id is 'Stable canonical consultant directory ID; null only for legacy rows.';
comment on column public.consultant_requests.audience is 'Routing audience: adult or pediatric; null only for legacy rows.';
comment on column public.consultant_chat_messages.service_id is 'Stable canonical consultant directory ID retained on both message roles.';
