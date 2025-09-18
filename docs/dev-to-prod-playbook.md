# Dev → Prod Playbook (Codex Completions API)

This playbook defines a repeatable method to port the dev stack setup to the production `codex-api` setup safely and consistently.

Audience: engineers and automation. Assumes Docker, Traefik host service, and Cloudflare in front per project rules.

## Principles

- Validate in dev first; only then propose minimal diffs for prod.
- Keep Traefik labels stable; do not remove/reorder these routers: `codex-api`, `codex-preflight`, `codex-models`, `codex-health`.
- ForwardAuth target in PROD must remain `http://127.0.0.1:18080/verify` (host loopback). Do not switch to container alias unless Traefik itself runs inside the same Docker network (not our prod).
- Keep `PROXY_SANDBOX_MODE=danger-full-access` and mount a writable `.codex-api/` in prod.
- Prefer environment’s advertised model IDs in examples: DEV `codev-5*`; PROD `codex-5*` (both accepted).

## TL;DR (commands)

1. Dev checks

- `npm ci --ignore-scripts`
- `npx playwright install --with-deps chromium`
- `npm run verify:all`
- `npm run dev:stack:up` → `npm run smoke:dev`

2. Prepare production update (dry-run checks)

- `npm run port:check` (now also syncs `.codev → .codex-api` by default in dry-run mode)

  2.5) Sync Codex config & agents to prod HOME

- Usually handled by `port:check` automatically. To run explicitly or to force-overwrite:
  - `npm run port:sync-config` (copies `.codev/{config.toml,AGENTS.md}` → `.codex-api/`; skips secrets)

3. Deploy to production (after review)

- One-liner (validate, sync, deploy, smoke):
  - `DOMAIN=codex-api.onemainarmy.com npm run port:prod`
- Manual path:
  - `docker compose up -d --build --force-recreate`
  - `npm run smoke:prod` (set `DOMAIN` and optionally `KEY`)

## Step-by-step Method

1. Develop and validate in DEV

- Implement changes locally; keep diffs minimal.
- Run tests: `npm run verify:all`.
- Bring up public dev stack: `npm run dev:stack:up`.
- Validate edge path via Cloudflare: `npm run smoke:dev` with `DEV_DOMAIN` set.

### Dev non-stream timeout note

- On the dev domain (`codex-dev.onemainarmy.com`), the non-streaming aggregation path can exceed 10 seconds while the streaming path returns promptly.
- The current dev smoke uses `curl -m 10` for the non-stream POST. If you see a timeout but streaming passes, increase the timeout for diagnosis, for example:

  ```bash
  DEV_DOMAIN=codex-dev.onemainarmy.com KEY=$DEV_KEY \
    bash -c 'curl -s -m 60 -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
    -d '\''{"model":"codex-5","stream":false,"messages":[{"role":"user","content":"Say hello."}]}'\'' \
    https://$DEV_DOMAIN/v1/chat/completions | jq .'
  ```

- If `stream:true` succeeds quickly but non-stream stalls only at the edge, verify Cloudflare/Traefik policies for dev POST requests; origin may still be healthy.

### Runbook: Dev edge non-stream timeout triage

Use the scripted smoke for reproducible evidence and quick signal on where the stall occurs.

1. Run non-stream and streaming smokes on the dev domain

```bash
DOMAIN=$DEV_DOMAIN KEY=$DEV_KEY npm run smoke:dev-edge
```

Evidence written to `/tmp/nonstream.out` and `/tmp/stream.out`.

2. Interpret results

- Non-stream 200 + JSON OK, stream OK → edge transient; repeat and collect Ray IDs.
- Non-stream timeout, stream OK → likely edge/ingress buffering or timeout policy for POST JSON.
- Both fail → origin or auth/ForwardAuth misconfiguration.

3. Checks (edge → ingress → app)

- Edge: look for 522/524/499 and correlate Ray IDs; confirm WAF policies for POST JSON to `/v1/chat/completions`.
- Ingress (Traefik): verify timeouts, ForwardAuth target host loopback, route matches production invariants.
- App: confirm `PROXY_TIMEOUT_MS`/`PROXY_IDLE_TIMEOUT_MS` and non-stream handler returns promptly for short prompts.

4. After fix

- Re-run the smoke script twice; attach cURL headers and timings to GH #74.
- Add the non-stream smoke to post-deploy CI if not already present.

### Runbook: Non-stream truncation flake triage

1. Reproduce locally with the deterministic shim:

```bash
npx vitest run tests/integration/chat.nonstream.length.int.test.js --reporter=default
```

- The test runs five sequential POSTs against the proxy using `scripts/fake-codex-proto-no-complete.js`. Any `UND_ERR_SOCKET other side closed` indicates the handler closed the socket before emitting JSON.

2. Inspect application logs for `[proxy][chat.nonstream]` errors. Recent fixes log child process/stdout errors before returning a best-effort JSON body with `finish_reason:"length"`.
3. Confirm idle watchdog behaviour: ensure `PROXY_PROTO_IDLE_MS` is large enough for local shims and that the handler responded before canceling the timer (look for 504 responses in logs).
4. Run `scripts/dev-edge-smoke.sh` to confirm dev edge parity still succeeds with usage fields populated (the script auto-loads `DEV_DOMAIN` and `PROXY_API_KEY` from `.env.dev`).
5. If still flaky, enable proto debugging (`PROXY_DEBUG_PROTO=true`) and capture `appendProtoEvent` logs to see whether the proto emitted `task_complete` or exited unexpectedly.

6. Map DEV settings to PROD

- Compare `compose.dev.stack.yml` to `docker-compose.yml`:
  - ForwardAuth: DEV uses host loopback `127.0.0.1:18081/verify`; PROD must use `127.0.0.1:18080/verify`.
  - Traefik network label `traefik.docker.network=traefik` retained.
  - CORS/headers/ratelimit middlewares remain in the same order before ForwardAuth.
  - Models and Health routers remain public (no auth) exactly as in prod compose.
- Confirm `.codex-api/` is mounted read/write in PROD and present in repo (tracked seed files only; secrets managed out-of-band).
  - Seed it with `npm run port:sync-config` on the production host (or copy the two files manually). The script does not copy `auth.json` or any credentials.
  - The bearer credential is sourced from `~/.codex/auth.json`; after rotating it, copy that file into `.codex-api/auth.json` (prod) and `.codev/auth.json` (dev) before starting stacks.

3. Dry‑run production readiness checks

- Run `npm run port:check` to execute:
  - invariants validation (labels present, ForwardAuth targets, network `traefik` present),
  - `docker compose config` sanity output,
  - optional curl of `127.0.0.1:11435/healthz` if container is up.
- Review `test-results/port-*/` artifacts, then proceed.

4. Deploy to PROD

- On the production host, from repo root:
- `docker compose up -d --build --force-recreate`
- `npm run smoke:prod` (the helper reads `DOMAIN`/`APP_DOMAIN` and `PROXY_API_KEY` from `.env`; override via env vars if needed).
- If any label or Dockerfile changes were part of the diff, also run `npm run test:live` against the public endpoint.

5. Post‑deploy verification and rollback

- Verify SSE streaming stability and that `[DONE]` terminator is received.
- If failure occurs, use `docker compose logs -f` and revert to previous image/tag if needed.

### Runbook: Streaming usage early emission checks

1. Reproduce deterministic flows locally:

   ```bash
   npx vitest run tests/integration/stream.usage-token-count.int.test.js --reporter=default
   npx vitest run tests/integration/stream.provider-usage.int.test.js --reporter=default
   ```

   - The token-count shim exits without `task_complete`; expect the SSE transcript to show a `finish_reason:"length"` frame followed by a usage chunk containing `"emission_trigger":"token_count"`.
   - The provider shim emits a usage event even when `include_usage:false`; the proxy must log it (`emission_trigger:"provider"`) but must not forward an additional usage chunk to the client.

2. Inspect `TOKEN_LOG_PATH` (default `${TMPDIR}/codex-usage.ndjson`) for recent entries:
   - Confirm each request logs exactly one usage record with `usage_included` reflecting client intent and `emission_trigger` set to `token_count`, `task_complete`, or `provider`.
   - Watch for duplicate request IDs or mixed triggers after deployment; run a short script to group counts per request if needed.

3. Smoke dev edge (`scripts/dev-edge-smoke.sh`) once changes are deployed:
   - Capture the streaming transcript and verify the usage chunk appears before `[DONE]` with the expected `emission_trigger`.
   - Record `codex-usage.ndjson` samples and attach them to GH #73 (or successor) as evidence.

## Test Selection Policy (applies before porting)

- Only `src/utils.js` → run unit tests: `npm run test:unit`.
- `server.js` or streaming/route changes → run integration then E2E: `npm run test:integration && npm test`.
- `docker-compose.yml` or Traefik labels → after build, run `npm run smoke:prod` (on origin host) and `npm test` (E2E).
- `Dockerfile` or runtime image changes → run dev stack and E2E: `npm run dev:stack:up && npm test`.

## Invariants the checks enforce

- Traefik routers exist and are not removed: `codex-api`, `codex-preflight`, `codex-models`, `codex-health`.
- ForwardAuth in PROD points to `127.0.0.1:18080/verify`.
- External network `traefik` exists; labels include `traefik.docker.network=traefik`.
- `.codex-api/` is mounted writable; sandbox/workdir env defaults remain set:
  - `PROXY_SANDBOX_MODE=danger-full-access`
  - `PROXY_CODEX_WORKDIR=/tmp/codex-work`

## Artifacts

The `npm run port:check` command writes a dated folder under `test-results/port-*/` containing:

- docker compose rendered config (`docker-compose.config.yaml`),
- selected label checks output,
- a summary of what to run next to deploy and smoke test.

## Notes

- Do not change Cloudflare or Traefik static config unless explicitly requested.
- Keep production compose (`docker-compose.yml`) the single source of truth for routing/labels.
