-- Versioned student-library repair. This creates student-scoped video records
-- pointing at already-reviewed media objects; it never changes Test Room rows,
-- completion rows, mandatory status, or learner progress.
do $$
declare
  missing_count integer;
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
      and video.status = 'published'
      and video.audience = 'test_room'
      and video.processing_status = 'ready'
      and nullif(video.video_path, '') is not null
  );
  if missing_count <> 0 then
    raise exception 'STUDENT_LIBRARY_SOURCE_MEDIA_NOT_READY: % source rows missing', missing_count;
  end if;
end $$;

insert into public.walkthrough_videos (
  id, version, title, description, learning_objective, topic, audience,
  onboarding_eligible, thumbnail_path, video_path, duration_seconds,
  captions_path, transcript, status, processing_status, created_by
)
select repair.new_id, 1, source.title, source.description,
  source.learning_objective, source.topic, 'student', true,
  source.thumbnail_path, source.video_path, source.duration_seconds,
  source.captions_path, source.transcript, 'published', source.processing_status,
  source.created_by
from (values
  ('8d70f650-bfad-40d8-b52e-bf39f549db62'::uuid, 'b7a4bb2d-4b01-4b01-8f7e-000000000001'::uuid),
  ('623d49a5-3400-4d32-9a84-3a82b536841c'::uuid, 'b7a4bb2d-4b01-4b01-8f7e-000000000002'::uuid),
  ('a25d3424-afdf-42a4-b8e3-ea8652c78e2e'::uuid, 'b7a4bb2d-4b01-4b01-8f7e-000000000003'::uuid),
  ('1a004bd9-a257-4fd5-a285-f72ddd501e78'::uuid, 'b7a4bb2d-4b01-4b01-8f7e-000000000004'::uuid),
  ('06216dc8-3420-49c3-a10c-dee8455a47db'::uuid, 'b7a4bb2d-4b01-4b01-8f7e-000000000005'::uuid),
  ('4580468f-2aec-4fff-9444-6a7ed50ddc9e'::uuid, 'b7a4bb2d-4b01-4b01-8f7e-000000000006'::uuid)
) repair(source_id, new_id)
join public.walkthrough_videos source
  on source.id = repair.source_id and source.version = 1
on conflict (id) do nothing;

update public.walkthrough_course_items item
set video_id = repair.new_id,
    video_version = 1
from (values
  ('8d70f650-bfad-40d8-b52e-bf39f549db62'::uuid, 'b7a4bb2d-4b01-4b01-8f7e-000000000001'::uuid),
  ('623d49a5-3400-4d32-9a84-3a82b536841c'::uuid, 'b7a4bb2d-4b01-4b01-8f7e-000000000002'::uuid),
  ('a25d3424-afdf-42a4-b8e3-ea8652c78e2e'::uuid, 'b7a4bb2d-4b01-4b01-8f7e-000000000003'::uuid),
  ('1a004bd9-a257-4fd5-a285-f72ddd501e78'::uuid, 'b7a4bb2d-4b01-4b01-8f7e-000000000004'::uuid),
  ('06216dc8-3420-49c3-a10c-dee8455a47db'::uuid, 'b7a4bb2d-4b01-4b01-8f7e-000000000005'::uuid),
  ('4580468f-2aec-4fff-9444-6a7ed50ddc9e'::uuid, 'b7a4bb2d-4b01-4b01-8f7e-000000000006'::uuid)
) repair(source_id, new_id)
where item.course_id = '4e6bdaf6-50b6-4f2f-9a61-5efb6e0d4c71'::uuid
  and item.course_version = 1
  and item.video_id = repair.source_id;
