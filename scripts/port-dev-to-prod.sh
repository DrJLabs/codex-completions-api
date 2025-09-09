#!/usr/bin/env bash
set -Eeuo pipefail

# Guarded Dev→Prod port helper.
# - Default: non-destructive checks; also syncs Codex config + AGENTS by default.
# - Validates invariants (Traefik labels, ForwardAuth target, network), syncs `.codev → .codex-api`,
#   optional deploy, optional smoke test.
# - Creates artifacts under test-results/port-YYYYmmddHHMMSS.
#
# Usage:
#   bash scripts/port-dev-to-prod.sh [--deploy] [--smoke] [--sync|--no-sync] [--dry-run] [--domain <name>]
# Env (when --deploy):
#   CONFIRM_DEPLOY=prod         # required to actually run docker compose up
#   DOMAIN=codex-api.example    # used by --smoke if not provided via flag
#   KEY=sk-...                  # optional bearer for chat tests

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ts() { date +%Y%m%d%H%M%S; }
ART_DIR="$ROOT_DIR/test-results/port-$(ts)"
mkdir -p "$ART_DIR"

DEPLOY=0
DO_SMOKE=0
DO_SYNC=1
DRY_RUN=0
DOMAIN="${DOMAIN:-}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --deploy) DEPLOY=1; shift;;
    --smoke) DO_SMOKE=1; shift;;
    --sync) DO_SYNC=1; shift;;
    --no-sync) DO_SYNC=0; shift;;
    --dry-run) DRY_RUN=1; shift;;
    --domain) DOMAIN="$2"; shift 2;;
    *) echo "Unknown arg: $1" >&2; exit 2;;
  esac
done

echo "== Port Dev→Prod: checks (artifacts: ${ART_DIR}) =="

need() { command -v "$1" >/dev/null || { echo "Missing: $1" >&2; exit 2; }; }
need docker

# 1) Basic repo sanity
if [[ ! -f docker-compose.yml ]] || [[ ! -f compose.dev.stack.yml ]]; then
  echo "Error: missing compose files in repo root" >&2; exit 2
fi

# 2) Render compose for prod and save
echo "# docker compose config (prod)" | tee "$ART_DIR/docker-compose.config.yaml" >/dev/null
docker compose config >> "$ART_DIR/docker-compose.config.yaml"

# 3) Invariant checks
echo "Checking invariants…"

# ForwardAuth address must be host loopback:18080 (prod)
FA_ADDR=$(grep -m 1 -E "^\s*-\s*traefik\.http\.middlewares\.codex-forwardauth\.forwardauth\.address=" docker-compose.yml | cut -d= -f2- || true)
if [[ -z "$FA_ADDR" ]]; then
  echo "[FAIL] ForwardAuth label missing in docker-compose.yml" | tee "$ART_DIR/invariants.txt"
  exit 3
fi
if [[ "$FA_ADDR" != "http://127.0.0.1:18080/verify" ]]; then
  echo "[FAIL] ForwardAuth address in docker-compose.yml is not 127.0.0.1:18080/verify: $FA_ADDR" | tee "$ART_DIR/invariants.txt"
  exit 3
fi

# Required routers present
required=(codex-api codex-preflight codex-models codex-health)
missing=()
for r in "${required[@]}"; do
  if ! grep -qE "^\s*-\s*traefik\.http\.routers\.${r}\.rule=" docker-compose.yml; then missing+=("$r"); fi
done
if [[ ${#missing[@]} -gt 0 ]]; then
  echo "[FAIL] Missing routers: ${missing[*]}" | tee -a "$ART_DIR/invariants.txt"
  exit 3
fi

# Traefik network label present
if ! grep -qE '^\s*-\s*traefik\.docker\.network=traefik' docker-compose.yml; then
  echo "[FAIL] traefik.docker.network=traefik not set on app service" | tee -a "$ART_DIR/invariants.txt"
  exit 3
fi

# External network exists locally (best-effort)
if ! docker network ls --format '{{.Name}}' | grep -qx traefik; then
  echo "[WARN] Docker network 'traefik' not found locally; ensure it exists on prod host" | tee -a "$ART_DIR/invariants.txt"
fi

# .codex-api mapped (writable by default)
if ! grep -qE '^\s*-\s*\./\.codex-api:/app/\.codex-api' docker-compose.yml; then
  echo "[FAIL] .codex-api volume not mounted in prod compose" | tee -a "$ART_DIR/invariants.txt"
  exit 3
fi

echo "[PASS] Invariants OK" | tee -a "$ART_DIR/invariants.txt"

# 3b) Presence of required Codex HOME seed files
missing_seed=()
for f in config.toml AGENTS.md; do
  [[ -f ".codex-api/$f" ]] || missing_seed+=("$f")
done
if ((${#missing_seed[@]})); then
  echo "[WARN] Missing files in .codex-api/: ${missing_seed[*]}" | tee -a "$ART_DIR/invariants.txt"
  echo "      Hint: run 'npm run port:sync-config' to seed from .codev/." | tee -a "$ART_DIR/invariants.txt"
fi

# 3c) Sync Codex config + AGENTS from .codev to .codex-api (default on)
if [[ "$DO_SYNC" == "1" ]]; then
  echo "Syncing Codex HOME from .codev → .codex-api (config.toml, AGENTS.md)..."
  if [[ "$DRY_RUN" == "1" ]]; then
    bash "$ROOT_DIR/scripts/sync-codex-config.sh" --dry-run | tee "$ART_DIR/sync-dry-run.txt"
  else
    bash "$ROOT_DIR/scripts/sync-codex-config.sh" --force | tee "$ART_DIR/sync.log"
  fi
fi

# 4) Suggest next steps
cat >"$ART_DIR/NEXT_STEPS.txt" <<'TXT'
Next steps to deploy on production host:

1) Build and (re)create containers:
   docker compose up -d --build --force-recreate

2) Smoke test via Cloudflare (set your domain and optional KEY):
   DOMAIN=codex-api.onemainarmy.com npm run smoke:prod
   # With auth for chat tests:
   DOMAIN=codex-api.onemainarmy.com KEY=sk-... npm run smoke:prod

3) Optional live E2E (requires KEY in .env or environment):
   LIVE_BASE_URL=https://codex-api.onemainarmy.com npm run test:live

4) If issues arise, inspect logs:
   docker compose logs -f
TXT

echo "Wrote next steps to: $ART_DIR/NEXT_STEPS.txt"

# 5) Optional deploy (guarded)
if [[ "$DEPLOY" == "1" ]]; then
  if [[ "${CONFIRM_DEPLOY:-}" != "prod" ]]; then
    echo "Refusing to deploy: set CONFIRM_DEPLOY=prod to proceed." >&2
    exit 4
  fi
  echo "Deploying: docker compose up -d --build --force-recreate" | tee -a "$ART_DIR/deploy.log"
  docker compose up -d --build --force-recreate | tee -a "$ART_DIR/deploy.log"
  echo "Deployment complete. Run: DOMAIN=your.domain npm run smoke:prod"
fi

echo "All checks complete. Artifacts: $ART_DIR"

# 6) Optional smoke test via Cloudflare
if [[ "$DO_SMOKE" == "1" ]]; then
  if [[ -z "$DOMAIN" ]]; then
    echo "Warning: --smoke set but no domain provided (use --domain or DOMAIN=...). Skipping smoke." | tee -a "$ART_DIR/smoke.txt"
  else
    echo "Running smoke against https://$DOMAIN ..." | tee -a "$ART_DIR/smoke.txt"
    DOMAIN="$DOMAIN" KEY="${KEY:-}" bash "$ROOT_DIR/scripts/prod-smoke.sh" | tee -a "$ART_DIR/smoke.txt"
  fi
fi
