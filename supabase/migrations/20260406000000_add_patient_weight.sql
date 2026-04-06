-- Add weight_kg column to patients table
alter table public.patients
add column if not exists weight_kg numeric;

-- Add comment for documentation
comment on column public.patients.weight_kg is 'Patient weight in kilograms';
