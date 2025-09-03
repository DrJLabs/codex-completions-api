#!/usr/bin/env bash
set -euo pipefail

# A lightweight shim to emulate `codex exec` for local smoke/acceptance tests
# Usage is intentionally minimal and matches how server.js invokes the binary.

OUTPUT_FILE=""
MODEL=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    exec)
      shift
      ;;
    --sandbox)
      shift; [[ $# -gt 0 ]] && shift
      ;;
    --config)
      shift; [[ $# -gt 0 ]] && shift
      ;;
    --skip-git-repo-check)
      shift
      ;;
    --output-last-message)
      shift; OUTPUT_FILE="${1:-}"; shift || true
      ;;
    -m)
      shift; MODEL="${1:-}"; shift || true
      ;;
    *)
      # Ignore unknown flags/args for shim
      shift
      ;;
  esac
done

# Read stdin as prompt (ignored for deterministic output)
cat >/dev/null || true

MSG="Hello from fake-codex for model ${MODEL:-unknown}."

if [[ -n "${OUTPUT_FILE}" ]]; then
  printf "%s\n" "$MSG" >"${OUTPUT_FILE}"
fi

# Optionally print a simple line to stdout (server ignores for final content when output file exists)
echo "$MSG" 1>&2

exit 0

