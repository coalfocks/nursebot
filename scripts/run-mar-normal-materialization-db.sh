#!/usr/bin/env bash
set -euo pipefail

(( BASH_VERSINFO[0] >= 4 )) || { echo 'Bash 4+ required' >&2; exit 2; }
[[ "${MAR_NORMAL_DISPOSABLE:-}" == 1 ]] || { echo 'Refusing without MAR_NORMAL_DISPOSABLE=1' >&2; exit 2; }
command -v psql >/dev/null || { echo 'psql required' >&2; exit 2; }
: "${MAR_NORMAL_DATABASE_URL:?Set MAR_NORMAL_DATABASE_URL to an isolated disposable PostgreSQL URL}"
: "${MAR_NORMAL_ADMIN_SUB:?Set MAR_NORMAL_ADMIN_SUB to a disposable educator/superadmin profile UUID}"
: "${MAR_NORMAL_STUDENT_SUB:?Set MAR_NORMAL_STUDENT_SUB to a disposable learner profile UUID}"
: "${MAR_NORMAL_UNLISTED_SUB:?Set MAR_NORMAL_UNLISTED_SUB to a disposable learner in an unlisted school}"
: "${MAR_NORMAL_ROOM_ID:?Set MAR_NORMAL_ROOM_ID to a disposable room ID}"

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

echo 'Applying only the append-only reviewed dependency set to the disposable database.'
for migration in \
  supabase/migrations/20261019100009_mar_authored_baseline_and_administrations.sql \
  supabase/migrations/20261019100010_mar_authorized_scope_materialization.sql \
  supabase/migrations/20261019100011_mar_read_scope_and_versions.sql \
  supabase/migrations/20261019100012_mar_atomic_snapshot_save.sql \
  supabase/migrations/20261019100013_mar_revoke_split_mutators.sql \
  supabase/migrations/20261019100014_mar_normal_assignment_materialization.sql \
  supabase/migrations/20261019100015_mar_materialization_scope_and_snapshot_reader.sql; do
  echo "APPLY $migration"
  psql "$MAR_NORMAL_DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f "$root_dir/$migration"
done

echo 'READINESS'
psql "$MAR_NORMAL_DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "select public.get_mar_normal_materialization_readiness();"
echo 'FIXTURE'
assignment_id="$(uuidgen)"
request_id="$(uuidgen)"
psql "$MAR_NORMAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v admin_sub="$MAR_NORMAL_ADMIN_SUB" -v student_sub="$MAR_NORMAL_STUDENT_SUB" -v room_id="$MAR_NORMAL_ROOM_ID" \
  -v assignment_id="$assignment_id" -v request_id="$request_id" \
  -f "$root_dir/supabase/tests/mar_normal_assignment_materialization_v2.sql"
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
echo "RAW_LOG $log_file"
