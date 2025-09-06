#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Load env quietly
if [[ -f "$ROOT_DIR/.env" ]]; then set -a; . "$ROOT_DIR/.env"; set +a; fi
if [[ -f "$ROOT_DIR/.env.secret" ]]; then set -a; . "$ROOT_DIR/.env.secret"; set +a; fi

# Defaults
export LIVE_BASE_URL="${LIVE_BASE_URL:-http://127.0.0.1:11435}"
# Prefer KEY for clarity, fall back to PROXY_API_KEY
export KEY="${KEY:-${PROXY_API_KEY:-}}"

if [[ -z "${KEY:-}" ]]; then
  echo "Error: KEY/PROXY_API_KEY not set (from .env or environment)." >&2
  exit 2
fi

echo "Live E2E against: $LIVE_BASE_URL"
exec npx playwright test -c "$ROOT_DIR/playwright.live.config.ts"

