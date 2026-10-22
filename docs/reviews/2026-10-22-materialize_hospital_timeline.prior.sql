-- Captured from the production schema dump on 2026-10-22 UTC.
-- Rollback reference only; do not apply without owner review.
CREATE OR REPLACE FUNCTION public.materialize_hospital_timeline(
  p_room_id integer, p_patient_id uuid, p_school_id uuid,
  p_case_blueprint_id uuid, p_timeline jsonb, p_nurse_context text,
  p_generated_at timestamptz default now()
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public AS $$
declare
  v_timeline jsonb := coalesce(p_timeline, '{}'::jsonb);
  v_entries jsonb := coalesce(v_timeline->'entries', '[]'::jsonb);
  v_encounter text := coalesce(v_timeline->>'encounterType', 'inpatient');
  v_days integer := coalesce((v_timeline->>'stayDays')::integer, 1);
  v_entry jsonb; v_id text; v_kind text; v_hours integer; v_at timestamptz;
  v_value text; v_num numeric; v_notes integer := 0; v_labs integer := 0;
  v_vitals integer := 0; v_imaging integer := 0;
begin
  if not exists (select 1 from public.rooms where id = p_room_id and patient_id = p_patient_id and school_id = p_school_id) then
    raise exception 'Timeline publish link mismatch for room %, patient %, school %', p_room_id, p_patient_id, p_school_id;
  end if;
  if v_encounter not in ('inpatient', 'ed', 'ld') or v_days not between 1 and 3 then raise exception 'Invalid hospital timeline encounter or stay duration'; end if;
  if v_encounter = 'ed' and v_days <> 1 then raise exception 'ED timeline must be a single encounter'; end if;
  if exists (select 1 from jsonb_array_elements(v_entries) e where coalesce((e->>'relativeHoursBeforeEncounter')::numeric, (e->>'offsetHours')::numeric, 0) < 0 or coalesce((e->>'relativeHoursBeforeEncounter')::numeric, (e->>'offsetHours')::numeric, 0) > v_days * 24) then raise exception 'Timeline offsets must be 0–% hours before encounter', v_days * 24; end if;
  if exists (select 1 from jsonb_array_elements(v_entries) e where e->>'kind' = 'nurse_page' and coalesce((e->>'relativeHoursBeforeEncounter')::numeric, (e->>'offsetHours')::numeric, 0) > 12) then raise exception 'Nurse page must be within the final 12-hour context window'; end if;

  update public.rooms set hospital_timeline = v_timeline, hospital_stay_days = v_days, encounter_type = v_encounter, nurse_context = coalesce(p_nurse_context, nurse_context) where id = p_room_id and patient_id = p_patient_id and school_id = p_school_id;

  for v_entry in select value from jsonb_array_elements(v_entries) loop
    v_id := nullif(v_entry->>'id', ''); v_kind := v_entry->>'kind';
    if v_id is null or v_kind is null then raise exception 'Every timeline entry requires id and kind'; end if;
    v_hours := greatest(0, round(coalesce((v_entry->>'relativeHoursBeforeEncounter')::numeric, (v_entry->>'offsetHours')::numeric, 0))::integer);
    v_at := p_generated_at - make_interval(hours => v_hours);
    if v_kind in ('admission', 'progress_note', 'consult', 'procedure') then
      insert into public.clinical_notes (patient_id, room_id, school_id, case_blueprint_id, override_scope, timeline_entry_id, relative_offset_hours, note_type, title, content, author, timestamp, signed)
      values (p_patient_id, p_room_id, p_school_id, p_case_blueprint_id, 'room', v_id, v_hours, case v_kind when 'admission' then 'H&P' when 'progress_note' then 'Progress' when 'consult' then 'Consult' else 'Procedure' end, coalesce(v_entry->>'title', 'Authored pre-page note'), case when v_kind = 'consult' and nullif(v_entry->>'recommendation', '') is not null then coalesce(v_entry->>'content', '') || E'\nRecommendation: ' || (v_entry->>'recommendation') else coalesce(v_entry->>'content', '') end, coalesce(nullif(v_entry->>'consultant', ''), 'Authored pre-page timeline'), v_at, true)
      on conflict (room_id, timeline_entry_id) where timeline_entry_id is not null and deleted_at is null do update set patient_id = excluded.patient_id, school_id = excluded.school_id, case_blueprint_id = excluded.case_blueprint_id, relative_offset_hours = excluded.relative_offset_hours, note_type = excluded.note_type, title = excluded.title, content = excluded.content, author = excluded.author, timestamp = excluded.timestamp, signed = true, deleted_at = null;
      v_notes := v_notes + 1;
    elsif v_kind = 'lab' then
      v_value := nullif(trim(v_entry->>'value'), ''); v_num := case when v_value ~ '^[+-]?([0-9]+(\.[0-9]+)?|\.[0-9]+)$' then v_value::numeric else null end;
      insert into public.lab_results (patient_id, room_id, school_id, case_blueprint_id, override_scope, timeline_entry_id, relative_offset_hours, test_name, value, value_type, text_value, unit, status, lifecycle_status, collection_time, result_time, ordered_by)
      values (p_patient_id, p_room_id, p_school_id, p_case_blueprint_id, 'room', v_id, v_hours, coalesce(v_entry->>'analyte', v_entry->>'title', 'Authored lab'), v_num, case when v_num is null then 'coded' else 'numeric' end, case when v_num is null then v_value else null end, nullif(v_entry->>'unit', ''), 'Unknown', 'resulted', v_at, v_at, 'Authored pre-page timeline')
      on conflict (room_id, timeline_entry_id) where timeline_entry_id is not null and deleted_at is null do update set patient_id = excluded.patient_id, school_id = excluded.school_id, case_blueprint_id = excluded.case_blueprint_id, relative_offset_hours = excluded.relative_offset_hours, test_name = excluded.test_name, value = excluded.value, value_type = excluded.value_type, text_value = excluded.text_value, unit = excluded.unit, collection_time = excluded.collection_time, result_time = excluded.result_time, deleted_at = null;
      v_labs := v_labs + 1;
    elsif v_kind = 'vital' then
      insert into public.vital_signs (patient_id, room_id, school_id, override_scope, timeline_entry_id, relative_offset_hours, timestamp, temperature, blood_pressure_systolic, blood_pressure_diastolic, heart_rate, respiratory_rate, oxygen_saturation, pain)
      values (p_patient_id, p_room_id, p_school_id, 'room', v_id, v_hours, v_at, (v_entry->'vitals'->>'temperature')::numeric, (v_entry->'vitals'->>'bloodPressureSystolic')::numeric, (v_entry->'vitals'->>'bloodPressureDiastolic')::numeric, (v_entry->'vitals'->>'heartRate')::numeric, (v_entry->'vitals'->>'respiratoryRate')::numeric, (v_entry->'vitals'->>'oxygenSaturation')::numeric, (v_entry->'vitals'->>'pain')::numeric)
      on conflict (room_id, timeline_entry_id) where timeline_entry_id is not null and deleted_at is null do update set patient_id = excluded.patient_id, school_id = excluded.school_id, relative_offset_hours = excluded.relative_offset_hours, timestamp = excluded.timestamp, temperature = excluded.temperature, blood_pressure_systolic = excluded.blood_pressure_systolic, blood_pressure_diastolic = excluded.blood_pressure_diastolic, heart_rate = excluded.heart_rate, respiratory_rate = excluded.respiratory_rate, oxygen_saturation = excluded.oxygen_saturation, pain = excluded.pain, deleted_at = null;
      v_vitals := v_vitals + 1;
    elsif v_kind = 'imaging' then
      insert into public.imaging_studies (patient_id, room_id, school_id, case_blueprint_id, override_scope, timeline_entry_id, relative_offset_hours, order_name, study_type, status, ordered_by, order_time, report, report_generated_at)
      values (p_patient_id, p_room_id, p_school_id, p_case_blueprint_id, 'room', v_id, v_hours, coalesce(v_entry->>'title', v_entry->>'studyType', 'Authored imaging'), coalesce(v_entry->>'studyType', v_entry->>'title', 'Imaging'), 'Completed', 'Authored pre-page timeline', v_at, coalesce(v_entry->>'report', v_entry->>'content'), v_at)
      on conflict (room_id, timeline_entry_id) where timeline_entry_id is not null and deleted_at is null do update set patient_id = excluded.patient_id, school_id = excluded.school_id, case_blueprint_id = excluded.case_blueprint_id, relative_offset_hours = excluded.relative_offset_hours, order_name = excluded.order_name, study_type = excluded.study_type, status = excluded.status, order_time = excluded.order_time, report = excluded.report, report_generated_at = excluded.report_generated_at, deleted_at = null;
      v_imaging := v_imaging + 1;
    end if;
  end loop;
  return jsonb_build_object('room_id', p_room_id, 'patient_id', p_patient_id, 'timeline_entries', jsonb_array_length(v_entries), 'notes', v_notes, 'labs', v_labs, 'vitals', v_vitals, 'imaging', v_imaging);
end;
$$;
