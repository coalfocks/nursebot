-- Correct the already-applied publish adapter to preserve fractional-hour
-- authored offsets. PostgreSQL make_interval accepts fractional seconds, not
-- fractional hours.
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

  v_definition := replace(
    v_definition,
    'make_interval(hours => v_max_offset::double precision)',
    'make_interval(secs => v_max_offset * 3600)'
  );
  v_definition := replace(
    v_definition,
    'make_interval(hours => coalesce((v_entry->>''offsetHours'')::double precision, 0))',
    'make_interval(secs => coalesce((v_entry->>''offsetHours'')::double precision, 0) * 3600)'
  );

  execute v_definition;
end
$$;
