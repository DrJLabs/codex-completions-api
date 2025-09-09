#!/usr/bin/env bash
set -Eeuo pipefail

# Sync Codex config files from a dev HOME (default .codev) to prod HOME (.codex-api).
# Copies only: config.toml, AGENTS.md. Skips secrets (e.g., auth.json).
#
# Usage:
#   bash scripts/sync-codex-config.sh [--from <src_home>] [--to <dest_home>] [--dry-run] [--force]
# Examples:
#   npm run port:sync-config                  # .codev → .codex-api on this machine
#   SOURCE_HOME=.codev DEST_HOME=/srv/codex/.codex-api bash scripts/sync-codex-config.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SOURCE_HOME=".codev"
DEST_HOME=".codex-api"
DRY_RUN=0
FORCE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --from) SOURCE_HOME="$2"; shift 2;;
    --to) DEST_HOME="$2"; shift 2;;
    --dry-run) DRY_RUN=1; shift;;
    --force) FORCE=1; shift;;
    *) echo "Unknown arg: $1" >&2; exit 2;;
  esac
done

echo "Syncing Codex config: ${SOURCE_HOME} -> ${DEST_HOME}"

for f in config.toml AGENTS.md; do
  src="$SOURCE_HOME/$f"
  dst="$DEST_HOME/$f"
  if [[ ! -f "$src" ]]; then
    printf "[WARN] Missing source %s; skipping\n" "$src"
    continue
  fi
  mkdir -p "$DEST_HOME"
  if [[ -f "$dst" ]]; then
    if cmp -s "$src" "$dst"; then
      echo "[OK] Up-to-date: $dst"
      continue
    fi
    if [[ "$FORCE" != "1" ]]; then
      echo "[DIFF] $dst differs. Use --force to overwrite or remove it first."
      continue
    fi
  fi
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "DRY RUN: would copy $src -> $dst"
  else
    if [[ -f "$dst" ]] && [[ "$FORCE" == "1" ]]; then
      bk="$dst.bak.$(date +%Y%m%d%H%M%S)"
      cp -p "$dst" "$bk"
      echo "[BACKUP] Saved previous to $bk"
    fi
    install -m 644 "$src" "$dst"
    echo "[COPIED] $src -> $dst (644)"
  fi
done

echo "Done. Note: secrets like auth.json are intentionally not copied."
