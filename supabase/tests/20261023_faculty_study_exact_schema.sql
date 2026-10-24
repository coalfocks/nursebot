-- REVIEW ONLY. Read-only exact-schema preflight for the faculty study path.
-- This file must stop before migration/deployment if any assertion fails.

do $$
declare
  required text[] := array[
    'id', 'room_id', 'student_id', 'status', 'completed_at',
    'student_progress_note', 'feedback_status', 'feedback_error', 'grade',
    'nurse_feedback', 'feedback_debrief', 'communication_score', 'mdm_score',
    'communication_breakdown', 'mdm_breakdown', 'learning_objectives',
    'feedback_generated_at', 'scoring_start_at', 'rubric_version',
    'case_key_version', 'assessment_version', 'source_event_ids',
    'technical_incomplete', 'safety_result'
  ];
  required_column text;
  context_table text;
begin
  foreach required_column in array required loop
    if not exists (
      select 1 from information_schema.columns c
      where table_schema = 'public'
        and table_name = 'student_room_assignments'
        and c.column_name = required_column
    ) then
      raise exception 'FACULTY_STUDY_SCHEMA_MISSING:student_room_assignments.%', required_column;
    end if;
  end loop;

  foreach required_column in array array['id', 'manifest', 'status', 'lease_token', 'lease_expires_at'] loop
    if not exists (
      select 1 from information_schema.columns c
      where table_schema = 'public'
        and table_name = 'faculty_study_batches'
        and c.column_name = required_column
    ) then
      raise exception 'FACULTY_STUDY_SCHEMA_MISSING:faculty_study_batches.%', required_column;
    end if;
  end loop;

  foreach required_column in array array['batch_id', 'batch_ordinal', 'result', 'canonical_result', 'raw_model_response', 'error', 'lease_token'] loop
    if not exists (
      select 1 from information_schema.columns c
      where table_schema = 'public'
        and table_name = 'faculty_study_results'
        and c.column_name = required_column
    ) then
      raise exception 'FACULTY_STUDY_SCHEMA_MISSING:faculty_study_results.%', required_column;
    end if;
  end loop;

  foreach required_column in array array['assignment_id', 'evaluator_config_id', 'evaluator_version'] loop
    if not exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = 'feedback_assessment_runs'
        and c.column_name = required_column
    ) then
      raise exception 'FACULTY_STUDY_SCHEMA_MISSING:feedback_assessment_runs.%', required_column;
    end if;
  end loop;

  foreach context_table in array array[
    'chat_messages', 'medical_orders', 'lab_results', 'vital_signs',
    'imaging_studies', 'learner_action_events', 'patient_chat_messages',
    'consultant_chat_messages'
  ] loop
    if not exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = context_table
        and c.column_name = 'assignment_id'
    ) then
      raise exception 'FACULTY_STUDY_SCHEMA_MISSING:% .assignment_id', context_table;
    end if;
  end loop;

  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'feedback_evaluator_configs') then
    raise exception 'FACULTY_STUDY_SCHEMA_MISSING:feedback_evaluator_configs';
  end if;
end $$;

select 'FACULTY_STUDY_EXACT_SCHEMA_PREFLIGHT_PASS' as result;
