-- Rejected evaluator candidates are staff diagnostics, never student feedback.
-- Restrictive policy also covers future permissive policies on this table.
create policy "Rejected feedback candidates are staff only"
on public.feedback_assessment_runs as restrictive for select to authenticated
using (
  coalesce(result->>'status', '') <> 'rejected'
  or exists (
    select 1 from public.student_room_assignments a
    join public.rooms r on r.id = a.room_id
    join public.profiles p on p.id = auth.uid()
    where a.id = assignment_id
      and (p.role = 'super_admin' or (p.role = 'school_admin' and p.school_id = r.school_id))
  )
);
