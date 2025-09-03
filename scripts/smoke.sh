#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:11435/v1}"
API_KEY="${API_KEY:-codex-local-secret}"

echo "# Health check"
curl -sf "${BASE_URL%/}/../healthz" | jq . || (echo "Health check failed" >&2; exit 1)

echo "# Models"
curl -sf "${BASE_URL}/models" | jq .

echo "# Streaming chat sample (10 lines)"
curl -sN "${BASE_URL}/chat/completions" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H 'Content-Type: application/json' \
  -d '{"model":"codex-5","stream":true,"reasoning":{"effort":"high"},"messages":[{"role":"user","content":"Respond with a short sentence."}]}' | head -n 10

echo "# Non-streaming chat sample"
curl -s "${BASE_URL}/chat/completions" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H 'Content-Type: application/json' \
  -d '{"model":"codex-5","stream":false,"messages":[{"role":"user","content":"Respond with a short sentence."}]}' | jq '.choices[0].message.content' || true
