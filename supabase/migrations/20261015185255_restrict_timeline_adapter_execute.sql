revoke all on function public.materialize_hospital_timeline(integer, uuid, uuid, uuid, jsonb, text, timestamptz) from anon;
revoke all on function public.materialize_hospital_timeline(integer, uuid, uuid, uuid, jsonb, text, timestamptz) from public;
grant execute on function public.materialize_hospital_timeline(integer, uuid, uuid, uuid, jsonb, text, timestamptz) to authenticated;
