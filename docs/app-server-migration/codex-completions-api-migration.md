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

## J. Example JSON‑RPC shapes

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

## K. Remaining gaps

1. **No CI/dev mock:** add a lightweight JSON‑RPC fake app-server for tests (fixtures for initialize, deltas, final).
2. **Cancellation:** if/when Codex surfaces a cancel RPC, wire it; until then rely on timeouts and selective restarts.
3. **Schema evolution:** feature-flag method handlers; ignore unknown notifications; log for observability.
4. **Per-request models:** prefer instance routing; optionally queue per-model workers.
5. **Tool events:** ensure function/tool call deltas continue to map to OpenAI tool_calls if you expose them.

---

## L. Feature flag rollout defaults

The `PROXY_USE_APP_SERVER` flag controls whether the proxy boots the legacy proto backend or the new app-server implementation. The defaults below match the rollout plan documented in the implementation readiness report.

| Environment       | Default backend | Toggle procedure                                                                                            | Notes                                                                                               |
| ----------------- | --------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Local / Dev stack | proto (`false`) | Set `PROXY_USE_APP_SERVER=true` in `.env.dev` (or export before `npm run dev:stack:up`) to trial app-server | Keeps deterministic proto behavior for day-to-day development while allowing opt-in validation.     |
| Staging           | proto (`false`) | Update the staging compose/.env files and redeploy `docker compose up -d --build` when ready                | Staging adopts app-server only after integration tests verify parity with production workloads.     |
| Production        | proto (`false`) | Flip the systemd environment (`/etc/systemd/system/codex-openai-proxy.service.d/env.conf`) and reload       | Production remains on proto until rollout gates pass; toggling requires maintenance window + smoke. |

These defaults are mirrored in `.env.example` and `.env.dev`. CI enforces alignment with a docs lint that compares the table values against the sample environment files.
