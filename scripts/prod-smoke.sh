#!/usr/bin/env bash
set -Eeuo pipefail

# Prod smoke test for the Codex API behind Traefik/Cloudflare
# Usage:
#   DOMAIN=codex-api.onemainarmy.com [KEY=sk-...] bash scripts/prod-smoke.sh
# Optional:
#   ORIGIN_HOST=127.0.0.1   # IP/host where Traefik listens (default 127.0.0.1)
#   SKIP_ORIGIN=1            # only test via public domain

# Load env quietly from repo `.env` if present to populate KEY/PROXY_API_KEY
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "$ROOT_DIR/.env" ]]; then . "$ROOT_DIR/.env"; fi

DOMAIN="${DOMAIN:-${APP_DOMAIN:-}}"; if [[ -z "$DOMAIN" ]]; then echo "ERROR: DOMAIN (or APP_DOMAIN in .env) is required" >&2; exit 2; fi
ORIGIN_HOST="${ORIGIN_HOST:-127.0.0.1}"
# Prefer KEY, fall back to PROXY_API_KEY (from .env or environment)
KEY="${KEY:-${PROXY_API_KEY:-}}"
BASE_CF="https://$DOMAIN"

pass() { printf "[PASS] %s\n" "$*"; }
fail() { printf "[FAIL] %s\n" "$*"; exit 1; }

curl_cf() { curl -sS -m 10 -f "$@"; }
curl_origin() { curl -sS -m 10 -f -k -H "Host: $DOMAIN" "https://$ORIGIN_HOST$1"; }

echo "== Prod smoke for $DOMAIN =="

if [[ "${SKIP_ORIGIN:-0}" != "1" ]]; then
  # Origin health
  curl_origin "/healthz" >/dev/null && pass "origin /healthz" || fail "origin /healthz"
  # Origin models
  curl_origin "/v1/models" | jq -e '.data[0].id=="codex-5"' >/dev/null && pass "origin /v1/models" || fail "origin /v1/models"
else
  echo "(Skipping origin checks)"
fi

# Cloudflare health/models
curl_cf -D- -o /dev/null "$BASE_CF/healthz" | grep -q " 200 " && pass "cf /healthz" || fail "cf /healthz"
curl_cf "$BASE_CF/v1/models" | jq -e '.data[0].id=="codex-5"' >/dev/null && pass "cf /v1/models" || fail "cf /v1/models"

if [[ -n "$KEY" ]]; then
  # Non-stream chat
  PAY='{"model":"codex-5","stream":false,"messages":[{"role":"user","content":"Say hello."}]}'
  curl_cf -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
    -d "$PAY" "$BASE_CF/v1/chat/completions" | jq -e '.choices[0].message.content|length>0' >/dev/null \
    && pass "cf POST /v1/chat/completions (non-stream)" || fail "cf POST /v1/chat/completions (non-stream)"

  # Streaming chat (SSE) — require at least one content delta and [DONE]
  SSE_OUT=$(mktemp)
  curl -sN -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
    -d '{"model":"codex-5","stream":true,"messages":[{"role":"user","content":"Say hello."}]}' \
    "$BASE_CF/v1/chat/completions" | sed '/^data: \[DONE\]$/q' > "$SSE_OUT" || true
  if grep -q '^data: \[DONE\]$' "$SSE_OUT" && \
     grep -q '"object":"chat.completion.chunk"' "$SSE_OUT" && \
     grep -q '"delta":{' "$SSE_OUT" && \
     ! grep -q 'No output from backend\.' "$SSE_OUT"; then
    pass "cf POST /v1/chat/completions (stream)"
  else
    echo "--- SSE capture ---"; sed -n '1,120p' "$SSE_OUT"; echo "-------------------"
    fail "cf POST /v1/chat/completions (stream)"
  fi
  rm -f "$SSE_OUT"
else
  echo "(Skipping auth chat tests; set KEY=...)"
fi

echo "All smoke checks passed."
