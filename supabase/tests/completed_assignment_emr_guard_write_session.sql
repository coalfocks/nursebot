\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('app.emr_finalization', '0', true);
update public.medical_orders
   set instructions = coalesce(instructions, '') || ' serialized-write-test'
 where id = :'writable_order_id'::uuid;
\set ON_ERROR_STOP on
select 'WRITER_LOCK_HELD' as synchronization_marker;
-- Keep the transaction open after the trigger obtains the authoritative
-- assignment lock; the completion session must wait on that real lock.
select pg_sleep(2);
commit;
