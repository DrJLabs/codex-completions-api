#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'USAGE'
Usage: stack-snapshot.sh [options]

Create a reproducible project snapshot tarball and metadata for release publication.

Options:
  --env <name>           Environment identifier stored in metadata (default: prod)
  --version <version>    Version label for the snapshot (default: package.json version or git SHA)
  --keep <count>         Number of local tarballs/locks to retain when pruning (default: 3)
  --prune                Delete older tarballs/locks beyond --keep after creating the new snapshot
  --dry-run              Print planned actions without writing files
  --docker-image <ref>   Optional Docker image reference to retag with the snapshot label
  --docker-tag-prefix <prefix>
                         Prefix for generated Docker tag when --docker-image is provided (default: codex-app-server-proxy)
  --output-dir <path>    Directory for release artifacts (default: ./releases)
  --no-tarball           Skip tarball creation (metadata-only)
  -h, --help             Show this help text
USAGE
}

log() { printf '[stack-snapshot] %s\n' "$*"; }
warn() { printf '[stack-snapshot][WARN] %s\n' "$*" >&2; }
die() { printf '[stack-snapshot][ERROR] %s\n' "$*" >&2; exit 1; }

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_OUTPUT="$ROOT_DIR/releases"
APP_NAME="codex-app-server-proxy"

env_name="prod"
version_label=""
keep_count=3
should_prune=0
dry_run=0
output_dir="$DEFAULT_OUTPUT"
base_image_ref=""
docker_tag_prefix="$APP_NAME"
create_tarball=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      env_name="$2"; shift 2 ;;
    --version)
      version_label="$2"; shift 2 ;;
    --keep)
      keep_count="$2"; shift 2 ;;
    --prune)
      should_prune=1; shift ;;
    --dry-run)
      dry_run=1; shift ;;
    --docker-image)
      base_image_ref="$2"; shift 2 ;;
    --docker-tag-prefix)
      docker_tag_prefix="$2"; shift 2 ;;
    --output-dir)
      output_dir="$2"; shift 2 ;;
    --no-tarball)
      create_tarball=0; shift ;;
    -h|--help)
      usage; exit 0 ;;
    --)
      shift; break ;;
    *)
      die "Unknown option: $1" ;;
  esac
done

if ! [[ $keep_count =~ ^[0-9]+$ && $keep_count -ge 1 ]]; then
  die "--keep must be a positive integer"
fi

mkdir -p "$output_dir"

if [[ -z "$version_label" ]]; then
  if command -v node >/dev/null 2>&1; then
    version_label="$(cd "$ROOT_DIR" && node -p "(() => { try { const v = require('./package.json').version; return v || ''; } catch { return ''; } })()" || true)"
  fi
  if [[ -z "$version_label" ]]; then
    version_label="git-$(git -C "$ROOT_DIR" rev-parse --short HEAD)"
  fi
fi

if [[ $version_label != v* && $version_label != git-* ]]; then
  version_label="v${version_label}"
fi

snapshot_ts="$(date -u +%Y-%m-%dT%H%M%SZ)"
ts_compact="$(date -u +%Y%m%d-%H%M%SZ)"
tarball_name="${APP_NAME}-${version_label}-${snapshot_ts}.tar.gz"
tarball_path="$output_dir/$tarball_name"
lock_name="${APP_NAME}-${version_label}-${snapshot_ts}.lock.json"
lock_path="$output_dir/$lock_name"
repo_sha="$(git -C "$ROOT_DIR" rev-parse --short=12 HEAD || echo unknown)"

log "Preparing snapshot for $APP_NAME@$repo_sha (version=$version_label, env=$env_name)"

create_snapshot_tarball() {
  local staging
  staging="$(mktemp -d)"
  trap 'rm -rf "$staging"' RETURN

  rsync -a --delete \
    --exclude='.git' \
    --exclude='node_modules' \
    --exclude='releases' \
    --exclude='playwright-report' \
    --exclude='.cache' \
    --exclude='artifacts' \
    --exclude='.bmad-core' \
    --exclude='.idea' \
    --exclude='docs/internal' \
    "$ROOT_DIR"/ "$staging"/

  tar -C "$staging" -czf "$tarball_path" .
  log "Created tarball: $tarball_path"
}

snapshot_docker_tag=""
if [[ -n "$base_image_ref" ]]; then
  snapshot_docker_tag="${docker_tag_prefix}:${env_name}-${ts_compact}"
  if [[ $dry_run -eq 1 ]]; then
    log "[dry-run] Would retag docker image $base_image_ref → $snapshot_docker_tag"
  else
    command -v docker >/dev/null 2>&1 || die "docker command not available but --docker-image provided"
    docker image inspect "$base_image_ref" >/dev/null 2>&1 || die "Base docker image '$base_image_ref' not found"
    docker tag "$base_image_ref" "$snapshot_docker_tag"
    log "Tagged docker image: $snapshot_docker_tag"
  fi
fi

sha256_value=""
if [[ $create_tarball -eq 1 ]]; then
  if [[ $dry_run -eq 1 ]]; then
    log "[dry-run] Would create tarball $tarball_path"
  else
    create_snapshot_tarball
    sha256_value="$(sha256sum "$tarball_path" | awk '{print $1}')"
  fi
else
  log "Tarball creation disabled via --no-tarball"
fi

write_lock_file() {
  if [[ $dry_run -eq 1 ]]; then
    log "[dry-run] Would write lock metadata $lock_path"
    return
  fi

  command -v python3 >/dev/null 2>&1 || die "python3 is required to generate lock files but is not found in PATH."

  VERSION_LABEL="$version_label" \
  ENV_NAME="$env_name" \
  REPO_SHA="$repo_sha" \
  SNAPSHOT_TS="$snapshot_ts" \
  TARBALL_NAME="$tarball_name" \
  TARBALL_SHA256="$sha256_value" \
  DOCKER_TAG="$snapshot_docker_tag" \
  KEEP_COUNT="$keep_count" \
  OUTPUT_DIR_RELATIVE="${output_dir#$ROOT_DIR/}" \
  OUTPUT_DIR="$output_dir" \
  CREATE_TARBALL="$create_tarball" \
  DRY_RUN_FLAG="$dry_run" \
  PRUNE_FLAG="$should_prune" \
  LOCK_PATH="$lock_path" \
  python3 - <<'PY'
import json, os, pathlib

def optional(env_key):
    value = os.environ.get(env_key, "").strip()
    return value or None

create_tarball = os.environ.get("CREATE_TARBALL", "1") == "1"
lock = pathlib.Path(os.environ["LOCK_PATH"])
lock.parent.mkdir(parents=True, exist_ok=True)

data = {
    "version": os.environ["VERSION_LABEL"],
    "env": os.environ["ENV_NAME"],
    "git_sha": os.environ["REPO_SHA"],
    "created_at": os.environ["SNAPSHOT_TS"],
    "tarball": optional("TARBALL_NAME") if create_tarball else None,
    "tarball_sha256": optional("TARBALL_SHA256") if create_tarball else None,
    "docker_tag": optional("DOCKER_TAG"),
    "release_url": None,
    "keep": int(os.environ["KEEP_COUNT"]),
    "notes": {
        "output_dir": optional("OUTPUT_DIR_RELATIVE") or os.environ["OUTPUT_DIR"],
        "dry_run": bool(int(os.environ["DRY_RUN_FLAG"])),
        "prune": bool(int(os.environ["PRUNE_FLAG"]))
    }
}

lock.write_text(json.dumps(data, indent=2) + "\n")
PY
  log "Wrote lock metadata: $lock_path"
}

prune_artifacts() {
  local tarballs locks
  mapfile -t tarballs < <(
    find "$output_dir" -maxdepth 1 -type f -name "${APP_NAME}-*.tar.gz" \
      -printf '%T@ %p\n' | sort -nr | cut -d' ' -f2- || true
  )
  mapfile -t locks < <(
    find "$output_dir" -maxdepth 1 -type f -name "${APP_NAME}-*.lock.json" \
      -printf '%T@ %p\n' | sort -nr | cut -d' ' -f2- || true
  )

  if (( ${#tarballs[@]} > keep_count )); then
    log "Found ${#tarballs[@]} tarballs, pruning to keep $keep_count"
    for file in "${tarballs[@]:keep_count}"; do
      if [[ $dry_run -eq 1 ]]; then
        log "[dry-run] Would prune tarball $file"
      else
        rm -f "$file"
        log "Pruned tarball $file"
      fi
    done
  fi

  if (( ${#locks[@]} > keep_count )); then
    log "Found ${#locks[@]} lock files, pruning to keep $keep_count"
    for file in "${locks[@]:keep_count}"; do
      if [[ $dry_run -eq 1 ]]; then
        log "[dry-run] Would prune lock $file"
      else
        rm -f "$file"
        log "Pruned lock $file"
      fi
    done
  fi
}

write_lock_file

if [[ $should_prune -eq 1 ]]; then
  prune_artifacts
fi

if [[ $dry_run -eq 1 ]]; then
  log "Dry run complete. Tarball would be: $tarball_path"
elif [[ $create_tarball -eq 1 ]]; then
  log "Snapshot complete. Tarball: $tarball_path"
else
  log "Snapshot complete. Tarball creation skipped."
fi
