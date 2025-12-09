# Codex Completions API — OpenAI Chat Completions proxy for Codex CLI

Goal: let any OpenAI Chat Completions client (SDKs, IDEs, curl) talk to Codex CLI as if it were a standard model API. The proxy exposes `/v1/models` and `/v1/chat/completions`, streams with SSE (role-first delta, `[DONE]`), and keeps output shaping minimal so existing tools work without changes.

> **Disclaimer:** This project is an independent community effort and is not affiliated with or endorsed by OpenAI.

## Table of Contents

1. [Features](#features)
2. [Getting Started](#getting-started)
3. [Usage](#usage)
4. [Project Structure](#project-structure-high-level)
5. [Environments](#environments-prod-vs-dev)
6. [Backend Modes](#backend-modes)
7. [Production Smoke](#production-smoke)
8. [Documentation](#documentation)
9. [License](#license)
10. [Contributing](#contributing)
11. [Testing](#testing)
12. [Deployment](#deployment-traefik--cloudflare-docker-compose)

## Features

- OpenAI-compatible routes: `/v1/models`, `/v1/chat/completions`, `/v1/responses` (typed streaming + non-stream).
- SSE streaming: role-first delta, then deltas or a final message; always ends with `[DONE]`. Periodic `: keepalive` comments prevent intermediary timeouts.
- App-server JSON-RPC parity: request normalization (`initialize`, `sendUserTurn`, `sendUserMessage`) mirrors the exported Codex schema and is covered by schema and integration tests.
- Minimal shaping: strips ANSI; optional tool-block helpers for clients that parse `<use_tool>` blocks.
- Dev vs Prod model IDs: dev advertises `codev-5*` plus `codev-5.1-{L,M,H}` (map to `gpt-5.1` low/medium/high); prod advertises `codex-5*`. Both prefixes are accepted everywhere.
- Reasoning effort mapping: `reasoning.effort` → `--config model_reasoning_effort="<low|medium|high|minimal>"` (also passes the legacy `--config reasoning.effort=...` for older CLIs).
- Token usage tracking (approximate): logs estimated prompt/completion tokens per request and exposes query endpoints under `/v1/usage`.
- Connection hygiene: graceful SSE cleanup on disconnect; keepalive/timers cleared; optional child termination on client close.
- Worker supervisor: production and dev run long-lived `codex app-server` workers gated by handshake/readiness timers (see [Backend Modes](#backend-modes)). A deterministic proto shim still exists for CI, but the real proto binary requires Codex CLI ≤ 0.44.x.

## Getting Started

### Prerequisites

- Node.js ≥ 22 and npm 10+
- Codex CLI ≥ 0.58.0 for the default app-server workflow (install under `.codev/` for dev or `.codex-api/` for prod)
- `@openai/codex` is intentionally pinned to an exact version (currently 0.58.0) so JSON-RPC schemas and CLI behavior stay deterministic across dev/prod; bump only after coordinating schema/regression updates.
- Docker + Docker Compose v2 (optional but recommended for parity with production)
- `curl`/`jq` for quick health checks
- Legacy proto mode requires Codex CLI ≤ 0.44.x; see [Legacy proto mode](#legacy-proto-mode-codex-cli-044x) for details

### Run locally with Node

1. Install dependencies:

   ```bash
   npm install
   ```

2. Seed `.codev/` with your Codex CLI config (`config.toml`, `auth.json`).
3. Start the proxy (defaults to port `11435` and binds to `127.0.0.1` unless overridden):

   ```bash
   PORT=11435 PROXY_API_KEY=codex-local-secret npm run start
   ```

4. Smoke-test the API:

   ```bash
   # health
   curl -s http://127.0.0.1:11435/healthz | jq .
   # models
   curl -s http://127.0.0.1:11435/v1/models | jq .
   ```

5. Issue a sample chat completion (non-stream):

   ```bash
   curl -s http://127.0.0.1:11435/v1/chat/completions \
     -H "Authorization: Bearer codex-local-secret" -H 'Content-Type: application/json' \
     -d '{"model":"codex-5","stream":false,"messages":[{"role":"user","content":"Say hello."}]}' | jq .
   ```

### Run with Docker Compose

1. Copy the example compose file and adjust environment variables:

   ```bash
   cp docker-compose.local.example.yml docker-compose.local.yml
   # edit docker-compose.local.yml to set PROXY_API_KEY or other overrides
   ```

2. Populate `.codex-api/` with your Codex CLI config (ignored by Git).
3. Launch the stack:

   ```bash
   docker compose -f docker-compose.local.yml up --build
   ```

4. Query the API on `http://127.0.0.1:11435`:

   ```bash
   curl -s http://127.0.0.1:11435/v1/models | jq .
   ```

### Dev helpers

- `npm run dev` — start the proxy with live reload and the default app-server worker supervisor.
- `npm run dev:stack:up` — full dev stack (Traefik, auth, proxy) on `http://127.0.0.1:18010/v1` using the real Codex CLI mount. Traefik now sources the `codex-dev` routers/middlewares from `/etc/traefik/dynamic/codex-dev.yml` (file provider) instead of Docker labels, so make sure that file exists on the host when bringing the stack up.
- `npm run dev:shim` — starts the proxy against the deterministic legacy proto shim (no Codex install required). This is only for CI/offline testing; see [Legacy proto mode](#legacy-proto-mode-codex-cli-044x).

## Usage

### Authentication

- All `/v1/chat/completions` **and `/v1/responses`** requests require `Authorization: Bearer $PROXY_API_KEY`.
- `/v1/models` is public in dev but can be protected by setting `PROXY_PROTECT_MODELS=true`.
- Usage telemetry (`/v1/usage`, `/v1/usage/raw`) requires the bearer key unless you explicitly set `PROXY_USAGE_ALLOW_UNAUTH=true` for local diagnostics.
- Test-only routes (`/__test/*`) are gated by `PROXY_TEST_ENDPOINTS=true`, always require the bearer key, and default to loopback-only unless `PROXY_TEST_ALLOW_REMOTE=true`.
- ForwardAuth (Traefik) also checks the same key to keep edge and origin consistent.

### Model selection

- Production advertises `codex-5{,-low,-medium,-high,-minimal}`; development advertises `codev-5{,-low,-medium,-high,-minimal}` to avoid client confusion.
- Dev also exposes `codev-5.1-{L,M,H}` which map directly to `gpt-5.1` with implied low/medium/high reasoning effort (uppercase suffix is optional; IDs are case-insensitive).
- Both prefixes are accepted. The proxy normalizes model IDs to the effective Codex target (`gpt-5` or `gpt-5.1` for the new aliases) and applies the implied reasoning effort automatically.
- Do not override `CODEX_MODEL` unless you are purposely testing unsupported combinations; let the proxy map inputs.

### Requests

- Non-stream requests respond with OpenAI-compatible JSON (see the [Run locally with Node](#run-locally-with-node) example).
- Streaming uses server-sent events with role-first deltas followed by incremental content chunks and a terminating `[DONE]` marker.
- `PROXY_STREAM_MODE=jsonl` outputs raw Codex JSON lines for debugging; default mode emits OpenAI-style SSE envelopes.
- `/v1/responses` can be disabled for chat-only deployments via `PROXY_ENABLE_RESPONSES=false`; default is on for parity with OpenAI.

### Streaming controls for tool-heavy clients

- `PROXY_SUPPRESS_TAIL_AFTER_TOOLS=true` — hide assistant narrative after the final `<use_tool>` block while keeping the stream open.
- `PROXY_STOP_AFTER_TOOLS=true` — cut the stream immediately after the final `<use_tool>` block.
- `PROXY_STOP_AFTER_TOOLS_MODE=burst|first` — allow a small burst of tool blocks before cutting or stop after the first one.
- `PROXY_STOP_AFTER_TOOLS_GRACE_MS=300` — grace window for burst mode.
- `PROXY_TOOL_BLOCK_MAX=10` — optional cap on tool blocks to prevent client overload.

### Usage metrics

- The proxy logs estimated prompt/completion token usage for each request and exposes the aggregates via `/v1/usage`.
- Metrics are approximate because Codex CLI does not expose raw token counts for every release; treat them as guidance rather than billable totals.

## Project Structure (high‑level)

```
docker-compose.yml              # PRODUCTION compose and Traefik labels (source of truth)
Dockerfile                      # App image (production build)
server.js                       # Express API (OpenAI‑compatible routes)
src/utils.js                    # Utilities (tokens, join/normalize, CORS helpers)
auth/server.mjs                 # Traefik ForwardAuth microservice
tests/                          # Unit, integration, Playwright E2E
vitest.config.ts                # Unit test config + coverage thresholds (V8)
playwright.config.ts            # E2E config (spawns server with the legacy proto shim for CI)
scripts/                        # Dev + CI helpers (dev.sh, prod-smoke.sh)
scripts/setup-testing-ci.sh     # Idempotent test/CI scaffolder (useful for forks)
.codev/                         # Project‑local Codex HOME for dev (config.toml, AGENTS.md)
 .codex-api/                     # Production Codex HOME (secrets; writable mount in compose)
docs/app-server-migration/      # Schema exports, runbooks, parity harness instructions
.github/workflows/ci.yml        # CI: lint, format, unit, integration, e2e
AGENTS.md                       # Agent directives (project‑specific rules included)
```

## Environments: PROD vs DEV

See docs/README.md for documentation pointers. Internal runbooks (Dev → Prod, architecture diagrams, etc.) live in `docs/private/` locally and are not committed.

### Production

- This repo’s `docker-compose.yml` is the production deployment spec.
- Traefik runs as a host/system service (not a container).
- ForwardAuth MUST use host loopback:
  - `traefik.http.middlewares.codex-forwardauth.forwardauth.address=http://127.0.0.1:18080/verify`
- App attaches to Docker network `traefik` and is discovered via labels.
- Edge is Cloudflare for `codex-api.onemainarmy.com`.
- Backend mode: production sets `PROXY_USE_APP_SERVER=true` and keeps a long-lived app-server worker alive. Refresh `.codex-api/auth.json` from `~/.codex/auth.json` before each deployment so the worker can authenticate.

Codex HOME (production):

- The proxy sets `CODEX_HOME` to `/app/.codex-api` in the container.
- `docker-compose.yml` bind-mounts the project’s `./.codex-api` into the container: `./.codex-api:/app/.codex-api` (writable).
- Do not commit secrets. Only a placeholder `README.md` and optional `.gitkeep` are tracked; everything else under `.codex-api/` is ignored by Git and is also excluded from Docker build context via `.dockerignore`.
- `.codex-api` MUST be writable in production because Codex CLI persists rollout/session artifacts under its home on some versions. Mounting read-only has caused streaming/tool communication to fail in production.
  - Note: The proxy also sets `PROXY_CODEX_WORKDIR` (default `/tmp/codex-work`) as the child process working directory to isolate ephemeral writes. However, do not rely on this to redirect Codex’s own rollout/session files away from `CODEX_HOME` unless your Codex CLI version explicitly supports that.
- On the production host, provision the following files under the project’s `.codex-api/` before `docker compose up`:
  - `config.toml` (Codex client config)
  - `AGENTS.md` (optional)
  - `auth.json` and any other credentials required by Codex (if applicable)
  - The canonical bearer credential lives at `~/.codex/auth.json`; after each rotation copy that file into `.codex-api/auth.json` (prod) and `.codev/auth.json` (dev) before starting stacks.

#### Sync Dev Config → Prod (`.codev` → `.codex-api`)

To port your dev Codex HOME config and agents into the production Codex HOME safely (without copying secrets):

- Quick sync on the host running production:

  ```bash
  npm run port:sync-config
  ```

  This copies `.codev/{config.toml,AGENTS.md}` → `.codex-api/`. It will not overwrite existing files that differ; use the `--force` flag to overwrite and create a timestamped backup.

- Explicit path override (e.g., remote home path):

  ```bash
  SOURCE_HOME=.codev DEST_HOME=/srv/codex/.codex-api bash scripts/sync-codex-config.sh --force
  ```

Notes:

- The sync intentionally skips secrets like `auth.json` — manage credentials out‑of‑band.
  - For this project the source of truth is `~/.codex/auth.json`; refreshes should be propagated into `.codev/` and `.codex-api/` manually.
- Detailed Dev → Prod procedures are available in the private documentation bundle (`docs/private/`).

### Release & Backup shortcuts

- `npm run snapshot:dry-run` → preview the release tarball + lock that `scripts/stack-snapshot.sh` would create in `releases/`.
- `bash scripts/stack-snapshot.sh --keep 3 --prune` → generate a release bundle (tarball + lock) and prune older bundles.
- Tagging `v*` triggers `.github/workflows/release.yml`, which verifies the SHA256 and uploads tarball + lock + `SHA256SUMS` to the GitHub Release.
- `npm run backup:data` → run `scripts/codex-data-backup.sh --mount-check --prune` to copy `.codex-api` into `/mnt/gdrive/codex-backups/YYYY/MM-DD/` with matching `.sha256` files.
- Optional encryption: export `CODEX_BACKUP_GPG_KEY` and append `--encrypt` when running the backup script.

### Development

- Node dev: `npm run dev` (port 18000) or `npm run dev:shim` (no Codex CLI required), using `.codev` as Codex HOME.
- Dev stack: `npm run dev:stack:up` (port 18010 by default). By default the dev stack uses the real Codex CLI (`CODEX_BIN=codex`), mounting `~/.cargo/bin/codex` from the host. To use the lightweight proto shim instead, set `CODEX_BIN=/app/scripts/fake-codex-proto.js` in `.env.dev` and re‑up the stack.

#### Model IDs and client compatibility

- Prod advertises: `codex-5`, `codex-5-{low,medium,high,minimal}`.
- Dev advertises: `codev-5`, `codev-5-{low,medium,high,minimal}`, plus `codev-5.1-{L,M,H}` which route to `gpt-5.1` automatically.
- The server accepts both prefixes everywhere, but many SDKs/tools validate against `GET /v1/models` and will reject an ID that isn’t advertised by that environment. Use the environment‑appropriate prefix, or specify `model: "gpt-5"` and set `reasoning.effort`.

Examples

```bash
# Prod (non-stream)
curl -s https://codex-api.onemainarmy.com/v1/chat/completions \
  -H "Authorization: Bearer $PROD_KEY" -H 'Content-Type: application/json' \
  -d '{"model":"codex-5-low","stream":false,"messages":[{"role":"user","content":"Say hello."}]}' | jq '.choices[0].message.content'

# Dev (non-stream)
curl -s https://codex-dev.onemainarmy.com/v1/chat/completions \
  -H "Authorization: Bearer $DEV_KEY" -H 'Content-Type: application/json' \
  -d '{"model":"codev-5-low","stream":false,"messages":[{"role":"user","content":"Say hello."}]}' | jq '.choices[0].message.content'

# Prefix-agnostic alternative (works in both, set BASE and KEY first)
# e.g. BASE=codex-dev.onemainarmy.com KEY=$DEV_KEY
curl -s https://$BASE/v1/chat/completions \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"model":"gpt-5","reasoning":{"effort":"low"},"stream":false,"messages":[{"role":"user","content":"Say hello."}]}' | jq '.choices[0].message.content'
```

Note: `GET /v1/models` is unauthenticated in both envs for discovery unless `PROXY_PROTECT_MODELS=true`.

Dev parity stack (public behind Traefik):

- Purpose: exercise the proxy with a real Codex CLI behind Traefik and ForwardAuth, mirroring prod, without touching prod.
- Bring up: `npm run dev:stack:up`
  - Uses a single file: `compose.dev.stack.yml` (self-contained dev app + dev auth)
  - Project name: `codex-dev` (ensures it doesn’t collide with prod services)
  - If local port 18010 is in use, override:
    - `DEV_PORT=19010 docker compose -p codex-dev -f compose.dev.stack.yml --env-file .env.dev up -d --build`
  - Uses the host Codex CLI by default (`CODEX_BIN=codex`, requires `~/.cargo/bin/codex`)
- Domain: create a DNS record for `codex-dev.onemainarmy.com` to your Traefik host (Cloudflare). The dev host now loads its routers/middlewares from `/etc/traefik/dynamic/codex-dev.yml`, so keep that file in sync with the compose labels if you tweak origins/CORS.
- ForwardAuth (dev) uses a dedicated dev auth service at `http://127.0.0.1:18081/verify`, backed by `auth-dev` in `compose.dev.stack.yml` and the dev key from `.env.dev`. Prod continues to use `http://127.0.0.1:18080/verify`.
- Dev key: set in `.env.dev` (see `.env.dev.example`) and pass to smoke/tests via `KEY`.
- Smoke: `DEV_DOMAIN=codex-dev.onemainarmy.com KEY=$DEV_KEY npm run smoke:dev`
- Live tests (real Codex): `DEV_DOMAIN=codex-dev.onemainarmy.com KEY=$DEV_KEY npm run test:live:dev`

Model IDs in dev vs prod:

- Prod (advertised): `codex-5`, `codex-5-low`, `codex-5-medium`, `codex-5-high`, `codex-5-minimal`.
- Dev (advertised): `codev-5`, `codev-5-low`, `codev-5-medium`, `codev-5-high`, `codev-5-minimal`, plus `codev-5.1-{L,M,H}` which normalize to `gpt-5.1` at low/medium/high reasoning effort.
- Both environments accept either prefix; dev advertises `codev-*` to avoid client confusion. All map to the effective model (`gpt-5` for the `codex/codev-5*` aliases, `gpt-5.1` for `codev-5.1-*`) with the implied reasoning effort.
- Do **not** override `CODEX_MODEL` in dev to force a specific reasoning tier. Leave it unset so the proxy maps
  `codev-5-*` requests to `gpt-5` and `codev-5.1-*` requests to `gpt-5.1` internally; dev API keys cannot call `gpt-5-minimal` directly and will raise
  `400 Unsupported model` otherwise.

Notes:

- Dev config stays in `.codev/` (writable). Runtime writes are isolated under `PROXY_CODEX_WORKDIR`.
- Prod config stays in `.codex-api/` (writable mount). Prod compose unchanged until you promote changes.

### Dev → Prod Promotion Flow (authoritative)

- Change only dev inputs first: `.codev/*`, `compose.dev.stack.yml`.
- Validate locally (Node or container) and behind Traefik on `codex-dev…`:
  - Smoke: `DEV_DOMAIN=codex-dev.onemainarmy.com KEY=$DEV_KEY npm run smoke:dev`
  - Live E2E (real Codex): `DEV_DOMAIN=codex-dev.onemainarmy.com KEY=$DEV_KEY npm run test:live:dev`
- When green, open a PR with the minimal prod diffs (e.g., `docker-compose.yml`).
- After merge, rebuild prod and validate:
  - `docker compose up -d --build --force-recreate`
  - `DOMAIN=codex-api.onemainarmy.com KEY=$PROXY_API_KEY npm run smoke:prod`
  - Optional live E2E: `LIVE_BASE_URL=https://codex-api.onemainarmy.com KEY=$PROXY_API_KEY npm run test:live`

Operational guarantees:

- CODEX_HOME: dev `.codev/`, prod `.codex-api/` (both writable).
- Runtime writes: use `PROXY_CODEX_WORKDIR` in both environments; do not rely on it to redirect Codex rollouts unless your CLI version supports it.
- Traefik ForwardAuth: always host loopback `http://127.0.0.1:18080/verify` (prod and dev).

Codex HOME (development):

- Dev instances use the project-local `.codev/` as Codex HOME.
- Scripts (`npm run dev`, `npm run dev:shim`) and dev compose map `.codev` appropriately; the dev launcher seeds `config.toml` and `AGENTS.md` into the runtime `CODEX_HOME` if missing.

Build context hygiene:

- `.dockerignore` excludes `.codex-api/**`, `.codev/**`, `.env*`, logs, and other local artifacts so secrets are never sent to the Docker daemon.

## Backend Modes

### App-server (default)

- `PROXY_USE_APP_SERVER=true` boots a worker supervisor that keeps one or more `codex app-server` processes alive.
- Readiness hinges on the JSON-RPC `initialize` handshake; `/healthz` only reports ready once the worker has completed it.
- Use this mode everywhere (dev, CI, prod). Ensure Codex CLI ≥ 0.58.0 and keep `.codex-api/auth.json` synced from `~/.codex/auth.json` before restarting.
- Tune worker lifecycle with `WORKER_*_TIMEOUT_MS`, `PROXY_KILL_ON_DISCONNECT`, and `PROXY_WORKER_COUNT` when running on slower hardware or when you need multiple concurrent workers.

### Legacy proto mode (Codex CLI ≤ 0.44.x)

- `PROXY_USE_APP_SERVER=false` reverts to the historical proto workflow (one `codex proto` process per request) and only works with Codex CLI 0.44.x or older.
- Keep references to this path minimal; it exists solely for compatibility testing and to support the deterministic shim used in CI.
- Commands such as `npm run dev:shim`, `npm run test:integration`, and `npm test` launch `scripts/fake-codex-proto.js` so suites can run without a Codex install. Treat the shim as a stand-in for this legacy mode.
- Because proto mode lacks long-lived workers, features like streaming clean-up and usage logging can diverge slightly; always validate changes against the app-server path before shipping.

## Production Smoke

Run a minimal end‑to‑end check of origin (Traefik) and edge (Cloudflare):

```
DOMAIN=codex-api.onemainarmy.com KEY=$PROXY_API_KEY npm run smoke:prod
```

Behavior:

- Origin (host only): checks `https://127.0.0.1/healthz` and `/v1/models` with `Host: $DOMAIN`.
- Edge (Cloudflare): checks `/healthz`, `/v1/models`, and an optional authenticated non‑stream chat.

## Documentation

This repository ships with a minimal public documentation stub (`docs/README.md`) — treat it as the canonical index. Any internal guides, architecture diagrams, or historical notes should live under `docs/private/`, which is ignored by Git so nothing confidential is committed. Run `npm run lint:runbooks` before committing doc changes to keep runbooks formatted.

## License

This project is released under the [MIT License](LICENSE).

## Contributing

- Start every task from a clean checkout and create a work branch using the `feat/<kebab>`, `fix/<kebab>`, or `chore/<kebab>` pattern before editing files.
- Use Conventional Commit subjects (≤ 72 chars). Keep review follow-ups in separate commits instead of amending history.
- Follow the test selection policy:
  - `src/utils.js` only → `npm run test:unit`
  - `server.js` or streaming changes → `npm run test:integration` then `npm test`
  - Docker/Traefik changes → rebuild + `npm run smoke:prod`
- Before opening a PR, run `npm run verify:all` (formatting, lint, unit, integration, Playwright) unless the task explicitly calls for a different subset.
- Align code style with the repo defaults: ESM Node.js, 2-space indentation, double quotes, and Prettier/ESLint configs already checked in.

## Testing

This repo uses a three-layer testing setup optimized for fast inner-loop feedback while coding:

- Run `npm run verify:all` before opening a PR to execute formatting, linting, unit, integration, and Playwright suites in one step.
- Env smokes: `npm run smoke:dev` (requires `DEV_DOMAIN`/`KEY`) and `npm run smoke:prod` (requires `DOMAIN`/`KEY`) hit `/v1/models` and both streaming and non-stream chat endpoints against the respective stacks.
- CI artifacts: the workflow uploads `playwright-report`/`blob-report` plus `.smoke-tool-call.log`. Download artifacts from the run and open the HTML report locally via `npx playwright show-report playwright-report`.
- CI enforces a clean workspace after tests to catch regenerated fixtures; keep tracked assets updated locally before pushing.

1. Unit (Vitest, fast, watchable)

- Scope: pure helpers in `src/utils.js` (model normalization, token heuristics, message joining, time/usage math, CORS header logic, text filtering).
- Commands:
  - `npm run test:unit` — run once
  - `npm run test:unit:watch` — watch mode during development
  - `npm run coverage:unit` — unit test coverage (v8)

2. Integration (Vitest, real server, no external deps)

- Scope: Express endpoints exercised against the deterministic legacy proto shim; auth, error codes, non‑stream chat, usage endpoints, and CORS preflight for `/v1/chat/completions`.
- Notes: spawns `node server.js` on a random port and sets `CODEX_BIN=scripts/fake-codex-proto.js`, so no Codex installation is required.
- Command: `npm run test:integration`

3. End‑to‑End API/SSE (Playwright Test)

- Scope: verifies `/v1/models`, non‑stream chat, and streaming SSE (`role` delta and `[DONE]`).
- Command: `npm test`
- Tip: set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` if you are only running API/SSE tests and do not want browsers downloaded.

Live E2E (real Codex)

- Purpose: run E2E against a live proxy (local compose or edge) using your `.env` key to catch issues that the legacy shim cannot (e.g., writable `.codex-api` rollouts).
- Command: `npm run test:live`
- Env:
- `KEY` or `PROXY_API_KEY` (loaded from `.env` or environment)
  - `LIVE_BASE_URL` (default `http://127.0.0.1:11435`)
- What it checks:
  - `/healthz`, `/v1/models` (200 or 401 when models are protected)
  - Non‑stream chat returns content (no fallback message)
  - Streaming emits role delta, at least one content delta, and `[DONE]`

All together

- `npm run test:all` — unit → integration → e2e in sequence. Useful before pushing.
- `npm run test:report` — open the Playwright HTML report (after e2e has run).

Scaffolding (for forks)

- This repo already includes `vitest.config.ts` and the test suites. If you need to scaffold the same setup in a fork that lacks them, use the idempotent helper: `bash scripts/setup-testing-ci.sh`.

Suggested dev loop

- Working on pure helpers? Start `npm run test:unit:watch` and code in `src/utils.js`.
- Changing route logic or request/response shapes? Run `npm run test:integration` frequently.
- Touching streaming behavior? Validate with `npm test` (Playwright SSE) or the curl snippet in “Manual checks (SSE)”.

## Codex Cloud Setup

To prepare a fresh Codex Cloud (or any CI) environment with everything required to run this repo’s tests locally:

```bash
./setup-codex-cloud.sh           # installs deps, Playwright, prepares writable dirs
./setup-codex-cloud.sh --verify  # does the above and runs unit→integration→e2e
```

Notes

- Requires Node ≥ 22 and npm; does not touch your `.env` or secrets.
- Ensures `.codex-api/` and `.codev/` exist and are writable.
- Installs Playwright Chromium and OS deps when supported; falls back gracefully if not.
- Tests use the deterministic proto shim and do not require a real Codex binary.

### Environment variables (Codex Cloud)

These are optional for CI/Codex Cloud. The default test configs work without secrets.

- PROXY_API_KEY: Only needed when you run the server yourself or for live tests; not required for unit/integration/local E2E.
- LIVE_BASE_URL: Override base URL for `npm run test:live` (default `http://127.0.0.1:11435`).
- KEY: Alternative to `PROXY_API_KEY` for `test:live` bearer.
- PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: Set to `1` to skip downloading browsers if preinstalled.
- HTTP_PROXY / HTTPS_PROXY: Use standard proxy env vars if your environment requires outbound proxying. The setup script normalizes legacy npm proxy keys to avoid warnings.

### Which tests to run when

- Before running the full verification chain (`npm run verify:all`), execute the smoke script (`npm run smoke:dev` locally or `npm run smoke:prod` on hosts). The smoke workflow now fails fast by running `codex app-server --help`; failures surface immediately if the CLI is missing the app-server entrypoint.
- Changed `src/utils.js` only → run unit: `npm run test:unit`.
- Changed `server.js` routing/handlers/streaming → run integration: `npm run test:integration`, then E2E: `npm test`.
- Changed `docker-compose.yml` (labels/ports/ForwardAuth) or Traefik‑related behavior → run production smoke: `npm run smoke:prod` (on the origin host) and E2E.
- Changed `Dockerfile` → build and run dev stack (`npm run dev:stack:up`), then E2E.

Environment variables:

- `PORT` (default: `11435`)
- `PROXY_API_KEY` (default: `codex-local-secret`)
- `CODEX_MODEL` (default: `gpt-5`)
- `PROXY_STREAM_MODE` (deprecated/no effect) — kept for legacy compatibility; streaming mode is handled per request by the proxy/back end.
- `CODEX_BIN` (default: `codex`) — override to `/app/scripts/fake-codex-proto.js` only when you explicitly need the legacy proto shim (CI/offline tests).
- `CODEX_HOME` (default: `$PROJECT/.codex-api`) — path passed to Codex CLI for configuration. The repo uses a project‑local Codex HOME under `.codex-api/` (`config.toml`, `AGENTS.md`, etc.).
- `PROXY_SANDBOX_MODE` (default: `read-only`) — runtime sandbox passed to the Codex CLI via `--config sandbox_mode=...`. Read-only keeps the app-server from invoking file-writing tools (Codex will stop before `apply_patch` or shell edits). Override to `danger-full-access` only if you explicitly need write-capable tool calls and can tolerate clients that attempt to modify the workspace.
- Built-in Codex tools (shell, apply_patch, web_search, view_image) are disabled via `.codex-api/config.toml` / `.codev/config.toml`. Assistants must respond in plain text and must not emit `<use_tool>` blocks or request tool calls. Sections that describe tool-tail streaming (e.g., stop-after-tools) are therefore inactive unless you explicitly re-enable tools for a workflow.
- `PROXY_CODEX_WORKDIR` (default: `/tmp/codex-work`) — working directory for the Codex child process. This isolates any file writes from the app code and remains ephemeral in containers.
- `CODEX_FORCE_PROVIDER` (optional) — if set (e.g., `chatgpt`), the proxy passes `--config model_provider="<value>"` to Codex to force a provider instead of letting Codex auto-select (which may fall back to OpenAI API otherwise).
- `PROXY_ENABLE_CORS` (default: `true`) — when `true`, Express emits CORS headers. Set to `false` if the edge fully manages CORS.
- `PROXY_CORS_ALLOWED_ORIGINS` (default: `*`) — comma-separated allowlist used when app CORS is enabled. Include each trusted origin (e.g., `https://codex-api.onemainarmy.com,https://obsidian.md,app://obsidian.md,capacitor://localhost,http://localhost,https://localhost`).
- `PROXY_PROTECT_MODELS` (default: `false`) — set to `true` to require auth on `/v1/models`.
- `PROXY_TIMEOUT_MS` (default: `300000`) — overall request timeout (5 minutes).
- `PROXY_IDLE_TIMEOUT_MS` (default: `15000`) — non‑stream idle timeout while waiting for backend output.
- `PROXY_STREAM_IDLE_TIMEOUT_MS` (default: `300000`) — stream idle timeout between chunks (5 minutes).
- `PROXY_PROTO_IDLE_MS` (default: `120000`) — non‑stream aggregation idle guard for the legacy proto mode/shim.
- `PROXY_MAX_PROMPT_TOKENS` (default: `0`) — when >0, rejects overlong prompts with `403 tokens_exceeded_error` based on the proxy’s rough token estimator (≈1 token per 4 chars).
- `PROXY_KILL_ON_DISCONNECT` (default: `false`) — if true, terminate Codex when client disconnects.
- `SSE_KEEPALIVE_MS` (default: `15000`) — periodic `: keepalive` comment cadence for intermediaries.
- `TOKEN_LOG_PATH` (default: OS tmpdir `codex-usage.ndjson`) — where usage events are appended (NDJSON).
- `RATE_LIMIT_AVG` / `RATE_LIMIT_BURST` — Traefik rate limit average/burst (defaults: 200/400).

## Roo Code configuration

Use OpenAI-Compatible provider:

- Any OpenAI‑style Chat Completions client can talk to this proxy by setting the base URL and API key. Example: `http://127.0.0.1:11435/v1`
- API Key: `codex-local-secret`
- Model: `gpt-5`
- Reasoning effort: `High`

An example file is in `config/roo-openai-compatible.json`.

## API mapping

- `model`: normalized to the effective Codex model before invoking the JSON-RPC transport. Aliases such as `codex/gpt-5` are accepted but rewritten to the underlying `gpt-5` call.
- `messages[]`: transformed into the Codex schema (`system_prompt`, `messages`, `metadata`) and passed to `sendUserTurn`. System and assistant messages remain in the transcript; tool calls are flattened into text so existing Codex releases can parse them.
- `stream: true`: emits SSE with a role-first chunk, incremental content deltas, and `[DONE]`. When running the legacy proto shim, `PROXY_STREAM_MODE=jsonl` causes the proxy to forward raw JSON lines for debugging; app-server ignores this flag.
- `reasoning.effort ∈ {low,medium,high,minimal}`: forwarded via `--config model_reasoning_effort=...` (and the older `--config reasoning.effort=...` for backwards compatibility) in addition to the JSON payload.
- Sampling knobs (`temperature`, `top_p`, penalties, `max_tokens`) are ignored because Codex CLI does not expose them for app-server mode.

## How it works (main‑p)

- A supervisor launches one or more `codex app-server` workers with `--config sandbox_mode=<...>`, `--config project_doc_max_bytes=0`, `--config tools.web_search=false`, and the normalized effective model (`gpt-5` unless overridden).
- On boot the worker completes `initialize` against the exported schema bundle (`docs/app-server-migration/*`). Health endpoints stay unhealthy until this handshake succeeds.
- Each `/v1/chat/completions` request acquires a worker channel, builds a JSON-RPC payload for `sendUserTurn`, and injects the OpenAI-style transcript (system → `system_prompt`, rest → `messages`). Optional `reasoning.effort` becomes both JSON metadata and `--config model_reasoning_effort`.
- Streaming requests attach an event listener that forwards `agent_message_delta` notifications as SSE chunks (role-first, then deltas, then `[DONE]`). Keepalives (`: keepalive`) go out every `SSE_KEEPALIVE_MS`.
- Non-stream requests buffer deltas until `task_complete` arrives, then respond with a single OpenAI-compatible JSON body.
- Disconnects or idle timers trigger `cancelTask` and optionally `PROXY_KILL_ON_DISCONNECT`, ensuring app-server state does not leak across clients.

### Usage/Token tracking (approximate)

The proxy estimates tokens using a simple heuristic (~1 token per 4 characters) and logs each `/v1/chat/completions` call to an NDJSON file. For most operational trending this is sufficient; it does not reflect provider billing.

Endpoints (protected by the same edge auth as other `/v1/*` routes):

- `GET /v1/usage?start=<iso|epoch>&end=<iso|epoch>&group=<hour|day>` → aggregated counts
- `GET /v1/usage/raw?limit=100` → last N raw events

Event fields:

- `ts` (ms since epoch), `route`, `method`, `requested_model`, `effective_model`, `stream`, `prompt_tokens_est`, `completion_tokens_est`, `total_tokens_est`, `duration_ms`, `status`, `user_agent`.

### Reasoning variants

The proxy advertises additional model ids that all map to GPT‑5 but set the reasoning effort automatically unless explicitly provided in the request:

- `codex-5-low`
- `codex-5-medium`
- `codex-5-high`
- `codex-5-minimal`

Behavior:

- Selection sets `--config model_reasoning_effort="<level>"` (and a legacy `--config reasoning.effort="<level>"` for older CLIs).
- If `body.reasoning.effort` is present in the incoming request, it takes precedence over the implied level.
- The underlying `-m` remains the effective model (default: `gpt-5`).

## Behavior summary

- `GET /healthz` returns `{ ok: true }`.
- `GET /v1/models` lists only `codex-5` (no slashes) so clients like Cursor won’t confuse it with OpenAI built-ins. Requests that specify `gpt-5` directly still work.
- `POST /v1/chat/completions` with `stream:true` yields SSE with a role-first chunk and a `[DONE]` terminator (content chunk may arrive aggregated before `[DONE]`).
- App-server workers launch via `codex app-server` with flags such as `--config sandbox_mode=read-only`, `--config project_doc_max_bytes=0`, `--config tools.web_search=false`, and `--config model_reasoning_effort="<level>"`. Additional JSON payloads supply transcripts and metadata per request.

### Local dev with `.codev`

For an isolated dev setup that doesn’t touch your global Codex state, this repo supports a project-local config under `.codev/` (checked in with `AGENTS.md` and `config.toml`). Run the server on a separate port (e.g., 18000) using that config by pointing `CODEX_HOME` to `.codev`:

```
PROXY_API_KEY=<your-dev-key> npm run start:codev
```

If you don’t have the Codex CLI installed, you can use the built-in legacy proto shim to mimic streaming behavior (see [Legacy proto mode](#legacy-proto-mode-codex-cli-044x)):

```
PROXY_API_KEY=<your-dev-key> npm run start:codev:shim
```

Both commands serve at `http://127.0.0.1:18000/v1`.

### Prod Smoke

Use the production smoke script to verify the edge (Cloudflare) and the origin (Traefik) without relying on any IDE:

```
DOMAIN=codex-api.onemainarmy.com KEY=$PROXY_API_KEY npm run smoke:prod
```

Behavior:

- Checks origin via `https://127.0.0.1` with `Host: $DOMAIN` for `/healthz` and `/v1/models` (skippable with `SKIP_ORIGIN=1`).
- Checks Cloudflare for the same endpoints.
- If `KEY` is provided, issues a non‑stream chat completion and validates a text response.

### Simplest dev start (loads `.env` automatically)

Use the helper launcher which sources `.env` and runs on port 18000 by default:

```
npm run dev
```

Options:

- `npm run dev -- -p 19000` — change port
- `npm run dev:shim` — run without Codex CLI, using the deterministic legacy proto shim (see [Legacy proto mode](#legacy-proto-mode-codex-cli-044x))

The launcher never prints secrets and prefers project-local `.codev` config via `CODEX_HOME=.codev`.

### Dev stack (Compose)

Convenience scripts manage a self-contained dev stack that mirrors production behind Traefik:

- `npm run dev:stack:up` — build and start on `http://127.0.0.1:18010/v1` using the real app-server workers by default
- `npm run dev:stack:logs` — follow logs
- `npm run dev:stack:down` — stop and remove (prunes volumes)

Notes:

- Compose reads `PROXY_API_KEY` from `.env.dev`.
- Override port: `DEV_PORT=19010 npm run dev:stack:up`
- Set `CODEX_BIN=codex` to use your host Codex CLI (requires `~/.cargo/bin/codex`).
- File: `compose.dev.stack.yml` — single-file dev stack (`app-dev` + `auth-dev`), maps `./.codev` to `/home/node/.codex`, mounts your host Codex CLI at `/usr/local/bin/codex`, and configures ForwardAuth dev at `127.0.0.1:18081`. Set `CODEX_BIN=/app/scripts/fake-codex-proto.js` only if you explicitly need the legacy proto shim for CI/offline tests.

## Notes and troubleshooting

- Legacy note: `codex proto` does not accept `--ask-for-approval`, so the shim ignores that config. The app-server path enforces sandboxing via `.codex-api/config.toml` instead.
- Port already in use: If `11435` is busy, launch with `PORT=18000 npm run start` and run acceptance with `BASE_URL=http://127.0.0.1:18000/v1`.
- Streaming shape: First SSE chunk sets the role; subsequent chunks are deltas as the backend emits them; `[DONE]` terminates the stream.
- Auth: Ensure Codex CLI is logged in (e.g., `codex login`) if you are not using the test shim.
- Sandboxing: On some containerized Linux setups, sandboxing may be limited; read-only intent remains.
- Project docs are disabled for proxy runs: the proxy passes `--config project_doc_max_bytes=0` so the Codex backend behaves like a pure model API and does not ingest the app repo. The global `AGENTS.md` under `CODEX_HOME` still applies.

### Writable state and rollouts

The Codex CLI persists lightweight session artifacts ("rollouts"). Use `PROXY_CODEX_WORKDIR` (default `/tmp/codex-work`) to isolate runtime writes from configuration. Rollouts are small JSONL traces that include timestamps, minimal configuration, and high‑level event records from each Codex session. They enable:

- Debugging and reproducibility of agent behavior
- Auditability/telemetry for long‑running sessions
- Optional offline analysis or redaction pipelines

If the working area is read‑only, Codex may fail at startup or fall back to placeholder responses. Symptoms:

- App logs show: `failed to initialize rollout recorder: Read-only file system (os error 30)`
- Client sees minimal placeholder output despite a 200 status, or stream closes early.

Fix: ensure `PROXY_CODEX_WORKDIR` is present and writable (default `/tmp/codex-work`). The repo‑local `.codev` holds configuration; runtime writes should target the workdir, not configuration.

### Long-running tasks and stable streaming

For long/complex tasks or slow backends, tune these environment variables:

- `PROXY_TIMEOUT_MS` (default 300000): overall request timeout (non‑stream).
- `PROXY_STREAM_IDLE_TIMEOUT_MS` (default 300000): idle window for streaming before the backend is terminated.
- `PROXY_SSE_KEEPALIVE_MS` (default 15000): interval for SSE comment pings to keep connections alive across proxies.

The proxy sends periodic `: keepalive` SSE comments to prevent intermediaries from closing idle connections. Prefer `stream:true` for long tasks.

## Security and .gitignore

Sensitive files such as `.env`, `.npmrc`, and any Codex cache directory (`.codex/`) are ignored by `.gitignore`. The proxy never reads or writes your project files; it runs Codex with `--sandbox read-only`.

## Manual checks (SSE)

Validate streaming with curl:

```bash
curl -sN http://127.0.0.1:11435/v1/chat/completions \
  -H "Authorization: Bearer $PROXY_API_KEY" -H 'Content-Type: application/json' \
  -d '{"model":"codex-5","stream":true,"messages":[{"role":"user","content":"Say hello."}]}' | sed -n '1,30p'
```

Expect an initial role delta, one or more `data: {"..."}` chunks, then `data: [DONE]`.

## Client compatibility quickstart

- Any OpenAI‑style Chat Completions client can talk to this proxy by setting the base URL and API key. Example: `https://your-public-host/v1` (must be reachable by Cursor’s cloud; `http://127.0.0.1` will not work).
- API Key: same value as `PROXY_API_KEY`.
- Model: select `codex-5` (proxy normalizes to effective `gpt-5`).
- Streaming: supported (role-first delta + `[DONE]`). For more granular deltas set `PROXY_STREAM_MODE=jsonl`.
- Optional: set `PROXY_PROTECT_MODELS=true` to force auth on `/v1/models` during verification.
- Hangs: if Codex is missing or stalls, responses will fail fast per `PROXY_TIMEOUT_MS` instead of hanging.

## Deployment: Traefik + Cloudflare (Docker Compose)

This section deploys the API behind Traefik with HTTPS handled by cloudflared and Bearer auth enforced at the edge via Traefik ForwardAuth. The service itself already checks Bearer tokens internally in [app.post()](server.js:46). Public health probe is served at [app.get()](server.js:39).

Prerequisites

- Traefik v3 running as a host service with Docker provider enabled and an external Docker network named `traefik`.
- Entrypoint `websecure` is active in Traefik. Certificates are handled by your cloudflared tunnel + Traefik; no ACME changes required.
- Domain: `codex-api.onemainarmy.com` is routed via cloudflared to Traefik.
- Docker Compose v2.

Files in this repo

- Build image: [Dockerfile](Dockerfile)
- Compose stack: [docker-compose.yml](docker-compose.yml)
- ForwardAuth microservice: [auth/server.js](auth/server.js)
- Main API server: [server.js](server.js)

Edge authentication model

- Traefik calls `http://127.0.0.1:18080/verify` via ForwardAuth (implemented by [auth/server.js](auth/server.js:1)).
- The auth service validates the `Authorization: Bearer &lt;token&gt;` header equals the shared secret `PROXY_API_KEY`. On mismatch it returns 401 with a `WWW-Authenticate: Bearer realm=api` header.
- On success, Traefik forwards the request to the app container service port 11435, preserving the original `Authorization` header so the in-app check still applies (defense in depth).

Containerization

- The app image is defined in [Dockerfile](Dockerfile) and launches the proxy with `node server.js`.
- Codex CLI availability inside the container:
  - Option A (mount from host, recommended initially): By default the app runs Codex with `HOME=/home/node` and expects config under `/home/node/.codex/config.toml`. The Compose file mounts your host `~/.codex-api` into the container at `/home/node/.codex` and binds the `codex` binary:
    - Host → Container: `~/.codex-api` → `/home/node/.codex:ro`
    - Host → Container: `~/.cargo/bin/codex` → `/usr/local/bin/codex:ro`
    - Create your config at `~/.codex-api/config.toml` on the host.
  - Option B (bake into image): Extend the Dockerfile to install `codex` and copy credentials during build (ensure no secrets end up in the image layers).

Configuration

- Create an environment file from the example:
  - `cp .env.example .env`
  - Set `PROXY_API_KEY` to the shared secret (used by both the auth service and the app).
- Ensure external Docker network:
  - `docker network create traefik` (no-op if it already exists)
- Bring up the stack:
  - `docker compose up -d --build`

Traefik labels overview (see [docker-compose.yml](docker-compose.yml))

- Protected API:
  - Router: `Host('codex-api.onemainarmy.com') && PathPrefix('/v1')`
  - EntryPoints: `websecure`, `tls=true`
  - Middleware: `codex-forwardauth` pointing to `http://127.0.0.1:18080/verify`
  - Service port: `11435`
- Public health:
  - Router: `Host('codex-api.onemainarmy.com') && Path('/healthz')`
  - EntryPoints: `websecure`, `tls=true`
  - Service: same as API service

Smoke tests

- Health (public):
  - `curl -i https://codex-api.onemainarmy.com/healthz`
- Protected route (no token → 401):
  - `curl -i https://codex-api.onemainarmy.com/v1/models`
- Wrong token → 401:
  - `curl -i -H 'Authorization: Bearer wrong' https://codex-api.onemainarmy.com/v1/models`
- Correct token → 200 (replace VALUE):
  - `curl -i -H 'Authorization: Bearer VALUE' https://codex-api.onemainarmy.com/v1/models`
- SSE streaming sanity:
  - `curl -N -H 'Authorization: Bearer VALUE' -H 'Content-Type: application/json' \\`
  - `  -d '{"model":"gpt-5","stream":true,"messages":[{"role":"user","content":"ping"}]}' \\`
  - `  https://codex-api.onemainarmy.com/v1/chat/completions`

Notes

- The app already sets headers for SSE in [streaming branch](server.js:120) and disables buffering with `X-Accel-Buffering: no`. Traefik streams by default.
- Do not expose the app’s container port on the host. Traefik connects via the Docker network `traefik`.
- Keep `PROXY_API_KEY` out of images and source control. Provide via environment or a Docker secret.

## Security Hardening

This repository ships an edge-first security posture when deployed via Traefik and Cloudflare. Key elements:

- Layered CORS: Traefik enforces an allowlist via `accessControlAllowOriginList`, and the app reflects only the origins present in `PROXY_CORS_ALLOWED_ORIGINS`. Disable app CORS (`PROXY_ENABLE_CORS=false`) if you prefer the edge to be the single enforcement point.
- Preflight router: Host-scoped `OPTIONS` router uses `noop@internal` so the origin is never hit, with middlewares `codex-cors,codex-headers,codex-ratelimit`.
- Security headers: HSTS, frame deny, nosniff, referrer policy, and a restrictive `Permissions-Policy` (includes `interest-cohort=()`).
- Rate limiting: `codex-ratelimit` applied before ForwardAuth to shield the auth service.

Cloudflare CORS Worker

- Worker name: `codex-preflight-logger`. Lives under `workers/cors-preflight-logger` and reflects the incoming Origin plus _all_ requested preflight headers for trusted origins (`app://obsidian.md`, `capacitor://localhost`, `http://localhost`, `https://localhost`, and the hosted domains).
- Deploy with `./workers/cors-preflight-logger/deploy.sh` (requires `WORKER_CLOUDFLARE_API_TOKEN` granting Workers Scripts + Routes). The `wrangler.toml` attaches the worker to both `codex-dev` and `codex-api` hostnames.
- The worker logs every OPTIONS/POST via `console.log`, making `wrangler tail codex-preflight-logger --format json --sampling-rate 0.5` ideal for on-call investigations.
- Keep Traefik’s `codex-cors` middleware and `PROXY_CORS_ALLOWED_ORIGINS` in sync with the worker allowlist. Traefik still guards preflights with `noop@internal` so the origin only sees vetted requests.

Optional Transform Rule (only if Workers unavailable)

- Rules → Transform Rules → Response Header Modification → Create
  - When: Host equals your domain + Path starts with `/v1/` + Method in OPTIONS, GET, POST, HEAD
  - Set headers:
    - Access-Control-Allow-Origin: explicit origin string or `$http_origin` (if supported)
    - Access-Control-Allow-Methods: `GET, POST, HEAD, OPTIONS`
    - Access-Control-Allow-Headers: include all headers sent by your clients (Stainless adds `X-Stainless-*`, Obsidian iOS sends `user-agent`)
    - Access-Control-Max-Age: `600`

Preflight smoke test

```bash
curl -i -X OPTIONS 'https://codex-api.onemainarmy.com/v1/chat/completions' \
  -H 'Origin: app://obsidian.md' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: authorization, content-type, x-stainless-os'
# Expect: ACAO echoes the Origin, Allow-Methods present, Allow-Headers includes union (e.g., X-Stainless-* + user-agent).
# Mobile smoke: swap the Origin header to `capacitor://localhost` (or `capacitor://localhost/`) to emulate Obsidian iOS; use `http://localhost:1313` to mimic Android.
```

Tightening origins

- Default is `Access-Control-Allow-Origin: *` (safe with bearer tokens; no cookies). To restrict:
- Set a Traefik allowlist via `accessControlAllowOriginList[...]` and regex entries (include `app://obsidian.md`, `capacitor://localhost`, `http://localhost`, `https://localhost`, and trusted web origins).
  - Update the Cloudflare transform rule to either reflect the request `Origin` (Worker) or set an explicit allowlist value.
- Streaming usage event (in-band): Include `"stream_options": { "include_usage": true }` to receive a final SSE usage event: `data: {"event":"usage","usage":{"prompt_tokens":N,"completion_tokens":M,"total_tokens":N+M}}`.
- Ask the model directly: Send a user message like `usage today`, `usage yesterday`, `usage last 7d`, or `usage start=2025-09-01 end=2025-09-02 group=hour`. The proxy detects these simple queries and responds with a usage summary without invoking the backend model.

## Branch status

This branch (`main-p`) runs the app-server worker supervisor (stateless per request, but workers stay warm between calls). Feature branches exist but are not merged:

- `feat/playwright-tests`: Playwright API/SSE tests with a deterministic shim.
- `feat/prompt-cache-resume`: experimental, feature-gated caching hooks.
- `feat/proto-continuous-sessions`: experimental legacy proto sessions keyed by `session_id`.

They remain idle; refer to their commit messages for details.
