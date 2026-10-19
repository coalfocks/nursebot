#!/usr/bin/env bash
set -Eeuo pipefail
DB_URL=${1:?usage: concurrent_retry.sh DB_URL}
student='11111111-1111-4111-8111-111111111111'
assignment='33333333-3333-4333-8333-333333333333'
patient='22222222-2222-4222-8222-222222222222'
request='58888888-8888-4888-8888-888888888888'
client='68888888-8888-4888-8888-888888888888'
token='78888888-8888-4888-8888-888888888888'
psql "$DB_URL" -v ON_ERROR_STOP=1 -c "insert into public.consultant_requests (id,assignment_id,patient_id,room_id,specialty,summary,clinical_question,reason,urgency,client_request_id,message,audience,payload_hash,lease_token,lease_expires_at) values ('$request','$assignment','$patient',7001,'Rheumatology','','','','routine','$client','concurrent same id','adult','hash-race','$token',now()+interval '5 minutes');"
call="select * from public.persist_consultant_response_v2('$student','$assignment','$client','$patient',7001,'adult','Rheumatology','concurrent same id','hash-race','concurrent response','routine_review','$token');"
psql "$DB_URL" -v ON_ERROR_STOP=1 -c "$call" >"${TMPDIR:-/tmp}/retry-a.$$.out" 2>&1 & pa=$!
psql "$DB_URL" -v ON_ERROR_STOP=1 -c "$call" >"${TMPDIR:-/tmp}/retry-b.$$.out" 2>&1 & pb=$!
wait "$pa"; wait "$pb"
cat "${TMPDIR:-/tmp}/retry-a.$$.out" "${TMPDIR:-/tmp}/retry-b.$$.out"
rm -f "${TMPDIR:-/tmp}/retry-a.$$.out" "${TMPDIR:-/tmp}/retry-b.$$.out"
orders=$(psql "$DB_URL" -At -v ON_ERROR_STOP=1 -c "select count(*) from public.medical_orders where assignment_id='$assignment' and consult_service='Rheumatology';")
messages=$(psql "$DB_URL" -At -v ON_ERROR_STOP=1 -c "select count(*) from public.consultant_chat_messages where request_id='$request';")
[[ "$orders" == 1 && "$messages" == 2 ]] || { echo "expected one order/two messages, got $orders/$messages" >&2; exit 1; }
echo "concurrent retry passed: one order, two messages"
