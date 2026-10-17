-- Stable provenance for authored pre-page chart context. These fields let the
-- runtime render every lab/vital/note at its authored offset instead of hiding
-- the date in free-text note content. They never enter learner action scoring.
alter table public.clinical_notes
  add column if not exists timeline_entry_id text;

alter table public.lab_results
  add column if not exists timeline_entry_id text;

alter table public.vital_signs
  add column if not exists timeline_entry_id text;

create unique index if not exists clinical_notes_room_timeline_entry_uidx
  on public.clinical_notes (room_id, timeline_entry_id)
  where room_id is not null and timeline_entry_id is not null and deleted_at is null;

create unique index if not exists lab_results_room_timeline_entry_uidx
  on public.lab_results (room_id, timeline_entry_id)
  where room_id is not null and timeline_entry_id is not null and deleted_at is null;

create unique index if not exists vital_signs_room_timeline_entry_uidx
  on public.vital_signs (room_id, timeline_entry_id)
  where room_id is not null and timeline_entry_id is not null and deleted_at is null;

comment on column public.clinical_notes.timeline_entry_id is 'Authored pre-page timeline entry provenance; excluded from learner action timeline and feedback scoring.';
comment on column public.lab_results.timeline_entry_id is 'Authored pre-page timeline entry provenance; excluded from learner action timeline and feedback scoring.';
comment on column public.vital_signs.timeline_entry_id is 'Authored pre-page timeline entry provenance; excluded from learner action timeline and feedback scoring.';

-- Publish adapter: update the room's authored timeline/nurse facts and materialize
-- the same entries into the linked chart in one transaction. This is SECURITY
-- INVOKER intentionally: existing room/chart RLS policies remain the authority.
create or replace function public.materialize_hospital_timeline(
  p_room_id integer,
  p_patient_id uuid,
  p_school_id uuid,
  p_case_blueprint_id uuid,
  p_timeline jsonb,
  p_nurse_context text,
  p_generated_at timestamptz default now()
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_timeline jsonb := coalesce(p_timeline, '{}'::jsonb);
  v_entries jsonb := coalesce(v_timeline->'entries', '[]'::jsonb);
  v_encounter_type text := coalesce(v_timeline->>'encounterType', 'inpatient');
  v_stay_days integer := coalesce((v_timeline->>'stayDays')::integer, 1);
  v_max_offset numeric := 0;
  v_entry jsonb;
  v_kind text;
  v_entry_id text;
  v_at timestamptz;
  v_numeric numeric;
  v_value text;
  v_notes integer := 0;
  v_labs integer := 0;
  v_vitals integer := 0;
  v_day integer;
begin
  if not exists (
    select 1 from public.rooms r
    where r.id = p_room_id
      and r.patient_id = p_patient_id
      and r.school_id = p_school_id
  ) then
    raise exception 'Timeline publish link mismatch for room %, patient %, school %', p_room_id, p_patient_id, p_school_id;
  end if;

  if v_encounter_type not in ('inpatient', 'ed', 'ld') or v_stay_days not between 1 and 3 then
    raise exception 'Invalid hospital timeline encounter or stay duration';
  end if;
  if v_encounter_type = 'ed' and v_stay_days <> 1 then
    raise exception 'ED timeline must be a single encounter';
  end if;

  select coalesce(max((entry->>'offsetHours')::numeric), 0)
    into v_max_offset
  from jsonb_array_elements(v_entries) entry;

  if exists (
    select 1
    from jsonb_array_elements(v_entries) entry
    where coalesce(entry->>'kind', '') = 'nurse_page'
      and coalesce((entry->>'offsetHours')::numeric, 0) < greatest(0, v_stay_days * 24 - 12)
  ) then
    raise exception 'Nurse page must be within the final 12-hour context window';
  end if;

  update public.rooms
  set hospital_timeline = v_timeline,
      hospital_stay_days = v_stay_days,
      encounter_type = v_encounter_type,
      nurse_context = coalesce(p_nurse_context, nurse_context)
  where id = p_room_id and patient_id = p_patient_id and school_id = p_school_id;

  for v_entry in select value from jsonb_array_elements(v_entries) loop
    v_entry_id := nullif(v_entry->>'id', '');
    v_kind := v_entry->>'kind';
    if v_entry_id is null or v_kind is null then
      raise exception 'Every timeline entry requires id and kind';
    end if;

    v_at := (p_generated_at - make_interval(hours => v_max_offset::double precision))
      + make_interval(hours => coalesce((v_entry->>'offsetHours')::double precision, 0));

    if v_kind in ('admission', 'progress_note', 'consult', 'procedure') then
      if exists (select 1 from public.clinical_notes where room_id = p_room_id and timeline_entry_id = v_entry_id and deleted_at is null) then
        update public.clinical_notes
        set patient_id = p_patient_id, school_id = p_school_id, case_blueprint_id = p_case_blueprint_id,
            note_type = case v_kind when 'admission' then 'H&P' when 'progress_note' then 'Progress' when 'consult' then 'Consult' else 'Procedure' end,
            title = coalesce(v_entry->>'title', 'Authored pre-page note'),
            content = case when v_kind = 'consult' and nullif(v_entry->>'recommendation', '') is not null
              then coalesce(v_entry->>'content', '') || E'\nRecommendation: ' || (v_entry->>'recommendation')
              else coalesce(v_entry->>'content', '') end,
            author = coalesce(nullif(v_entry->>'consultant', ''), 'Authored pre-page timeline'),
            timestamp = v_at, signed = true, deleted_at = null
        where room_id = p_room_id and timeline_entry_id = v_entry_id and deleted_at is null;
      else
        insert into public.clinical_notes (patient_id, room_id, school_id, case_blueprint_id, override_scope, timeline_entry_id, note_type, title, content, author, timestamp, signed)
        values (p_patient_id, p_room_id, p_school_id, p_case_blueprint_id, 'room', v_entry_id,
          case v_kind when 'admission' then 'H&P' when 'progress_note' then 'Progress' when 'consult' then 'Consult' else 'Procedure' end,
          coalesce(v_entry->>'title', 'Authored pre-page note'),
          case when v_kind = 'consult' and nullif(v_entry->>'recommendation', '') is not null
            then coalesce(v_entry->>'content', '') || E'\nRecommendation: ' || (v_entry->>'recommendation')
            else coalesce(v_entry->>'content', '') end,
          coalesce(nullif(v_entry->>'consultant', ''), 'Authored pre-page timeline'), v_at, true);
      end if;
      v_notes := v_notes + 1;
    elsif v_kind = 'lab' then
      v_value := nullif(trim(v_entry->>'value'), '');
      v_numeric := case when v_value ~ '^[+-]?([0-9]+(\.[0-9]+)?|\.[0-9]+)$' then v_value::numeric else null end;
      if exists (select 1 from public.lab_results where room_id = p_room_id and timeline_entry_id = v_entry_id and deleted_at is null) then
        update public.lab_results
        set patient_id = p_patient_id, school_id = p_school_id, case_blueprint_id = p_case_blueprint_id,
            test_name = coalesce(v_entry->>'analyte', v_entry->>'title', 'Authored lab'),
            value = v_numeric, value_type = case when v_numeric is null then 'coded' else 'numeric' end,
            text_value = case when v_numeric is null then v_value else null end,
            unit = nullif(v_entry->>'unit', ''), status = 'Unknown', lifecycle_status = 'resulted',
            collection_time = v_at, result_time = v_at, ordered_by = 'Authored pre-page timeline', deleted_at = null
        where room_id = p_room_id and timeline_entry_id = v_entry_id and deleted_at is null;
      else
        insert into public.lab_results (patient_id, room_id, school_id, case_blueprint_id, override_scope, timeline_entry_id, test_name, value, value_type, text_value, unit, status, lifecycle_status, collection_time, result_time, ordered_by)
        values (p_patient_id, p_room_id, p_school_id, p_case_blueprint_id, 'room', v_entry_id,
          coalesce(v_entry->>'analyte', v_entry->>'title', 'Authored lab'), v_numeric,
          case when v_numeric is null then 'coded' else 'numeric' end,
          case when v_numeric is null then v_value else null end, nullif(v_entry->>'unit', ''), 'Unknown', 'resulted', v_at, v_at, 'Authored pre-page timeline');
      end if;
      v_labs := v_labs + 1;
    elsif v_kind = 'vital' then
      if exists (select 1 from public.vital_signs where room_id = p_room_id and timeline_entry_id = v_entry_id and deleted_at is null) then
        update public.vital_signs
        set patient_id = p_patient_id, school_id = p_school_id, timestamp = v_at,
            temperature = case when (v_entry->'vitals'->>'temperature') ~ '^[+-]?[0-9]+(\.[0-9]+)?$' then (v_entry->'vitals'->>'temperature')::numeric end,
            blood_pressure_systolic = case when (v_entry->'vitals'->>'bloodPressureSystolic') ~ '^[0-9]+$' then (v_entry->'vitals'->>'bloodPressureSystolic')::numeric end,
            blood_pressure_diastolic = case when (v_entry->'vitals'->>'bloodPressureDiastolic') ~ '^[0-9]+$' then (v_entry->'vitals'->>'bloodPressureDiastolic')::numeric end,
            heart_rate = case when (v_entry->'vitals'->>'heartRate') ~ '^[0-9]+$' then (v_entry->'vitals'->>'heartRate')::numeric end,
            respiratory_rate = case when (v_entry->'vitals'->>'respiratoryRate') ~ '^[0-9]+$' then (v_entry->'vitals'->>'respiratoryRate')::numeric end,
            oxygen_saturation = case when (v_entry->'vitals'->>'oxygenSaturation') ~ '^[0-9]+(\.[0-9]+)?$' then (v_entry->'vitals'->>'oxygenSaturation')::numeric end,
            pain = case when (v_entry->'vitals'->>'pain') ~ '^[0-9]+(\.[0-9]+)?$' then (v_entry->'vitals'->>'pain')::numeric end,
            deleted_at = null
        where room_id = p_room_id and timeline_entry_id = v_entry_id and deleted_at is null;
      else
        insert into public.vital_signs (patient_id, room_id, school_id, override_scope, timeline_entry_id, timestamp, temperature, blood_pressure_systolic, blood_pressure_diastolic, heart_rate, respiratory_rate, oxygen_saturation, pain)
        values (p_patient_id, p_room_id, p_school_id, 'room', v_entry_id, v_at,
          case when (v_entry->'vitals'->>'temperature') ~ '^[+-]?[0-9]+(\.[0-9]+)?$' then (v_entry->'vitals'->>'temperature')::numeric end,
          case when (v_entry->'vitals'->>'bloodPressureSystolic') ~ '^[0-9]+$' then (v_entry->'vitals'->>'bloodPressureSystolic')::numeric end,
          case when (v_entry->'vitals'->>'bloodPressureDiastolic') ~ '^[0-9]+$' then (v_entry->'vitals'->>'bloodPressureDiastolic')::numeric end,
          case when (v_entry->'vitals'->>'heartRate') ~ '^[0-9]+$' then (v_entry->'vitals'->>'heartRate')::numeric end,
          case when (v_entry->'vitals'->>'respiratoryRate') ~ '^[0-9]+$' then (v_entry->'vitals'->>'respiratoryRate')::numeric end,
          case when (v_entry->'vitals'->>'oxygenSaturation') ~ '^[0-9]+(\.[0-9]+)?$' then (v_entry->'vitals'->>'oxygenSaturation')::numeric end,
          case when (v_entry->'vitals'->>'pain') ~ '^[0-9]+(\.[0-9]+)?$' then (v_entry->'vitals'->>'pain')::numeric end);
      end if;
      v_vitals := v_vitals + 1;
    end if;
  end loop;

  return jsonb_build_object('room_id', p_room_id, 'patient_id', p_patient_id, 'timeline_entries', jsonb_array_length(v_entries), 'notes', v_notes, 'labs', v_labs, 'vitals', v_vitals);
end;
$$;

revoke all on function public.materialize_hospital_timeline(integer, uuid, uuid, uuid, jsonb, text, timestamptz) from public;
grant execute on function public.materialize_hospital_timeline(integer, uuid, uuid, uuid, jsonb, text, timestamptz) to authenticated;
