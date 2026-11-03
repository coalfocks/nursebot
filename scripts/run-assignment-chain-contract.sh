#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
container_name="assignment-chain-contract-pg"
port="${ASSIGNMENT_CHAIN_PG_PORT:-55439}"

cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

cleanup
docker run --rm -d --name "$container_name" -e POSTGRES_PASSWORD=contract -p "${port}:5432" -v "$repo_root:/repo:ro" postgres:16 >/dev/null
until docker exec "$container_name" pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done

docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  < "$repo_root/supabase/tests/fixtures/assignment-chain-bootstrap.sql"
docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  < "$repo_root/supabase/tests/assignment-chain-rpc.integration.sql"
