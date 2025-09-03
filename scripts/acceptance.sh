#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:11435/v1}"
API_KEY="${API_KEY:-codex-local-secret}"

fail() { echo "[FAIL] $*" >&2; exit 1; }
pass() { echo "[PASS] $*"; }

echo "Checking /healthz..."
curl -sf "${BASE_URL%/}/../healthz" | jq -e '.ok == true' >/dev/null || fail "healthz not ok"
pass "/healthz ok"

echo "Checking /v1/models..."
curl -sf "${BASE_URL}/models" | jq -e '.data[0].id == "codex-5"' >/dev/null || fail "models missing or wrong id"
pass "/v1/models ok"

echo "Checking streaming /v1/chat/completions..."
SSE=$(mktemp)
trap 'rm -f "$SSE"' EXIT
curl -sN "${BASE_URL}/chat/completions" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H 'Content-Type: application/json' \
  -d '{"model":"codex-5","stream":true,"reasoning":{"effort":"high"},"messages":[{"role":"user","content":"Say hello."}]}' \
  > "$SSE"

grep -Fq '[DONE]' "$SSE" || fail "SSE missing [DONE]"
grep -Fq '"delta":{"role":"assistant"}' "$SSE" || fail "SSE missing role delta"
pass "streaming chat ok"

echo "All acceptance checks passed."
