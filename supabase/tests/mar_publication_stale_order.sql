-- Disposable-only stale composite preview fixture. It proves that an Order
-- edit between preview and publish cannot be silently captured by a request
-- carrying the old Orders+MAR hash.
\set ON_ERROR_STOP on
select set_config('request.jwt.claim.sub', :'admin_sub', false);
select set_config('mar.test.room_id', :'room_id', false);
select set_config('mar.test.request_id', gen_random_uuid()::text, false);
select set_config('mar.test.preview', public.get_mar_publication_preview(current_setting('mar.test.room_id')::integer)::text, false);

select set_config('mar.test.preview_revision', current_setting('mar.test.preview')::jsonb->>'revision', false);
select set_config('mar.test.preview_hash', current_setting('mar.test.preview')::jsonb->>'contentHash', false);

-- Simulate a committed authoring edit after the preview was rendered. The
-- publish request still carries the old composite hash.
update public.medical_orders
set dose = '21 mg', record_version = record_version + 1
where id = (select id from public.medical_orders where room_id = current_setting('mar.test.room_id')::integer and category = 'Medication' limit 1);

set role authenticated;
do $$ begin
  begin
    perform public.publish_mar_case_version_atomic(
      current_setting('mar.test.request_id')::uuid,
      current_setting('mar.test.room_id')::integer,
      current_setting('mar.test.preview_revision')::integer,
      current_setting('mar.test.preview_hash'),
      null
    );
    raise exception 'MAR_PUBLICATION_STALE_ORDER_ACCEPTED';
  exception when others then
    if sqlerrm not like '%MAR_PUBLICATION_CONTENT_CONFLICT%' then raise; end if;
  end;
end $$;
reset role;

do $$ begin
  if exists (select 1 from public.mar_publication_operations where request_id = current_setting('mar.test.request_id')::uuid)
     then raise exception 'MAR_PUBLICATION_STALE_ORDER_LEFT_OPERATION'; end if;
end $$;

select 'MAR_PUBLICATION_STALE_ORDER_PASS' as result,
  current_setting('mar.test.preview_hash') as old_hash,
  (public.get_mar_publication_preview(current_setting('mar.test.room_id')::integer)->>'contentHash') as current_hash;
