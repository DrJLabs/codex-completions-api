#!/usr/bin/env bash
set -Eeuo pipefail

# Tool-call smoke for CI using fake Codex backend.
# Spins up proxy with scripts/fake-codex-jsonrpc.js and runs stream-tool-call.js modes.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PORT="${PORT:-11435}"
BASE_URL="${BASE_URL:-http://127.0.0.1:${PORT}}"
KEY="${KEY:-codex-ci}"
MODEL="${MODEL:-codex-5}"
TOOL_SMOKE_MODES="${TOOL_SMOKE_MODES:-structured,disconnect,textual}"
TIMEOUT_MS="${TIMEOUT_MS:-30000}"

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" || true
    wait "$SERVER_PID" || true
  fi
  SERVER_PID=""
}
trap cleanup EXIT

start_server() {
  local fake_mode="$1"
  local tool_call_count="$2"

  cleanup

  NODE_ENV=${NODE_ENV:-test} \
  PROXY_API_KEY="$KEY" \
  PROXY_PROTECT_MODELS=false \
  PORT="$PORT" \
  CODEX_BIN="scripts/fake-codex-jsonrpc.js" \
  FAKE_CODEX_MODE="$fake_mode" \
  FAKE_CODEX_TOOL_CALL_COUNT="$tool_call_count" \
  PROXY_SSE_KEEPALIVE_MS=0 \
  node "$ROOT_DIR/server.js" >"$ROOT_DIR/.smoke-tool-call.log" 2>&1 &
  SERVER_PID=$!

  # wait for health
  local health_ok=false
  for _ in {1..30}; do
    if curl -fsS "http://127.0.0.1:${PORT}/healthz" >/dev/null; then
      health_ok=true
      break
    fi
    sleep 1
  done
  if [[ "$health_ok" != "true" ]]; then
    echo "[FAIL] Server did not become healthy within 30s on ${BASE_URL}/healthz" >&2
    exit 1
  fi
}

run_mode() {
  local mode="$1"; shift
  local fake_mode="$1"; shift
  local tool_call_count="$1"; shift
  local flags=("$@")
  local out
  out=$(mktemp)

  start_server "$fake_mode" "$tool_call_count"

  if BASE_URL="$BASE_URL" MODEL="$MODEL" KEY="$KEY" TIMEOUT_MS="$TIMEOUT_MS" \
    node "$ROOT_DIR/scripts/smoke/stream-tool-call.js" "${flags[@]}" >"$out" 2>&1; then
    printf "[PASS] tool-call smoke (%s)\n" "$mode"
    cat "$out"
  else
    printf "[FAIL] tool-call smoke (%s)\n" "$mode" >&2
    cat "$out" >&2
    exit 1
  fi
  rm -f "$out"
  cleanup
}

IFS=',' read -ra MODES <<<"$TOOL_SMOKE_MODES"
for mode in "${MODES[@]}"; do
  case "$mode" in
    structured|"")
      run_mode "structured" \
        "${FAKE_CODEX_MODE_STRUCTURED:-tool_call}" \
        "${FAKE_CODEX_TOOL_CALL_COUNT_STRUCTURED:-2}" ;;
    disconnect)
      run_mode "disconnect" \
        "${FAKE_CODEX_MODE_DISCONNECT:-tool_call}" \
        "${FAKE_CODEX_TOOL_CALL_COUNT_DISCONNECT:-1}" \
        --disconnect-after-first-tool --allow-single ;;
    textual)
      run_mode "textual" \
        "${FAKE_CODEX_MODE_TEXTUAL:-textual_tool}" \
        "${FAKE_CODEX_TOOL_CALL_COUNT_TEXTUAL:-1}" \
        --expect-xml --allow-single ;;
    *)
      echo "(Skipping unknown tool-call smoke mode: $mode)" ;;
  esac
done

cleanup
