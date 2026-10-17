-- Serialize one patient-chat model call per logical learner message. The
-- service-role edge function is the only writer; RLS intentionally exposes no
-- rows to browser clients.
create table if not exists public.patient_chat_requests (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.student_room_assignments(id) on delete cascade,
  client_message_id uuid not null,
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed')),
  response_content text,
  response_role text check (response_role in ('patient', 'caregiver')),
  error_code text,
  lease_expires_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (assignment_id, client_message_id)
);

create index if not exists patient_chat_requests_lease_idx
  on public.patient_chat_requests(status, lease_expires_at);

alter table public.patient_chat_requests enable row level security;
