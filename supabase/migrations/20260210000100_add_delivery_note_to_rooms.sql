alter table public.rooms
  add column if not exists delivery_note text;

comment on column public.rooms.delivery_note is 'Optional delivery note content for OBGYN continuation cases.';
