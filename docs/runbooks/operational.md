# Operational Runbook — Codex Completions API

Audience: on-call, SRE, and developers operating the OpenAI‑compatible proxy.
Scope: origin service only (Node/Express + Codex child). Traefik/Cloudflare specifics are referenced where relevant.

## Quick Checks

- Health: `curl -s 127.0.0.1:${PORT:-11435}/healthz | jq .`
- Models (HEAD/GET): `curl -sI 127.0.0.1:${PORT:-11435}/v1/models && curl -s 127.0.0.1:${PORT:-11435}/v1/models | jq .`
- Chat (non‑stream):
  ```bash
  BASE="http://127.0.0.1:${PORT:-11435}"; KEY="${KEY:-${PROXY_API_KEY:-codex-local-secret}}"
  curl -s "$BASE/v1/chat/completions" \
    -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
    -d '{"model":"gpt-5","stream":false,"messages":[{"role":"user","content":"ping"}]}' | jq .
  ```
- Codex CLI mount sanity: `docker compose exec codex-api ls -1 /usr/local/lib/codex-cli && docker compose exec codex-api env | grep CODEX_BIN`

## Common Incidents (Symptoms → Causes → Checks → Fixes)

1. Child spawn failure (500 spawn_error)

- Symptoms: 5xx with `{ error.type: "server_error", code: "spawn_error" }`; stderr mentions ENOENT/permission.
- Causes: `CODEX_BIN` not installed/visible; `CODEX_HOME` unwritable.
- Checks: `which $CODEX_BIN`; verify `CODEX_HOME` path exists and is writable; inspect service logs.
- Fixes: install Codex CLI; set `CODEX_BIN` to absolute path; ensure `CODEX_HOME` and `PROXY_CODEX_WORKDIR` are writable and on a local disk.

2. Backend idle/timeout (504 timeout_error)

- Symptoms: 504 in JSON or SSE; logs show "request timeout" or idle timeouts.
- Causes: slow provider; excessive prompt size; too‑low `PROXY_TIMEOUT_MS` / `PROXY_STREAM_IDLE_TIMEOUT_MS` / `PROXY_PROTO_IDLE_MS`.
- Checks: increase temporarily and retry; verify prompt size; watch CPU/mem.
- Fixes: raise timeouts conservatively; trim prompts; investigate provider slowness.

3. Edge 502/504 via Traefik/Cloudflare

- Symptoms: clients see 502/504 at edge, local origin is healthy.
- Causes: container down; label/Router drift; ForwardAuth unreachable.
- Checks: `docker ps`; `docker logs`; confirm Traefik router names unchanged; ForwardAuth on `http://127.0.0.1:18080/verify` (prod).
- Fixes: `docker compose up -d --build --force-recreate`; ensure service on external `traefik` network; verify ForwardAuth.

4. CORS preflight failures

- Symptoms: browser OPTIONS gets 4xx; missing `Access-Control-Allow-*` headers.
- Causes: `PROXY_ENABLE_CORS=false`; edge policy blocking.
- Checks: curl -i -X OPTIONS http://127.0.0.1:${PORT:-11435}/v1/chat/completions -H 'Origin: http://app' -H 'Access-Control-Request-Method: POST'.
- Fixes: set `PROXY_ENABLE_CORS=true` when browser clients call origin directly; otherwise enforce CORS at edge and keep origin permissive only as needed.

5. ForwardAuth 401 (invalid token)

- Symptoms: 401 at edge with `WWW-Authenticate: Bearer`.
- Causes: `PROXY_API_KEY` mismatch between app and ForwardAuth.
- Checks: confirm both services read the same key; review `.env` vs runtime env.
- Fixes: align keys; restart both services; rotate if leaked.

6. SSE concurrency exceeded (429 concurrency_exceeded)

- Symptoms: `{ error.code: "concurrency_exceeded" }` on stream start.
- Causes: `PROXY_SSE_MAX_CONCURRENCY` too low for current load; low FD limits.
- Checks: check current load; `ulimit -n` inside container.
- Fixes: raise `PROXY_SSE_MAX_CONCURRENCY`; increase OS/file‑descriptor limits; scale replicas.

7. In‑app rate limiting (429 rate_limited)

- Symptoms: 429 with `Retry-After` header.
- Causes: `PROXY_RATE_LIMIT_ENABLED=true` and traffic exceeds `PROXY_RATE_LIMIT_MAX` per key/IP per window.
- Checks: review env; confirm edge RL policy.
- Fixes: tune `PROXY_RATE_LIMIT_*`; prefer enforcing RL at Traefik/Cloudflare.

8. Codex CLI mismatch / missing vendor assets

- Symptoms: spawn errors referencing missing scripts or vendor modules; sudden behavior drift across environments.
- Causes: container not mounting `/usr/local/lib/codex-cli` or using an outdated local CLI binary.
- Checks: `docker compose exec codex-api ls -1 /usr/local/lib/codex-cli`; confirm `CODEX_BIN=/usr/local/lib/codex-cli/bin/codex.js` at runtime; inspect host path `~/.local/share/npm/lib/node_modules/@openai/codex`.
- Fixes: reinstall/update the host `@openai/codex` package; ensure compose files mount it read-only; restart the stack after syncing.

## Deploy, Restart, Rollback

Rebuild + restart (prod host):

```bash
docker compose up -d --build --force-recreate
```

Rollback to previous image tag:

1. Edit `docker-compose.yml` service image → previous known‑good tag.
2. `docker compose up -d --force-recreate`

Post‑deploy smoke:

```bash
DOMAIN=${DOMAIN:?set} KEY=${KEY:?set} npm run smoke:prod
```

## Observability & Logs

- Structured JSON access logs from `src/middleware/access-log.js` (one line per request):
  - Fields: `ts, level, req_id, method, route, status, dur_ms, ua, auth, kind`
  - Example filter (last 200 lines): `tail -200 server.log | jq -r 'select(.kind=="access") | [.status,.dur_ms,.route] | @tsv'`
- Dev prompt/proto events when enabled: look for `[dev][prompt]` and `[proxy] spawning (proto)` lines.
- Streaming benchmarks: `scripts/benchmarks/stream-multi-choice.mjs` spawns the proxy and samples CPU/RSS via `ps`; run locally when comparing CLI builds or parallel-tool experiments.

## Environment Profiles (summary)

- Dev: permissive CORS, advertise `codev-5*`, test endpoints allowed, low concurrency, optional `PROXY_ENABLE_PARALLEL_TOOL_CALLS=true` for Codex parallel tool experiments.
- Prod: optionally restrict CORS at edge; advertise `codex-5*`; enable models gating; edge RL; set SSE concurrency and OS limits appropriately; keep `PROXY_ENABLE_PARALLEL_TOOL_CALLS` unset/false for deterministic sequencing.

See `docs/bmad/prd.md` for a full Dev vs Prod table, KPIs/SLIs, and references.
