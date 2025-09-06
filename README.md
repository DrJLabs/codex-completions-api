# Codex Completions API (OpenAI-compatible proxy)

OpenAI Chat Completions-compatible HTTP proxy that shells to Codex CLI, with SSE streaming compatibility and minimal output shaping. An OpenAI Chat Completions‑compatible HTTP proxy that invokes the Codex CLI in "proto" mode. It provides a drop‑in /v1/chat/completions endpoint with Server‑Sent Events (SSE) streaming and minimal output shaping so that any OpenAI‑style client (SDKs, tools, curl) can talk to Codex as if it were a standard model API.

## Features

- OpenAI-compatible routes: `/v1/models`, `/v1/chat/completions`.
- Streaming via Codex proto events: first SSE chunk sets `delta.role=assistant`, then incremental deltas when proto emits them; otherwise a full message arrives once available. The stream always ends with `[DONE]`. Periodic `: keepalive` SSE comments keep intermediaries from timing out.
- Minimal output shaping: ANSI is stripped; additional heuristics exist but are conservative by default to avoid dropping valid content.
- Reasoning effort mapping: `reasoning.effort` → `--config model_reasoning_effort="<low|medium|high|minimal>"` (also passes the legacy `--config reasoning.effort=...` for older CLIs).
- Token usage tracking (approximate): logs estimated prompt/completion tokens per request and exposes query endpoints under `/v1/usage`.
- Safety: Codex runs read‑only; the proxy does not read project files. One proto process per request on this branch (stateless).

## Project Structure (high‑level)

```
docker-compose.yml              # PRODUCTION compose and Traefik labels (source of truth)
Dockerfile                      # App image (production build)
server.js                       # Express API (OpenAI‑compatible routes)
src/utils.js                    # Utilities (tokens, join/normalize, CORS helpers)
auth/server.mjs                 # Traefik ForwardAuth microservice
tests/                          # Unit, integration, Playwright E2E
scripts/                        # Dev + CI helpers (dev.sh, dev-docker.sh, prod-smoke.sh)
.codev/                         # Project‑local Codex HOME for dev (config.toml, AGENTS.md)
 .codex-api/                     # Production Codex HOME (secrets; writable mount in compose)
.github/workflows/ci.yml        # CI: lint, format, unit, integration, e2e
AGENTS.md                       # Agent directives (project‑specific rules included)
```

## Environments: PROD vs DEV

### Production

- This repo’s `docker-compose.yml` is the production deployment spec.
- Traefik runs as a host/system service (not a container).
- ForwardAuth MUST use host loopback:
  - `traefik.http.middlewares.codex-forwardauth.forwardauth.address=http://127.0.0.1:18080/verify`
- App attaches to Docker network `traefik` and is discovered via labels.
- Edge is Cloudflare for `codex-api.onemainarmy.com`.

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

### Development

- Node dev: `npm run dev` (port 18000) or `npm run dev:shim` (no Codex CLI required), using `.codev` as Codex HOME.
- Container dev: `npm run dev:docker` (also port 18000 by default) or `npm run dev:docker:codex` (uses host Codex CLI).

Codex HOME (development):

- Dev instances use the project-local `.codev/` as Codex HOME.
- Scripts (`npm run dev`, `npm run dev:shim`) and dev compose map `.codev` appropriately; the dev launcher seeds `config.toml` and `AGENTS.md` into the runtime `CODEX_HOME` if missing.

Build context hygiene:

- `.dockerignore` excludes `.codex-api/**`, `.codev/**`, `.env*`, logs, and other local artifacts so secrets are never sent to the Docker daemon.

## Production Smoke

Run a minimal end‑to‑end check of origin (Traefik) and edge (Cloudflare):

```
DOMAIN=codex-api.onemainarmy.com KEY=$PROXY_API_KEY npm run smoke:prod
```

Behavior:
- Origin (host only): checks `https://127.0.0.1/healthz` and `/v1/models` with `Host: $DOMAIN`.
- Edge (Cloudflare): checks `/healthz`, `/v1/models`, and an optional authenticated non‑stream chat.

## Diagrams

Architecture (PROD routing & components):

![Architecture](docs/architecture.png)

Development modes (Node vs Container):

![Dev Modes](docs/dev-modes.png)

Request Flow (Auth, Routers, SSE):

![Request Flow](docs/request-flow.png)

## Quick start

- Prereqs: Node ≥ 18, npm, curl (or Docker Compose).

Option A — Node (local):

```bash
npm install
PORT=11435 PROXY_API_KEY=codex-local-secret npm run start
# health
curl -s http://127.0.0.1:11435/healthz | jq .
# models
curl -s http://127.0.0.1:11435/v1/models | jq .
# chat (non-stream)
curl -s http://127.0.0.1:11435/v1/chat/completions \
  -H "Authorization: Bearer codex-local-secret" -H 'Content-Type: application/json' \
  -d '{"model":"codex-5","stream":false,"messages":[{"role":"user","content":"Respond with a short sentence."}]}' | jq .
```

Option B — Docker Compose:

```bash
docker compose up -d --build
curl -s http://127.0.0.1:11435/healthz | jq .
```

## Local development

Use the curl snippets above to validate endpoints while `npm run start` is running.

## Testing

This repo uses a three-layer testing setup optimized for fast inner-loop feedback while coding:

1. Unit (Vitest, fast, watchable)

- Scope: pure helpers in `src/utils.js` (model normalization, token heuristics, message joining, time/usage math, CORS header logic, text filtering).
- Commands:
  - `npm run test:unit` — run once
  - `npm run test:unit:watch` — watch mode during development
  - `npm run coverage:unit` — unit test coverage (v8)

2. Integration (Vitest, real server, no external deps)

- Scope: Express endpoints with a deterministic Codex "proto" shim; exercises auth, error codes, non‑stream chat, and usage endpoints.
- Notes: spawns `node server.js` on a random port and sets `CODEX_BIN=scripts/fake-codex-proto.js`, so no Codex installation is required.
- Command: `npm run test:integration`

3. End‑to‑End API/SSE (Playwright Test)

- Scope: verifies `/v1/models`, non‑stream chat, and streaming SSE (`role` delta and `[DONE]`).
- Command: `npm test`
- Tip: set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` if you are only running API/SSE tests and do not want browsers downloaded.

Live E2E (real Codex)

- Purpose: run E2E against a live proxy (local compose or edge) using your `.env` key to catch issues that the proto shim cannot (e.g., writable `.codex-api` rollouts).
- Command: `npm run test:live`
- Env:
  - `KEY` or `PROXY_API_KEY` (loaded from `.env`/`.env.secret` by the script)
  - `LIVE_BASE_URL` (default `http://127.0.0.1:11435`)
- What it checks:
  - `/healthz`, `/v1/models` (200 or 401 when models are protected)
  - Non‑stream chat returns content (no fallback message)
  - Streaming emits role delta, at least one content delta, and `[DONE]`

All together

- `npm run test:all` — unit → integration → e2e in sequence. Useful before pushing.

Suggested dev loop

- Working on pure helpers? Start `npm run test:unit:watch` and code in `src/utils.js`.
- Changing route logic or request/response shapes? Run `npm run test:integration` frequently.
- Touching streaming behavior? Validate with `npm test` (Playwright SSE) or the curl snippet in “Manual checks (SSE)”.

### Which tests to run when

- Changed `src/utils.js` only → run unit: `npm run test:unit`.
- Changed `server.js` routing/handlers/streaming → run integration: `npm run test:integration`, then E2E: `npm test`.
- Changed `docker-compose.yml` (labels/ports/ForwardAuth) or Traefik‑related behavior → run production smoke: `npm run smoke:prod` (on the origin host) and E2E.
- Changed `Dockerfile` → build and run container DEV smoke (`npm run dev:docker`), then E2E.

Environment variables:

- `PORT` (default: `11435`)
- `PROXY_API_KEY` (default: `codex-local-secret`)
- `CODEX_MODEL` (default: `gpt-5`)
- `PROXY_STREAM_MODE` (default: `incremental`) — proto‑based streaming emits deltas when available or an aggregated message; this knob is kept for compatibility.
- `CODEX_BIN` (default: `codex`)
- `CODEX_HOME` (default: `$PROJECT/.codex-api`) — path passed to Codex CLI for configuration. The repo uses a project‑local Codex HOME under `.codex-api/` (`config.toml`, `AGENTS.md`, etc.).
- `PROXY_SANDBOX_MODE` (default: `danger-full-access`) — runtime sandbox passed to Codex proto via `--config sandbox_mode=...`. Use `read-only` if clients should be prevented from file writes; use `danger-full-access` to avoid IDE plugins misinterpreting sandbox errors.
- `PROXY_CODEX_WORKDIR` (default: `/tmp/codex-work`) — working directory for the Codex child process. This isolates any file writes from the app code and remains ephemeral in containers.
- `CODEX_FORCE_PROVIDER` (optional) — if set (e.g., `chatgpt`), the proxy passes `--config model_provider="<value>"` to Codex to force a provider instead of letting Codex auto-select (which may fall back to OpenAI API otherwise).
- `PROXY_ENABLE_CORS` (default: `true`) — set to `false` when fronted by Traefik/Cloudflare so edge owns CORS.
- `PROXY_PROTECT_MODELS` (default: `false`) — set to `true` to require auth on `/v1/models`.
- `PROXY_TIMEOUT_MS` (default: `300000`) — overall request timeout (5 minutes).
- `PROXY_IDLE_TIMEOUT_MS` (default: `15000`) — non‑stream idle timeout while waiting for backend output.
- `PROXY_STREAM_IDLE_TIMEOUT_MS` (default: `300000`) — stream idle timeout between chunks (5 minutes).
- `PROXY_PROTO_IDLE_MS` (default: `120000`) — non‑stream aggregation idle guard for proto mode.
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

- `model`: passthrough to `-m <model>`.
  - Accepts aliases like `codex/<model>` (e.g., `codex/gpt-5`), which normalize to `<model>` when invoking Codex.
- `messages[]`: joined into a single positional prompt with `[role]` prefixes.
- `stream: true`:
  - Default: role-first SSE chunk, then one aggregated content chunk on process close, then `[DONE]`.
  - With `PROXY_STREAM_MODE=jsonl`: proxy parses `codex proto --json` JSON-lines. If Codex emits `agent_message_delta`, deltas are streamed incrementally; otherwise the full `agent_message` is forwarded immediately without waiting for process exit.
- `reasoning.effort ∈ {low,medium,high,minimal}`: attempts `--config reasoning.effort="<effort>"`.
- Other knobs (temperature, top_p, penalties, max_tokens): ignored.

## How it works (main‑p)

- The proxy normalizes the requested model (e.g., `codex-5` → effective `gpt-5`) and prepares Codex proto args:
  - `preferred_auth_method="chatgpt"`, `project_doc_max_bytes=0`, `history.persistence="none"`, `tools.web_search=false`, `model="<effective>"`, optional `model_provider`, and `reasoning.effort` when supplied.
- It joins `messages[]` into a single text prompt `"[role] content"` lines and sends one `user_input` op to the Codex proto child process.
- Streaming (`stream:true`):
  - Sends an initial SSE chunk with `delta.role=assistant`.
  - For each `agent_message_delta`, emits a content delta chunk; otherwise emits the full `agent_message` when received.
  - Appends `[DONE]` and ends the stream. Keepalives (`: keepalive`) are sent every `SSE_KEEPALIVE_MS`.
- Non‑stream: Accumulates deltas until `task_complete`, then responds with an OpenAI‑style JSON body.
- One proto process per request: the child process is terminated on timeout/idle/close; no state is retained between requests.

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
- Codex child invoked as:

```
codex proto \
  --sandbox read-only \
  --config preferred_auth_method="chatgpt" \
  --config project_doc_max_bytes=0 \
  -m gpt-5 \
  [--config model_reasoning_effort="high"] \
  "<prompt>"
```

### Local dev with `.codev`

For an isolated dev setup that doesn’t touch your global Codex state, this repo supports a project-local config under `.codev/` (checked in with `AGENTS.md` and `config.toml`). Run the server on a separate port (e.g., 18000) using that config by pointing `CODEX_HOME` to `.codev`:

```
PROXY_API_KEY=<your-dev-key> npm run start:codev
```

If you don’t have the Codex CLI installed, you can use the built-in proto shim to mimic streaming behavior:

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

Use the helper launcher which sources `.env` (and `.env.secret` if present) and runs on port 18000 by default:

```
npm run dev
```

Options:

- `npm run dev -- -p 19000` — change port
- `npm run dev:shim` — run without Codex CLI, using the built-in proto shim

The launcher never prints secrets and prefers project-local `.codev` config via `CODEX_HOME=.codev`.

### Container dev (Compose)

Convenience scripts manage a dev container that mirrors production but runs on a local port and uses project‑local config:

- `npm run dev:docker` — build and start on `http://127.0.0.1:18000/v1` using the proto shim
- `npm run dev:docker:codex` — same but uses your host Codex CLI (requires `~/.cargo/bin/codex`)
- `npm run dev:docker:logs` — follow logs
- `npm run dev:docker:down` — stop and remove

Notes:

- Compose reads `PROXY_API_KEY` from your `.env`.
- Override port: `DEV_PORT=19000 npm run dev:docker`
- Files:
  - `docker-compose.dev.yml` — base dev service (`app-dev`), maps `./.codev` to `/home/node/.codex`, exposes `127.0.0.1:${DEV_PORT:-18000}:11435` and defaults to the proto shim at `/app/scripts/fake-codex-proto.js`.
  - `docker-compose.dev.codex.yml` — optional override to mount `~/.cargo/bin/codex` and set `CODEX_BIN=codex`.

## Notes and troubleshooting

- Approval flag: `codex proto` does not accept `--ask-for-approval`.
-
- Port already in use: If `11435` is busy, launch with `PORT=18000 npm run start` and run acceptance with `BASE_URL=http://127.0.0.1:18000/v1`.
- Streaming shape: First SSE chunk sets the role; subsequent chunks are deltas when proto emits them; `[DONE]` terminates the stream.
- Auth: Ensure Codex CLI is logged in (e.g., `codex login`) if you are not using the test shim.
- Sandboxing: On some containerized Linux setups, sandboxing may be limited; read-only intent remains.
- Project docs are disabled for proxy runs: the proxy passes `--config project_doc_max_bytes=0` so the Codex backend behaves like a pure model API and does not ingest the app repo. The global `AGENTS.md` under `CODEX_HOME` still applies.

### Writable state and rollouts

The Codex CLI persists lightweight session artifacts ("rollouts"). Use `PROXY_CODEX_WORKDIR` (default `/tmp/codex-work`) to isolate runtime writes from configuration. Rollouts are small JSONL traces that include timestamps, minimal configuration, and high‑level event records from the proto session. They enable:

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

## License

UNLICENSED (see repository terms). Do not redistribute without permission.

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

- CORS at the edge: App CORS is disabled (`PROXY_ENABLE_CORS=false` in Compose). Traefik emits CORS headers for actual and preflight responses; Cloudflare adds/normalizes these for OPTIONS and error paths.
- Preflight router: Host-scoped `OPTIONS` router uses `noop@internal` so the origin is never hit, with middlewares `codex-cors,codex-headers,codex-ratelimit`.
- Security headers: HSTS, frame deny, nosniff, referrer policy, and a restrictive `Permissions-Policy` (includes `interest-cohort=()`).
- Rate limiting: `codex-ratelimit` applied before ForwardAuth to shield the auth service.

Cloudflare Response Header Transform (dashboard)

- Rules → Transform Rules → Response Header Modification → Create
  - When: Host equals your domain + Path starts with `/v1/` + Method in OPTIONS, GET, POST, HEAD
  - Set headers:
    - Access-Control-Allow-Origin: `*`
    - Access-Control-Allow-Methods: `GET, POST, HEAD, OPTIONS`
    - Access-Control-Allow-Headers: `Authorization, Content-Type, Accept, OpenAI-Organization, OpenAI-Beta, X-Requested-With, X-Stainless-OS, X-Stainless-Lang, X-Stainless-Arch, X-Stainless-Runtime, X-Stainless-Runtime-Version, X-Stainless-Package-Version, X-Stainless-Timeout, X-Stainless-Retry-Count`
    - Access-Control-Max-Age: `600`

Preflight smoke test

```bash
curl -i -X OPTIONS 'https://codex-api.onemainarmy.com/v1/chat/completions' \
  -H 'Origin: app://obsidian.md' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: authorization, content-type, x-stainless-os'
# Expect: ACAO: *, Allow-Methods present, Allow-Headers includes X-Stainless-*
```

Tightening origins

- Default is `Access-Control-Allow-Origin: *` (safe with bearer tokens; no cookies). To restrict:
  - Set a Traefik allowlist via `accessControlAllowOriginList[...]` and regex entries (include `app://obsidian.md`, localhost, and trusted web origins).
  - Update the Cloudflare transform rule to either reflect the request `Origin` (Worker) or set an explicit allowlist value.
- Streaming usage event (in-band): Include `"stream_options": { "include_usage": true }` to receive a final SSE usage event: `data: {"event":"usage","usage":{"prompt_tokens":N,"completion_tokens":M,"total_tokens":N+M}}`.
- Ask the model directly: Send a user message like `usage today`, `usage yesterday`, `usage last 7d`, or `usage start=2025-09-01 end=2025-09-02 group=hour`. The proxy detects these simple queries and responds with a usage summary without invoking the backend model.

## Branch status

This branch (`main-p`) uses one Codex proto process per request (stateless). Feature branches exist but are not merged:

- `feat/playwright-tests`: Playwright API/SSE tests with a deterministic shim.
- `feat/prompt-cache-resume`: experimental, feature-gated caching hooks.
- `feat/proto-continuous-sessions`: continuous proto sessions keyed by `session_id`.

They remain idle; refer to their commit messages for details.
