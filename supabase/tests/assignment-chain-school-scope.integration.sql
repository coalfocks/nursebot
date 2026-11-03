-- Isolated source-contract fixture for the chain finalizer's room scope.
-- Run only in a disposable database after the reviewed MAR scope function and
-- prospective chain migration are applied; this file never changes product
-- data and is not an automatic migration.

do $$
declare
  primary_school uuid := '00000000-0000-0000-0000-000000000001';
  actor_school uuid := '00000000-0000-0000-0000-000000000002';
  foreign_school uuid := '00000000-0000-0000-0000-000000000003';
begin
  -- Global availability is valid even when primary ownership is another
  -- school; NULL and empty arrays both have the existing global meaning.
  if not public.mar_effective_school_allowed(primary_school, null, actor_school)
     or not public.mar_effective_school_allowed(primary_school, '{}'::uuid[], actor_school) then
    raise exception 'shared/global room scope fixture rejected';
  end if;

  -- A restricted room remains denied to a foreign actor school.
  if public.mar_effective_school_allowed(primary_school, array[foreign_school], actor_school) then
    raise exception 'foreign room scope fixture accepted';
  end if;
end $$;

select 'shared/global and denied-foreign room scope fixtures passed' as result;
