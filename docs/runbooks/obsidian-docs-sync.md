# Docs <-> Obsidian Sync Service

This repo keeps `docs/` and the Obsidian vault in sync using Unison (bidirectional). The repo is the source of truth: vault changes flow back only if the repo has not changed since the last sync. When both sides change, the repo version wins and the vault version is preserved as a copy-on-conflict file.

## Components

1. **Unison (bidirectional sync)**
   - Tracks state in `~/.unison/` to detect conflicts safely.
   - Uses a preference rule to resolve conflicts in favor of the repo.

2. **`scripts/sync-docs-to-vault.sh`**
   - One-shot Unison sync of `docs/` <-> vault path.
   - Suitable for manual runs.

3. **`scripts/watch-docs-sync.sh`**
   - Runs Unison continuously (`repeat=watch` or a short interval).
   - Suitable for systemd user service.

4. **Systemd service** (`~/.config/systemd/user/docs-sync.service`)
   ```ini
   [Unit]
   Description=Sync codex docs to Obsidian vault

   [Service]
   WorkingDirectory=/home/drj/projects/codex-completions-api
   ExecStart=/home/drj/projects/codex-completions-api/scripts/watch-docs-sync.sh
   Restart=on-failure

   [Install]
   WantedBy=default.target
   ```
   - Enabled and started with `systemctl --user enable --now docs-sync.service`.
   - If you edit the service file, run `systemctl --user daemon-reload` first.
   - Restarts automatically if the watcher exits.

## Common Tasks

| Task | Command |
| --- | --- |
| Check status | `systemctl --user status docs-sync.service` |
| Start/stop | `systemctl --user start docs-sync.service` / `systemctl --user stop docs-sync.service` |
| One-shot sync | `./scripts/sync-docs-to-vault.sh` (from repo root) |
| Continuous sync | `./scripts/watch-docs-sync.sh` (Ctrl+C to stop) |

## Porting this pattern to another repo

1. Copy both scripts into your repo under `scripts/`.
2. Update the vault destination in `scripts/sync-docs-to-vault.sh`:
   - `DOCS_SYNC_VAULT_PATH=/home/you/VAULTS/<YourVault>/<repo-name>/docs`
3. Update the systemd service `WorkingDirectory` and `ExecStart` to your repo paths.
4. Ensure both scripts are executable: `chmod +x scripts/sync-docs-to-vault.sh scripts/watch-docs-sync.sh`.
5. Decide whether these scripts should be committed. In this repo they are git-ignored:
   - `.gitignore` contains `scripts/sync-docs-to-vault.sh` and `scripts/watch-docs-sync.sh`
   - Remove those entries if you want the scripts tracked

## Env-based template (recommended for reuse)

Use these templates to avoid hard-coded paths. Set environment variables once and reuse the same scripts.

1. Create an env file (example: `~/.config/docs-sync.env`):
   ```ini
   DOCS_SYNC_REPO_ROOT=/home/you/projects/your-repo
   DOCS_SYNC_SOURCE_DIR=docs
   DOCS_SYNC_VAULT_PATH=/home/you/VAULTS/YourVault/your-repo/docs
   DOCS_SYNC_REPEAT=watch
   DOCS_SYNC_EXTRA_OPTS=
   ```

2. Sync script template (`scripts/sync-docs-to-vault.sh`):
   ```bash
   #!/usr/bin/env bash
   set -euo pipefail

   SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
   REPO_ROOT="${DOCS_SYNC_REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
   SRC_DIR="$REPO_ROOT/${DOCS_SYNC_SOURCE_DIR:-docs}"
   DEST_DIR="${DOCS_SYNC_VAULT_PATH:?Set DOCS_SYNC_VAULT_PATH}"

   if ! command -v unison >/dev/null 2>&1; then
     echo "[sync-docs] unison is required but not installed" >&2
     exit 1
   fi

   if [[ ! -d "$SRC_DIR" ]]; then
     echo "[sync-docs] Source docs directory not found at $SRC_DIR" >&2
     exit 1
   fi

   mkdir -p "$DEST_DIR"

   EXTRA_OPTS=()
   if [[ -n "${DOCS_SYNC_EXTRA_OPTS:-}" ]]; then
     read -r -a EXTRA_OPTS <<<"$DOCS_SYNC_EXTRA_OPTS"
   fi

   unison "$SRC_DIR" "$DEST_DIR" \
     -auto -batch -times \
     -prefer "$SRC_DIR" \
     -copyonconflict \
     "${EXTRA_OPTS[@]}"
   ```

3. Watcher template (`scripts/watch-docs-sync.sh`):
   ```bash
   #!/usr/bin/env bash
   set -euo pipefail

   SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
   SYNC_SCRIPT="$SCRIPT_DIR/sync-docs-to-vault.sh"

   if [[ ! -x "$SYNC_SCRIPT" ]]; then
     chmod +x "$SYNC_SCRIPT"
   fi

   DOCS_SYNC_REPEAT="${DOCS_SYNC_REPEAT:-watch}"
   if [[ "$DOCS_SYNC_REPEAT" != "" ]]; then
     DOCS_SYNC_EXTRA_OPTS="${DOCS_SYNC_EXTRA_OPTS:-} -repeat $DOCS_SYNC_REPEAT"
   fi

   export DOCS_SYNC_EXTRA_OPTS

   "$SYNC_SCRIPT"
   ```

4. Systemd template (`~/.config/systemd/user/docs-sync.service`):
   ```ini
   [Unit]
   Description=Sync repo docs to Obsidian vault

   [Service]
   EnvironmentFile=%h/.config/docs-sync.env
   WorkingDirectory=/home/you/projects/your-repo
   ExecStart=/home/you/projects/your-repo/scripts/watch-docs-sync.sh
   Restart=on-failure

   [Install]
   WantedBy=default.target
   ```
   - Enable with `systemctl --user enable --now docs-sync.service`.
   - If you edit the service file, run `systemctl --user daemon-reload` first.
   - systemd does not expand env vars for `WorkingDirectory` or `ExecStart`, so keep these absolute.

## Prerequisites

- `unison` (bidirectional sync).
- `systemd --user` (Linux only; for macOS/Windows you will need an alternative daemon).

## Notes

- Unison stores sync state under `~/.unison/`; do not delete it unless you intend to reset conflict history.
- If `repeat=watch` fails with “No file monitoring helper program found”, install a compatible `unison-fsmonitor` helper (ensure it is in `PATH`) or set `DOCS_SYNC_REPEAT=2` (or another short interval).
- Some distro packages ship `unison` without `unison-fsmonitor`; building from source may be required to enable true watch mode.
- This is repo-preferred: conflicts resolve to the repo and preserve the vault copy via `-copyonconflict`.
- If your Unison build does not recognize `-copyonconflict`, remove it and set an alternative backup policy in `DOCS_SYNC_EXTRA_OPTS`.
