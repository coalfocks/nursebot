\set ON_ERROR_STOP on
\set student '11111111-1111-4111-8111-111111111111'
\set patient '22222222-2222-4222-8222-222222222222'
\set assignment '33333333-3333-4333-8333-333333333333'
\set room 7001
\set school '44444444-4444-4444-8444-444444444444'

insert into public.patients(id) values (:'patient') on conflict do nothing;
insert into public.rooms(id, patient_id, school_id) values (:'room', :'patient', :'school') on conflict do nothing;
insert into public.student_room_assignments(id, student_id, room_id) values (:'assignment', :'student', :'room') on conflict do nothing;

\set req1 '51111111-1111-4111-8111-111111111111'
\set client1 '61111111-1111-4111-8111-111111111111'
\set token1 '71111111-1111-4111-8111-111111111111'
insert into public.consultant_requests (id, assignment_id, patient_id, room_id, specialty, summary, clinical_question, reason, urgency, client_request_id, message, audience, payload_hash, lease_token, lease_expires_at)
values (:'req1', :'assignment', :'patient', :'room', 'Medicine', '', '', '', 'routine', :'client1', 'first message', 'adult', 'hash-1', :'token1', now() + interval '5 minutes');
select * from public.persist_consultant_response_v2(:'student', :'assignment', :'client1', :'patient', :'room', 'adult', 'Medicine', 'first message', 'hash-1', 'stored response 1', 'routine_review', :'token1');
select * from public.persist_consultant_response_v2(:'student', :'assignment', :'client1', :'patient', :'room', 'adult', 'Medicine', 'first message', 'hash-1', 'ignored edited response', 'routine_review', :'token1');

\set req2 '52222222-2222-4222-8222-222222222222'
\set client2 '62222222-2222-4222-8222-222222222222'
\set token2 '72222222-2222-4222-8222-222222222222'
insert into public.consultant_requests (id, assignment_id, patient_id, room_id, specialty, summary, clinical_question, reason, urgency, client_request_id, message, audience, payload_hash, lease_token, lease_expires_at)
values (:'req2', :'assignment', :'patient', :'room', 'Medicine', '', '', '', 'routine', :'client2', 'follow-up message', 'adult', 'hash-2', :'token2', now() + interval '5 minutes');
select * from public.persist_consultant_response_v2(:'student', :'assignment', :'client2', :'patient', :'room', 'adult', 'Medicine', 'follow-up message', 'hash-2', 'stored response 2', 'routine_review', :'token2');
do $$
declare order_count integer; message_count integer;
begin
  select count(*) into order_count from public.medical_orders where assignment_id = '33333333-3333-4333-8333-333333333333' and category = 'Consult' and consult_audience = 'adult' and consult_service = 'Medicine';
  select count(*) into message_count from public.consultant_chat_messages where assignment_id = '33333333-3333-4333-8333-333333333333' and audience = 'adult' and specialty = 'Medicine';
  if order_count <> 1 or message_count <> 4 then raise exception 'exact-once/order-reuse assertion failed: orders %, messages %', order_count, message_count; end if;
end $$;

\set req3 '53333333-3333-4333-8333-333333333333'
\set client3 '63333333-3333-4333-8333-333333333333'
\set oldtoken '73333333-3333-4333-8333-333333333333'
\set newtoken '83333333-3333-4333-8333-333333333333'
insert into public.consultant_requests (id, assignment_id, patient_id, room_id, specialty, summary, clinical_question, reason, urgency, client_request_id, message, audience, payload_hash, lease_token, lease_expires_at)
values (:'req3', :'assignment', :'patient', :'room', 'Cardiology', '', '', '', 'routine', :'client3', 'take over', 'adult', 'hash-3', :'oldtoken', now() - interval '1 minute');
update public.consultant_requests set lease_token = :'newtoken', lease_expires_at = now() + interval '5 minutes'
where id = :'req3' and status = 'requested' and (lease_expires_at is null or lease_expires_at <= now());
do $$
begin
  begin
    perform * from public.persist_consultant_response_v2('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', '63333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222', 7001, 'adult', 'Cardiology', 'take over', 'hash-3', 'stale owner must reject', 'routine_review', '73333333-3333-4333-8333-333333333333');
    raise exception 'stale lease owner unexpectedly finalized';
  exception when sqlstate '55P03' then null;
  end;
end $$;
select * from public.persist_consultant_response_v2(:'student', :'assignment', :'client3', :'patient', :'room', 'adult', 'Cardiology', 'take over', 'hash-3', 'takeover response', 'routine_review', :'newtoken');
select * from public.persist_consultant_response_v2(:'student', :'assignment', :'client3', :'patient', :'room', 'adult', 'Cardiology', 'take over', 'hash-3', 'different replay response', 'routine_review', :'newtoken');
do $$
begin
  if (select count(*) from public.consultant_chat_messages where request_id = '53333333-3333-4333-8333-333333333333') <> 2 then raise exception 'lease takeover replay duplicated messages'; end if;
  if (select status from public.consultant_requests where id = '53333333-3333-4333-8333-333333333333') <> 'answered' then raise exception 'lease takeover did not answer request'; end if;
end $$;

\set req4 '54444444-4444-4444-8444-444444444444'
\set client4 '64444444-4444-4444-8444-444444444444'
\set token4 '74444444-4444-4444-8444-444444444444'
insert into public.consultant_requests (id, assignment_id, patient_id, room_id, specialty, summary, clinical_question, reason, urgency, client_request_id, message, audience, payload_hash, lease_token, lease_expires_at)
values (:'req4', :'assignment', :'patient', :'room', 'Pulmonology', '', '', '', 'routine', :'client4', 'fenced message', 'adult', 'hash-4', :'token4', now() + interval '5 minutes');
do $$
begin
  begin
    perform * from public.persist_consultant_response_v2('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', '64444444-4444-4444-8444-444444444444', '22222222-2222-4222-8222-222222222222', 7001, 'adult', 'Pulmonology', 'fenced message', 'hash-4', 'must reject', 'routine_review', '73333333-3333-4333-8333-333333333333');
    raise exception 'old-owner finalize unexpectedly succeeded';
  exception when sqlstate '55P03' then null;
  end;
end $$;

create or replace function public.test_consultant_failure_injection() returns trigger language plpgsql as $$
begin
  if current_setting('consultant.test_failure', true) = TG_ARGV[0] then raise exception 'injected % failure', TG_ARGV[0]; end if;
  return new;
end $$;
create trigger consultant_test_order_failure before insert on public.medical_orders for each row execute function public.test_consultant_failure_injection('order');
create trigger consultant_test_message_failure before insert on public.consultant_chat_messages for each row execute function public.test_consultant_failure_injection('message');

\set req5 '55555555-5555-4555-8555-555555555555'
\set client5 '65555555-5555-4555-8555-555555555555'
\set token5 '75555555-5555-4555-8555-555555555555'
insert into public.consultant_requests (id, assignment_id, patient_id, room_id, specialty, summary, clinical_question, reason, urgency, client_request_id, message, audience, payload_hash, lease_token, lease_expires_at)
values (:'req5', :'assignment', :'patient', :'room', 'Neurology', '', '', '', 'routine', :'client5', 'rollback order', 'adult', 'hash-5', :'token5', now() + interval '5 minutes');
do $$
begin
  perform set_config('consultant.test_failure', 'order', true);
  begin
    perform * from public.persist_consultant_response_v2('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', '65555555-5555-4555-8555-555555555555', '22222222-2222-4222-8222-222222222222', 7001, 'adult', 'Neurology', 'rollback order', 'hash-5', 'not committed', 'routine_review', '75555555-5555-4555-8555-555555555555');
  exception when others then
    if sqlerrm <> 'injected order failure' then raise; end if;
  end;
end $$;
do $$
begin
  if (select status from public.consultant_requests where id = '55555555-5555-4555-8555-555555555555') <> 'requested' then raise exception 'order rollback changed request status'; end if;
  if exists (select 1 from public.medical_orders where assignment_id = '33333333-3333-4333-8333-333333333333' and consult_service = 'Neurology') then raise exception 'order rollback left an order'; end if;
  if exists (select 1 from public.consultant_chat_messages where request_id = '55555555-5555-4555-8555-555555555555') then raise exception 'order rollback left messages'; end if;
end $$;

\set req6 '56666666-6666-4666-8666-666666666666'
\set client6 '66666666-6666-4666-8666-666666666666'
\set token6 '76666666-6666-4666-8666-666666666666'
insert into public.consultant_requests (id, assignment_id, patient_id, room_id, specialty, summary, clinical_question, reason, urgency, client_request_id, message, audience, payload_hash, lease_token, lease_expires_at)
values (:'req6', :'assignment', :'patient', :'room', 'Nephrology', '', '', '', 'routine', :'client6', 'rollback message', 'adult', 'hash-6', :'token6', now() + interval '5 minutes');
do $$
begin
  perform set_config('consultant.test_failure', 'message', true);
  begin
    perform * from public.persist_consultant_response_v2('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', '66666666-6666-4666-8666-666666666666', '22222222-2222-4222-8222-222222222222', 7001, 'adult', 'Nephrology', 'rollback message', 'hash-6', 'not committed', 'routine_review', '76666666-6666-4666-8666-666666666666');
  exception when others then
    if sqlerrm <> 'injected message failure' then raise; end if;
  end;
end $$;
do $$
begin
  if (select status from public.consultant_requests where id = '56666666-6666-4666-8666-666666666666') <> 'requested' then raise exception 'message rollback changed request status'; end if;
  if exists (select 1 from public.medical_orders where assignment_id = '33333333-3333-4333-8333-333333333333' and consult_service = 'Nephrology') then raise exception 'message rollback left an order'; end if;
  if exists (select 1 from public.consultant_chat_messages where request_id = '56666666-6666-4666-8666-666666666666') then raise exception 'message rollback left messages'; end if;
end $$;
drop trigger consultant_test_order_failure on public.medical_orders;
drop trigger consultant_test_message_failure on public.consultant_chat_messages;
drop function public.test_consultant_failure_injection();

\set req7 '57777777-7777-4777-8777-777777777777'
\set client7 '67777777-7777-4777-8777-777777777777'
\set token7 '77777777-7777-4777-8777-777777777777'
insert into public.consultant_requests (id, assignment_id, patient_id, room_id, specialty, summary, clinical_question, reason, urgency, client_request_id, message, audience, payload_hash, lease_token, lease_expires_at)
values (:'req7', :'assignment', :'patient', :'room', 'Infectious Disease', '', '', '', 'routine', :'client7', 'lost readback', 'adult', 'hash-7', :'token7', now() + interval '5 minutes');
select * from public.persist_consultant_response_v2(:'student', :'assignment', :'client7', :'patient', :'room', 'adult', 'Infectious Disease', 'lost readback', 'hash-7', 'committed response', 'routine_review', :'token7');
select * from public.persist_consultant_response_v2(:'student', :'assignment', :'client7', :'patient', :'room', 'adult', 'Infectious Disease', 'lost readback', 'hash-7', 'committed response', 'routine_review', :'token7');
do $$
begin
  if (select count(*) from public.medical_orders where assignment_id = '33333333-3333-4333-8333-333333333333' and consult_service = 'Infectious Disease') <> 1 then raise exception 'lost-readback replay duplicated order'; end if;
  if (select count(*) from public.consultant_chat_messages where request_id = '57777777-7777-4777-8777-777777777777') <> 2 then raise exception 'lost-readback replay duplicated messages'; end if;
end $$;

select 'consultant transport DB integration assertions passed' as result;
