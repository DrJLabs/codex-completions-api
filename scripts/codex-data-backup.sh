#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'USAGE'
Usage: codex-data-backup.sh [options]

Create a `.codex-api` data snapshot, copy it into Google Drive, and optionally prune older backups.

Options:
  --source <path>        Path to the .codex-api directory (default: ./.codex-api in project root)
  --dest <path>          Destination root for backups (default: /mnt/gdrive/codex-backups)
  --keep <count>         Number of backups to retain when pruning (default: 3)
  --prune                Remove older backups beyond --keep after upload
  --dry-run              Print planned actions without writing files
  --mount-check          Fail if the destination is not a mounted filesystem (uses mountpoint -q)
  --encrypt              Encrypt the archive with GPG symmetric encryption (requires CODEX_BACKUP_GPG_KEY env var)
  --suffix <label>       Optional label appended to the archive name (e.g., prod)
  -h, --help             Show this help text
USAGE
}

log() { printf '[codex-backup] %s\n' "$*"; }
warn() { printf '[codex-backup][WARN] %s\n' "$*" >&2; }
die() { printf '[codex-backup][ERROR] %s\n' "$*" >&2; exit 1; }

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_SOURCE="$ROOT_DIR/.codex-api"
DEFAULT_DEST="/mnt/gdrive/codex-backups"

source_dir="$DEFAULT_SOURCE"
dest_root="$DEFAULT_DEST"
keep_count=3
should_prune=0
dry_run=0
mount_check=0
encrypt_flag=0
suffix=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source)
      source_dir="$2"; shift 2 ;;
    --dest)
      dest_root="$2"; shift 2 ;;
    --keep)
      keep_count="$2"; shift 2 ;;
    --prune)
      should_prune=1; shift ;;
    --dry-run)
      dry_run=1; shift ;;
    --mount-check)
      mount_check=1; shift ;;
    --encrypt)
      encrypt_flag=1; shift ;;
    --suffix)
      suffix="$2"; shift 2 ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      die "Unknown option: $1" ;;
  esac
done

if ! [[ $keep_count =~ ^[0-9]+$ && $keep_count -ge 1 ]]; then
  die "--keep must be a positive integer"
fi

if [[ ! -d "$source_dir" ]]; then
  die "Source directory '$source_dir' does not exist"
fi

if [[ $mount_check -eq 1 ]]; then
  check_path=$dest_root
  if [[ ! -d $check_path ]]; then
    check_path=$(dirname "$check_path")
  fi
  found_mount=0
  if command -v findmnt >/dev/null 2>&1; then
    if findmnt -T "$check_path" >/dev/null 2>&1; then
      found_mount=1
    fi
  fi
  if [[ $found_mount -eq 0 ]] && command -v mountpoint >/dev/null 2>&1; then
    probe=$check_path
    while [[ $probe != "/" ]]; do
      if mountpoint -q "$probe" 2>/dev/null; then
        found_mount=1
        break
      fi
      probe=$(dirname "$probe")
    done
  fi
  if [[ $found_mount -eq 0 ]]; then
    die "Destination '$dest_root' is not on a mounted filesystem (mount-check enabled)"
  fi
fi

if [[ $encrypt_flag -eq 1 ]]; then
  command -v gpg >/dev/null 2>&1 || die "gpg is required for --encrypt"
  if [[ -z "${CODEX_BACKUP_GPG_KEY:-}" ]]; then
    die "CODEX_BACKUP_GPG_KEY environment variable must be set when using --encrypt"
  fi
fi

mkdir -p "$dest_root"

snapshot_ts="$(date -u +%Y-%m-%dT%H%M%SZ)"
short_date="${snapshot_ts%%T*}"
subdir="$dest_root/$short_date"
if [[ -n "$suffix" ]]; then
  suffix="-$suffix"
fi
archive_base="codex-api${suffix}-${snapshot_ts}"
archive_name="$archive_base.tar.gz"
archive_path="$subdir/$archive_name"
checksum_path="$archive_path.sha256"

if [[ $encrypt_flag -eq 1 ]]; then
  archive_name="$archive_base.tar.gz.gpg"
  archive_path="$subdir/$archive_name"
  checksum_path="$archive_path.sha256"
fi

log "Source: $source_dir"
log "Destination: $archive_path"

if [[ $dry_run -eq 1 ]]; then
  log "[dry-run] Would create destination directory $subdir"
else
  mkdir -p "$subdir"
fi

make_archive() {
  local tmp_dir tmp_tar
  tmp_dir="$(mktemp -d)"
  tmp_tar="$tmp_dir/$archive_base.tar.gz"
  trap 'rm -rf "$tmp_dir"' RETURN

  tar -C "$(dirname "$source_dir")" -czf "$tmp_tar" "$(basename "$source_dir")"

  if [[ $encrypt_flag -eq 1 ]]; then
    local encrypted="$tmp_dir/$archive_base.tar.gz.gpg"
    printf '%s' "$CODEX_BACKUP_GPG_KEY" | gpg --batch --yes --passphrase-fd 0 --symmetric --cipher-algo AES256 --output "$encrypted" "$tmp_tar"
    mv "$encrypted" "$archive_path"
  else
    mv "$tmp_tar" "$archive_path"
  fi
}

generate_checksum() {
  sha256sum "$archive_path" > "$checksum_path"
}

if [[ $dry_run -eq 1 ]]; then
  log "[dry-run] Would create archive $archive_path"
  if [[ $encrypt_flag -eq 1 ]]; then
    log "[dry-run] Encryption enabled via CODEX_BACKUP_GPG_KEY"
  fi
else
  make_archive
  generate_checksum
  log "Created backup and checksum: $archive_path"
fi

prune_backups() {
  local archives
  mapfile -t archives < <(
    find "$dest_root" -maxdepth 2 -type f \
      \( -name '*.tar.gz' -o -name '*.tar.gz.gpg' \) \
      -printf '%T@ %p\n' 2>/dev/null | sort -nr | cut -d' ' -f2- || true
  )

  local total=${#archives[@]}
  if (( total > keep_count )); then
    log "Found $total backups, pruning to keep $keep_count"
    for archive in "${archives[@]:keep_count}"; do
      local checksum="${archive}.sha256"
      if [[ $dry_run -eq 1 ]]; then
        log "[dry-run] Would prune $archive"
        [[ -f $checksum ]] && log "[dry-run] Would prune $checksum"
      else
        rm -f "$archive" "$checksum"
        log "Pruned $archive"
      fi
    done
  fi
}

if [[ $should_prune -eq 1 ]]; then
  prune_backups
fi

if [[ $dry_run -eq 1 ]]; then
  log "Dry run complete. No files written."
else
  log "Backup complete: $archive_path"
  log "Checksum: $(cat "$checksum_path")"
fi
