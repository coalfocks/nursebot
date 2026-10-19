\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('app.emr_finalization', '0', true);
select id from public.student_room_assignments
 where id = :'writable_assignment_id'::uuid for update;
select pg_sleep(2);
update public.medical_orders
   set instructions = coalesce(instructions, '') || ' serialized-write-test'
 where id = :'writable_order_id'::uuid;
commit;
