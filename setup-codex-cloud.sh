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
Usage: ./setup-codex-cloud.sh [--verify] [--skip-browsers] [--no-ci] [--seed-dev-config]

Options:
  --verify            Run tests after setup (unit → integration → e2e)
  --skip-browsers     Do not install Playwright browsers/OS deps
  --no-ci             Use `npm install` instead of `npm ci`
  --seed-dev-config   Copy .codev/{config.toml,AGENTS.md} into .codex-api if missing

Environment:
  CI                             When set, Playwright uses list reporter (recommended in CI)
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1   Skip browser downloads entirely

Notes:
  - Requires Node >= 22 and npm.
  - Does NOT touch your .env or secrets.
  - Creates/ensures writable: ./.codex-api and ./.codev
USAGE
}

VERIFY=false
SKIP_BROWSERS=${PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD:-}
USE_NPM_CI=true
SEED_DEV=false

for arg in "$@"; do
  case "$arg" in
    -h|--help) usage; exit 0 ;;
    --verify) VERIFY=true ;;
    --skip-browsers) SKIP_BROWSERS=1 ;;
    --no-ci) USE_NPM_CI=false ;;
    --seed-dev-config) SEED_DEV=true ;;
    *) echo "Unknown option: $arg" >&2; usage; exit 2 ;;
  esac
done

echo "[setup] Project: $PROJECT_ROOT"
QUIET=${QUIET:-1}

# 1) Node/npm preflight
if ! command -v node >/dev/null 2>&1; then
  echo "[setup] ERROR: Node.js is required (>= 22)." >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "[setup] ERROR: npm is required." >&2
  exit 1
fi

# Pre-sanitize legacy npm proxy env to avoid early npm warnings
# Prefer HTTP(S)_PROXY or `npm config set proxy/https-proxy` over legacy
SANITIZED_PROXY_ENV=false
# Legacy underscore variant (valid var name)
if env | grep -qi '^npm_config_http_proxy='; then
  val="$(printenv npm_config_http_proxy || true)"
  if [ -n "$val" ] && [ "$val" != "true" ]; then
    [ "$QUIET" != "1" ] && echo "[setup] WARNING: Found legacy env 'npm_config_http_proxy'; mapping to 'npm_config_proxy'."
    export npm_config_proxy="$val"
  else
    [ "$QUIET" != "1" ] && echo "[setup] NOTE: Clearing valueless npm_config_http_proxy to avoid warnings."
  fi
  unset npm_config_http_proxy || true
  SANITIZED_PROXY_ENV=true
fi
# Also map https variant if present
if env | grep -qi '^npm_config_https_proxy='; then
  val_https="$(printenv npm_config_https_proxy || true)"
  if [ -n "$val_https" ] && [ "$val_https" != "true" ]; then
    [ "$QUIET" != "1" ] && echo "[setup] WARNING: Found legacy env 'npm_config_https_proxy'; keeping as-is (modern key)."
    export npm_config_https_proxy="$val_https"
  else
    [ "$QUIET" != "1" ] && echo "[setup] NOTE: Clearing valueless npm_config_https_proxy to avoid warnings."
    unset npm_config_https_proxy || true
  fi
  SANITIZED_PROXY_ENV=true
fi
if [ "$SANITIZED_PROXY_ENV" = true ] && [ "${BASH_SOURCE[0]}" = "$0" ] && [ "$QUIET" != "1" ]; then
  echo "[setup] NOTE: Proxy env cleanup won't persist in the parent shell."
  echo "       Prefer one of:" 
  echo "         export HTTP_PROXY=\"http://host:port\"  HTTPS_PROXY=\"http://host:port\""
  echo "         npm config set proxy \"http://host:port\"; npm config set https-proxy \"http://host:port\""
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
EXPECTED_NODE_MAJOR=22  # Aligns with Dockerfile/compose images (node:22-alpine)
if [ "$NODE_MAJOR" -lt "$EXPECTED_NODE_MAJOR" ]; then
  echo "[setup] ERROR: Node $(node -v) < $EXPECTED_NODE_MAJOR — please use Node >= $EXPECTED_NODE_MAJOR." >&2
  exit 1
fi
echo "[setup] Node: $(node -v)"
echo "[setup] npm:  $(npm -v)"
if [ "$NODE_MAJOR" -ne "$EXPECTED_NODE_MAJOR" ]; then
  echo "[setup] NOTE: Local Node major (${NODE_MAJOR}) differs from container/CI (${EXPECTED_NODE_MAJOR})." >&2
  echo "        For parity with Docker/compose and CI, prefer Node ${EXPECTED_NODE_MAJOR}.x locally (e.g., 'nvm use ${EXPECTED_NODE_MAJOR}')." >&2
fi

# 2) Sanitize npm proxy config (project-scoped, no secrets)
# - Some environments inject legacy/misnamed keys like `http-proxy` which npm warns about.
# - We map any `http-proxy` value to `proxy` and then delete `http-proxy` at project scope.
# - Environment variable misnames are handled earlier before invoking npm.
{
  # Capture value if set; avoid printing secrets
  set +e
  HPV=$(npm config get http-proxy 2>/dev/null || true)
  set -e
  # npm may coerce valueless env to 'true'; treat that as invalid
  if [ -n "${HPV:-}" ] && [ "${HPV}" != "null" ] && [ "${HPV}" != "undefined" ] && [ "${HPV}" != "true" ]; then
    echo "[setup] Detected legacy npm 'http-proxy' config (project). Migrating to 'proxy'."
    npm config set proxy "$HPV" --location=project || true
    npm config delete http-proxy --location=project || true
  else
    # Ensure no stray project-level http-proxy remains
    npm config delete http-proxy --location=project >/dev/null 2>&1 || true
  fi
}

# 3) Install npm deps (skip lifecycle scripts to avoid Husky and auto-installs)
#    We'll install Playwright assets explicitly below.
export HUSKY=0
NPM_LOGLEVEL="${NPM_LOGLEVEL:-error}"
NPM_BASE_FLAGS=(--ignore-scripts --no-audit --no-fund --progress=false --loglevel=$NPM_LOGLEVEL)
if [ -f package-lock.json ] && [ "$USE_NPM_CI" = true ]; then
  echo "[setup] Installing dependencies via: HUSKY=0 npm ci ${NPM_BASE_FLAGS[*]} …"
  npm ci "${NPM_BASE_FLAGS[@]}" || { echo "[setup] npm ci failed; trying npm install…"; npm install "${NPM_BASE_FLAGS[@]}"; }
else
  echo "[setup] Installing dependencies via: HUSKY=0 npm install ${NPM_BASE_FLAGS[*]} …"
  npm install "${NPM_BASE_FLAGS[@]}"
fi

# 4) Prepare writable Codex homes used by server/test harness
mkdir -p ./.codex-api ./.codev
if [ -w ./.codex-api ]; then
  echo "[setup] ./.codex-api is writable ✅"
else
  echo "[setup] WARNING: ./.codex-api is not writable; some Codex versions write rollout/session state here." >&2
fi

# Optionally seed Codex HOME with safe dev config so the server can run easily without secrets
if [ "$SEED_DEV" = true ]; then
  for file in config.toml AGENTS.md; do
    src_file="./.codev/$file"
    dest_file="./.codex-api/$file"
    # Only copy if source exists and destination does not, to avoid `cp -n` portability issues.
    if [ -f "$src_file" ] && [ ! -e "$dest_file" ]; then
      cp "$src_file" "$dest_file"
    fi
  done
  echo "[setup] Seeded .codex-api with .codev config where missing."
fi

# 5) Playwright setup (browsers + OS deps when possible)
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

# 6) Optional verification run
if [ "$VERIFY" = true ]; then
  echo "[setup] Running verify: format → lint → unit → integration → e2e…"
  npm run format:check
  npm run lint
  npm run test:all
  echo "[setup] Verify completed. To open Playwright report: 'npm run test:report'"
else
  cat <<'NEXT'
[setup] Done.

Common next steps:
  - Unit tests:         npm run test:unit
  - Unit coverage:      npm run coverage:unit
  - Integration tests:  npm run test:integration
  - E2E (API/SSE):      npm test
  - All layers:         npm run test:all
  - Open e2e report:    npm run test:report

Dev server (shim, no Codex needed):
  npm run dev:shim

Start server normally:
  PORT=11435 PROXY_API_KEY=codex-local-secret npm run start
NEXT
fi

exit 0
