-- Versioned student-library repair. This creates student-scoped video records
-- and a new optional course record. Existing Test Room rows, course items,
-- enrollments, progress, and mandatory status are never rewritten.
begin;

do $$
declare
  missing_count integer;
  old_item_count integer;
begin
  select count(*) into missing_count
  from (values
    ('8d70f650-bfad-40d8-b52e-bf39f549db62'::uuid),
    ('623d49a5-3400-4d32-9a84-3a82b536841c'::uuid),
    ('a25d3424-afdf-42a4-b8e3-ea8652c78e2e'::uuid),
    ('1a004bd9-a257-4fd5-a285-f72ddd501e78'::uuid),
    ('06216dc8-3420-49c3-a10c-dee8455a47db'::uuid),
    ('4580468f-2aec-4fff-9444-6a7ed50ddc9e'::uuid)
  ) source(id)
  where not exists (
    select 1 from public.walkthrough_videos video
    where video.id = source.id and video.version = 1
      and video.status = 'published' and video.audience = 'test_room'
      and video.processing_status = 'ready' and nullif(video.video_path, '') is not null
  );
  if missing_count <> 0 then
    raise exception 'STUDENT_LIBRARY_SOURCE_MEDIA_NOT_READY: % source rows missing', missing_count;
  end if;
  select count(*) into old_item_count
  from public.walkthrough_course_items
  where course_id = '4e6bdaf6-50b6-4f2f-9a61-5efb6e0d4c71'::uuid and course_version = 1;
  if old_item_count <> 6 then
    raise exception 'STUDENT_LIBRARY_SOURCE_COURSE_CHANGED: expected 6 old items, got %', old_item_count;
  end if;
end $$;

do $$
begin
  if exists (select 1 from public.walkthrough_videos where id in (
    'b7a4bb2d-4b01-4b01-8f7e-000000000001'::uuid,
    'b7a4bb2d-4b01-4b01-8f7e-000000000002'::uuid,
    'b7a4bb2d-4b01-4b01-8f7e-000000000003'::uuid,
    'b7a4bb2d-4b01-4b01-8f7e-000000000004'::uuid,
    'b7a4bb2d-4b01-4b01-8f7e-000000000005'::uuid,
    'b7a4bb2d-4b01-4b01-8f7e-000000000006'::uuid
  )) then raise exception 'STUDENT_LIBRARY_TARGET_ID_CONFLICT'; end if;
  if exists (select 1 from public.walkthrough_courses where id = 'b7a4bb2d-4b01-4b01-8f7e-000000001001'::uuid) then
    raise exception 'STUDENT_LIBRARY_COURSE_TARGET_ID_CONFLICT';
  end if;
end $$;

insert into public.walkthrough_videos (
  id, version, title, description, learning_objective, topic, audience,
  onboarding_eligible, thumbnail_path, video_path, duration_seconds,
  captions_path, transcript, status, processing_status, created_by
)
select repair.new_id, 1, source.title, source.description, source.learning_objective,
  source.topic, 'student', true, source.thumbnail_path, source.video_path,
  source.duration_seconds, source.captions_path, source.transcript,
  'published', source.processing_status, source.created_by
from (values
  ('8d70f650-bfad-40d8-b52e-bf39f549db62'::uuid, 'b7a4bb2d-4b01-4b01-8f7e-000000000001'::uuid),
  ('623d49a5-3400-4d32-9a84-3a82b536841c'::uuid, 'b7a4bb2d-4b01-4b01-8f7e-000000000002'::uuid),
  ('a25d3424-afdf-42a4-b8e3-ea8652c78e2e'::uuid, 'b7a4bb2d-4b01-4b01-8f7e-000000000003'::uuid),
  ('1a004bd9-a257-4fd5-a285-f72ddd501e78'::uuid, 'b7a4bb2d-4b01-4b01-8f7e-000000000004'::uuid),
  ('06216dc8-3420-49c3-a10c-dee8455a47db'::uuid, 'b7a4bb2d-4b01-4b01-8f7e-000000000005'::uuid),
  ('4580468f-2aec-4fff-9444-6a7ed50ddc9e'::uuid, 'b7a4bb2d-4b01-4b01-8f7e-000000000006'::uuid)
) repair(source_id, new_id)
join public.walkthrough_videos source on source.id = repair.source_id and source.version = 1;

insert into public.walkthrough_courses
  (id, version, title, description, audience, status, is_mandatory, created_by)
select 'b7a4bb2d-4b01-4b01-8f7e-000000001001'::uuid, 1,
  source.title || ' — student media', source.description, 'student', 'draft', false, source.created_by
from public.walkthrough_courses source
where source.id = '4e6bdaf6-50b6-4f2f-9a61-5efb6e0d4c71'::uuid and source.version = 1
  and source.status = 'published' and source.is_mandatory = false;

insert into public.walkthrough_course_items
  (course_id, course_version, video_id, video_version, position, required)
select 'b7a4bb2d-4b01-4b01-8f7e-000000001001'::uuid, 1, repair.new_id, 1,
  old_item.position, old_item.required
from public.walkthrough_course_items old_item
join (values
  ('8d70f650-bfad-40d8-b52e-bf39f549db62'::uuid, 'b7a4bb2d-4b01-4b01-8f7e-000000000001'::uuid),
  ('623d49a5-3400-4d32-9a84-3a82b536841c'::uuid, 'b7a4bb2d-4b01-4b01-8f7e-000000000002'::uuid),
  ('a25d3424-afdf-42a4-b8e3-ea8652c78e2e'::uuid, 'b7a4bb2d-4b01-4b01-8f7e-000000000003'::uuid),
  ('1a004bd9-a257-4fd5-a285-f72ddd501e78'::uuid, 'b7a4bb2d-4b01-4b01-8f7e-000000000004'::uuid),
  ('06216dc8-3420-49c3-a10c-dee8455a47db'::uuid, 'b7a4bb2d-4b01-4b01-8f7e-000000000005'::uuid),
  ('4580468f-2aec-4fff-9444-6a7ed50ddc9e'::uuid, 'b7a4bb2d-4b01-4b01-8f7e-000000000006'::uuid)
) repair(source_id, new_id) on repair.source_id = old_item.video_id
where old_item.course_id = '4e6bdaf6-50b6-4f2f-9a61-5efb6e0d4c71'::uuid
  and old_item.course_version = 1;

update public.walkthrough_courses
set status = 'published', updated_at = timezone('utc', now())
where id = 'b7a4bb2d-4b01-4b01-8f7e-000000001001'::uuid and version = 1;

do $$
declare
  new_item_count integer;
  old_item_count integer;
begin
  select count(*) into new_item_count from public.walkthrough_course_items
    where course_id = 'b7a4bb2d-4b01-4b01-8f7e-000000001001'::uuid and course_version = 1;
  select count(*) into old_item_count from public.walkthrough_course_items
    where course_id = '4e6bdaf6-50b6-4f2f-9a61-5efb6e0d4c71'::uuid and course_version = 1;
  if new_item_count <> 6 or old_item_count <> 6 then
    raise exception 'STUDENT_LIBRARY_ATOMIC_REPAIR_COUNT_FAILED: new %, old %', new_item_count, old_item_count;
  end if;
end $$;

commit;
