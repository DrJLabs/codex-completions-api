This directory is the responses Codex HOME used by the proxy.

Do NOT commit real credentials or Codex artifacts here. This repository only
tracks this README (and an optional `.gitkeep`) so the path exists after
checkout. All real files should be provisioned on the host and mounted into the
container at runtime.

Expected contents on a production host (examples):

- `config.toml` — Codex client configuration (providers, tools, preferences)
- `AGENTS.md` — Project agents/personas for Codex (standard clients)
- `auth.json` — Provider credentials or tokens (if Codex requires them)
- `sessions/` — Runtime state written by Codex (if enabled)

Security and runtime notes:

- Never check in `auth.json`, tokens, or session data.
- This folder is ignored in `.dockerignore` so those files are not sent to the
  Docker daemon during builds.
- In `docker-compose.yml` this path is mounted at `/app/.codex-responses-api`
  and MUST be writable. Codex writes rollout/session artifacts under this
  directory.
