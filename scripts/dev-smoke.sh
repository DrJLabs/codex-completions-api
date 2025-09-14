#!/usr/bin/env bash
set -Eeuo pipefail

# Usage:
#   DEV_DOMAIN=codex-dev.onemainarmy.com [KEY=sk-dev-...] bash scripts/dev-smoke.sh
# Optional:
#   ORIGIN_HOST=127.0.0.1    # where Traefik listens (host loopback), default 127.0.0.1
#   SKIP_ORIGIN=1            # only test via public domain

# Load env quietly from repo `.env.dev` if present to populate KEY/PROXY_API_KEY
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "$ROOT_DIR/.env.dev" ]]; then set -a; . "$ROOT_DIR/.env.dev"; set +a; fi

DOMAIN="${DEV_DOMAIN:-${DOMAIN:-}}"; [[ -n "$DOMAIN" ]] || { echo "ERROR: DEV_DOMAIN or DOMAIN is required" >&2; exit 2; }
ORIGIN_HOST="${ORIGIN_HOST:-127.0.0.1}"
# Prefer KEY, fall back to PROXY_API_KEY (from .env.dev or environment)
KEY="${KEY:-${PROXY_API_KEY:-}}"
BASE_CF="https://$DOMAIN"

pass() { printf "[PASS] %s\n" "$*"; }
fail() { printf "[FAIL] %s\n" "$*"; exit 1; }

curl_cf() { curl -sS -m 10 -f "$@"; }
curl_origin() { curl -sS -m 10 -f -k -H "Host: $DOMAIN" "https://$ORIGIN_HOST$1"; }

echo "== Dev smoke for $DOMAIN =="

if [[ "${SKIP_ORIGIN:-0}" != "1" ]]; then
  curl_origin "/healthz" >/dev/null && pass "origin /healthz" || fail "origin /healthz"
  curl_origin "/v1/models" | jq -e '.object=="list"' >/dev/null && pass "origin /v1/models" || fail "origin /v1/models"
else
  echo "(Skipping origin checks)"
fi

curl_cf -D- -o /dev/null "$BASE_CF/healthz" | grep -q " 200 " && pass "cf /healthz" || fail "cf /healthz"
curl_cf "$BASE_CF/v1/models" | jq -e '.object=="list"' >/dev/null && pass "cf /v1/models" || fail "cf /v1/models"

if [[ -n "$KEY" ]]; then
  PAY='{"model":"codex-5","stream":false,"messages":[{"role":"user","content":"Say hello."}]}'
  curl_cf -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
    -d "$PAY" "$BASE_CF/v1/chat/completions" | jq -e '.choices[0].message.content|length>0' >/dev/null \
    && pass "cf POST /v1/chat/completions (non-stream)" || fail "cf POST /v1/chat/completions (non-stream)"

  SSE_OUT=$(mktemp)
  curl -sN -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
    -d '{"model":"codex-5","stream":true,"messages":[{"role":"user","content":"Say hello."}]}' \
    "$BASE_CF/v1/chat/completions" | sed '/^data: \[DONE\]$/q' > "$SSE_OUT" || true
  if grep -q '^data: \[DONE\]$' "$SSE_OUT" && \
     grep -q '"object":"chat.completion.chunk"' "$SSE_OUT" && \
     grep -q '"delta":{' "$SSE_OUT"; then
    pass "cf POST /v1/chat/completions (stream)"
  else
    echo "--- SSE capture ---"; sed -n '1,120p' "$SSE_OUT"; echo "-------------------"
    fail "cf POST /v1/chat/completions (stream)"
  fi
  rm -f "$SSE_OUT"
else
  echo "(Skipping auth chat tests; set KEY=...)"
fi

echo "All dev smoke checks passed."
