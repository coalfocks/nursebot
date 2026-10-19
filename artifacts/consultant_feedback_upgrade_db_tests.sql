\set ON_ERROR_STOP on
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);

do $$
declare
  global_a uuid;
  anchors jsonb := jsonb_build_object(
    'focused_information_gathering', jsonb_build_object('range', '0-2'),
    'closed_loop_team_communication', jsonb_build_object('range', '0-3'),
    'efficiency_deduction', jsonb_build_object('range', '-2-0'),
    'orders_monitoring_quality', jsonb_build_object('range', '0-3'),
    'clinical_reasoning_documentation', jsonb_build_object('range', '0-2'),
    'safety_deduction', jsonb_build_object('range', '0,-1,-2')
  );
begin
  select (public.create_feedback_evaluator_draft('global', null, 'global prompt', anchors)).id into global_a;
  perform public.create_feedback_evaluator_draft('global', null, 'second global prompt', anchors);
  if (select count(*) from public.feedback_evaluator_configs where scope_identity = 'global' and version in (1, 2)) <> 2 then
    raise exception 'global version allocation failed';
  end if;
  begin
    update public.feedback_evaluator_configs set evaluator_prompt = 'tampered' where id = global_a;
    raise exception 'immutable evaluator update unexpectedly succeeded';
  exception when sqlstate 'P0001' then
    if sqlerrm not like 'EVALUATOR_VERSION_IMMUTABLE:%' then raise; end if;
  end;
end $$;

-- A status-only update is rejected before activation when the flag is unset.
do $$
declare config_id uuid;
begin
  select id into config_id from public.feedback_evaluator_configs where scope_identity = 'global' order by version limit 1;
  begin
    update public.feedback_evaluator_configs set status = 'active' where id = config_id;
    raise exception 'unflagged evaluator status update unexpectedly succeeded';
  exception when sqlstate 'P0001' then
    if sqlerrm not like 'EVALUATOR_VERSION_IMMUTABLE:%' then raise; end if;
  end;
end $$;

-- The activation RPC is the only status transition path; the one-active index
-- also protects against direct/concurrent active inserts.
do $$
begin
  insert into public.feedback_evaluator_configs(scope, version, status, evaluator_prompt, scoring_anchors)
    values ('global', 99, 'active', 'concurrent active', '{}'::jsonb);
  insert into public.feedback_evaluator_configs(scope, version, status, evaluator_prompt, scoring_anchors)
    values ('global', 100, 'active', 'second active', '{}'::jsonb);
  raise exception 'one-active-scope constraint unexpectedly allowed two active rows';
exception when unique_violation then null;
end $$;

select 'feedback evaluator upgrade constraints passed' as result;
