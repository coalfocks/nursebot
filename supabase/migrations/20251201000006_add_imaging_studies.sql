create table if not exists public.imaging_studies (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references public.patients (id) on delete cascade,
  assignment_id uuid references public.student_room_assignments (id) on delete set null,
  room_id integer references public.rooms (id) on delete set null,
  override_scope text not null default 'baseline',
  school_id uuid references public.schools (id) on delete set null,
  order_name text,
  study_type text not null,
  contrast text,
  priority text,
  status text default 'Completed',
  ordered_by text,
  order_time timestamptz default now(),
  report text,
  report_generated_at timestamptz,
  images jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz,
  constraint imaging_studies_override_scope_check check (override_scope in ('baseline', 'room', 'assignment')),
  constraint imaging_studies_assignment_scope_check check (override_scope <> 'assignment' or assignment_id is not null),
  constraint imaging_studies_room_scope_check check (override_scope <> 'room' or room_id is not null)
);

create trigger imaging_studies_set_updated_at
before update on public.imaging_studies
for each row execute function public.set_updated_at();

alter table public.imaging_studies enable row level security;

create policy "allow authenticated read" on public.imaging_studies for select
using (auth.role() = 'authenticated');

create policy "allow authenticated write" on public.imaging_studies for all
using (auth.role() = 'authenticated');
