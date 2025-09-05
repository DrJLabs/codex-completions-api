#!/usr/bin/env bash
set -Eeuo pipefail

# Dev Docker launcher
# - Sources .env and .env.secret for PROXY_API_KEY and other overrides
# - Uses docker-compose.dev.yml by default
# - Supports --codex to use the real Codex CLI via an override file
# - Supports --port/-p to set host port (default 18000)

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

CMD="up"
USE_CODEX=0
DEV_PORT="${DEV_PORT:-18000}"

if [[ -f .env ]]; then set -a; . ./.env; set +a; fi
if [[ -f .env.secret ]]; then set -a; . ./.env.secret; set +a; fi
if [[ -z "${PROXY_API_KEY:-}" && -f .env ]]; then PROXY_API_KEY="$(sed -n 's/^PROXY_API_KEY=//p' .env | head -n1)"; fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    up|down|restart|logs)
      CMD="$1"; shift;;
    --codex)
      USE_CODEX=1; shift;;
    -p|--port)
      DEV_PORT="$2"; shift 2;;
    *)
      echo "Unknown arg: $1" >&2; exit 2;;
  esac
done

export DEV_PORT PROXY_API_KEY

FILES=(-f docker-compose.dev.yml)
if [[ "$USE_CODEX" == "1" ]]; then
  FILES+=(-f docker-compose.dev.codex.yml)
fi

case "$CMD" in
  up)
    docker compose "${FILES[@]}" up -d --build --remove-orphans ;;
  down)
    docker compose "${FILES[@]}" down -v --remove-orphans ;;
  restart)
    docker compose "${FILES[@]}" up -d --build --remove-orphans ;;
  logs)
    docker compose "${FILES[@]}" logs -f app-dev ;;
esac

echo "Dev container is managed with: docker compose ${FILES[*]} $CMD (DEV_PORT=$DEV_PORT)"

