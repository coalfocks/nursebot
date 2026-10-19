\set ON_ERROR_STOP on
begin;
update public.student_room_assignments
   set status = 'completed'
 where id = :'writable_assignment_id'::uuid;
commit;
