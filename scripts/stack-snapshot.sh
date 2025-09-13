#!/usr/bin/env bash
set -Eeuo pipefail

# Snapshot currently running dev/prod images on this host,
# tag them with timestamped tags, save optional tar backups,
# and record paths for quick rollback.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROD_COMPOSE="${PROD_COMPOSE:-$ROOT_DIR/docker-compose.yml}"
DEV_COMPOSE="${DEV_COMPOSE:-$ROOT_DIR/compose.dev.stack.yml}"

APP_IMAGE_BASENAME="codex-completions-api"
BACKUP_DIR="${BACKUP_DIR:-$HOME/.cache/codex-backups}"
mkdir -p "$BACKUP_DIR" "$ROOT_DIR/releases"

TS_UTC="$(date -u +"%Y-%m-%dT%H-%M-%SZ")"
SHORT_DATE="${TS_UTC%%T*}"

LOCK_FILE="$ROOT_DIR/releases/stack-images-${SHORT_DATE}.lock.json"
TMP_LOCK="$(mktemp)"
trap 'rm -f "$TMP_LOCK"' EXIT

log() { echo "[stack-snapshot] $*"; }
warn() { echo "[stack-snapshot][WARN] $*" >&2; }
die() { echo "[stack-snapshot][ERROR] $*" >&2; exit 1; }

have_container() {
  local compose_file=$1 service=$2
  docker compose -f "$compose_file" ps -q "$service" 2>/dev/null | grep -q . || return 1
}

container_id() {
  local compose_file=$1 service=$2
  docker compose -f "$compose_file" ps -q "$service" 2>/dev/null || true
}

image_id_from_container() {
  local cid=$1
  docker inspect "$cid" --format '{{.Image}}'
}

image_id_from_tag() {
  local tag=$1
  docker image inspect "$tag" --format '{{.Id}}' 2>/dev/null || true
}

snapshot_env() {
  local env=$1 compose_file=$2 service=$3 base_tag=$4
  local cid iid tag new_tag backup_tar

  if have_container "$compose_file" "$service"; then
    cid=$(container_id "$compose_file" "$service")
    iid=$(image_id_from_container "$cid")
    log "$env: found container $cid with image $iid"
  else
    iid=$(image_id_from_tag "$base_tag")
    if [[ -z "$iid" ]]; then
      warn "$env: no running container and base tag '$base_tag' not found; skipping"
      return 0
    fi
    log "$env: using image from tag $base_tag → $iid"
  fi

  # Timestamped tag for archival (lowercase, no colons)
  local ts_compact
  ts_compact="$(date -u +%Y%m%d-%H%M%SZ)"
  local tag_name
  tag_name="${env}-${ts_compact}"  # e.g., prod-20250912-235129Z
  local new_tag
  new_tag="${APP_IMAGE_BASENAME}:${tag_name}"
  docker tag "$iid" "$new_tag"

  # Optional tar backup (set SNAPSHOT_SKIP_SAVE=1 to skip)
  if [[ "${SNAPSHOT_SKIP_SAVE:-0}" != "1" ]]; then
    backup_tar="$BACKUP_DIR/${APP_IMAGE_BASENAME}-${env}-${TS_UTC}.tar"
    docker save -o "$backup_tar" "$new_tag"
  else
    backup_tar=""
  fi

  # Write latest pointers for rollback convenience
  echo -n "$iid" > "$BACKUP_DIR/codex-latest-${env}.iid"
  echo -n "$new_tag" > "$BACKUP_DIR/codex-latest-${env}.tag"
  if [[ -n "$backup_tar" ]]; then
    echo -n "$backup_tar" > "$BACKUP_DIR/codex-latest-${env}.tarpath"
  fi

  # Append JSON line to host history
  printf '{"ts":"%s","env":"%s","service":"%s","compose":"%s","image_id":"%s","archival_tag":"%s","backup_tar":"%s"}\n' \
    "$TS_UTC" "$env" "$service" "$compose_file" "$iid" "$new_tag" "${backup_tar:-}" \
    >> "$BACKUP_DIR/codex-image-history.jsonl"

  # Emit object to tmp lock for repo record
  printf '  {"env":"%s","compose_file":"%s","service":"%s","compose_image":"%s","snap_ts_utc":"%s","image_id":"%s","archival_tag":"%s"},\n' \
    "$env" "${compose_file#$ROOT_DIR/}" "$service" "$base_tag" "$TS_UTC" "$iid" "$new_tag" \
    >> "$TMP_LOCK"
}

# Capture prod + dev if present
snapshot_env prod "$PROD_COMPOSE" app "$APP_IMAGE_BASENAME:latest"
snapshot_env dev  "$DEV_COMPOSE"  app-dev "$APP_IMAGE_BASENAME:dev"

# Build lock file (array) from tmp entries if any lines were written
if [[ -s "$TMP_LOCK" ]]; then
  {
    echo '{'
    printf '  "_note": "Image snapshot created on %s for rollback.",\n' "$TS_UTC"
    printf '  "created_at": "%s",\n' "$TS_UTC"
    printf '  "repo_head": "%s",\n' "$(git -C "$ROOT_DIR" rev-parse --short=12 HEAD || echo unknown)"
    echo '  "images": ['
    sed '$ s/,$//' "$TMP_LOCK"
    echo '  ]'
    echo '}'
  } > "$LOCK_FILE"
  log "Wrote lock: $LOCK_FILE"
  echo -n "$LOCK_FILE" > "$ROOT_DIR/releases/stack-images.latest.path"
else
  warn "No images captured (neither prod nor dev present)."
fi

log "Done. History: $BACKUP_DIR/codex-image-history.jsonl"
