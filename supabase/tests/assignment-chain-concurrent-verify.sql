\set ON_ERROR_STOP on
do $$
declare intent_count integer; member_count integer;
begin
  select count(*) into intent_count from public.assignment_chain_intents
    where chain_id in ('00000000-0000-0000-0000-000000000501'::uuid, '00000000-0000-0000-0000-000000000502'::uuid);
  select count(*) into member_count from public.assignment_chain_intent_members
    where assignment_id = any(array[
      '00000000-0000-0000-0000-000000004701'::uuid,
      '00000000-0000-0000-0000-000000004702'::uuid,
      '00000000-0000-0000-0000-000000004703'::uuid
    ]);
  if intent_count <> 1 or member_count <> 3 then
    raise exception 'concurrent membership result invalid: intents %, members %', intent_count, member_count;
  end if;
end $$;
select 'concurrent distinct-chain contender denial preserved one immutable membership' as result;
