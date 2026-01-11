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

## Implementation plan
1) Add `.codex-responses-api` to `.gitignore` and `.dockerignore` (avoid secrets in builds/commits).
2) Add a new app service in `docker-compose.yml` (same image) with:
   - `PROXY_OUTPUT_MODE=openai-json`
   - `PROXY_COPILOT_AUTO_DETECT=false`
   - `CODEX_HOME=/app/.codex-responses-api`
   - Volume mount: `./.codex-responses-api:/app/.codex-responses-api`
   - Host-specific `PROXY_CORS_ALLOWED_ORIGINS` for standard clients
3) Add Traefik routers for `codex-responses-api.onemainarmy.com`:
   - `/v1` (protected), `/v1/models` (public), `/healthz` (public), OPTIONS preflight
4) Seed `./.codex-responses-api/` with standard `config.toml` + `AGENTS.md` (no Obsidian instructions).
5) Update README to describe the dual-host setup and new CODEX_HOME.

## Tests to run
- `DOMAIN=codex-api.onemainarmy.com npm run smoke:prod` (Obsidian host)
- `DOMAIN=codex-responses-api.onemainarmy.com npm run smoke:prod` (standard host)
