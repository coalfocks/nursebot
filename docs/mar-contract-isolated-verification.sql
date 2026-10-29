-- Read-only verification queries for a disposable database after the reviewed
-- prerequisites are installed. Substitute room IDs/versions as appropriate.
-- These queries do not publish, create, repin, reset, or mutate any record.

-- 1. Accepted packet provenance and required event counts.
select r.room_number,
       p.case_version,
       p.revision,
       jsonb_array_length(p.events) as packet_event_count,
       md5(p.patient_id::text || '|' || p.room_id::text || '|' || p.case_version || '|' || p.revision::text || '|' || p.events::text) as packet_hash
from public.rooms r
join public.manual_mar_packets p on p.room_id = r.id and p.patient_id = r.patient_id
where r.room_number in ('204', 'ED 20', '304')
order by r.room_number, p.updated_at desc;

-- Expected acceptance evidence for the supplied packets is 7/8/4 saved
-- events, respectively. This assertion is intentionally read-only.
do $$
declare
  expected record;
  actual integer;
begin
  for expected in
    select * from (values ('204', 7), ('ED 20', 8), ('304', 4)) as x(room_number, event_count)
  loop
    select jsonb_array_length(p.events) into actual
    from public.rooms r join public.manual_mar_packets p on p.room_id = r.id and p.patient_id = r.patient_id
    where r.room_number = expected.room_number
    order by p.updated_at desc limit 1;
    if actual is distinct from expected.event_count then
      raise exception 'MAR_PACKET_COUNT_MISMATCH room=% expected=% actual=%', expected.room_number, expected.event_count, actual;
    end if;
  end loop;
end $$;

-- 2. Provenance after the explicit normal-path publication operation.
select r.room_number, v.case_version, v.source_packet_id,
       v.source_packet_revision, jsonb_array_length(v.event_snapshot) as event_count,
       v.content_hash
from public.rooms r
join public.mar_authored_case_versions v on v.room_id = r.id
where r.room_number in ('204', 'ED 20', '304')
order by r.room_number, v.created_at desc;

-- 3. Fresh assignment readback: every new attempt must have one and only one
-- immutable reader source, with the same event count as its source packet.
select a.id, r.room_number, a.case_key_version,
       (select count(*) from public.mar_assignment_baseline_versions b where b.assignment_id = a.id) as automatic_snapshots,
       (select count(*) from public.manual_mar_assignment_snapshots m where m.assignment_id = a.id) as manual_snapshots,
       (select count(*) from public.mar_administration_events e where e.assignment_id = a.id and e.deleted_at is null) as materialized_events
from public.student_room_assignments a join public.rooms r on r.id = a.room_id
where a.created_at >= now() - interval '1 hour'
  and r.room_number in ('204', 'ED 20', '304')
order by a.created_at desc;
