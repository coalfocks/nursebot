\set ON_ERROR_STOP on
\set student_id '00000000-0000-0000-0000-000000000001'
\set allowed_admin_id '00000000-0000-0000-0000-000000000002'
\set denied_admin_id '00000000-0000-0000-0000-000000000003'
\set other_student_id '00000000-0000-0000-0000-000000000004'
\set patient_id '10000000-0000-0000-0000-000000000001'
\set other_patient_id '10000000-0000-0000-0000-000000000002'
\set assignment_id '20000000-0000-0000-0000-000000000001'
\set other_assignment_id '20000000-0000-0000-0000-000000000002'
\set order_id '30000000-0000-0000-0000-000000000001'
\set other_order_id '30000000-0000-0000-0000-000000000002'
\set same_room_assignment_id '20000000-0000-0000-0000-000000000003'
\set same_room_order_id '30000000-0000-0000-0000-000000000003'

insert into public.patients(id, school_id) values
  (:'patient_id'::uuid, '00000000-0000-0000-0000-0000000000a1'),
  (:'other_patient_id'::uuid, '00000000-0000-0000-0000-0000000000b2');
insert into public.rooms(id, patient_id, school_id) values
  (1, :'patient_id'::uuid, '00000000-0000-0000-0000-0000000000a1'),
  (2, :'other_patient_id'::uuid, '00000000-0000-0000-0000-0000000000b2');
insert into public.profiles(id, role, school_id) values
  (:'student_id'::uuid, 'student', '00000000-0000-0000-0000-0000000000a1'),
  (:'other_student_id'::uuid, 'student', '00000000-0000-0000-0000-0000000000a1'),
  (:'allowed_admin_id'::uuid, 'school_admin', '00000000-0000-0000-0000-0000000000a1'),
  (:'denied_admin_id'::uuid, 'school_admin', '00000000-0000-0000-0000-0000000000b2');
insert into public.student_room_assignments(id, student_id, room_id, school_id, case_key_version, status) values
  (:'assignment_id'::uuid, :'student_id'::uuid, 1, '00000000-0000-0000-0000-0000000000a1', 'case-v1', 'in_progress'),
  (:'same_room_assignment_id'::uuid, :'other_student_id'::uuid, 1, '00000000-0000-0000-0000-0000000000a1', 'case-v1-other', 'in_progress'),
  (:'other_assignment_id'::uuid, :'student_id'::uuid, 2, '00000000-0000-0000-0000-0000000000b2', 'case-other', 'in_progress');
insert into public.medical_orders(id, patient_id, room_id, assignment_id) values
  (:'order_id'::uuid, :'patient_id'::uuid, 1, :'assignment_id'::uuid),
  (:'same_room_order_id'::uuid, :'patient_id'::uuid, 1, :'same_room_assignment_id'::uuid),
  (:'other_order_id'::uuid, :'other_patient_id'::uuid, 2, :'other_assignment_id'::uuid);

-- The explicit RPC is the only write path; direct table DML is denied.
select set_config('request.jwt.claim.sub', :'allowed_admin_id', false);
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('app.test.assignment_id', :'assignment_id', false);
select set_config('app.test.other_order_id', :'other_order_id', false);
select public.save_mar_history(
  :'patient_id'::uuid, 1, :'assignment_id'::uuid, 'case-v1', 0,
  jsonb_build_array(jsonb_build_object(
    'orderId', :'order_id', 'caseVersion', 'case-v1', 'occurrenceKey', 'dose-4',
    'relativeOffsetHours', 4, 'medicationName', 'Fixture medication', 'status', 'Given',
    'source', 'authored_scenario'
  ))
);
select public.save_mar_history(
  :'patient_id'::uuid, 1, :'same_room_assignment_id'::uuid, 'case-v1-other', 0,
  jsonb_build_array(jsonb_build_object(
    'orderId', :'same_room_order_id', 'caseVersion', 'case-v1-other', 'occurrenceKey', 'other-dose-4',
    'relativeOffsetHours', 4, 'medicationName', 'Other learner medication', 'status', 'Given',
    'source', 'authored_scenario'
  ))
);
select set_config('app.test.patient_id', :'patient_id', false);

select public.create_mar_baseline_version(
  :'assignment_id'::uuid, 'case-v1',
  jsonb_build_array(jsonb_build_object('occurrenceKey', 'dose-4', 'relativeOffsetHours', 4, 'status', 'Given'))
);
do $test$
begin
  begin
    perform public.create_mar_baseline_version(
      current_setting('app.test.assignment_id')::uuid, 'case-v1',
      jsonb_build_array(jsonb_build_object('occurrenceKey', 'dose-4', 'relativeOffsetHours', 8, 'status', 'Given'))
    );
    raise exception 'EXPECTED_IMMUTABLE_MAR_VERSION_ERROR';
  exception when others then
    if sqlerrm not like 'MAR_BASELINE_VERSION_IMMUTABLE%' then raise; end if;
  end;
end
$test$;

do $test$
begin
  if (select count(*) from public.mar_administration_events where patient_id = current_setting('app.test.patient_id')::uuid) <> 2 then
    raise exception 'EXPECTED_TWO_SCOPED_MAR_EVENTS';
  end if;
  if (select count(*) from public.mar_assignment_baselines where assignment_id = current_setting('app.test.assignment_id')::uuid) <> 1 then
    raise exception 'EXPECTED_ONE_IMMUTABLE_ASSIGNMENT_MATERIALIZATION';
  end if;
end
$test$;

-- Learners sharing a room cannot read each other's assignment events.
select set_config('request.jwt.claim.sub', :'student_id', false);
do $test$
begin
  if (select count(*) from public.mar_administration_events where patient_id = current_setting('app.test.patient_id')::uuid) <> 1 then
    raise exception 'EXPECTED_STUDENT_ONE_ASSIGNMENT_SCOPE';
  end if;
end
$test$;
select set_config('request.jwt.claim.sub', :'other_student_id', false);
do $test$
begin
  if (select count(*) from public.mar_administration_events where patient_id = current_setting('app.test.patient_id')::uuid) <> 1 then
    raise exception 'EXPECTED_STUDENT_TWO_ASSIGNMENT_SCOPE';
  end if;
end
$test$;

-- Cross-school direct reads and direct writes remain denied.
select set_config('request.jwt.claim.sub', :'denied_admin_id', false);
do $test$
begin
  if exists (select 1 from public.mar_administration_events where patient_id = current_setting('app.test.patient_id')::uuid) then
    raise exception 'EXPECTED_CROSS_SCHOOL_READ_DENIED';
  end if;
  begin
    insert into public.mar_administration_events(patient_id, room_id, assignment_id, case_version, occurrence_key, medication_name)
    values (current_setting('app.test.patient_id')::uuid, 1, current_setting('app.test.assignment_id')::uuid, 'case-v1', 'direct-write', 'Denied');
    raise exception 'EXPECTED_DIRECT_WRITE_DENIED';
  exception when insufficient_privilege then null;
  end;
end
$test$;

-- A valid school admin cannot bind an order from another patient/assignment or
-- a different immutable case version through the RPC.
select set_config('request.jwt.claim.sub', :'allowed_admin_id', false);
select set_config('app.test.assignment_id', :'assignment_id', false);
select set_config('app.test.order_id', :'order_id', false);
select set_config('app.test.other_order_id', :'other_order_id', false);
do $test$
begin
  begin
    perform public.save_mar_history(
      current_setting('app.test.patient_id')::uuid, 1, current_setting('app.test.assignment_id')::uuid, 'case-v2', 1,
      jsonb_build_array(jsonb_build_object('orderId', current_setting('app.test.other_order_id'), 'caseVersion', 'case-v2', 'occurrenceKey', 'bad', 'medicationName', 'Bad'))
    );
    raise exception 'EXPECTED_MAR_LINEAGE_REJECTION';
  exception when others then
    if sqlerrm not like 'MAR_CASE_VERSION_IMMUTABLE%' and sqlerrm not like 'MAR_ASSIGNMENT_ROOM_MISMATCH%' and sqlerrm not like 'MAR_LINEAGE_MISMATCH%' then raise; end if;
  end;
end
$test$;
