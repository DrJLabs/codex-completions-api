#!/usr/bin/env bash

set -euo pipefail

if ! command -v jq >/dev/null 2>&1; then
  echo "[parser-smoke] jq is required" >&2
  exit 1
fi

LOG_PATH=${SANITIZER_LOG_PATH:-}

if [[ -z "$LOG_PATH" ]]; then
  echo "[parser-smoke] SANITIZER_LOG_PATH must be set" >&2
  exit 1
fi

if [[ ! -f "$LOG_PATH" ]]; then
  echo "[parser-smoke] log file not found: $LOG_PATH" >&2
  exit 1
fi

# Extract the most recent metadata sanitizer summary entry.
if command -v tac >/dev/null 2>&1; then
  SUMMARY=$(
    tac "$LOG_PATH" | jq -c 'select(.kind=="metadata_sanitizer_summary")' | head -n 1
  )
else
  SUMMARY=$(jq -c 'select(.kind=="metadata_sanitizer_summary")' "$LOG_PATH" | tail -n 1)
fi

if [[ -z "$SUMMARY" ]]; then
  echo "[parser-smoke] no metadata_sanitizer_summary entries found" >&2
  exit 1
fi

COUNT=$(printf '%s' "$SUMMARY" | jq -r '.sanitized_count // 0')

if [[ "$COUNT" -eq 0 ]]; then
  echo "[parser-smoke] latest summary has zero sanitized entries" >&2
  exit 2
fi

printf '%s\n' "$SUMMARY"
