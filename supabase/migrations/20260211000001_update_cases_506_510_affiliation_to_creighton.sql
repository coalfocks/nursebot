with creighton as (
  select id
  from public.schools
  where lower(name) like '%creighton%'
  order by created_at asc
  limit 1
),
target_rooms as (
  select r.id
  from public.rooms r
  where r.room_number in ('506', '507', '508', '509', '510')
)
update public.rooms r
set school_id = c.id,
    available_school_ids = array[c.id]::uuid[]
from creighton c
where r.id in (select id from target_rooms);

with creighton as (
  select id
  from public.schools
  where lower(name) like '%creighton%'
  order by created_at asc
  limit 1
),
target_rooms as (
  select r.id
  from public.rooms r
  where r.room_number in ('506', '507', '508', '509', '510')
)
update public.patients p
set school_id = c.id
from creighton c
where p.room_id in (select id from target_rooms);

with creighton as (
  select id
  from public.schools
  where lower(name) like '%creighton%'
  order by created_at asc
  limit 1
),
target_rooms as (
  select r.id
  from public.rooms r
  where r.room_number in ('506', '507', '508', '509', '510')
)
update public.student_room_assignments a
set school_id = c.id
from creighton c
where a.room_id in (select id from target_rooms);
