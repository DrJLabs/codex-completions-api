#!/usr/bin/env bash
set -Eeuo pipefail

# Roll back prod/dev by retagging the canonical tag (latest/dev)
# to a previously snapshotted image ID, then redeploy without build.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROD_COMPOSE="${PROD_COMPOSE:-$ROOT_DIR/docker-compose.yml}"
DEV_COMPOSE="${DEV_COMPOSE:-$ROOT_DIR/compose.dev.stack.yml}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/.cache/codex-backups}"
APP_IMAGE_BASENAME="codex-completions-api"

envs=(prod dev)
LOCK_FROM=""
ONLY_ENV=""
IMAGE_ID_OVERRIDE=""
TAG_OVERRIDE=""

usage() {
  cat <<EOF
Usage: $(basename "$0") [--env prod|dev|both] [--from-lock PATH] [--image-id SHA256:...] [--tag TAG]

Defaults: --env both, uses latest pointers under $BACKUP_DIR.
Examples:
  $(basename "$0") --env prod
  $(basename "$0") --from-lock releases/stack-images-2025-09-12.lock.json --env dev
  $(basename "$0") --image-id sha256:abc... --env prod
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      shift; case "${1:-}" in prod|dev|both) ONLY_ENV="$1";; *) echo "--env must be prod|dev|both" >&2; exit 2;; esac; shift || true ;;
    --from-lock)
      [[ -n "${2:-}" ]] || die "Missing argument for --from-lock"
      LOCK_FROM="${2:-}"; shift 2 ;;
    --image-id)
      [[ -n "${2:-}" ]] || die "Missing argument for --image-id"
      IMAGE_ID_OVERRIDE="${2:-}"; shift 2 ;;
    --tag)
      [[ -n "${2:-}" ]] || die "Missing argument for --tag"
      TAG_OVERRIDE="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

log() { echo "[stack-rollback] $*"; }
warn() { echo "[stack-rollback][WARN] $*" >&2; }
die() { echo "[stack-rollback][ERROR] $*" >&2; exit 1; }

choose_envs() {
  case "$ONLY_ENV" in
    prod) envs=(prod) ;;
    dev) envs=(dev) ;;
    *) envs=(prod dev) ;;
  esac
}

iid_from_lock() {
  local env=$1 lock=$2
  # crude JSON extraction without jq; expects exact key layout from stack-snapshot.sh
  # finds the first matching env block and extracts image_id value
  awk -v env="$env" '
    $0 ~ "\"env\": \""env"\"" { f=1 }
    f && $0 ~ /"image_id"/ { gsub(/[",]/, "", $2); print $2; exit }
  ' "$lock"
}

ts_from_lock() {
  local env=$1 lock=$2
  awk -v env="$env" '
    $0 ~ "\"env\": \""env"\"" { f=1 }
    f && $0 ~ /"snap_ts_utc"/ { gsub(/[",]/, "", $2); print $2; exit }
  ' "$lock"
}

ensure_image_present() {
  local iid=$1 env=$2 lock=$3
  if docker image inspect "$iid" >/dev/null 2>&1; then
    return 0
  fi
  # Prefer tar derived from lock timestamp if provided, else latest pointer
  local tarpath=""
  if [[ -n "$lock" ]]; then
    local ts
    ts=$(ts_from_lock "$env" "$lock" || true)
    if [[ -n "$ts" ]]; then
      tarpath="$BACKUP_DIR/${APP_IMAGE_BASENAME}-${env}-${ts}.tar"
    fi
  fi
  if [[ -z "$tarpath" ]] || [[ ! -f "$tarpath" ]]; then
    tarpath="$BACKUP_DIR/codex-latest-${env}.tarpath"
    [[ -f "$tarpath" ]] && tarpath="$(cat "$tarpath")" || tarpath=""
  fi
  if [[ -f "$tarpath" ]]; then
    log "$env: loading image from $tarpath"
    docker load -i "$tarpath"
    return 0
  fi
  die "$env: image $iid not present and no backup tar available"
}

retag_and_redeploy() {
  local env=$1 iid=$2
  local base_tag compose_file service
  if [[ "$env" == "prod" ]]; then
    base_tag="$APP_IMAGE_BASENAME:latest"
    compose_file="$PROD_COMPOSE"
    service=app
  else
    base_tag="$APP_IMAGE_BASENAME:dev"
    compose_file="$DEV_COMPOSE"
    service=app-dev
  fi

  if [[ -n "$TAG_OVERRIDE" ]]; then
    base_tag="$TAG_OVERRIDE"
  fi

  log "$env: retagging $iid -> $base_tag"
  docker tag "$iid" "$base_tag"
  log "$env: redeploying with compose (no build)"
  docker compose -f "$compose_file" up -d --no-build "$service"
}

choose_envs

for env in "${envs[@]}"; do
  iid=""
  if [[ -n "$IMAGE_ID_OVERRIDE" ]]; then
    iid="$IMAGE_ID_OVERRIDE"
  elif [[ -n "$LOCK_FROM" ]]; then
    iid="$(iid_from_lock "$env" "$LOCK_FROM")"
  else
    # use latest pointer
    ptr="$BACKUP_DIR/codex-latest-${env}.iid"
    if [[ -f "$ptr" ]]; then
      iid="$(cat "$ptr")"
    fi
  fi

  [[ -n "$iid" ]] || die "$env: could not determine image id; use --from-lock or --image-id"
  ensure_image_present "$iid" "$env" "$LOCK_FROM"
  retag_and_redeploy "$env" "$iid"
done

log "Rollback complete."
