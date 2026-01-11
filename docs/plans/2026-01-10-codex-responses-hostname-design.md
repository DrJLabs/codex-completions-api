## Goal
- Add a separate hostname for standard OpenAI clients with a dedicated CODEX_HOME/AGENTS, while keeping the existing Obsidian-tuned host intact.

## Assumptions / constraints
- Production routing stays in `docker-compose.yml` with Traefik labels.
- The standard host is `codex-responses-api.onemainarmy.com`.
- The standard host uses its own CODEX_HOME at `./.codex-responses-api` (mounted to `/app/.codex-responses-api`).
- Obsidian host keeps `obsidian-xml` defaults and its own AGENTS.
- No app code changes are required; configuration/compose-only change.

## Research (current state)
- Relevant files/entrypoints:
  - `docker-compose.yml` (prod routing, env, volumes)
  - `src/config/index.js` (defaults for `PROXY_OUTPUT_MODE`, `PROXY_COPILOT_AUTO_DETECT`)
  - `src/handlers/chat/shared.js` (output mode resolution precedence)
  - `README.md` (output modes, prod routing guidance)
- Existing patterns to follow:
  - `PROXY_OUTPUT_MODE` default and `x-proxy-output-mode` override behavior
  - Traefik per-host routing labels for `/v1`, `/v1/models`, `/healthz`, and preflight

## Analysis
### Options
1) One container, two hostnames, edge-injected `x-proxy-output-mode` header
2) Two containers (same image), one per hostname with distinct env + CODEX_HOME
3) Single container with in-app host-based overrides for output mode and AGENTS

### Decision
- Chosen: Option 2 (two containers, same image)
- Why: It is the only approach that guarantees separate AGENTS and CODEX_HOME without adding app complexity or relying on edge header injection.

### Risks / edge cases
- Config drift between `./.codex-api` and `./.codex-responses-api` (keep in sync intentionally).
- Port collision if both services map 127.0.0.1:11435; expose only one locally or change the second port.
- CORS allowlists must be host-specific (no Obsidian origins on the standard host).
- Ensure `.codex-responses-api` is gitignored and excluded from Docker build context.

### Open questions
- None. Hostname and CODEX_HOME confirmed.

## Q&A (answer before implementation)
- Confirmed: standard hostname is `codex-responses-api.onemainarmy.com`.
- Confirmed: standard CODEX_HOME path is `./.codex-responses-api`.
- Confirmed: standard host `PROXY_CORS_ALLOWED_ORIGINS` = `https://codex-responses-api.onemainarmy.com,http://localhost,https://localhost` (exclude `app://obsidian.md`).
- Confirmed: seed `CODEX_HOME` by creating `./.codex-responses-api/`, running `SOURCE_HOME=.codev DEST_HOME=.codex-responses-api bash scripts/sync-codex-config.sh --force`, then replace `./.codex-responses-api/AGENTS.md` with standard instructions and copy `~/.codex/auth.json` into `./.codex-responses-api/auth.json` on the host.
- Confirmed: avoid local port collision on `127.0.0.1:11435` by exposing only the Obsidian service locally; for the standard service either omit `ports:` entirely or map `127.0.0.1:11436:11435` with `PORT=11435` unchanged in the container.

## Implementation plan
1) Add `.codex-responses-api` to `.gitignore` and `.dockerignore` (avoid secrets in builds/commits).
2) Add a new app service in `docker-compose.yml` (same image) with:
   - `PROXY_OUTPUT_MODE=openai-json`
   - `PROXY_COPILOT_AUTO_DETECT=false`
   - `CODEX_HOME=/app/.codex-responses-api`
   - Volume mount: `./.codex-responses-api:/app/.codex-responses-api`
   - Host-specific `PROXY_CORS_ALLOWED_ORIGINS=https://codex-responses-api.onemainarmy.com,http://localhost,https://localhost`
   - No local port binding (or `127.0.0.1:11436:11435` if local access is required)
3) Add Traefik routers for `codex-responses-api.onemainarmy.com`:
   - `/v1` (protected) → `traefik.http.routers.codex-responses.rule=Host(\`codex-responses-api.onemainarmy.com\`) && PathPrefix(\`/v1\`)`
   - `/v1/models` (public) → `traefik.http.routers.codex-responses-models.rule=Host(\`codex-responses-api.onemainarmy.com\`) && (Path(\`/v1/models\`) || Path(\`/v1/models/\`))`
   - `/healthz` (public) → `traefik.http.routers.codex-responses-health.rule=Host(\`codex-responses-api.onemainarmy.com\`) && Path(\`/healthz\`)`
   - OPTIONS preflight → `traefik.http.routers.codex-responses-preflight.rule=Host(\`codex-responses-api.onemainarmy.com\`) && PathPrefix(\`/v1\`) && Method(\`OPTIONS\`)`
   - Point routers to `traefik.http.services.codex-responses.loadbalancer.server.port=11435` on the new service.
4) Seed `./.codex-responses-api/` with standard `config.toml` + `AGENTS.md` (no Obsidian instructions) using the sync command above; treat it as idempotent and re-run after any config updates.
5) Update README to describe the dual-host setup and new CODEX_HOME.

## Tests to run
- Run on the production host before and after deployment.
- `DOMAIN=codex-api.onemainarmy.com npm run smoke:prod` (Obsidian host, bash syntax)
- `DOMAIN=codex-responses-api.onemainarmy.com npm run smoke:prod` (standard host, bash syntax)
