do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(p.oid)
    into v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'materialize_hospital_timeline'
    and pg_get_function_identity_arguments(p.oid) = 'p_room_id integer, p_patient_id uuid, p_school_id uuid, p_case_blueprint_id uuid, p_timeline jsonb, p_nurse_context text, p_generated_at timestamp with time zone';

  if v_definition is null then
    raise exception 'materialize_hospital_timeline function was not found';
  end if;

  v_definition := replace(v_definition,
    E'update public.clinical_notes\n        set patient_id = p_patient_id, school_id = p_school_id,',
    E'update public.clinical_notes\n        set patient_id = p_patient_id, school_id = p_school_id, case_blueprint_id = p_case_blueprint_id,');
  v_definition := replace(v_definition,
    'insert into public.clinical_notes (patient_id, room_id, school_id, override_scope, timeline_entry_id,',
    'insert into public.clinical_notes (patient_id, room_id, school_id, case_blueprint_id, override_scope, timeline_entry_id,');
  v_definition := replace(v_definition,
    E'values (p_patient_id, p_room_id, p_school_id, ''room'', v_entry_id,\n          case v_kind',
    E'values (p_patient_id, p_room_id, p_school_id, p_case_blueprint_id, ''room'', v_entry_id,\n          case v_kind');

  execute v_definition;
end
$$;
