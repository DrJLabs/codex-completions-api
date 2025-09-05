#!/usr/bin/env bash
set -Eeuo pipefail

# Simple dev launcher that:
# - Loads secrets from .env (and .env.secret if present)
# - Defaults to port 18000
# - Uses project-local Codev config at .codev
# - Optional --shim to run without a real Codex CLI

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Load env from .env (and .env.secret if present) without echoing secrets
if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$ROOT_DIR/.env"
  set +a
fi
if [[ -f "$ROOT_DIR/.env.secret" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$ROOT_DIR/.env.secret"
  set +a
fi

# Defaults (can be overridden by env or flags)
PORT="${PORT:-18000}"
CODEX_HOME="${CODEX_HOME:-$ROOT_DIR/.codev}"
CODEX_BIN="${CODEX_BIN:-}"
USE_SHIM="${CODEX_SHIM:-0}"

# Flags: -p/--port <n>, --shim, --no-shim
while [[ $# -gt 0 ]]; do
  case "$1" in
    -p|--port)
      PORT="$2"; shift 2;;
    --shim)
      USE_SHIM=1; shift;;
    --no-shim)
      USE_SHIM=0; shift;;
    *)
      echo "Unknown arg: $1" >&2; exit 2;;
  esac
done

if [[ -z "${PROXY_API_KEY:-}" ]]; then
  echo "Error: PROXY_API_KEY is not set. Place it in .env or export it." >&2
  exit 1
fi

if [[ "$USE_SHIM" == "1" && -z "$CODEX_BIN" ]]; then
  CODEX_BIN="$ROOT_DIR/scripts/fake-codex-proto.js"
fi

export PORT PROXY_API_KEY CODEX_HOME
if [[ -n "$CODEX_BIN" ]]; then export CODEX_BIN; fi

mkdir -p "$CODEX_HOME"
# Seed local CODEX_HOME with project .codev config if missing
if [[ ! -f "$CODEX_HOME/config.toml" && -f "$ROOT_DIR/.codev/config.toml" ]]; then
  cp -n "$ROOT_DIR/.codev/config.toml" "$CODEX_HOME/config.toml"
fi
if [[ ! -f "$CODEX_HOME/AGENTS.md" && -f "$ROOT_DIR/.codev/AGENTS.md" ]]; then
  cp -n "$ROOT_DIR/.codev/AGENTS.md" "$CODEX_HOME/AGENTS.md"
fi

echo "Dev server: http://127.0.0.1:$PORT/v1 (CODEX_HOME=$CODEX_HOME)"
exec node "$ROOT_DIR/server.js"

