-- Create EMR tables for patients, clinical notes, labs, vitals, and orders
-- Soft deletes via deleted_at

create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools (id) on delete set null,
  room_id integer references public.rooms (id) on delete set null,
  mrn text not null,
  first_name text not null,
  last_name text not null,
  date_of_birth date not null,
  gender text not null,
  service text,
  admission_date date,
  attending_physician text,
  allergies text[] default '{}',
  code_status text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);

create table if not exists public.clinical_notes (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references public.patients (id) on delete cascade,
  school_id uuid references public.schools (id) on delete set null,
  note_type text not null,
  title text not null,
  content text not null,
  author text,
  timestamp timestamptz default now(),
  signed boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);

create table if not exists public.lab_results (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references public.patients (id) on delete cascade,
  school_id uuid references public.schools (id) on delete set null,
  test_name text not null,
  value numeric,
  unit text,
  reference_range text,
  status text,
  collection_time timestamptz,
  result_time timestamptz,
  ordered_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);

create table if not exists public.vital_signs (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references public.patients (id) on delete cascade,
  school_id uuid references public.schools (id) on delete set null,
  timestamp timestamptz not null,
  temperature numeric,
  blood_pressure_systolic numeric,
  blood_pressure_diastolic numeric,
  heart_rate numeric,
  respiratory_rate numeric,
  oxygen_saturation numeric,
  pain numeric,
  weight numeric,
  height numeric,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);

create table if not exists public.medical_orders (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references public.patients (id) on delete cascade,
  school_id uuid references public.schools (id) on delete set null,
  category text not null,
  order_name text not null,
  frequency text,
  route text,
  dose text,
  priority text,
  status text default 'Active',
  ordered_by text,
  order_time timestamptz default now(),
  scheduled_time timestamptz,
  instructions text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);

-- Triggers to keep updated_at fresh
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger patients_set_updated_at
before update on public.patients
for each row execute function public.set_updated_at();

create trigger clinical_notes_set_updated_at
before update on public.clinical_notes
for each row execute function public.set_updated_at();

create trigger lab_results_set_updated_at
before update on public.lab_results
for each row execute function public.set_updated_at();

create trigger vital_signs_set_updated_at
before update on public.vital_signs
for each row execute function public.set_updated_at();

create trigger medical_orders_set_updated_at
before update on public.medical_orders
for each row execute function public.set_updated_at();

-- Minimal RLS: allow all authenticated access (since fake data)
alter table public.patients enable row level security;
alter table public.clinical_notes enable row level security;
alter table public.lab_results enable row level security;
alter table public.vital_signs enable row level security;
alter table public.medical_orders enable row level security;

create policy "allow authenticated read" on public.patients for select using (auth.role() = 'authenticated');
create policy "allow authenticated write" on public.patients for all using (auth.role() = 'authenticated');

create policy "allow authenticated read" on public.clinical_notes for select using (auth.role() = 'authenticated');
create policy "allow authenticated write" on public.clinical_notes for all using (auth.role() = 'authenticated');

create policy "allow authenticated read" on public.lab_results for select using (auth.role() = 'authenticated');
create policy "allow authenticated write" on public.lab_results for all using (auth.role() = 'authenticated');

create policy "allow authenticated read" on public.vital_signs for select using (auth.role() = 'authenticated');
create policy "allow authenticated write" on public.vital_signs for all using (auth.role() = 'authenticated');

create policy "allow authenticated read" on public.medical_orders for select using (auth.role() = 'authenticated');
create policy "allow authenticated write" on public.medical_orders for all using (auth.role() = 'authenticated');
