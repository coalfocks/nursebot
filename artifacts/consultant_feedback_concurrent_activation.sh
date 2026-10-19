#!/usr/bin/env bash
set -Eeuo pipefail
DB_URL=${1:?usage: concurrent_activation.sh DB_URL}
SUB='11111111-1111-4111-8111-111111111111'
barrier='consultant_upgrade_activation_barrier'
ANCHORS='{"focused_information_gathering":{},"closed_loop_team_communication":{},"efficiency_deduction":{},"orders_monitoring_quality":{},"clinical_reasoning_documentation":{},"safety_deduction":{}}'
create_sql="set request.jwt.claim.sub='$SUB'; select id from public.create_feedback_evaluator_draft('global', null, 'concurrent activation A', '$ANCHORS'); select id from public.create_feedback_evaluator_draft('global', null, 'concurrent activation B', '$ANCHORS');"
mapfile -t ids < <(psql "$DB_URL" -At -v ON_ERROR_STOP=1 -c "$create_sql" | grep -E '^[0-9a-f-]{36}$')
a=${ids[0]}; b=${ids[1]}
if [[ -z "$a" || -z "$b" ]]; then echo 'activation seed did not return two IDs' >&2; exit 1; fi
psql "$DB_URL" -v ON_ERROR_STOP=1 -c "create table if not exists public.$barrier (participant integer primary key); truncate public.$barrier;"
trap 'psql "$DB_URL" -v ON_ERROR_STOP=1 -c "drop table if exists public.$barrier" >/dev/null 2>&1 || true' EXIT
activate() {
  local id=$1
  local participant=$2
  psql "$DB_URL" -v ON_ERROR_STOP=1 -c "
    set request.jwt.claim.sub='$SUB';
    begin;
    insert into public.$barrier(participant) values ($participant);
    commit;
    do \$\$ begin
      for i in 1..200 loop
        if (select count(*) from public.$barrier) = 2 then return; end if;
        perform pg_sleep(0.01);
      end loop;
      raise exception 'activation barrier timeout';
    end \$\$;
    select version,status from public.activate_feedback_evaluator_config('$id');"
}
activate "$a" 1 >"/tmp/activation-a.$$.out" 2>&1 & pa=$!
activate "$b" 2 >"/tmp/activation-b.$$.out" 2>&1 & pb=$!
wait "$pa"; wait "$pb"
cat "/tmp/activation-a.$$.out" "/tmp/activation-b.$$.out"
rm -f "/tmp/activation-a.$$.out" "/tmp/activation-b.$$.out"
active_count=$(psql "$DB_URL" -At -v ON_ERROR_STOP=1 -c "select count(*) from public.feedback_evaluator_configs where scope_identity='global' and status='active';")
[[ "$active_count" == 1 ]] || { echo "expected one active global evaluator, got $active_count" >&2; exit 1; }
if psql "$DB_URL" -v ON_ERROR_STOP=1 -c "update public.feedback_evaluator_configs set status='draft' where status='active';" >/dev/null 2>&1; then
  echo 'status-only update unexpectedly succeeded on a reused connection' >&2
  exit 1
fi
echo "concurrent activation passed: synchronized two-session start; exactly one active version; fresh-connection status update rejected"
