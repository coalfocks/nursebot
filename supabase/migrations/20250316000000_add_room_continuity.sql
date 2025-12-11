-- Add continuity linkage between rooms
alter table public.rooms
add column if not exists continues_from integer references public.rooms(id) on delete set null;

create index if not exists rooms_continues_from_idx on public.rooms(continues_from);
