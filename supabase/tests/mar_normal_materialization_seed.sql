\set ON_ERROR_STOP on
insert into public.mar_administration_events(
  patient_id, room_id, assignment_id, order_id, case_version, occurrence_key,
  relative_offset_hours, medication_name, ordered_dose, administered_dose, unit,
  route, frequency, category, status, source, actor_id, record_version
) values (
  '10000000-0000-0000-0000-000000000001', 1, null,
  '30000000-0000-0000-0000-000000000001', 'authored-seed', 'authored-dose-12',
  12, 'Disposable authored medication', '20 mg', '20 mg', 'mg', 'PO', 'q4h PRN',
  'prn', 'Given', 'authored_scenario', '00000000-0000-0000-0000-000000000002', 1
);
