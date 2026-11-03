#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/assignment-chain-wrapper-test.XXXXXX")"
trap 'rm -rf "$test_dir"' EXIT

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

echo 'offline wrapper ownership collision/failure and owned-cleanup checks passed'
