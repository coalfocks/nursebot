#!/usr/bin/env bash
set -euo pipefail

(( BASH_VERSINFO[0] >= 4 )) || { echo 'Bash 4+ required' >&2; exit 2; }
command -v docker >/dev/null || { echo 'docker required' >&2; exit 2; }
command -v psql >/dev/null || { echo 'psql required' >&2; exit 2; }
: "${MAR_SCOPE_PGPORT:=54353}"
name="mar-scope-$MAR_SCOPE_PGPORT"
docker rm -f "$name" >/dev/null 2>&1 || true
docker run -d --name "$name" alpine:3.20 sleep 30 >/dev/null
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
if MAR_SCOPE_DISPOSABLE=1 MAR_SCOPE_PGPORT="$MAR_SCOPE_PGPORT" "$(dirname "$0")/run-mar-authorized-scope-db.sh" >/tmp/mar-occupied-$MAR_SCOPE_PGPORT.log 2>&1; then
  echo 'occupied-container refusal unexpectedly succeeded' >&2
  exit 1
fi
[[ "$(docker ps -q -f "name=^${name}$")" == *[0-9a-f]* ]] || { echo 'occupied container was removed' >&2; exit 1; }
echo 'occupied-container refusal: PASS (pre-existing container preserved)'
