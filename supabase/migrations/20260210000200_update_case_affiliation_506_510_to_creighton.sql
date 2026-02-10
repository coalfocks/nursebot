do $$
declare
  creighton_school_id uuid;
begin
  select id
  into creighton_school_id
  from public.schools
  where lower(name) like '%creighton%'
     or lower(slug) like '%creighton%'
  order by created_at
  limit 1;

  if creighton_school_id is null then
    raise notice 'Skipping affiliation update for cases 506-510: Creighton school not found.';
    return;
  end if;

  update public.rooms
  set school_id = creighton_school_id
  where room_number in ('506', '507', '508', '509', '510');

  update public.patients
  set school_id = creighton_school_id
  where room_id in (
    select id from public.rooms where room_number in ('506', '507', '508', '509', '510')
  );

  update public.student_room_assignments
  set school_id = creighton_school_id
  where room_id in (
    select id from public.rooms where room_number in ('506', '507', '508', '509', '510')
  );
end $$;
