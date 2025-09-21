#!/usr/bin/env bash
set -euo pipefail

# Keploy replays bind to 11436 so the main Express app (11435) can stay up while proxying snapshots.
export PORT="${PORT:-11436}"
export PROXY_API_KEY="${PROXY_API_KEY:-test-sk-ci}"
export CODEX_BIN="${CODEX_BIN:-scripts/fake-codex-proto.js}"
export PROXY_PROTECT_MODELS="${PROXY_PROTECT_MODELS:-false}"

exec node server.js
