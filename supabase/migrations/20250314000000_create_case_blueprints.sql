-- Case blueprints let admins capture rich nurse chat scenarios in-app
create table if not exists case_blueprints (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  specialty text not null,
  difficulty text not null check (difficulty in ('easy', 'intermediate', 'difficult')),
  objectives text not null,
  admitting_hpi text not null,
  hospital_days int,
  admit_orders text,
  admission_vitals text,
  admission_labs text,
  admission_exam text,
  initial_message text,
  bedside_required boolean default false,
  event_vitals text,
  nurse_exam text,
  bedside_exam text,
  typical_questions text[] default '{}',
  imaging_and_orders text,
  harmful_actions text[] default '{}',
  progress_note text,
  created_by uuid references public.profiles (id),
  school_id uuid not null references public.schools (id) on delete cascade,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

comment on table case_blueprints is 'Admin-authored nurse chat case blueprints captured inside the app.';
comment on column case_blueprints.difficulty is 'Normalized difficulty labels: easy, intermediate, difficult.';

create index if not exists idx_case_blueprints_school_id on case_blueprints(school_id);
create index if not exists idx_case_blueprints_difficulty on case_blueprints(difficulty);

-- Keep timestamps fresh
create trigger case_blueprints_set_updated_at
  before update on case_blueprints
  for each row
  execute function update_updated_at_column();

-- Default school scoping to the creator when missing
create or replace function set_case_blueprint_school_id()
returns trigger as $$
begin
  if new.school_id is null and new.created_by is not null then
    select school_id into new.school_id
    from profiles
    where id = new.created_by;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists case_blueprints_set_school_id on case_blueprints;
create trigger case_blueprints_set_school_id
  before insert on case_blueprints
  for each row
  when (new.school_id is null)
  execute function set_case_blueprint_school_id();

-- RLS
alter table case_blueprints enable row level security;

drop policy if exists "Admins manage case blueprints" on case_blueprints;
drop policy if exists "Service role manages case blueprints" on case_blueprints;

create policy "Service role manages case blueprints"
on case_blueprints
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

create policy "Admins manage case blueprints"
on case_blueprints
for all
using (
  exists (
    select 1 from profiles p
    where p.id = auth.uid()
      and p.role in ('school_admin', 'super_admin')
      and (
        p.role = 'super_admin'
        or p.school_id = case_blueprints.school_id
      )
  )
)
with check (
  exists (
    select 1 from profiles p
    where p.id = auth.uid()
      and p.role in ('school_admin', 'super_admin')
      and (
        p.role = 'super_admin'
        or p.school_id = case_blueprints.school_id
      )
  )
);
