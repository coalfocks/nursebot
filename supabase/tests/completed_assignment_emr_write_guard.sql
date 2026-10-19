-- Disposable-only regression harness for 20261019100000.
-- Run after the migration with psql variables:
--   -v student_id=<student UUID> -v school_admin_id=<admin UUID>
--   -v completed_assignment_id=<completed assignment UUID>
--   -v completed_order_id=<order UUID>
--   -v writable_assignment_id=<assigned/in_progress assignment UUID>
-- This file never commits changes and must not be pointed at production.

\set ON_ERROR_STOP on
begin;

-- A learner cannot update a row belonging to a completed assignment.
select set_config('request.jwt.claim.sub', :'student_id', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('app.emr_finalization', '0', true);
do $test$
begin
  begin
    update public.medical_orders
       set instructions = coalesce(instructions, '') || ' guard-test'
     where id = :'completed_order_id'::uuid
       and assignment_id = :'completed_assignment_id'::uuid;
    raise exception 'EXPECTED_COMPLETED_GUARD_ERROR';
  exception when sqlstate '42501' then
    if sqlerrm not like 'COMPLETED_ASSIGNMENT_READ_ONLY%' then raise; end if;
  end;
end
$test$;

-- UPDATE provenance is checked on both OLD and NEW: moving a completed row to
-- an unassigned row cannot evade the boundary.
do $test$
begin
  begin
    update public.medical_orders
       set assignment_id = null
     where id = :'completed_order_id'::uuid;
    raise exception 'EXPECTED_OLD_PROVENANCE_GUARD_ERROR';
  exception when sqlstate '42501' then
    if sqlerrm not like 'COMPLETED_ASSIGNMENT_READ_ONLY%' then raise; end if;
  end;
end
$test$;

-- A missing auth subject cannot bypass an assignment-scoped write.
select set_config('request.jwt.claim.sub', '', true);
do $test$
begin
  begin
    update public.medical_orders
       set instructions = coalesce(instructions, '') || ' null-auth-guard-test'
     where id = :'completed_order_id'::uuid;
    raise exception 'EXPECTED_NULL_AUTH_GUARD_ERROR';
  exception when sqlstate '42501' then
    if sqlerrm not like 'COMPLETED_ASSIGNMENT_READ_ONLY%' and sqlerrm not like 'ASSIGNMENT_WRITE_NOT_AUTHORIZED%' then raise; end if;
  end;
end
$test$;

-- An explicit service-role finalization context is permitted only for the
-- pre-completion path; it is transaction-local and cannot write the completed
-- row. The completed-row assertion below proves the latter boundary.
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('app.emr_finalization', '1', true);
do $test$
begin
  begin
    update public.medical_orders
       set instructions = coalesce(instructions, '') || ' service-finalization-test'
     where id = :'completed_order_id'::uuid;
    raise exception 'EXPECTED_COMPLETED_FINALIZATION_GUARD_ERROR';
  exception when sqlstate '42501' then
    if sqlerrm not like 'COMPLETED_ASSIGNMENT_READ_ONLY%' then raise; end if;
  end;
end
$test$;

-- Educator access remains scoped and reversible inside the disposable test.
select set_config('request.jwt.claim.sub', :'school_admin_id', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('app.emr_finalization', '0', true);
update public.medical_orders
   set instructions = coalesce(instructions, '') || ' educator-rollback-test'
 where id = :'completed_order_id'::uuid;

rollback;
