-- Complete the published Test Room curriculum without touching clinical data.
-- This is intentionally idempotent and scoped to audience = test_room.
do $$
declare
  test_course_id uuid;
  test_course_version integer;
begin
  select id, version
    into test_course_id, test_course_version
  from public.walkthrough_courses
  where audience = 'test_room' or title = 'Test Room Learning Library'
  order by (audience = 'test_room') desc, updated_at desc nulls last
  limit 1;

  if test_course_id is null then
    insert into public.walkthrough_courses
      (title, description, audience, status, is_mandatory)
    values
      ('Test Room Learning Library',
       'A complete synthetic learner walkthrough for test accounts only.',
       'test_room', 'draft', false)
    returning id, version into test_course_id, test_course_version;
  else
    update public.walkthrough_courses
    set title = 'Test Room Learning Library',
        description = 'A complete synthetic learner walkthrough for test accounts only.',
        audience = 'test_room',
        status = 'draft',
        is_mandatory = false,
        updated_at = timezone('utc', now())
    where id = test_course_id and version = test_course_version;
  end if;

  with ranked as (
    select id,
           row_number() over (
             partition by regexp_replace(lower(trim(title)), '^[0-9]+[[:space:]]*[|][[:space:]]*', '')
             order by (audience = 'test_room') desc,
                      (status = 'published') desc,
                      updated_at desc nulls last,
                      id
           ) as rn
    from public.walkthrough_videos
  )
  update public.walkthrough_videos v
  set audience = 'test_room',
      onboarding_eligible = false,
      status = 'published',
      updated_at = timezone('utc', now())
  where v.id in (
    select id from ranked where rn = 1
  )
  and regexp_replace(lower(trim(v.title)), '^[0-9]+[[:space:]]*[|][[:space:]]*', '') in (
    'getting an account', 'starting a trial case',
    'opening an assigned student case', 'nurse and bedside conversations',
    'reviewing the emr and ordering a cbc',
    'completing a case and reviewing feedback',
    'full start-to-finish sandbox case walkthrough'
  );

  delete from public.walkthrough_course_items
  where course_id = test_course_id and course_version = test_course_version;

  insert into public.walkthrough_course_items
    (course_id, course_version, video_id, video_version, position, required)
  select test_course_id, test_course_version, v.id, v.version, x.position, true
  from (values
    ('getting an account', 0),
    ('starting a trial case', 1),
    ('opening an assigned student case', 2),
    ('nurse and bedside conversations', 3),
    ('reviewing the emr and ordering a cbc', 4),
    ('completing a case and reviewing feedback', 5),
    ('full start-to-finish sandbox case walkthrough', 6)
  ) as x(title, position)
  join lateral (
    select candidate.*
    from public.walkthrough_videos candidate
    where regexp_replace(lower(trim(candidate.title)), '^[0-9]+[[:space:]]*[|][[:space:]]*', '') = x.title
    order by (candidate.audience = 'test_room') desc,
             (candidate.status = 'published') desc,
             candidate.updated_at desc nulls last,
             candidate.id
    limit 1
  ) v on true;

  if (select count(*) from public.walkthrough_course_items
      where course_id = test_course_id and course_version = test_course_version) < 7 then
    raise exception 'test_room_learning_library_missing_walkthrough_video';
  end if;

  update public.walkthrough_courses
  set status = 'published', is_mandatory = false,
      updated_at = timezone('utc', now())
  where id = test_course_id and version = test_course_version;
end $$;
