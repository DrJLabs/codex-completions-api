# Codex Completions API (OpenAI-compatible proxy)

OpenAI Chat Completions-compatible HTTP proxy that shells to Codex CLI, with SSE streaming compatibility and minimal output shaping. Designed for Roo Code to treat Codex CLI as a first-class "model" via the OpenAI-Compatible provider path.

## Features
- OpenAI-compatible routes: `/v1/models`, `/v1/chat/completions`.
- SSE streaming: emits an initial `delta.role=assistant` chunk. By default content is aggregated into one chunk; with `PROXY_STREAM_MODE=jsonl`, the proxy parses `codex exec --json` to stream incremental deltas when available, or the full agent message as soon as it’s emitted.
- Minimal output shaping: ANSI is stripped; additional heuristics exist but are conservative by default to avoid dropping valid content.
- Reasoning effort mapping: `reasoning.effort` → `--config reasoning.effort="<low|medium|high|minimal>"` (silently ignored by older builds).
- Token usage tracking (approximate): logs estimated prompt/completion tokens per request and exposes query endpoints under `/v1/usage`.
- Safety: Codex runs with `--sandbox read-only`. Approval flags are not passed to `exec` (see Notes).

## Quick start

- Prereqs: Node >= 18, npm, curl. Codex CLI will be installed if missing.
- One-liner install + systemd user service:

```bash
bash scripts/install.sh
```

This installs to `~/.local/share/codex-openai-proxy`, creates a user service, and runs the proxy at `http://127.0.0.1:11435/v1` with API key `codex-local-secret`.
If port `11435` is already in use, override with `PORT=18000 npm run start` (and use `BASE_URL=http://127.0.0.1:18000/v1` in tests).

## Local development

```bash
npm install
npm run start
# In another shell
bash scripts/smoke.sh
```

Environment variables:
- `PORT` (default: `11435`)
- `PROXY_API_KEY` (default: `codex-local-secret`)
- `CODEX_MODEL` (default: `gpt-5`)
- `PROXY_STREAM_MODE` (default: `incremental`) — set to `jsonl` to parse `--json` events for finer-grained streaming.
- `CODEX_BIN` (default: `codex`)
 - `PROXY_ENABLE_CORS` (default: `true`) — set to `false` when fronted by Traefik/Cloudflare so edge owns CORS.
- `PROXY_PROTECT_MODELS` (default: `false`) — set to `true` to require auth on `/v1/models`.
- `PROXY_TIMEOUT_MS` (default: `60000`) — per-request timeout to abort hung Codex subprocesses.
- `PROXY_KILL_ON_DISCONNECT` (default: `true`) — terminate Codex if the client disconnects.
- `TOKEN_LOG_PATH` (default: `logs/usage.ndjson`) — where usage events are appended (NDJSON).
 - `RATE_LIMIT_AVG` / `RATE_LIMIT_BURST` — Traefik rate limit average/burst (defaults: 200/400).

## Roo Code configuration

Use OpenAI-Compatible provider:
- Base URL: `http://127.0.0.1:11435/v1`
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
  - With `PROXY_STREAM_MODE=jsonl`: proxy parses `codex exec --json` JSON-lines. If Codex emits `agent_message_delta`, deltas are streamed incrementally; otherwise the full `agent_message` is forwarded immediately without waiting for process exit.
- `reasoning.effort ∈ {low,medium,high,minimal}`: attempts `--config reasoning.effort="<effort>"`.
- Other knobs (temperature, top_p, penalties, max_tokens): ignored.

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

## Acceptance criteria

- `GET /healthz` returns `{ ok: true }`.
- `GET /v1/models` lists only `codex-5` (no slashes) so clients like Cursor won’t confuse it with OpenAI built-ins. Requests that specify `gpt-5` directly still work.
- `POST /v1/chat/completions` with `stream:true` yields SSE with a role-first chunk and a `[DONE]` terminator (content chunk may arrive aggregated before `[DONE]`).
- Codex child invoked as:

```
codex exec --sandbox read-only --config preferred_auth_method="chatgpt" -m gpt-5 [--config reasoning.effort="high"] "<prompt>"
```

## Notes and troubleshooting

- Approval flag: `codex exec` does not accept `--ask-for-approval`. The proxy relies on `exec`'s non-interactive behavior and your Codex defaults. If you need to enforce approvals globally, configure them in `~/.codex/config.toml`.
- Reasoning effort: Some versions may ignore `--config reasoning.effort=...`. Use Roo’s “High” if unsure.
- Port already in use: If `11435` is busy, launch with `PORT=18000 npm run start` and run acceptance with `BASE_URL=http://127.0.0.1:18000/v1`.
- Streaming shape: Immediate role chunk is emitted to satisfy Chat Completions SSE clients. Default aggregates content into a single chunk. Set `PROXY_STREAM_MODE=jsonl` to parse Codex JSON-lines: when deltas are available they are streamed; otherwise the full message is forwarded as soon as Codex emits it.
- Auth: Ensure you’re logged into Codex (`codex login`).
- Sandboxing: On some containerized Linux setups, sandboxing may be limited; read-only intent remains.

### Long-running tasks and stable streaming

For long/complex tasks or slow backends, tune these environment variables:

- `PROXY_TIMEOUT_MS` (default 300000): overall request timeout (non‑stream).
- `PROXY_STREAM_IDLE_TIMEOUT_MS` (default 300000): idle window for streaming before the backend is terminated.
- `PROXY_SSE_KEEPALIVE_MS` (default 15000): interval for SSE comment pings to keep connections alive across proxies.

The proxy sends periodic `: keepalive` SSE comments to prevent intermediaries from closing idle connections. Prefer `stream:true` for long tasks.

## Security and .gitignore

Sensitive files such as `.env`, `.npmrc`, and any Codex cache directory (`.codex/`) are ignored by `.gitignore`. The proxy never reads or writes your project files; it runs Codex with `--sandbox read-only`.

## Running acceptance

You can run the acceptance checks locally (requires Codex installed and logged in):

```bash
# Default port
bash scripts/acceptance.sh

# Alternate port if 11435 is in use
PORT=18000 npm run start &
BASE_URL=http://127.0.0.1:18000/v1 bash scripts/acceptance.sh
```

The acceptance checks look for a role-first SSE chunk and the `[DONE]` terminator. Content may arrive as one aggregated chunk prior to `[DONE]`.
## Cursor compatibility quickstart
- Base URL: `https://your-public-host/v1` (must be reachable by Cursor’s cloud; `http://127.0.0.1` will not work).
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
- ForwardAuth microservice: [auth/server.js](auth/server.js:1)
- Main API server: [Express app](server.js:8), routes [GET /healthz](server.js:39), [GET /v1/models](server.js:41), [POST /v1/chat/completions](server.js:46)

Edge authentication model
- Traefik calls `http://127.0.0.1:18080/verify` via ForwardAuth (implemented by [auth/server.js](auth/server.js:1)).
- The auth service validates the `Authorization: Bearer &lt;token&gt;` header equals the shared secret `PROXY_API_KEY`. On mismatch it returns 401 with a `WWW-Authenticate: Bearer realm=api` header.
- On success, Traefik forwards the request to the app container service port 11435, preserving the original `Authorization` header so the in-app check still applies (defense in depth).

Containerization
- The app image is defined in [Dockerfile](Dockerfile) and launches the proxy with `node server.js`.
- Codex CLI availability inside the container:
  - Option A (mount from host, recommended initially): Uncomment the volumes lines in [docker-compose.yml](docker-compose.yml) to mount your host Codex credentials and binary.
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
