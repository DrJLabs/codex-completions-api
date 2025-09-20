#!/usr/bin/env bash
set -euo pipefail

export PORT="${PORT:-11435}"
export PROXY_API_KEY="${PROXY_API_KEY:-test-sk-ci}"
export CODEX_BIN="${CODEX_BIN:-scripts/fake-codex-proto.js}"
export PROXY_PROTECT_MODELS="${PROXY_PROTECT_MODELS:-false}"

exec node server.js
