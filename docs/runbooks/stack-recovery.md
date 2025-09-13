**Stack Recovery**

- Purpose: Snapshot and roll back prod/dev containers on a shared host.
- Scope: Works with `docker-compose.yml` (prod, service `app`) and `compose.dev.stack.yml` (dev, service `app-dev`).

**Prereqs**

- Docker Compose v2 (`docker compose`).
- Disk space for optional tar backups under `~/.cache/codex-backups`.

**Snapshot (before risky changes)**

- Command: `bash scripts/stack-snapshot.sh`
- What it does:
  - Captures current image IDs for prod/dev if present.
  - Tags timestamped archives: `codex-completions-api:prod-YYYYMMDD-HHMMSSZ` and/or `...:dev-...`.
  - Saves tar backups to `~/.cache/codex-backups/` (skip via `SNAPSHOT_SKIP_SAVE=1`).
  - Writes pointers for quick rollback:
    - `~/.cache/codex-backups/codex-latest-prod.iid` (and `dev.iid`)
    - `~/.cache/codex-backups/codex-latest-prod.tag` (and `dev.tag`)
    - `~/.cache/codex-backups/codex-latest-prod.tarpath` (and `dev.tarpath`)
  - Adds repo record: `releases/stack-images-YYYY-MM-DD.lock.json` and updates `releases/stack-images.latest.path`.

**Rollback (fast path)**

- Command: `bash scripts/stack-rollback.sh --env prod|dev|both`
- Behavior:
  - Reads latest `*.iid` pointer for the selected env(s).
  - If image missing, loads from latest tar backup.
  - Retags canonical tag (`codex-completions-api:latest` for prod, `:dev` for dev).
  - Runs `docker compose up -d --no-build` for the service.

**Rollback (from explicit lock file)**

- Example: `bash scripts/stack-rollback.sh --from-lock releases/stack-images-2025-09-12.lock.json --env prod`

**Notes**

- Compose files still have `build:` set; rollback uses `--no-build` to avoid a rebuild.
- Avoid `--build` when reverting; it would create a new image with the same tag.
- For “belt and suspenders”, run snapshot immediately before any rebuild or `port:deploy`.

**Troubleshooting**

- Image not present and no tar: you can fetch from a registry if pushed, or rebuild from the matching commit and retag to the archived tag in `releases/*lock.json`.
- Verify running versions:
  - Prod: `docker compose -f docker-compose.yml ps`
  - Dev: `docker compose -f compose.dev.stack.yml ps`
