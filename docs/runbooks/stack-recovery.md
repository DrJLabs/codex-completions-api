# Stack Recovery & Release Backups

This runbook covers creating reproducible release bundles, backing up the Codex runtime data directory, and restoring the stack using the new lightweight tooling. It replaces the old container-image snapshot workflow.

## Scope

- Release bundles created by `scripts/stack-snapshot.sh` and stored under `releases/`.
- GitHub Release publication via `.github/workflows/release.yml` (tag-driven).
- `.codex-api/` runtime data backups replicated to the mounted Google Drive at `/mnt/gdrive`.
- Manual restore drills (monthly spot check, quarterly full drill) required for Story 3.10.

## Prerequisites

- Required tools: `rsync`, `tar`, `sha256sum`, and (optional) `gpg` for encrypted backups.
- Google Drive mount available at `/mnt/gdrive` (verified via `df -h` on 2025-09-22).
- Environment variable `CODEX_BACKUP_GPG_KEY` set if you plan to use the `--encrypt` flag.

## Create a Release Snapshot (local CLI)

Use the revamped snapshot script to package tracked sources and write a lock file with metadata:

```bash
# Dry run (safe preview)
npm run snapshot:dry-run

# Real snapshot (keeps 3 bundles locally, prunes extras)
bash scripts/stack-snapshot.sh --keep 3 --prune
```

Outputs:

- Tarball at `releases/codex-completions-api-v<version>-<timestamp>.tar.gz`.
- Matching lock file `releases/codex-completions-api-v<version>-<timestamp>.lock.json` containing git SHA, checksum, and (once published) the GitHub Release URL.
- Optional Docker tag if `--docker-image` is provided (not required for the solo workflow).

### Snapshot Script Highlights

- Uses `rsync` to stage files, excluding heavy directories (`node_modules`, `releases/`, `.cache/`, Playwright reports).
- Records SHA256 in the lock file and prints it for verification.
- Supports `--dry-run`, `--keep`, `--prune`, and optional Docker retagging.
- Convenience alias: `npm run snapshot:dry-run`.

## Publish the Snapshot (CI workflow)

Tagging `v*` automatically triggers `.github/workflows/release.yml`:

1. Runs `npm install --ignore-scripts` (dependency lock validation).
2. Invokes `scripts/stack-snapshot.sh --keep 5 --prune`.
3. Verifies the SHA256 digest recorded in the lock file.
4. Updates the lock with the release URL.
5. Uploads the tarball, lock file, and `SHA256SUMS` to the GitHub Release and retains them as workflow artifacts.

Manual fallback (if CI is unavailable):

```bash
TAG=v1.0.1
bash scripts/stack-snapshot.sh --keep 5
# create GitHub release with gh CLI
gh release create "$TAG" releases/codex-completions-api-${TAG}-*.tar.gz \
  releases/codex-completions-api-${TAG}-*.lock.json --generate-notes
```

Update the lock file’s `release_url` manually if you publish outside the workflow (for example:
`jq --arg url "$RELEASE_URL" '.release_url = $url' "$LOCK_FILE" > tmp && mv tmp "$LOCK_FILE"`).

## Backup `.codex-api` to Google Drive

The new helper copies a tarball + checksum into `/mnt/gdrive/codex-backups/YYYY/MM-DD/` and enforces keep-count pruning.

```bash
# Preview (no writes)
bash scripts/codex-data-backup.sh --dry-run --mount-check --keep 3

# Real backup with mount health check and pruning
bash scripts/codex-data-backup.sh --mount-check --keep 3 --prune

# Optional encryption (requires CODEX_BACKUP_GPG_KEY in environment)
export CODEX_BACKUP_GPG_KEY='your-strong-secret-passphrase'
bash scripts/codex-data-backup.sh --mount-check --encrypt --prune
```

Outputs:

- Archive `codex-api-<timestamp>.tar.gz` (or `.tar.gz.gpg`) stored on Google Drive.
- Matching checksum file `*.sha256` created alongside the archive.
- Prunes older archives beyond `--keep` when `--prune` is supplied.

The script fails fast if `/mnt/gdrive` is not mounted (when `--mount-check` is used), satisfying risk TECH-3101.

## Restore Procedures

### Monthly Spot Restore (verification)

1. Download the latest GitHub Release tarball and Google Drive `.codex-api` archive.
2. Validate checksums:

   ```bash
   sha256sum --check releases/SHA256SUMS
   sha256sum --check /mnt/gdrive/codex-backups/YYYY/MM-DD/codex-api-*.sha256
   ```

3. Extract the release bundle to a temp directory and run:

   ```bash
   tar -xzvf codex-completions-api-*.tar.gz -C /tmp/codex-release
   cd /tmp/codex-release
   npm install --production
   npm run start -- --dry-run
   ```

4. Extract the `.codex-api` backup to a staging directory and spot-check key files (e.g., `codex/config.toml`).
5. Log results under `docs/bmad/qa/artifacts/3.10/restore-checklist.md`.

### Quarterly Full Drill

1. Stop the running service.
2. Move the live `.codex-api/` aside (`mv .codex-api .codex-api.$(date +%Y%m%d)`).
3. Restore from the latest Google Drive archive:

   ```bash
   tar -xzvf /mnt/gdrive/codex-backups/YYYY/MM-DD/codex-api-*.tar.gz -C .
   ```

   - If encrypted, decrypt first: `printf '%s' "$CODEX_BACKUP_GPG_KEY" | gpg --batch --yes --passphrase-fd 0 -o codex-api.tar.gz codex-api.tar.gz.gpg`.

4. Re-deploy using the release tarball (copy into place or redeploy container with the release bundle contents).
5. Run smoke tests (`npm run smoke:prod` or local dry-run) and document the drill outcome.

## Pruning & Monitoring

- Local releases: run `bash scripts/stack-snapshot.sh --keep <n> --prune` periodically to remove old tarballs/locks.
- Google Drive: `bash scripts/codex-data-backup.sh --keep <n> --prune` handles retention.
- Space checks: `du -sh /mnt/gdrive/codex-backups` (alert at ≥80% target quota).

## Troubleshooting

- **Mount unavailable**: `mountpoint -q /mnt/gdrive` before running the backup script; re-authenticate Google Drive if required.
- **Checksum mismatch**: rerun snapshot/backup, ensure files weren’t truncated during upload, and confirm no manual edits to tarballs.
- **GPG errors**: verify `CODEX_BACKUP_GPG_KEY` is exported and `gpg` is installed; use `gpg --version` for diagnostics.
- **Legacy Docker rollback**: `scripts/stack-rollback.sh` remains available for older image-based snapshots, but future releases should rely on the tarball workflow described above.

## Evidence & QA Artifacts

- Store snapshot, backup, and restore command outputs under `docs/bmad/qa/artifacts/3.10/` as required by the test design.
- Update the QA Results section in the story after each drill.
