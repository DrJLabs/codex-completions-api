#!/usr/bin/env bash
set -euo pipefail

# Dev Edge Smoke for non-stream and streaming
# Usage:
#   DOMAIN=codex-dev.example.com KEY=sk-... ./scripts/dev-edge-smoke.sh [--nonstream] [--stream] [--headers]
# Defaults to both requests. Use --headers to dump response headers for comparison.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "$ROOT_DIR/.env.dev" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$ROOT_DIR/.env.dev"
  set +a
fi

DOMAIN="${DOMAIN:-${DEV_DOMAIN:-}}"
KEY="${KEY:-${PROXY_API_KEY:-}}"
# Prefer minimal public alias for faster responses; server normalizes to effective runtime model
MODEL="${MODEL:-codex-5-minimal}"
PROMPT="${PROMPT:-Say hello.}"

if [[ -z "${DOMAIN}" || -z "${KEY}" ]]; then
  echo "ERROR: set DOMAIN/DEV_DOMAIN and KEY/PROXY_API_KEY (see .env.dev)." >&2
  exit 2
fi

base="https://${DOMAIN}"
ts() { date +%Y-%m-%dT%H:%M:%S%z; }

hdr_path=""
nonstream_tmp=""
shdr_path=""
cleanup() {
  [[ -n "${hdr_path}" ]] && rm -f "$hdr_path" 2>/dev/null || true
  [[ -n "${nonstream_tmp}" ]] && rm -f "$nonstream_tmp" 2>/dev/null || true
  [[ -n "${shdr_path}" ]] && rm -f "$shdr_path" 2>/dev/null || true
}
trap cleanup EXIT

do_nonstream() {
  echo "[$(ts)] Non-stream smoke → ${base}/v1/chat/completions" >&2
  hdr_path=$(mktemp -t nonstream.hdr.XXXXXX)
  nonstream_tmp=$(mktemp -t nonstream.body.XXXXXX)
  http_code=$(curl -s ${SHOW_HEADERS:+-D "$hdr_path"} -o "$nonstream_tmp" -w "%{http_code}" \
    -H "Authorization: Bearer ${KEY}" -H 'Content-Type: application/json' \
    -X POST "${base}/v1/chat/completions" \
    -d "{\"model\":\"${MODEL}\",\"stream\":false,\"messages\":[{\"role\":\"user\",\"content\":\"${PROMPT}\"}]}" )

  cp "$nonstream_tmp" /tmp/nonstream.out

  echo "HTTP ${http_code}" >&2
  if [[ "${http_code}" != "200" ]]; then
    echo "Non-stream failed with HTTP ${http_code}" >&2
    if [[ -n "${SHOW_HEADERS:-}" && -s "$hdr_path" ]]; then
      echo "--- Non-stream response headers (sanitized) ---" >&2
      sed -E 's/(Authorization: Bearer )\S+/\1***REDACTED***/I' "$hdr_path" >&2 || true
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
  shdr_path=$(mktemp -t stream.hdr.XXXXXX)
  curl -s ${SHOW_HEADERS:+-D "$shdr_path"} -N -H "Authorization: Bearer ${KEY}" -H 'Content-Type: application/json' \
    -X POST "${base}/v1/chat/completions" \
    -d "{\"model\":\"${MODEL}\",\"stream\":true,\"messages\":[{\"role\":\"user\",\"content\":\"${PROMPT}\"}],\"stream_options\":{\"include_usage\":true}}" \
    | tee /tmp/stream.out >/dev/null

  # Check that we saw a finish_reason and a [DONE]
  grep -q "\"finish_reason\"" /tmp/stream.out
  grep -q "\[DONE\]" /tmp/stream.out
  echo "Stream OK (finish_reason + [DONE])." >&2
  if [[ -n "${SHOW_HEADERS:-}" && -s "$shdr_path" ]]; then
    echo "--- Stream response headers (sanitized) ---" >&2
    sed -E 's/(Authorization: Bearer )\S+/\1***REDACTED***/I' "$shdr_path" >&2 || true
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
