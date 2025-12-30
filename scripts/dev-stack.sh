#!/usr/bin/env bash
set -euo pipefail

action="${1:-}"
shift || true

compose_args=(
  --project-directory .
  -p codex-dev
  -f infra/compose/compose.dev.stack.yml
  --env-file .env.dev
)

case "$action" in
  up)
    DOCKER_BUILDKIT=0 docker compose "${compose_args[@]}" up -d --build "$@"
    ;;
  down)
    docker compose "${compose_args[@]}" down -v "$@"
    ;;
  logs)
    docker compose "${compose_args[@]}" logs -f --tail=200 "$@"
    ;;
  *)
    echo "Usage: $0 {up|down|logs} [args...]" >&2
    exit 1
    ;;
esac
