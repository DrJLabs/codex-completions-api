# Migrating `codex-completions-api` to `codex app-server`

> **Goal:** Switch backend from `codex proto` to `codex app-server` **without changing** the proxy’s external OpenAI‑compatible API responses (both streaming and non‑streaming).

---

## A. Replace CLI invocation

**Before (per request):**

```js
spawn("codex", [
  "proto",
  "--config",
  'preferred_auth_method="chatgpt"',
  /* model, sandbox, … */
]);
```

**After (once at startup):**

```js
spawn("codex", [
  "app-server",
  "--model",
  effectiveModel, // or provided by profile
  "--config",
  'preferred_auth_method="chatgpt"',
  "--config",
  'sandbox_mode="workspace-write"',
  /* any -c key=value overrides you already pass */
]);
```

- Keep the same `CODEX_BIN` resolution; only subcommand changes.
- Pin the CLI dependency (`@openai/codex`) to version **0.53.0** so the `app-server` binary ships with the image.
- After bumping the CLI, run `npm run jsonrpc:schema` to regenerate `src/lib/json-rpc/schema.ts`. The script stamps the recorded CLI version and is deterministic, so re-running when nothing changed should produce a zero-diff output.

---

## B. Process model change (singleton child)

- **Old:** spawn one child per HTTP request; write prompt; read events; kill child.
- **New:** spawn **one** `app-server` on service start; **reuse** for all requests.
  - Create a module‑level singleton `codexAppServer` with start/stop and a JSON‑RPC client.
  - On HTTP server shutdown (SIGINT/SIGTERM), terminate the child gracefully.

**Health:** implement a readiness/health probe that sends a lightweight RPC (or checks initialized state). Auto‑restart the child on exit.

---

## C. JSON‑RPC client: write & read

### C.1 Writer (requests)

- On first use, send **`initialize`** with `client_info`.
- For each API call:
  1. **`sendUserTurn`** (optionally set/receive `conversation_id`)
  2. **`sendUserMessage`** with the flattened prompt text (same `joinMessages(messages)` you already use)
- Assign unique numeric/string `id`s per RPC and track the outstanding map.

### C.2 Reader (responses & notifications)

- Parse **lines** from `stdout` as JSON.
- If a message has `id`, it’s a **response** to a prior request.
- If a message has `method`, it’s a **notification**. Route by method:
  - `agentMessageDelta` → write SSE `delta` chunk.
  - `agentMessage` → write final SSE chunk for message content.
  - `tokenCount`/usage style events → capture `prompt_tokens`/`completion_tokens`.
  - tool/lifecycle events → optional logging/metrics.
- Maintain a per‑HTTP‑request **context** (requestId → conversationId, rpc ids, buffers, usage counters) so notifications go to the correct stream even with concurrency.

---

## D. Streaming path (SSE)

- Keep your external streaming identical:
  - For each `agentMessageDelta` notification, emit:
    ```json
    {
      "id": "...",
      "object": "chat.completion.chunk",
      "choices": [{ "index": 0, "delta": { "content": "…" }, "finish_reason": null }]
    }
    ```
  - For the final `agentMessage`/completion, emit the terminal chunk, then `data: [DONE]`.
- Preserve your existing **tool/function call** delta shaping if the notification includes such payloads.

---

## E. Non‑streaming path (JSON)

- Accumulate message content from notifications and/or use the final RPC `result`.
- Set `choices[0].message` (role `assistant`, content full text).
- Compute `usage`:
  - Prefer explicit usage from notifications or result.
  - Fallback to your existing estimator only if strict counts absent.
- Determine `finish_reason` from the final event/result (map server reason → OpenAI values: `stop`, `length`, `content_filter`, `tool_calls`, etc.).

---

## F. Conversation lifecycle

- **Stateless external API:** create/let the server create a **new conversation per request**; do not carry memory between calls.
- After finishing a request, **release** the context; if the API exposes a cleanup call (e.g., `conversation/delete`), optionally call it to minimize memory footprint.

---

## G. Concurrency & timeouts

- Continue to cap **SSE concurrency** (e.g., environment `PROXY_SSE_MAX_CONCURRENCY`).
- Implement **per‑request timeouts** as before. If the app-server doesn’t support cancel:
  - Return a timeout error to the client.
  - Optionally **restart** the app-server child if it appears stuck (circuit breaker).
- Avoid killing the shared child for routine request timeouts unless necessary.

---

## H. Configuration & deployment

- **Auth:** ensure `CODEX_HOME` contains valid login (ChatGPT OAuth via `codex login`) or set `OPENAI_API_KEY` and configure `preferred_auth_method="api_key"`.
- **Docker/compose:** mount credentials into the container, e.g.:
  ```yaml
  volumes:
    - ~/.codex:/app/.codex-api:rw
  environment:
    - CODEX_HOME=/app/.codex-api
  ```
- **Profiles/models:** if callers specify `model`, run multiple app-server **instances** (one per model/profile) and route based on the request. Do not rely on in‑process model switching unless officially supported.
- **Upgrades:** pin a tested CLI version; track release notes for JSON‑RPC/event name changes.
- **Secrets:** keep credentials outside the image—mount them into `/app/.codex-api` and ensure the directory stays writable for Codex rollouts and session state.
- **Probes & orchestration:**
  - _Docker Compose:_ add explicit HTTP health checks so orchestrators only send traffic once `/readyz` reports ready. Example:

    ```yaml
    services:
      codex-api:
        healthcheck:
          test: ["CMD-SHELL", "curl -fsS http://127.0.0.1:${PORT:-11435}/readyz || exit 1"]
          interval: 10s
          timeout: 3s
          retries: 5
          start_period: 15s
    ```

    Compose keeps restarting the container if `/livez` fails; the readiness endpoint flips back to `503` within ~5s of a worker exit, so the check above gates deployment rolls until the worker handshake succeeds again.

  - _systemd:_ ensure units rely on the new probes and restart counters. Recommended unit fragment:

    ```ini
    [Service]
    ExecStart=/usr/bin/node /opt/codex/server.js
    ExecStartPost=/usr/bin/curl --fail --silent --retry 5 --retry-connrefused http://127.0.0.1:${PORT:-11435}/livez
    Restart=on-failure
    RestartSec=5s
    ```

    Systemd will only report the service healthy after `/livez` succeeds; readiness remains false until the supervisor announces the JSON-RPC handshake.

  - _Traefik:_ wire the external load balancer to `/readyz` so traffic drains instantly when the worker restarts:

    ```yaml
    labels:
      - "traefik.http.services.codex-api.loadbalancer.healthCheck.path=/readyz"
      - "traefik.http.services.codex-api.loadbalancer.healthCheck.interval=5s"
      - "traefik.http.services.codex-api.loadbalancer.healthCheck.timeout=2s"
    ```

    Traefik will stop routing within a single interval when readiness falls to `false`, aligning with the supervisor’s <5s guarantee.

---

## I. Code touch‑points (typical repo)

1. **Process spawn module**: change subcommand; add singleton lifecycle; add health/restart logic.
2. **Protocol adapter**: replace proto line parser with JSON‑RPC reader; add request writer.
3. **SSE handler**: map `agentMessageDelta`/`agentMessage` to OpenAI chunks; keep existing shape.
4. **Non‑stream handler**: assemble final message & usage; finalize finish_reason.
5. **Config/env**: ensure `CODEX_HOME`, model/profile flags, sandbox/approvals are passed.
6. **Tests**: replace proto shim with an **app‑server mock** speaking JSON‑RPC (golden transcripts).
7. **Docs**: update README and deployment notes (auth, volumes, CLI version).

---

## J. Example JSON-RPC shapes

**Initialize:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": { "client_info": { "name": "codex-completions-api", "version": "1.0.0" } }
}
```

**Turn + message:**

```json
{"jsonrpc":"2.0","id":2,"method":"sendUserTurn","params":{}}

{"jsonrpc":"2.0","id":3,"method":"sendUserMessage","params":{"text":"[system] …\n[user] …"}}
```

---

## K. Parity fixture maintenance workflow

1. **Refresh transcripts** – run `npm run transcripts:generate` to capture paired proto and app-server outputs. The generator now writes to `test-results/chat-completions/{proto,app}/`, stamps each artifact with `backend`, `backend_storage`, `codex_bin`, `cli_version`, `node_version`, and the current Git `commit`, and regenerates `test-results/chat-completions/manifest.json` summarizing scenario coverage.
2. **Verify parity** – execute `npm run test:parity` to compare normalized proto vs. app transcripts. The harness fails fast when a scenario diverges or is missing, producing actionable diffs.
3. **Smoke the baseline** – before publishing updated fixtures, run:
   ```bash
   npm run test:integration
   npm test
   ```
   This confirms the Epic 1 stack and SSE adapters remain healthy after regeneration. Capture the command output (or CI links) for the release record.
4. **Log versions** – copy the Codex CLI/App Server version information from the transcript `metadata` blocks (or `manifest.json`) into the deployment notes so downstream stories know which baseline the fixtures represent.
5. **Intentional mismatch drills** – when validating the harness, edit a single transcript, run `npm run test:parity` to observe the failure diagnostics, then restore the corpus with `npm run transcripts:generate`.

**Streaming delta (notification):**

```json
{ "jsonrpc": "2.0", "method": "agentMessageDelta", "params": { "delta": "Hello" } }
```

**Final message (notification):**

```json
{ "jsonrpc": "2.0", "method": "agentMessage", "params": { "text": "Hello world!" } }
```

**Final response (to id 3):**

```json
{ "jsonrpc": "2.0", "id": 3, "result": { "status": "complete" } }
```

(Exact method names/fields can evolve—write a tolerant adapter.)

---

## L. Remaining gaps

1. **No CI/dev mock:** add a lightweight JSON‑RPC fake app-server for tests (fixtures for initialize, deltas, final).
2. **Cancellation:** if/when Codex surfaces a cancel RPC, wire it; until then rely on timeouts and selective restarts.
3. **Schema evolution:** feature-flag method handlers; ignore unknown notifications; log for observability.
4. **Per-request models:** prefer instance routing; optionally queue per-model workers.
5. **Tool events:** ensure function/tool call deltas continue to map to OpenAI tool_calls if you expose them.

---

## N. Runbook checklist updates

### N.1 Prerequisites before toggling `PROXY_USE_APP_SERVER`

1. Verify `@openai/codex@0.53.0` is installed in the target image or host before enabling the app-server to guarantee the bundled binary includes the `app-server` subcommand (Source: Section A, [../architecture.md#decision-summary](../architecture.md#decision-summary)).
2. Confirm the environment mounts a writable `CODEX_HOME` (`.codev` for dev, `.codex-api` for containerized deployments) so the supervisor can persist rollout and session state (Source: Section H; [../stories/1-5-wire-readiness-and-liveness-probes-to-worker-state.md#dev-notes](../stories/1-5-wire-readiness-and-liveness-probes-to-worker-state.md#dev-notes)).
3. Stage and production monitors must track `/readyz` latency plus `worker_supervisor.restarts_total`; alert if readiness stays false for longer than 30 s or restarts increase by >1 within 10 minutes (Source: Section H; [../architecture.md#decision-summary](../architecture.md#decision-summary)).

### N.2 Toggle workflow by environment

- **Docker Compose (dev & staging):**
  1. Edit `.env.dev` or the staging compose overrides so `PROXY_USE_APP_SERVER=true`; keep proto default (`false`) elsewhere until rollout gates pass (Source: [../bmad/architecture/tech-stack.md](../bmad/architecture/tech-stack.md)).
  2. Run `npm run dev:stack:down` (if active) followed by `npm run dev:stack:up` to rebuild with the new flag.
  3. Execute `npm run smoke:dev` to validate CLI availability (`codex app-server --help`) and edge routing before promoting traffic (Source: [../../scripts/dev-smoke.sh](../../scripts/dev-smoke.sh)).
- **systemd (production host):**
  1. Update `/etc/systemd/system/codex-openai-proxy.service.d/env.conf` so `Environment=PROXY_USE_APP_SERVER=true`.
  2. Reload units with `systemctl daemon-reload && systemctl restart codex-openai-proxy`.
  3. Run `npm run smoke:prod` for the public domain, ensuring `/readyz` flips to `200` before reopening traffic (Source: [../../scripts/prod-smoke.sh](../../scripts/prod-smoke.sh)).
- **Traefik health gating:** ensure `traefik.http.services.codex-api.loadbalancer.healthCheck.path=/readyz` remains configured so traffic drains during worker restarts (Source: Section H; [../architecture.md#decision-summary](../architecture.md#decision-summary)).

### N.3 Verification checklist after toggling

1. `curl -f https://{domain}/readyz` returns `200` with `"ready":true` within five seconds (Source: [../stories/1-5-wire-readiness-and-liveness-probes-to-worker-state.md#dev-notes](../stories/1-5-wire-readiness-and-liveness-probes-to-worker-state.md#dev-notes)).
2. `curl -f https://{domain}/livez` stays `200`; any `503` requires paging the on-call and rolling back the flag (Source: Section H).
3. Run `npm run lint:runbooks` before publishing documentation updates to satisfy formatting and link linting (Source: [../bmad/architecture/tech-stack.md#testing--qa](../bmad/architecture/tech-stack.md#testing--qa)).

### N.4 Environment configuration matrix

| Environment       | Default backend | Flag toggle location                                         | CLI version requirement | `CODEX_HOME` mount | Smoke verification command              | Probe expectation                                                                        |
| ----------------- | --------------- | ------------------------------------------------------------ | ----------------------- | ------------------ | --------------------------------------- | ---------------------------------------------------------------------------------------- |
| Local / Dev stack | proto (`false`) | `.env.dev` (`PROXY_USE_APP_SERVER=true`)                     | `@openai/codex@0.53.0`  | `${REPO}/.codev`   | `npm run smoke:dev`                     | `http://127.0.0.1:${PORT:-11435}/readyz` returns `200` after supervisor handshake (<5 s) |
| Staging           | proto (`false`) | compose overrides / `.env.dev` (`PROXY_USE_APP_SERVER=true`) | `@openai/codex@0.53.0`  | `/app/.codex-api`  | `npm run smoke:dev` (with `DEV_DOMAIN`) | `https://{staging-domain}/readyz` gated via Traefik health check                         |
| Production        | proto (`false`) | `/etc/systemd/system/codex-openai-proxy.service.d/env.conf`  | `@openai/codex@0.53.0`  | `/app/.codex-api`  | `npm run smoke:prod`                    | `https://codex-api.onemainarmy.com/readyz` wired to Traefik health monitor               |

Defaults mirror `.env.example`, `.env.dev`, and `docker-compose.yml`; the docs lint compares this matrix against those files to catch drift (Source: Section H; [../bmad/architecture/tech-stack.md](../bmad/architecture/tech-stack.md)).

### N.5 Operational change log additions

- 2025-10-31 — Documented feature flag rollout, environment matrix, and probe verification steps for the app-server cutover. Linked smoke harnesses and Story 1.5 probe evidence so partner teams can reuse readiness data (Source: [../epics.md#story-16-document-foundation-and-operational-controls](../epics.md#story-16-document-foundation-and-operational-controls); [../stories/1-5-wire-readiness-and-liveness-probes-to-worker-state.md#change-log](../stories/1-5-wire-readiness-and-liveness-probes-to-worker-state.md#change-log)).
