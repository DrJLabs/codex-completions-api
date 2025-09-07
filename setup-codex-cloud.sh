#!/usr/bin/env bash
# Codex Cloud bootstrap for this repo
# - Installs npm deps
# - Ensures Playwright is ready (browsers + OS deps when possible)
# - Prepares writable runtimes (./.codex-api, ./.codev)
# - Optional test run (unit → integration → e2e)

set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_ROOT"

usage() {
  cat <<'USAGE'
Usage: ./setup-codex-cloud.sh [--verify] [--skip-browsers] [--no-ci]

Options:
  --verify         Run tests after setup (unit → integration → e2e)
  --skip-browsers  Do not install Playwright browsers/OS deps
  --no-ci          Use `npm install` instead of `npm ci`

Environment:
  CI                When set, Playwright uses list reporter (recommended in CI)
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1  Skip browser downloads entirely

Notes:
  - Requires Node >= 18 and npm.
  - Does NOT touch your .env or secrets.
  - Creates/ensures writable: ./.codex-api and ./.codev
USAGE
}

VERIFY=false
SKIP_BROWSERS=${PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD:-}
USE_NPM_CI=true

for arg in "$@"; do
  case "$arg" in
    -h|--help) usage; exit 0 ;;
    --verify) VERIFY=true ;;
    --skip-browsers) SKIP_BROWSERS=1 ;;
    --no-ci) USE_NPM_CI=false ;;
    *) echo "Unknown option: $arg" >&2; usage; exit 2 ;;
  esac
done

echo "[setup] Project: $PROJECT_ROOT"

# 1) Node/npm preflight
if ! command -v node >/dev/null 2>&1; then
  echo "[setup] ERROR: Node.js is required (>= 18)." >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "[setup] ERROR: npm is required." >&2
  exit 1
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "[setup] ERROR: Node $(node -v) < 18 — please use Node >= 18." >&2
  exit 1
fi
echo "[setup] Node: $(node -v)"
echo "[setup] npm:  $(npm -v)"

# 2) Install npm deps
if [ -f package-lock.json ] && [ "$USE_NPM_CI" = true ]; then
  echo "[setup] Installing dependencies via npm ci…"
  npm ci || { echo "[setup] npm ci failed; trying npm install…"; npm install; }
else
  echo "[setup] Installing dependencies via npm install…"
  npm install
fi

# 3) Prepare writable Codex homes used by server/test harness
mkdir -p ./.codex-api ./.codev
if [ -w ./.codex-api ]; then
  echo "[setup] ./.codex-api is writable ✅"
else
  echo "[setup] WARNING: ./.codex-api is not writable; some Codex versions write rollout/session state here." >&2
fi

# 4) Playwright setup (browsers + OS deps when possible)
if [ -n "$SKIP_BROWSERS" ]; then
  echo "[setup] Skipping Playwright browser install (requested)."
else
  echo "[setup] Installing Playwright chromium and OS deps (if supported)…"
  # Prefer installing OS deps on Linux GitHub-style runners; gracefully fall back elsewhere.
  if npx --yes playwright install --with-deps chromium; then
    echo "[setup] Playwright chromium + deps installed."
  else
    echo "[setup] WARN: '--with-deps' failed; falling back to browser-only install."
    npx --yes playwright install chromium || {
      echo "[setup] WARN: playwright browser install failed; tests that require Playwright may not run." >&2
    }
  fi
fi

# 5) Optional verification run
if [ "$VERIFY" = true ]; then
  echo "[setup] Running tests: unit → integration → e2e…"
  # Use deterministic Playwright reporter when CI is set by caller
  npm run test:all
  echo "[setup] Tests completed. To open Playwright report: 'npm run test:report'"
else
  cat <<'NEXT'
[setup] Done.

Common next steps:
  - Unit tests:         npm run test:unit
  - Integration tests:  npm run test:integration
  - E2E (API/SSE):      npm test
  - All layers:         npm run test:all

Dev server (shim, no Codex needed):
  npm run dev:shim

Start server normally:
  PORT=11435 PROXY_API_KEY=codex-local-secret npm run start
NEXT
fi

exit 0

