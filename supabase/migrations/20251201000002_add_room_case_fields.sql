alter table public.rooms
  add column if not exists nurse_context text,
  add column if not exists emr_context text,
  add column if not exists case_goals text,
  add column if not exists progress_note text,
  add column if not exists completion_hint text,
  add column if not exists bedside_hint text;
