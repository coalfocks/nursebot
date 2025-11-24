alter table public.medical_orders
  add column if not exists assignment_id uuid references public.student_room_assignments (id) on delete set null;

alter table public.lab_results
  add column if not exists assignment_id uuid references public.student_room_assignments (id) on delete set null;
