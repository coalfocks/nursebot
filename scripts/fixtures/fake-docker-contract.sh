#!/usr/bin/env bash
set -euo pipefail

printf '%s %s\n' "$1" "${*:2}" >> "$FAKE_DOCKER_LOG"
case "$1" in
  run)
    if [[ "${FAKE_DOCKER_MODE:-collision}" == "collision" ]]; then
      exit 17
    fi
    printf 'owned-container-id\n'
    ;;
  exec)
    exit 0
    ;;
  rm)
    printf 'rm-called\n' > "$FAKE_DOCKER_RM_MARKER"
    ;;
  *)
    exit 2
    ;;
esac
