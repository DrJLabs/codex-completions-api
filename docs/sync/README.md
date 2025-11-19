# Docs ↔️ Obsidian Sync Service

This repo mirrors `docs/` into the Obsidian vault at `~/VAULTS/DrJLabs/codex-completions-api/docs` so we can edit files in Git while reading them inside Obsidian. The sync runs continuously via a user-level systemd service.

## Components

1. **`scripts/sync-docs-to-vault.sh`**
   - One-shot `rsync -av --delete` from `$REPO/docs/` to the vault path.
   - Safe to run manually anytime; it is also invoked by the watcher.

2. **`scripts/watch-docs-sync.sh`**
   - Ensures prerequisites (`entr`, sync script executable).
   - Executes an initial sync, then watches `docs/` and re-runs the sync script whenever a file changes (`find docs -type f | entr -dn ...`).

3. **Systemd service** (`~/.config/systemd/user/docs-sync.service`)
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
   - Restarts automatically if the watcher exits.

## Common Tasks

| Task | Command |
| --- | --- |
| Check status | `systemctl --user status docs-sync.service` |
| Start/stop | `systemctl --user start docs-sync.service` / `systemctl --user stop docs-sync.service` |
| Manual sync | `./scripts/sync-docs-to-vault.sh` (from repo root) |

## Notes

- Requires `entr` (installed via `sudo apt-get install -y entr`).
- Vault mirror lives entirely under `~/VAULTS/DrJLabs/codex-completions-api/docs`; Obsidian should point there.
- Both scripts are git-ignored so local tweaks won’t affect the repo.
