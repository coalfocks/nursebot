begin;

-- Safe, idempotent product-content seed. This is a published preview, not a
-- mandatory onboarding course, so StudentLearningGate remains dormant.
update public.walkthrough_videos
set status = 'published',
    audience = 'student',
    onboarding_eligible = true,
    learning_objective = case id
      when '8d70f650-bfad-40d8-b52e-bf39f549db62'::uuid then 'Confirm your learner account and understand how to begin a Nurse Althea trial case.'
      when 'ef3cf2ec-2091-4db7-86ac-5910aaced43c'::uuid then 'Open an assigned case and orient yourself to the patient, room, and task.'
      when 'a25d3424-afdf-42a4-b8e3-ea8652c78e2e'::uuid then 'Use nurse, patient, and bedside conversations to gather focused information.'
      when '1a004bd9-a257-4fd5-a285-f72ddd501e78'::uuid then 'Review the EMR and place an appropriate diagnostic order.'
      when '06216dc8-3420-49c3-a10c-dee8455a47db'::uuid then 'Complete a case and review formative feedback for the next case.'
      when '623d49a5-3400-4d32-9a84-3a82b536841c'::uuid then 'Find and open an assigned student case from the learner workspace.'
      when '4580468f-2aec-4fff-9444-6a7ed50ddc9e'::uuid then 'Practice the complete student workflow from case start through feedback.'
      else learning_objective
    end,
    updated_at = timezone('utc', now())
where id in (
  '8d70f650-bfad-40d8-b52e-bf39f549db62',
  'ef3cf2ec-2091-4db7-86ac-5910aaced43c',
  'a25d3424-afdf-42a4-b8e3-ea8652c78e2e',
  '1a004bd9-a257-4fd5-a285-f72ddd501e78',
  '06216dc8-3420-49c3-a10c-dee8455a47db',
  '623d49a5-3400-4d32-9a84-3a82b536841c',
  '4580468f-2aec-4fff-9444-6a7ed50ddc9e'
);

update public.walkthrough_videos
set title = '02 | Getting an Account', updated_at = timezone('utc', now())
where id = '8d70f650-bfad-40d8-b52e-bf39f549db62'::uuid;

-- Sign-in is useful as an optional reference, never as required onboarding.
update public.walkthrough_videos
set onboarding_eligible = false, updated_at = timezone('utc', now())
where id = 'bdfe84fc-7317-4103-adf6-bc8ca6cc016a';

insert into public.walkthrough_courses
  (id, version, title, description, audience, status, is_mandatory)
values
  ('4e6bdaf6-50b6-4f2f-9a61-5efb6e0d4c71', 1,
   'Student Learning Library Preview',
   'Review the student workflow before required onboarding is enabled. This preview does not lock assigned cases.',
   'student', 'draft', false)
on conflict (id) do update set
  version = excluded.version,
  title = excluded.title,
  description = excluded.description,
  audience = excluded.audience,
  is_mandatory = false,
  status = 'draft',
  updated_at = timezone('utc', now());

delete from public.walkthrough_course_items
where course_id = '4e6bdaf6-50b6-4f2f-9a61-5efb6e0d4c71'::uuid and course_version = 1;

insert into public.walkthrough_course_items
  (course_id, course_version, video_id, video_version, position, required)
select '4e6bdaf6-50b6-4f2f-9a61-5efb6e0d4c71'::uuid, 1, v.id, v.version, x.position, x.required
from (values
  ('8d70f650-bfad-40d8-b52e-bf39f549db62'::uuid, 0, true),
  ('ef3cf2ec-2091-4db7-86ac-5910aaced43c'::uuid, 1, true),
  ('a25d3424-afdf-42a4-b8e3-ea8652c78e2e'::uuid, 2, true),
  ('1a004bd9-a257-4fd5-a285-f72ddd501e78'::uuid, 3, true),
  ('06216dc8-3420-49c3-a10c-dee8455a47db'::uuid, 4, true),
  ('623d49a5-3400-4d32-9a84-3a82b536841c'::uuid, 5, true),
  ('4580468f-2aec-4fff-9444-6a7ed50ddc9e'::uuid, 6, false)
) as x(video_id, position, required)
join public.walkthrough_videos v on v.id = x.video_id and v.version = 1;

-- Publish only after the complete item set exists. is_mandatory stays false.
update public.walkthrough_courses
set status = 'published', is_mandatory = false, updated_at = timezone('utc', now())
where id = '4e6bdaf6-50b6-4f2f-9a61-5efb6e0d4c71'::uuid and version = 1;

commit;
