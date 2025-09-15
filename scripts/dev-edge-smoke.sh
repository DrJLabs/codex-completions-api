#!/usr/bin/env bash
set -euo pipefail

# Dev Edge Smoke for non-stream and streaming
# Usage:
#   DOMAIN=codex-dev.example.com KEY=sk-... ./scripts/dev-edge-smoke.sh [--nonstream] [--stream] [--headers]
# Defaults to both requests. Use --headers to dump response headers for comparison.

DOMAIN="${DOMAIN:-${DEV_DOMAIN:-}}"
KEY="${KEY:-${PROXY_API_KEY:-}}"
# Prefer minimal public alias for faster responses; server normalizes to effective runtime model
MODEL="${MODEL:-codex-5-minimal}"
PROMPT="${PROMPT:-Say hello.}"

if [[ -z "${DOMAIN}" || -z "${KEY}" ]]; then
  echo "ERROR: set DOMAIN and KEY env vars (or DEV_DOMAIN, PROXY_API_KEY)." >&2
  exit 2
fi

base="https://${DOMAIN}"
ts() { date +%Y-%m-%dT%H:%M:%S%z; }

do_nonstream() {
  echo "[$(ts)] Non-stream smoke → ${base}/v1/chat/completions" >&2
  hdr=/tmp/nonstream.hdr
  http_code=$(curl -s ${SHOW_HEADERS:+-D "$hdr"} -o >(tee /tmp/nonstream.out) -w "%{http_code}" \
    -H "Authorization: Bearer ${KEY}" -H 'Content-Type: application/json' \
    -X POST "${base}/v1/chat/completions" \
    -d "{\"model\":\"${MODEL}\",\"stream\":false,\"messages\":[{\"role\":\"user\",\"content\":\"${PROMPT}\"}]}" )

  echo "HTTP ${http_code}" >&2
  if [[ "${http_code}" != "200" ]]; then
    echo "Non-stream failed with HTTP ${http_code}" >&2
    if [[ -n "${SHOW_HEADERS:-}" && -s "$hdr" ]]; then
      echo "--- Non-stream response headers (sanitized) ---" >&2
      sed -E 's/(Authorization: Bearer )\S+/\1***REDACTED***/I' "$hdr" >&2 || true
      echo "---------------------------------------------" >&2
    fi
    exit 3
  fi
  # Basic shape checks
  jq -e '.object=="chat.completion" and .choices[0].message.role=="assistant" and (.usage|type=="object")' </tmp/nonstream.out >/dev/null
  echo "Non-stream OK (shape + 200)." >&2
}

do_stream() {
  echo "[$(ts)] Streaming smoke → ${base}/v1/chat/completions" >&2
  shdr=/tmp/stream.hdr
  curl -s ${SHOW_HEADERS:+-D "$shdr"} -N -H "Authorization: Bearer ${KEY}" -H 'Content-Type: application/json' \
    -X POST "${base}/v1/chat/completions" \
    -d "{\"model\":\"${MODEL}\",\"stream\":true,\"messages\":[{\"role\":\"user\",\"content\":\"${PROMPT}\"}],\"stream_options\":{\"include_usage\":true}}" \
    | tee /tmp/stream.out >/dev/null

  # Check that we saw a finish_reason and a [DONE]
  grep -q "\"finish_reason\"" /tmp/stream.out
  grep -q "\[DONE\]" /tmp/stream.out
  echo "Stream OK (finish_reason + [DONE])." >&2
  if [[ -n "${SHOW_HEADERS:-}" && -s "$shdr" ]]; then
    echo "--- Stream response headers (sanitized) ---" >&2
    sed -E 's/(Authorization: Bearer )\S+/\1***REDACTED***/I' "$shdr" >&2 || true
    echo "------------------------------------------" >&2
  fi
}

run_nonstream=true
run_stream=true
for arg in "$@"; do
  case "$arg" in
    --nonstream) run_nonstream=true; run_stream=false;;
    --stream) run_stream=true; run_nonstream=false;;
    --headers) SHOW_HEADERS=1;;
  esac
done

${run_nonstream} && do_nonstream
${run_stream} && do_stream
echo "Smoke complete." >&2
