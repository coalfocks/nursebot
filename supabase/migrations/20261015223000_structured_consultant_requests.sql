-- Structured consultant requests keep the portal conversation, consult order,
-- and authored case behavior linked to one learner attempt.
create table if not exists public.consultant_requests (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.student_room_assignments(id) on delete cascade,
  patient_id uuid references public.patients(id) on delete set null,
  room_id bigint references public.rooms(id) on delete set null,
  specialty text not null,
  summary text not null,
  clinical_question text not null,
  reason text not null,
  urgency text not null check (urgency in ('routine', 'urgent', 'emergent')),
  client_request_id uuid not null,
  consult_order_id uuid references public.medical_orders(id) on delete set null,
  response text,
  disposition text not null default 'routine_review',
  status text not null default 'requested' check (status in ('requested', 'answered', 'assumes_care', 'failed')),
  created_at timestamptz not null default timezone('utc', now()),
  answered_at timestamptz
);

create unique index if not exists consultant_requests_assignment_client_key
  on public.consultant_requests(assignment_id, client_request_id);
create index if not exists consultant_requests_assignment_created_idx
  on public.consultant_requests(assignment_id, created_at);

alter table public.consultant_chat_messages
  add column if not exists request_id uuid references public.consultant_requests(id) on delete cascade,
  add column if not exists specialty text,
  add column if not exists urgency text,
  add column if not exists consult_order_id uuid references public.medical_orders(id) on delete set null;

create index if not exists consultant_chat_messages_request_idx
  on public.consultant_chat_messages(request_id, created_at);

alter table public.consultant_requests enable row level security;
drop policy if exists "consultant requests owner can read" on public.consultant_requests;
create policy "consultant requests owner can read" on public.consultant_requests for select using (
  exists (select 1 from public.student_room_assignments a where a.id = consultant_requests.assignment_id and a.student_id = auth.uid())
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
);

drop policy if exists "consultant requests owner can create" on public.consultant_requests;
create policy "consultant requests owner can create" on public.consultant_requests for insert with check (
  exists (select 1 from public.student_room_assignments a where a.id = consultant_requests.assignment_id and a.student_id = auth.uid())
);

comment on table public.consultant_requests is 'Structured learner consultant request and disposition for one assignment attempt.';
comment on column public.consultant_requests.client_request_id is 'Client idempotency key; retries cannot create a second consult request/order.';
