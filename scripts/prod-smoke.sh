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
REQUEST_TIMEOUT="${SMOKE_REQUEST_TIMEOUT:-20}"
STREAM_TIMEOUT="${SMOKE_STREAM_TIMEOUT:-30}"

pass() { printf "[PASS] %s\n" "$*"; }
fail() { printf "[FAIL] %s\n" "$*"; exit 1; }

curl_cf() { curl -sS -m "$REQUEST_TIMEOUT" -f "$@"; }
curl_origin() { curl -sS -m "$REQUEST_TIMEOUT" -f -k -H "Host: $DOMAIN" "https://$ORIGIN_HOST$1"; }

IMAGE="${IMAGE:-codex-completions-api:latest}"

echo "== Prod smoke for $DOMAIN =="

if ! command -v docker >/dev/null 2>&1; then
  fail "docker binary is required for CLI availability check"
fi

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  fail "docker image $IMAGE not present locally for CLI availability check"
fi

docker run --rm "$IMAGE" codex app-server --help >/dev/null && \
  pass "image codex app-server --help" || fail "image codex app-server --help"

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
  curl -sN --max-time "$STREAM_TIMEOUT" -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
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

echo "All smoke checks passed."
