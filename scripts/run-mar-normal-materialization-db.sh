#!/usr/bin/env bash
set -euo pipefail

(( BASH_VERSINFO[0] >= 4 )) || { echo 'Bash 4+ required' >&2; exit 2; }
[[ "${MAR_NORMAL_DISPOSABLE:-}" == 1 ]] || { echo 'Refusing without MAR_NORMAL_DISPOSABLE=1' >&2; exit 2; }
command -v psql >/dev/null || { echo 'psql required' >&2; exit 2; }
: "${MAR_NORMAL_DATABASE_URL:?Set MAR_NORMAL_DATABASE_URL to an isolated disposable PostgreSQL URL}"
: "${MAR_NORMAL_DISPOSABLE_ID:?Set MAR_NORMAL_DISPOSABLE_ID to an isolated fixture identity (for example mar-normal-v4-<run>)}"
[[ "$MAR_NORMAL_DISPOSABLE_ID" =~ ^mar-normal-[a-z0-9-]+$ ]] || { echo 'Refusing non-disposable fixture identity' >&2; exit 2; }
db_host="$(printf '%s' "$MAR_NORMAL_DATABASE_URL" | sed -E 's#^[^:]+://##; s#^[^@]*@##; s#[:/?].*$##')"
[[ "$db_host" == '127.0.0.1' || "$db_host" == 'localhost' ]] || { echo 'Refusing non-local database host for disposable runner' >&2; exit 2; }
MAR_NORMAL_ADMIN_SUB="${MAR_NORMAL_ADMIN_SUB:-00000000-0000-0000-0000-000000000002}"
MAR_NORMAL_STUDENT_SUB="${MAR_NORMAL_STUDENT_SUB:-00000000-0000-0000-0000-000000000001}"
MAR_NORMAL_UNLISTED_SUB="${MAR_NORMAL_UNLISTED_SUB:-00000000-0000-0000-0000-000000000003}"
MAR_NORMAL_ROOM_ID="${MAR_NORMAL_ROOM_ID:-1}"

root_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
log_file="${MAR_NORMAL_RAW_LOG:-$root_dir/artifacts/mar_normal_materialization_raw_$(date -u +%Y%m%dT%H%M%SZ).log}"
mkdir -p "$(dirname -- "$log_file")"
exec > >(tee "$log_file") 2>&1

assert_hash() {
  local file="$1" expected="$2" actual
  actual="$(sha256sum "$root_dir/$file" | awk '{print $1}')"
  [[ "$actual" == "$expected" ]] || { echo "HASH_MISMATCH $file expected=$expected actual=$actual"; exit 1; }
  echo "PIN $file sha256=$actual"
}
assert_hash supabase/migrations/20261019100009_mar_authored_baseline_and_administrations.sql 6f60888b3177dc750e0c8762c90ef0ecec62644f98299217570e3dc6b1555d88
assert_hash supabase/migrations/20261019100010_mar_authorized_scope_materialization.sql d2ad577476c2d42daa88015786210abf8822c3c7f22aec1a95ada6e90c001a16
assert_hash supabase/migrations/20261019100011_mar_read_scope_and_versions.sql ce3ac9202ccd5a2e8aa0c19de1dfcc23035531a9b25d4c2352e1400356efe302
assert_hash supabase/migrations/20261019100012_mar_atomic_snapshot_save.sql 24e38096a83a8da0c368a1fd66f86ea1f8087f3c1e9e648088c7a1ea741efbc3
assert_hash supabase/migrations/20261019100013_mar_revoke_split_mutators.sql 5f4a0461fbd681eabb58df0bfec348061ce2c3717fea365c6f66f287b3850ea8
assert_hash supabase/migrations/20261019100014_mar_normal_assignment_materialization.sql fac9d122c86545d4e9e6e68bbb424fb4d38f2dc0bcec5a70e53ce25d5b7f60b4
assert_hash supabase/migrations/20261019100015_mar_materialization_scope_and_snapshot_reader.sql 5c16453d6cd3c883cd1b83cebeb3466a4f80473f71621289abd2496efc4f622a
assert_hash supabase/migrations/20261019100016_mar_scope_and_publication_hardening.sql 55757099739e277b2409f6d102a5b067db2ab863b0a601f74964eaeb9a686bf1
assert_hash supabase/migrations/20261019155910_mar_publication_idempotency_and_order_merge.sql e3ec5f606c6fd3437ab50f00647554f3a32c823d030625d9dfd68da4ba061853
assert_hash supabase/migrations/20261019160000_mar_publication_contract_v5.sql edbabeb3b82346d456f5e04e3597aae001e5ec00aebd616f54d0fa73c21ae223

echo 'Applying only the append-only reviewed dependency set to the disposable database.'
psql "$MAR_NORMAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$root_dir/supabase/tests/mar_normal_materialization_schema.sql"
psql "$MAR_NORMAL_DATABASE_URL" -v ON_ERROR_STOP=1 -c 'grant authenticated to postgres'
for migration in \
  supabase/migrations/20261019100009_mar_authored_baseline_and_administrations.sql \
  supabase/migrations/20261019100010_mar_authorized_scope_materialization.sql \
  supabase/migrations/20261019100011_mar_read_scope_and_versions.sql; do
  echo "APPLY $migration"
  psql "$MAR_NORMAL_DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f "$root_dir/$migration"
done
echo 'APPLY 100012+100013 as one reviewed transaction unit'
psql "$MAR_NORMAL_DATABASE_URL" -v ON_ERROR_STOP=1 -1 \
  -f "$root_dir/supabase/migrations/20261019100012_mar_atomic_snapshot_save.sql" \
  -f "$root_dir/supabase/migrations/20261019100013_mar_revoke_split_mutators.sql"
echo 'APPLY 100014+100015+100016+155910+160000 as one coordinated materialization/publication unit'
psql "$MAR_NORMAL_DATABASE_URL" -v ON_ERROR_STOP=1 -1 \
  -f "$root_dir/supabase/migrations/20261019100014_mar_normal_assignment_materialization.sql" \
  -f "$root_dir/supabase/migrations/20261019100015_mar_materialization_scope_and_snapshot_reader.sql" \
  -f "$root_dir/supabase/migrations/20261019100016_mar_scope_and_publication_hardening.sql" \
  -f "$root_dir/supabase/migrations/20261019155910_mar_publication_idempotency_and_order_merge.sql" \
  -f "$root_dir/supabase/migrations/20261019160000_mar_publication_contract_v5.sql"
psql "$MAR_NORMAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$root_dir/supabase/tests/mar_normal_materialization_seed.sql"

echo 'READINESS'
readiness_json="$(psql "$MAR_NORMAL_DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "select public.get_mar_normal_materialization_readiness();")"
echo "$readiness_json"
[[ "$readiness_json" == *'"ready": true'* && "$readiness_json" == *'"materializationVersion": 5'* && "$readiness_json" == *'"publicationPreviewVersion": 5'* ]] || { echo 'readiness contract assertion failed' >&2; exit 1; }
echo 'FIXTURE'
assignment_id="$(uuidgen)"
request_id="$(uuidgen)"
psql "$MAR_NORMAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v admin_sub="$MAR_NORMAL_ADMIN_SUB" -v student_sub="$MAR_NORMAL_STUDENT_SUB" -v room_id="$MAR_NORMAL_ROOM_ID" \
  -v assignment_id="$assignment_id" -v request_id="$request_id" \
  -f "$root_dir/supabase/tests/mar_normal_assignment_materialization_v2.sql"
echo 'PUBLICATION RETRY/REVISION FIXTURE'
psql "$MAR_NORMAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v admin_sub="$MAR_NORMAL_ADMIN_SUB" -v room_id="$MAR_NORMAL_ROOM_ID" \
  -f "$root_dir/supabase/tests/mar_publication_idempotency.sql"
echo 'PUBLICATION STALE ORDERS+MAR PREVIEW FIXTURE'
psql "$MAR_NORMAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v admin_sub="$MAR_NORMAL_ADMIN_SUB" -v room_id="$MAR_NORMAL_ROOM_ID" \
  -f "$root_dir/supabase/tests/mar_publication_stale_order.sql"
echo 'PUBLICATION CONCURRENCY'
MAR_NORMAL_ROOM_ID="$MAR_NORMAL_ROOM_ID" MAR_NORMAL_ADMIN_SUB="$MAR_NORMAL_ADMIN_SUB" \
  bash "$root_dir/scripts/run-mar-publication-concurrent.sh"
echo 'AUTH_SCOPE_NEGATIVES'
missing_output="$(psql "$MAR_NORMAL_DATABASE_URL" -v ON_ERROR_STOP=0 -Atc "select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000099',false); select public.create_assignment_with_mar_materialization(gen_random_uuid(),gen_random_uuid(),'$MAR_NORMAL_STUDENT_SUB'::uuid,$MAR_NORMAL_ROOM_ID,(select school_id from public.profiles where id='$MAR_NORMAL_STUDENT_SUB'::uuid),(select case_version from public.mar_authored_case_versions where room_id=$MAR_NORMAL_ROOM_ID order by created_at desc limit 1),now(),now(),now()+interval '1 hour');" 2>&1 || true)"
echo "$missing_output"
[[ "$missing_output" == *'MAR_ADMIN_REQUIRED'* ]] || { echo 'missing-profile denial assertion failed' >&2; exit 1; }
anon_output="$(psql "$MAR_NORMAL_DATABASE_URL" -v ON_ERROR_STOP=0 -Atc "select set_config('request.jwt.claim.sub','',false); select public.create_assignment_with_mar_materialization(gen_random_uuid(),gen_random_uuid(),'$MAR_NORMAL_STUDENT_SUB'::uuid,$MAR_NORMAL_ROOM_ID,(select school_id from public.profiles where id='$MAR_NORMAL_STUDENT_SUB'::uuid),(select case_version from public.mar_authored_case_versions where room_id=$MAR_NORMAL_ROOM_ID order by created_at desc limit 1),now(),now(),now()+interval '1 hour');" 2>&1 || true)"
echo "$anon_output"
[[ "$anon_output" == *'MAR_AUTH_REQUIRED'* ]] || { echo 'anonymous denial assertion failed' >&2; exit 1; }
unlisted_output="$(psql "$MAR_NORMAL_DATABASE_URL" -v ON_ERROR_STOP=0 -Atc "select set_config('request.jwt.claim.sub','$MAR_NORMAL_ADMIN_SUB',false); select public.create_assignment_with_mar_materialization(gen_random_uuid(),gen_random_uuid(),'$MAR_NORMAL_UNLISTED_SUB'::uuid,$MAR_NORMAL_ROOM_ID,(select school_id from public.profiles where id='$MAR_NORMAL_UNLISTED_SUB'::uuid),(select case_version from public.mar_authored_case_versions where room_id=$MAR_NORMAL_ROOM_ID order by created_at desc limit 1),now(),now(),now()+interval '1 hour');" 2>&1 || true)"
echo "$unlisted_output"
[[ "$unlisted_output" == *'MAR_STUDENT_ROOM_UNAVAILABLE'* ]] || { echo 'unlisted-school denial assertion failed' >&2; exit 1; }
echo 'SCHOOL_AVAILABILITY_SEMANTICS'
availability_output="$(psql "$MAR_NORMAL_DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "select public.mar_effective_school_allowed('00000000-0000-0000-0000-0000000000a1'::uuid, null, '00000000-0000-0000-0000-0000000000a2'::uuid), public.mar_effective_school_allowed('00000000-0000-0000-0000-0000000000a1'::uuid, array['00000000-0000-0000-0000-0000000000a2']::uuid[], '00000000-0000-0000-0000-0000000000a2'::uuid), public.mar_effective_school_allowed('00000000-0000-0000-0000-0000000000a1'::uuid, '{}'::uuid[], '00000000-0000-0000-0000-0000000000a2'::uuid);")"
echo "$availability_output"
[[ "$availability_output" == 'f|t|t' ]] || { echo 'effective school availability semantics assertion failed' >&2; exit 1; }
echo 'LEGACY_MUTATOR_DENIAL'
legacy_output="$(psql "$MAR_NORMAL_DATABASE_URL" -v ON_ERROR_STOP=0 -Atc "set role authenticated; select set_config('request.jwt.claim.sub','$MAR_NORMAL_ADMIN_SUB',false); select public.publish_mar_case_version($MAR_NORMAL_ROOM_ID::integer,null);" 2>&1 || true)"
echo "$legacy_output"
[[ "$legacy_output" == *'permission denied'* ]] || { echo 'legacy publication mutator denial assertion failed' >&2; exit 1; }
echo "RAW_LOG $log_file"
