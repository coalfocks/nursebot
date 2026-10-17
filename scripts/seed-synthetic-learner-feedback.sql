begin;

-- Disposable synthetic fixture for the existing Internal Medicine test learner.
-- Fixed IDs make retries idempotent and keep this separate from QA-FB-BEDSIDE.
do $$
declare
  v_room_id bigint;
  v_patient_id uuid := 'f2b4b05a-3a11-4d1d-a7e5-1ddc71a0c401';
  v_assignment_id uuid := 'c9ddf760-8f7c-45a2-9c38-9f0f7f8e4d11';
  v_student_id uuid := '1d379f88-38d3-4e47-ba00-5908b027187f';
  v_school_id uuid := '05e89b88-af93-4ad5-8a3b-d632007ffa74';
  v_admin_id uuid := 'a3ca9cd4-cdf7-4c3b-95c3-8e8dd110a4d2';
  v_start timestamptz := timezone('utc', now()) - interval '8 minutes';
begin
  insert into public.patients (id, school_id, mrn, first_name, last_name, date_of_birth, gender, service, admission_date, attending_physician, allergies, code_status)
  values (v_patient_id, v_school_id, 'QA-LIB-FEEDBACK-20261015', 'Alex', 'Rivera', '1988-04-12', 'female', 'Synthetic QA', current_date, 'Synthetic supervising clinician', '{}', 'Full code')
  on conflict (id) do nothing;

  insert into public.rooms (school_id, specialty_id, room_number, role, learner_program, bedside_requirement, bedside_hint, objective, case_goals, context, nurse_context, patient_conversation_enabled, patient_conversation_prompt, patient_participation_reason, completion_token, difficulty_level, expected_diagnosis, expected_treatment, emr_context, example_progress_note, created_by, is_active)
  values (v_school_id, null, 'QA-LIB-FEEDBACK-20261015', 'Synthetic learner feedback QA only', 'medical', 'yes', 'Assess at bedside, communicate the findings, and document the plan.', 'Recognize acute instability, assess at bedside, escalate through the team, monitor, and reassess.', 'Recognize acute instability from bedside findings.\nEscalate to the senior clinician through an observable team channel.\nInitiate targeted monitoring and reassess.', 'Fictional synthetic QA case. Not for clinical use.', 'Synthetic nurse page: the patient is dizzy with low blood pressure and tachycardia.', true, 'Answer focused patient questions from the authored history without revealing the diagnosis or evaluation goals.', 'Fictional synthetic participant.', '<synthetic-library-feedback-20261015-complete>', 'advanced', 'Synthetic acute instability', array['Bedside assessment','Team escalation','Monitoring and reassessment'], '{"evaluation":{"version":"case-key-v2-bedside-team-2026-10-15","goals":["Recognize acute instability from bedside findings.","Escalate to the senior clinician through an observable team channel.","Initiate targeted monitoring and reassess."],"expectedEndpoint":"Stabilization plan communicated to the senior clinician with reassessment.","must":["document focused bedside findings","escalate to senior clinician","order urgent monitoring"],"should":["state a closed-loop reassessment plan"],"could":["ask the patient a focused symptom question"],"acceptableAlternativePaths":["Escalation in person or through a structured team action is equivalent to nurse chat when linked to the learner action."]},"admission":{"hAndP":"Synthetic H&P: acute dizziness and poor perfusion.","vitals":"Admission baseline stable.","labs":"Admission baseline normal."}}'::jsonb, 'Document findings, escalation recipient, monitoring, and reassessment.', v_admin_id, true)
  on conflict (room_number) do nothing;

  select id into v_room_id from public.rooms where room_number = 'QA-LIB-FEEDBACK-20261015';
  update public.patients set room_id = v_room_id where id = v_patient_id;
  update public.rooms set patient_id = v_patient_id where id = v_room_id;

  insert into public.student_room_assignments (id, school_id, student_id, room_id, assigned_by, learner_program, status, feedback_status, completion_token_matched, completed_at, student_progress_note, case_difficulty)
  values (v_assignment_id, v_school_id, v_student_id, v_room_id, v_admin_id, 'medical', 'completed', 'pending', true, v_start + interval '7 minutes', 'I assessed the patient at bedside, documented poor perfusion, escalated to the senior clinician, initiated monitoring, and documented reassessment.', 'advanced')
  on conflict (id) do nothing;

  insert into public.chat_messages (id, assignment_id, school_id, role, content, created_at)
  values
    ('0f6dbf93-2f08-4d52-bb6e-0b89f3d6a101', v_assignment_id, v_school_id, 'assistant', 'Nurse page: patient is dizzy; BP 82/48 and HR 126.', v_start),
    ('0f6dbf93-2f08-4d52-bb6e-0b89f3d6a102', v_assignment_id, v_school_id, 'student', 'I am assessing the patient at bedside and will escalate the findings.', v_start + interval '30 seconds'),
    ('0f6dbf93-2f08-4d52-bb6e-0b89f3d6a103', v_assignment_id, v_school_id, 'assistant', 'Understood. I will be available for specific questions.', v_start + interval '60 seconds'),
    ('0f6dbf93-2f08-4d52-bb6e-0b89f3d6a104', v_assignment_id, v_school_id, 'assistant', '<completed>', v_start + interval '7 minutes')
  on conflict (id) do nothing;

  insert into public.learner_action_events (id, assignment_id, room_id, action_type, channel, content, occurred_at, created_by)
  values
    ('0f6dbf93-2f08-4d52-bb6e-0b89f3d6b101', v_assignment_id, v_room_id, 'bedside_finding', 'bedside', 'At bedside: cool extremities, delayed capillary refill, pallor, and ongoing dizziness.', v_start + interval '2 minutes', v_student_id),
    ('0f6dbf93-2f08-4d52-bb6e-0b89f3d6b102', v_assignment_id, v_room_id, 'team_escalation', 'team', 'Escalated persistent hypotension and perfusion findings directly to the senior clinician and requested immediate review.', v_start + interval '3 minutes', v_student_id)
  on conflict (id) do nothing;

  insert into public.vital_signs (id, patient_id, school_id, room_id, assignment_id, override_scope, timestamp, blood_pressure_systolic, blood_pressure_diastolic, heart_rate, respiratory_rate, oxygen_saturation, temperature)
  values ('0f6dbf93-2f08-4d52-bb6e-0b89f3d6c101', v_patient_id, v_school_id, v_room_id, v_assignment_id, 'assignment', v_start + interval '2 minutes', 82, 48, 126, 26, 93, 37.1)
  on conflict (id) do nothing;

  insert into public.medical_orders (id, patient_id, school_id, room_id, assignment_id, override_scope, category, order_name, priority, status, ordered_by, order_time, instructions)
  values ('0f6dbf93-2f08-4d52-bb6e-0b89f3d6d101', v_patient_id, v_school_id, v_room_id, v_assignment_id, 'assignment', 'Monitoring', 'Continuous cardiac and pulse oximetry monitoring', 'STAT', 'Completed', 'Synthetic learner', v_start + interval '4 minutes', 'Repeat vital signs and reassess perfusion promptly.')
  on conflict (id) do nothing;

  insert into public.clinical_notes (id, patient_id, school_id, room_id, assignment_id, override_scope, note_type, title, content, author, timestamp, signed)
  values ('0f6dbf93-2f08-4d52-bb6e-0b89f3d6e101', v_patient_id, v_school_id, v_room_id, v_assignment_id, 'assignment', 'progress', 'Synthetic learner feedback QA note', 'Focused bedside findings, direct senior-clinician escalation, monitoring, and reassessment plan documented.', 'Synthetic learner', v_start + interval '5 minutes', true)
  on conflict (id) do nothing;
end $$;

commit;
