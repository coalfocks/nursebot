#!/usr/bin/env bash
set -Eeuo pipefail
DB_URL=${1:?usage: concurrent_retry.sh DB_URL}
student='11111111-1111-4111-8111-111111111111'
assignment='33333333-3333-4333-8333-333333333333'
patient='22222222-2222-4222-8222-222222222222'
request='58888888-8888-4888-8888-888888888888'
client='68888888-8888-4888-8888-888888888888'
token='78888888-8888-4888-8888-888888888888'
barrier='consultant_upgrade_retry_barrier'
psql "$DB_URL" -v ON_ERROR_STOP=1 -c "insert into public.consultant_requests (id,assignment_id,patient_id,room_id,specialty,summary,clinical_question,reason,urgency,client_request_id,message,audience,payload_hash,lease_token,lease_expires_at) values ('$request','$assignment','$patient',7001,'Rheumatology','','','','routine','$client','concurrent same id','adult','hash-race','$token',now()+interval '5 minutes');"
call="select * from public.persist_consultant_response_v2('$student','$assignment','$client','$patient',7001,'adult','Rheumatology','concurrent same id','hash-race','concurrent response','routine_review','$token');"
psql "$DB_URL" -v ON_ERROR_STOP=1 -c "create table if not exists public.$barrier (participant integer primary key); truncate public.$barrier;"
trap 'psql "$DB_URL" -v ON_ERROR_STOP=1 -c "drop table if exists public.$barrier" >/dev/null 2>&1 || true' EXIT
call_with_barrier() {
  local participant=$1
  psql "$DB_URL" -v ON_ERROR_STOP=1 -c "
    begin;
    insert into public.$barrier(participant) values ($participant);
    commit;
    do \$\$ begin
      for i in 1..200 loop
        if (select count(*) from public.$barrier) = 2 then return; end if;
        perform pg_sleep(0.01);
      end loop;
      raise exception 'retry barrier timeout';
    end \$\$;
    $call"
}
call_with_barrier 1 >"/tmp/retry-a.$$.out" 2>&1 & pa=$!
call_with_barrier 2 >"/tmp/retry-b.$$.out" 2>&1 & pb=$!
wait "$pa"; wait "$pb"
cat "/tmp/retry-a.$$.out" "/tmp/retry-b.$$.out"
rm -f "/tmp/retry-a.$$.out" "/tmp/retry-b.$$.out"
orders=$(psql "$DB_URL" -At -v ON_ERROR_STOP=1 -c "select count(*) from public.medical_orders where assignment_id='$assignment' and consult_service='Rheumatology';")
messages=$(psql "$DB_URL" -At -v ON_ERROR_STOP=1 -c "select count(*) from public.consultant_chat_messages where request_id='$request';")
[[ "$orders" == 1 && "$messages" == 2 ]] || { echo "expected one order/two messages, got $orders/$messages" >&2; exit 1; }
echo "concurrent retry passed: synchronized two-session start; one order, two messages"
