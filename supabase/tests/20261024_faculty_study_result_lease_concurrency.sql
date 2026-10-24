-- Isolated two-session regression fixture for the faculty-study result fence.
-- The runner starts session A and B concurrently; B's reclaim must wait for
-- A's FOR UPDATE transaction, then A's late write must return false.

create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
do $$ begin
  create role anon noinherit;
exception when duplicate_object then null; end $$;
do $$ begin
  create role authenticated noinherit;
exception when duplicate_object then null; end $$;
do $$ begin
  create role service_role noinherit;
exception when duplicate_object then null; end $$;
create extension if not exists pgcrypto;

insert into auth.users(id) values ('00000000-0000-4000-8000-000000000001') on conflict do nothing;

drop table if exists public.faculty_study_results cascade;
drop table if exists public.faculty_study_batches cascade;
