-- Make the already-authored Test Room walkthrough visible to test_user accounts.
-- This is learning-library content only; it does not create or alter clinical
-- cases, rooms, patients, assignments, or learner records.
do $$
declare
  selected_video record;
  test_course_id uuid;
  test_course_version integer;
begin
  select id, version, status, processing_status
    into selected_video
  from public.walkthrough_videos
  where id = 'ef3cf2ec-2091-4db7-86ac-5910aaced43c'::uuid
     or lower(title) like '%trial%'
     or lower(learning_objective) like '%trial%'
  order by (id = 'ef3cf2ec-2091-4db7-86ac-5910aaced43c'::uuid) desc,
           updated_at desc nulls last
  limit 1;

  if selected_video.id is null then
    raise exception 'test_room_library_requires_existing_trial_video';
  end if;

  update public.walkthrough_videos
  set audience = 'test_room',
      onboarding_eligible = false,
      status = 'published',
      updated_at = timezone('utc', now())
  where id = selected_video.id and version = selected_video.version;

  select id, version
    into test_course_id, test_course_version
  from public.walkthrough_courses
  where audience = 'test_room'
     or title = 'Test Room Learning Library'
  order by (audience = 'test_room') desc, updated_at desc nulls last
  limit 1;

  if test_course_id is null then
    insert into public.walkthrough_courses
      (title, description, audience, status, is_mandatory)
    values
      ('Test Room Learning Library',
       'Trial-account setup and starting a practice case for test users only.',
       'test_room', 'draft', false)
    returning id, version into test_course_id, test_course_version;
  else
    update public.walkthrough_courses
    set title = 'Test Room Learning Library',
        description = 'Trial-account setup and starting a practice case for test users only.',
        audience = 'test_room',
        is_mandatory = false,
        status = 'draft',
        updated_at = timezone('utc', now())
    where id = test_course_id and version = test_course_version;
  end if;

  delete from public.walkthrough_course_items
  where course_id = test_course_id and course_version = test_course_version;

  insert into public.walkthrough_course_items
    (course_id, course_version, video_id, video_version, position, required)
  values
    (test_course_id, test_course_version, selected_video.id,
     selected_video.version, 0, true);

  update public.walkthrough_courses
  set status = 'published', is_mandatory = false,
      updated_at = timezone('utc', now())
  where id = test_course_id and version = test_course_version;
end $$;

comment on table public.walkthrough_courses is
  'Versioned admin, student, or Test Room learning courses. Test Room courses are visible only to test_user accounts.';
