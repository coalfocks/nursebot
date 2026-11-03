#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/assignment-chain-wrapper-test.XXXXXX")"
mutation_target="$repo_root/supabase/tests/assignment-chain-rpc.integration.sql"
mutation_backup="$test_dir/assignment-chain-rpc.integration.sql.original"
cp -- "$mutation_target" "$mutation_backup"
restore_source() {
  cp -- "$mutation_backup" "$mutation_target"
  rm -rf "$test_dir"
}
trap restore_source EXIT

fake_bin="$test_dir/bin"
mkdir -p "$fake_bin"
ln -s "$repo_root/scripts/fixtures/fake-docker-contract.sh" "$fake_bin/docker"

existing_marker="$test_dir/existing-container-marker"
printf 'pre-existing-container\n' > "$existing_marker"
collision_log="$test_dir/collision.log"
collision_rm="$test_dir/collision-rm"
if PATH="$fake_bin:$PATH" FAKE_DOCKER_MODE=collision FAKE_DOCKER_LOG="$collision_log" FAKE_DOCKER_RM_MARKER="$collision_rm" \
  bash "$repo_root/scripts/run-assignment-chain-contract.sh" > "$test_dir/collision.out" 2>&1; then
  echo 'expected simulated docker create collision to fail' >&2
  exit 1
fi
grep -qx 'pre-existing-container' "$existing_marker"
! test -e "$collision_rm"
! grep -q '^rm ' "$collision_log"
! grep -q '^exec ' "$collision_log"

success_log="$test_dir/success.log"
success_rm="$test_dir/success-rm"
PATH="$fake_bin:$PATH" FAKE_DOCKER_MODE=success FAKE_DOCKER_LOG="$success_log" FAKE_DOCKER_RM_MARKER="$success_rm" \
  bash "$repo_root/scripts/run-assignment-chain-contract.sh" >/dev/null 2>&1
grep -q '^rm -f owned-container-id' "$success_log"
grep -q -- '-v ' "$success_log"
! grep -q -- ' -p ' "$success_log"
! grep -q 'POSTGRES_PASSWORD=contract' "$success_log"

mutation_log="$test_dir/mutation.log"
mutation_rm="$test_dir/mutation-rm"
mutation_exec_count="$test_dir/mutation-exec-count"
rpc_hash="$(sha256sum "$mutation_target" | awk '{print $1}')"
bootstrap_hash="$(sha256sum "$repo_root/supabase/tests/fixtures/assignment-chain-bootstrap.sql" | awk '{print $1}')"
mutation_output="$test_dir/mutation.out"
PATH="$fake_bin:$PATH" FAKE_DOCKER_MODE=success FAKE_DOCKER_LOG="$mutation_log" FAKE_DOCKER_RM_MARKER="$mutation_rm" \
  FAKE_DOCKER_EXEC_COUNT_FILE="$mutation_exec_count" FAKE_DOCKER_MUTATE_FILE="$mutation_target" FAKE_DOCKER_MUTATE_EXEC=2 \
  bash "$repo_root/scripts/run-assignment-chain-contract.sh" > "$mutation_output" 2>&1
grep -q "staged_sha256=$rpc_hash path=supabase/tests/assignment-chain-rpc.integration.sql" "$mutation_output"
grep -q "stdin_hash=$bootstrap_hash" "$mutation_log"
grep -q "stdin_hash=$rpc_hash" "$mutation_log"
cp -- "$mutation_backup" "$mutation_target"
cmp -s "$mutation_backup" "$mutation_target"

echo 'offline wrapper ownership, staged-input binding, collision/failure, and owned-cleanup checks passed'
