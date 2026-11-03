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
    exec_count_file="${FAKE_DOCKER_EXEC_COUNT_FILE:-$FAKE_DOCKER_LOG.exec-count}"
    exec_count=0
    if [[ -f "$exec_count_file" ]]; then exec_count="$(cat "$exec_count_file")"; fi
    exec_count=$((exec_count + 1))
    printf '%s\n' "$exec_count" > "$exec_count_file"
    if [[ -n "${FAKE_DOCKER_MUTATE_FILE:-}" && "$exec_count" == "${FAKE_DOCKER_MUTATE_EXEC:-2}" ]]; then
      printf 'mutated-after-staging\n' > "$FAKE_DOCKER_MUTATE_FILE"
    fi
    if [[ " ${*:2} " == *" -i "* ]]; then
      stdin_file="$(mktemp)"
      cat > "$stdin_file"
      stdin_payload="$(cat "$stdin_file")"
      stdin_hash="$(sha256sum "$stdin_file" | awk '{print $1}')"
      printf 'stdin_hash=%s\n' "$stdin_hash" >> "$FAKE_DOCKER_LOG"
      if [[ "${FAKE_DOCKER_MODE:-collision}" != "collision" ]]; then
        if [[ "$stdin_payload" == *"00000000-0000-0000-0000-000000000501"* ]]; then
          case "${FAKE_DOCKER_CONCURRENT_MODE:-success}" in
            success) printf 'NOTICE:  contender=granted chain=501\n' ;;
            missing) : ;;
            malformed) printf 'NOTICE:  contender=maybe chain=501\n' ;;
            both-granted|child-failure) printf 'NOTICE:  contender=granted chain=501\n' ;;
          esac
        elif [[ "$stdin_payload" == *"00000000-0000-0000-0000-000000000502"* ]]; then
          if [[ "${FAKE_DOCKER_CONCURRENT_MODE:-success}" == "child-failure" ]]; then
            exit 23
          fi
          case "${FAKE_DOCKER_CONCURRENT_MODE:-success}" in
            success) printf 'NOTICE:  contender=denied chain=502\n' ;;
            missing) : ;;
            malformed) printf 'NOTICE:  contender=denied chain=502\n' ;;
            both-granted) printf 'NOTICE:  contender=granted chain=502\n' ;;
          esac
        fi
      fi
      rm -f "$stdin_file"
    elif [[ "${*:2}" == *"show server_version"* ]]; then
      printf '16.15-test\n'
    fi
    exit 0
    ;;
  rm)
    printf 'rm-called\n' > "$FAKE_DOCKER_RM_MARKER"
    ;;
  *)
    exit 2
    ;;
esac
