alter table public.patient_chat_messages
  add column if not exists reply_to_client_message_id uuid;

create unique index if not exists patient_chat_messages_assignment_reply_to_idx
  on public.patient_chat_messages(assignment_id, reply_to_client_message_id)
  where reply_to_client_message_id is not null;
