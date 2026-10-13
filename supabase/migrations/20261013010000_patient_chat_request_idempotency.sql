alter table public.patient_chat_messages
  add column if not exists client_message_id uuid;

create unique index if not exists patient_chat_messages_assignment_client_message_idx
  on public.patient_chat_messages(assignment_id, client_message_id)
  where client_message_id is not null;
