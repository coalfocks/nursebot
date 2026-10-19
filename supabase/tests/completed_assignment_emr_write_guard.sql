-- Disposable-only regression harness for 20261019100000.
-- Required psql variables:
--   student_id, school_admin_id, denied_school_admin_id,
--   completed_assignment_id, completed_order_id, writable_assignment_id,
--   writable_order_id
--
-- Run with psql -v ON_ERROR_STOP=1 and never point at production. Values are
-- copied into transaction-local settings because psql does not interpolate
-- variables inside dollar-quoted DO bodies.

\set ON_ERROR_STOP on
begin;
select set_config('app.test.student_id', :'student_id', true);
select set_config('app.test.school_admin_id', :'school_admin_id', true);
select set_config('app.test.denied_school_admin_id', :'denied_school_admin_id', true);
select set_config('app.test.completed_assignment_id', :'completed_assignment_id', true);
select set_config('app.test.completed_order_id', :'completed_order_id', true);
select set_config('app.test.writable_assignment_id', :'writable_assignment_id', true);
select set_config('app.test.writable_order_id', :'writable_order_id', true);

-- Student writes to a completed assignment fail closed.
select set_config('request.jwt.claim.sub', current_setting('app.test.student_id'), true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('app.emr_finalization', '0', true);
do $test$
begin
  begin
    update public.medical_orders
       set instructions = coalesce(instructions, '') || ' guard-test'
     where id = current_setting('app.test.completed_order_id')::uuid
       and assignment_id = current_setting('app.test.completed_assignment_id')::uuid;
    raise exception 'EXPECTED_COMPLETED_GUARD_ERROR';
  exception when sqlstate '42501' then
    if sqlerrm not like 'COMPLETED_ASSIGNMENT_READ_ONLY%' then raise; end if;
  end;
end
$test$;

-- OLD provenance cannot be escaped by moving a completed row to NULL.
do $test$
begin
  begin
    update public.medical_orders
       set assignment_id = null
     where id = current_setting('app.test.completed_order_id')::uuid;
    raise exception 'EXPECTED_OLD_PROVENANCE_GUARD_ERROR';
  exception when sqlstate '42501' then
    if sqlerrm not like 'COMPLETED_ASSIGNMENT_READ_ONLY%' then raise; end if;
  end;
end
$test$;

-- NULL auth cannot bypass a completed or active assignment write.
select set_config('request.jwt.claim.sub', '', true);
do $test$
begin
  -- RLS denies both rows before the trigger when auth.uid() is NULL; this is
  -- itself the required fail-closed result for a direct/Edge learner path.
  update public.medical_orders
     set instructions = coalesce(instructions, '') || ' null-auth-guard-test'
   where id = current_setting('app.test.completed_order_id')::uuid;
  if found then raise exception 'EXPECTED_NULL_AUTH_GUARD_ERROR'; end if;
  update public.medical_orders
     set instructions = coalesce(instructions, '') || ' null-auth-active-test'
   where id = current_setting('app.test.writable_order_id')::uuid;
  if found then raise exception 'EXPECTED_NULL_AUTH_ACTIVE_GUARD_ERROR'; end if;
end
$test$;

-- An authenticated learner may write only to its own active assignment.
select set_config('request.jwt.claim.sub', current_setting('app.test.student_id'), true);
select set_config('request.jwt.claim.role', 'authenticated', true);
update public.medical_orders
   set instructions = coalesce(instructions, '') || ' active-learner-test'
 where id = current_setting('app.test.writable_order_id')::uuid
   and assignment_id = current_setting('app.test.writable_assignment_id')::uuid;

-- Service finalization is permitted only for an active assignment and is
-- transaction-local; completed rows remain protected.
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('app.emr_finalization', '1', true);
update public.medical_orders
   set instructions = coalesce(instructions, '') || ' service-finalization-test'
 where id = current_setting('app.test.writable_order_id')::uuid;
do $test$
begin
  begin
    update public.medical_orders
       set instructions = coalesce(instructions, '') || ' completed-finalization-test'
     where id = current_setting('app.test.completed_order_id')::uuid;
    raise exception 'EXPECTED_COMPLETED_FINALIZATION_GUARD_ERROR';
  exception when sqlstate '42501' then
    if sqlerrm not like 'COMPLETED_ASSIGNMENT_READ_ONLY%' then raise; end if;
  end;
end
$test$;

-- Educator access is scoped: the allowed school admin may edit the completed
-- row; a cross-school admin must be denied by the fixture's RLS/policy setup.
select set_config('request.jwt.claim.sub', current_setting('app.test.school_admin_id'), true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('app.emr_finalization', '0', true);
update public.medical_orders
   set instructions = coalesce(instructions, '') || ' educator-allowed-test'
 where id = current_setting('app.test.completed_order_id')::uuid;

select set_config('request.jwt.claim.sub', current_setting('app.test.denied_school_admin_id'), true);
do $test$
begin
  -- RLS should filter the cross-school row before the trigger runs.
  begin
    update public.medical_orders
       set instructions = coalesce(instructions, '') || ' educator-denied-test'
     where id = current_setting('app.test.completed_order_id')::uuid;
    if found then
      raise exception 'EXPECTED_CROSS_SCHOOL_ADMIN_ERROR';
    end if;
  end;
end
$test$;

rollback;
