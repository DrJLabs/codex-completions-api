# End-to-End Tracing Plan for Dev Server (App-Server Backend)

## 1. Goal & Scope

Guarantee that every **/v1/chat/completions** and **/v1/completions** request running through the dev server has a **linear, replayable trace** from:

- HTTP ingress (raw OpenAI-style request)  
- Through routing, normalization, and **Codex app-server (JSON-RPC) invocation**  
- Through streaming / non-stream shaping  
- To the final OpenAI-compatible response sent back to the client.

**Backend assumption:**  
The legacy `codex proto ...` path is deprecated. The only supported backend is **Codex app-server** accessed via JSON-RPC (e.g., via `JsonRpcChildAdapter` under `src/services/transport/child-adapter.js`). Any remaining CLI `proto` logging is considered **legacy** and must not be relied on for tracing.

Scope is **dev mode only** (`PROXY_ENV=dev`), using the current modularized layout:

- `server.js` (thin bootstrap)
- `src/app.js` (Express app, JSON limit, CORS, access log, routers)
- `src/middleware/access-log.js`
- `src/dev-logging.js`
- `src/routes/*` (health, models, chat, completions, usage)
- `src/handlers/chat/{stream,nonstream}.js`
- `src/services/{codex-runner,sse}.js`
- `src/services/transport/child-adapter.js` (JSON-RPC app-server transport)

The design must **not** change external API behavior or headers; it is observability-only, and must be compatible with **app-server-only** backends.

---

## 2. Current Signals (Re-evaluated for App-Server)

### 2.1 Access logging

**Where**  
- `src/middleware/access-log.js` (mounted in `src/app.js`).

**What it does**

- Generates a `req_id` per HTTP request via `nanoid()`.
- Stores it on `res.locals.req_id` and sets `X-Request-Id` response header.
- On `res.finish`, writes a **single JSON line** to stdout:

  ```json
  {
    "ts": 1730000000000,
    "level": "info",
    "req_id": "…",
    "method": "POST",
    "route": "/v1/chat/completions",
    "status": 200,
    "dur_ms": 123,
    "ua": "curl/8.4.0",
    "auth": "present|none",
    "kind": "access"
  }
  ```

**For app-server**

- This layer is **backend-agnostic** and remains valid.  
- It will serve as the **canonical HTTP correlation id** anchor for all deeper trace events.

---

### 2.2 Dev logging (usage + backend “proto” events)

**Where**

- `src/dev-logging.js`
- Call sites in chat/completions handlers.

**What it provides today**

- **Usage NDJSON**  
  - `TOKEN_LOG_PATH` (e.g., `codex-usage.ndjson`) via `appendUsage(obj)`; one record per completed request.  
  - Powers `/v1/usage` and `/v1/usage/raw` via `src/routes/usage.js`.

- **Backend events NDJSON** (historically called “proto events”)  
  - `PROTO_LOG_PATH` via `appendProtoEvent(obj)` when `LOG_PROTO` is enabled.
  - Currently logs:
    - Submissions (prompt captures)
    - Child stdout/stderr lines parsed as JSON
    - Event objects (e.g. `agent_message_delta`, `token_count`, `task_complete`)
    - Parsed `<use_tool>` blocks and metadata (tool name/path/query)

**App-server compatibility**

- The **names** (`LOG_PROTO`, `PROTO_LOG_PATH`) are historical; we will keep them but treat them as generic “backend trace events.”
- Any logging that currently depends on parsing `codex proto` stdout line-by-line must be **moved up** to the JSON-RPC layer; we will no longer rely on CLI proto line parsing for app-server.

---

### 2.3 Chat/completions handlers

**Where**

- `src/routes/chat.js` → `src/handlers/chat/{nonstream,stream}.js`

**What they do today (conceptually)**

- Parse OpenAI-style bodies for chat/completions.
- Normalize models and options.
- Invoke backend (previously via CLI proto; now via app-server JSON-RPC).
- Shape results into OpenAI-compatible responses (non-stream or SSE stream).
- Log dev information and usage via `appendProtoEvent` / `appendUsage`.

**App-server implications**

- The handlers should **not** be aware of low-level app-server JSON-RPC shapes.  
  That responsibility belongs in `JsonRpcChildAdapter` / transport services.
- Tracing for backend calls must therefore attach at the **transport layer**, while handlers still:
  - Manage HTTP-level logging (HTTP request, response).
  - Tag trace events with the appropriate `mode` and `route`.

---

### 2.4 SSE & Codex runner services

**Where**

- `src/services/codex-runner.js` – now responsible for starting/stopping app-server (via CLI `app-server` subcommand or similar) and owning the `JsonRpcChildAdapter`.
- `src/services/sse.js` – SSE framing and keepalives for client responses.

**App-server behavior**

- `codex-runner` no longer spawns `codex proto`; instead it ensures an app-server instance is running and exposes a JSON-RPC transport.
- `sse.js` remains independent of backend and is fully compatible; we only need to add **egress logging** compatible with app-server.

---

### 2.5 JSON-RPC / app-server transport

**Where**

- `src/services/transport/child-adapter.js` (or similar), often named `JsonRpcChildAdapter`.
- Related stories:
  - `docs/stories/1-4-establish-json-rpc-transport-channel.md`
  - `docs/stories/2-2-implement-request-translation-layer.md`
  - `docs/stories/2-3-implement-streaming-response-adapter.md`
- `docs/chat-completions-request-flow.md` describes the high-level flow.

**App-server responsibilities**

- Start and supervise the app-server child process (if local).
- Maintain a JSON-RPC channel (over stdio or TCP) with:
  - `initialize` / `handshake` calls
  - Turn-level calls for chat completions (e.g., `sendUserTurn`, `sendUserMessage`)
  - Streaming callbacks / notifications for deltas.
- Translate JSON-RPC messages into internal events used by handlers and SSE utils.

**Current logging gap**

- The adapter does **not** emit `appendProtoEvent` entries for:
  - Outgoing JSON-RPC requests (methods + params).
  - Incoming JSON-RPC responses/notifications.
  - Errors at the RPC layer.

All of the old CLI proto-specific logging must be **replaced or augmented** by this JSON-RPC–centric logging.

---

## 3. Gaps for App-Server-Based “End-to-End” Tracing

Relative to the app-server architecture:

1. **Request ID cohesion**
   - Access log uses `res.locals.req_id`.
   - Backend trace logging uses a separate `reqId` per handler.
   - JSON-RPC transport has no guaranteed awareness of `req_id`.

2. **Canonical HTTP request payload**
   - `req.body` is not persisted as an event.
   - Newer fields (tools, tool_choice, metadata, response_format, etc.) are not captured in one place.

3. **Backend submission visibility (JSON-RPC)**
   - No event that says: “We sent app-server method `X` with params `Y` for this HTTP request.”
   - No trace of which app-server turn, session, or conversation this request maps onto.

4. **Backend IO visibility**
   - JSON-RPC notifications and responses (token deltas, tool calls, final messages) are not recorded as high-level trace events.
   - Old CLI proto stdout parsing is obsolete and may be misleading.

5. **Client-facing responses**
   - We do not log the exact SSE frames (`data: …`) that go to clients.
   - Non-stream JSON responses are not recorded before `res.json`.

6. **Usage correlation**
   - Usage NDJSON has only partial overlap with JSON-RPC–level knowledge:
     - It tracks models, tokens, duration, status – but not which RPC methods were invoked.

7. **Config and lifecycle**
   - App-server lifecycle (startup, failures, reconnects) is not represented in the trace.
   - Proto logging can be disabled in dev without a clear signal that traces will be incomplete.

---

## 4. Design Principles (App-Server–Aligned)

1. **Single correlation id (`req_id`)**  
   One id from **HTTP ingress through JSON-RPC transport to client egress and usage**.

2. **Transport-centric backend logging**  
   The canonical backend traces come from the **JSON-RPC adapter**, not from CLI `stdout` parsing.

3. **Stable, layered phases**  
   Every event has:

   - `phase`: `http_ingress` | `backend_submission` | `backend_io` | `client_egress` | `usage_summary` | `backend_lifecycle`
   - `mode`: `chat` | `chat_stream` | `chat_nonstream` | `completions` | `completions_stream` | …

4. **Neutral event schema**  
   Event types should not assume “proto mode,” but refer to generic app-server concepts:

   - `rpc_request`, `rpc_response`, `rpc_notification`
   - `backend_start`, `backend_exit`
   - `client_sse`, `client_sse_done`, `client_json`

5. **Minimal and redacted**  
   Log enough to reconstruct a trace but always:

   - Redact secrets (`Authorization`, API keys).
   - Optionally truncate overly large fields.

6. **App-server-first, proto optional**  
   Existing proto-specific logging is treated as **optional** or **legacy** and should not be required for correctness once app-server tracing is in place.

---

## 5. Event Schema (App-Server–Friendly)

All backend trace events (still written via `appendProtoEvent`) use:

```ts
type TraceEvent = {
  ts: number;          // epoch ms
  req_id: string;      // from res.locals.req_id
  route: string;       // e.g. "/v1/chat/completions"
  method?: string;     // HTTP method (GET/POST/…)
  phase: string;       // http_ingress | backend_submission | backend_io | client_egress | usage_summary | backend_lifecycle
  mode?: string;       // chat | chat_stream | chat_nonstream | completions | completions_stream | completions_nonstream | ...
  kind: string;        // http_request | rpc_request | rpc_response | rpc_notification | backend_start | backend_exit | client_sse | client_sse_done | client_json | ...
  direction?: string;  // "in" | "out" | "internal" (optional)
  [key: string]: any;  // payload fields, sanitized
};
```

Legacy `kind` values such as `tool_block`, `tool_block_dedup_skip`, `tool_suppress_tail` remain valid, but become **subtypes** of `backend_io` for app-server streams.

---

## 6. Implementation Plan (App-Server Compatible)

### 6.1 Phase 0 – Align Request IDs (HTTP ↔ Handlers ↔ Transport)

**Goal**  
Ensure a single `req_id` flows from access log → handler → JSON-RPC adapter.

**Steps**

1. **Handlers** (`src/handlers/chat/{nonstream,stream}.js`):

   - Replace any local `const reqId = nanoid()` with:

     ```js
     const reqId = (res.locals && res.locals.req_id) || nanoid();
     if (!res.locals) res.locals = {};
     res.locals.req_id = reqId;
     ```

   - All calls to `appendProtoEvent` and `appendUsage` use this `reqId`.

2. **Transport** (`JsonRpcChildAdapter`):

   - Accept an optional `reqId` per call/request, passed from the handler.
   - Store it in the adapter’s context for that turn/stream so RPC events can be tagged with the same `req_id`.

**Outcome**  
You can join:

- Access logs (`kind: "access"`)
- Backend traces (`TraceEvent`)
- Usage events (`TOKEN_LOG_PATH`)

all by the same `req_id`.

---

### 6.2 Phase 1 – HTTP Ingress Capture (Backend-Agnostic)

**Goal**  
Capture **what the client sent**, in OpenAI shape, before any mutations – independent of backend.

**Where**

- A new helper `src/dev-trace/http.js`
- Called from chat/completions handlers immediately after auth/validation succeeds.

**Steps**

1. Implement:

   ```js
   import { appendProtoEvent } from "../dev-logging.js";

   export function logHttpRequest(req, res, mode) {
     const reqId = res.locals?.req_id;
     if (!reqId) return;

     const route = req.originalUrl || req.path || "<unknown>";
     const { method, headers, body } = req;

     const safeHeaders = { ...headers };
     if (safeHeaders.authorization) safeHeaders.authorization = "REDACTED";

     appendProtoEvent({
       ts: Date.now(),
       req_id: reqId,
       route,
       method,
       phase: "http_ingress",
       mode,
       kind: "http_request",
       headers: safeHeaders,
       body: body ?? null,
     });
   }
   ```

2. In handlers:

   - Non-stream chat: `logHttpRequest(req, res, "chat_nonstream");`
   - Stream chat: `logHttpRequest(req, res, "chat_stream");`
   - Completions: `logHttpRequest(req, res, "completions[_stream]");`

**Notes**

- Consider truncating large `body` fields (e.g., only first N characters per message content) if needed later.

---

### 6.3 Phase 2 – Backend Submission (JSON-RPC Layer)

**Goal**  
Log what the **app-server receives** for each HTTP request, replacing any deprecated CLI-proto-specific logging.

**Where**

- `src/services/transport/child-adapter.js` (JSON-RPC adapter).
- Or a new module that wraps all JSON-RPC calls.

**Steps**

1. Create a small tracer function:

   ```js
   import { appendProtoEvent } from "../../dev-logging.js";

   export function traceRpcRequest({ reqId, httpRoute, mode, method, params }) {
     if (!reqId) return;
     appendProtoEvent({
       ts: Date.now(),
       req_id: reqId,
       route: httpRoute,
       phase: "backend_submission",
       mode,
       kind: "rpc_request",
       rpc_method: method,
       params, // sanitized
     });
   }
   ```

2. Wrap all outgoing JSON-RPC calls:

   ```js
   async function callRpc(method, params, ctx) {
     const { reqId, httpRoute, mode } = ctx; // propagated from handler
     traceRpcRequest({ reqId, httpRoute, mode, method, params: sanitizeParams(params) });
     return await rpcClient.call(method, params);
   }
   ```

3. If app-server expects an “initialize”/“session” call per request, log that as well:

   - `kind: "rpc_init"` with session id, etc.

**Compatibility**

- Works regardless of whether app-server runs as a local child process or a remote HTTP service.
- Fully replaces legacy “child stdin submission” logging.

---

### 6.4 Phase 3 – Backend IO & Lifecycle (JSON-RPC Events)

**Goal**  
Log what app-server returns as JSON-RPC **responses/notifications**, not CLI stdout.

**Where**

- JSON-RPC adapter callback that handles inbound messages (results, notifications, streaming deltas).

**Steps**

1. For JSON-RPC **responses** (`result` or `error`):

   ```js
   appendProtoEvent({
     ts: Date.now(),
     req_id: reqId,
     route: httpRoute,
     phase: "backend_io",
     mode,
     kind: "rpc_response",
     rpc_method: method,
     result: sanitizeResult(result),
     error: sanitizeError(error),
   });
   ```

2. For JSON-RPC **notifications** that carry streaming content:

   - e.g., `"delta"`, `"message"`, `"tool_call"`, `"token_count"`:

   ```js
   appendProtoEvent({
     ts: Date.now(),
     req_id: reqId,
     route: httpRoute,
     phase: "backend_io",
     mode,
     kind: "rpc_notification",
     rpc_method: notification.method,
     payload: sanitizePayload(notification.params),
   });
   ```

3. Preserve tool-block logging:

   - If app-server emits tool usage metadata in JSON form, reuse the existing `<use_tool>` parser **or** add a JSON-based tool-block parser.
   - Emit:

     ```js
     appendProtoEvent({
       ts: Date.now(),
       req_id: reqId,
       route: httpRoute,
       phase: "backend_io",
       mode,
       kind: "tool_block",
       tool: { name, path, query }, // derived from JSON payload, not XML
     });
     ```

4. Lifecycle events (from `codex-runner` / adapter):

   - When starting app-server:

     ```js
     appendProtoEvent({
       ts: Date.now(),
       req_id: reqId ?? "<none>",
       route: "<backend>",
       phase: "backend_lifecycle",
       kind: "backend_start",
       backend: "app-server",
       details: { bin: resolvedCodexBin, args: appServerArgs },
     });
     ```

   - When app-server exits (crash or normal):

     ```js
     appendProtoEvent({
       ts: Date.now(),
       req_id: reqId ?? "<none>",
       route: "<backend>",
       phase: "backend_lifecycle",
       kind: "backend_exit",
       backend: "app-server",
       code,
       signal,
     });
     ```

**Outcome**

- App-server traffic is fully visible as JSON-RPC events; no reliance on CLI proto stdout parsing.

---

### 6.5 Phase 4 – Client Egress (SSE + JSON)

#### 6.5.1 Streaming SSE frames

**Where**

- `src/services/sse.js`.

**Steps**

1. Enhance `setSSEHeaders(res)` to tag route for logging:

   ```js
   export function setSSEHeaders(res, route) {
     res.locals = res.locals || {};
     res.locals.route = route;
     // existing header logic...
   }
   ```

2. Update handlers to call:

   ```js
   setSSEHeaders(res, "/v1/chat/completions");
   ```

3. Wrap `sendSSE` and `finishSSE`:

   ```js
   import { appendProtoEvent } from "../dev-logging.js";

   export function sendSSE(res, payload) {
     const reqId = res.locals?.req_id;
     const route = res.locals?.route || "<unknown>";
     if (reqId && LOG_PROTO) {
       appendProtoEvent({
         ts: Date.now(),
         req_id: reqId,
         route,
         phase: "client_egress",
         kind: "client_sse",
         payload,
       });
     }
     res.write(`data: ${JSON.stringify(payload)}\n\n`);
   }

   export function finishSSE(res) {
     const reqId = res.locals?.req_id;
     const route = res.locals?.route || "<unknown>";
     if (reqId && LOG_PROTO) {
       appendProtoEvent({
         ts: Date.now(),
         req_id: reqId,
         route,
         phase: "client_egress",
         kind: "client_sse_done",
       });
     }
     res.write("data: [DONE]\n\n");
     res.end();
   }
   ```

4. Optionally log keepalives as `kind: "client_sse_keepalive"` if needed.

#### 6.5.2 Non-stream JSON responses

**Where**

- Non-stream handlers before `res.json`.

**Steps**

- Add `logJsonResponse` helper:

  ```js
  export function logJsonResponse(res, route, mode, body, status) {
    const reqId = res.locals?.req_id;
    if (!reqId || !LOG_PROTO) return;

    appendProtoEvent({
      ts: Date.now(),
      req_id: reqId,
      route,
      method: "POST",
      phase: "client_egress",
      mode,
      kind: "client_json",
      status,
      body,
    });
  }
  ```

- Call right before `res.json` in `postChatNonStream` and `postCompletionsNonStream`.

---

### 6.6 Phase 5 – Usage Events & `/v1/usage`

**Goal**  
Align usage events with app-server traces.

**Steps**

1. Ensure all `appendUsage` calls populate:

   - `req_id` (same canonical id).
   - `route`, `method`, `status`.
   - `mode` (`"chat"` or `"completions"`).
   - `phase: "usage_summary"` (optional but helpful).

2. No change to `/v1/usage` and `/v1/usage/raw` shapes – they continue aggregating usage events. The trace system simply gains a more robust link between usage and RPC-level activity via `req_id`.

---

### 6.7 Phase 6 – Enforce Logging and Redaction in Dev

**6.7.1 Enforce tracing in dev**

- In `server.js`:

  ```js
  import { LOG_PROTO, PROTO_LOG_PATH } from "./src/dev-logging.js";

  if ((CFG.PROXY_ENV || "").toLowerCase() === "dev" && !LOG_PROTO) {
    console.warn(
      "[trace] LOG_PROTO=false in dev; end-to-end tracing will be incomplete. " +
      "Set PROXY_LOG_PROTO=true or opt out explicitly for this environment."
    );
  }
  ```

- Optionally, add `PROXY_TRACE_REQUIRED=true` to treat this as a hard error.

**6.7.2 Sanitization utilities**

- Add `src/dev-trace/sanitize.js` with helpers:

  ```js
  export function sanitizeHeaders(h) { /* redact authorization, cookies, etc. */ }
  export function sanitizeParams(p) { /* drop or shorten large/secret fields */ }
  export function sanitizeResult(r) { /* same idea */ }
  export function sanitizePayload(p) { /* for notifications */ }
  ```

- Apply sanitization in:
  - `logHttpRequest`
  - `traceRpcRequest`
  - RPC response/notification logging
  - `logJsonResponse`

This ensures app-server traces are useful without leaking sensitive data.

---

## 7. How This Works with App-Server Only

With the above changes, and app-server as the **only backend**, a dev trace for any `req_id` yields:

1. **HTTP ingress**

   - `phase: "http_ingress"`, `kind: "http_request"` –
     full OpenAI-style body + sanitized headers.

2. **Backend submission via JSON-RPC**

   - `phase: "backend_submission"`, `kind: "rpc_request"` –
     app-server method + params (sanitized).
   - Optional `kind: "backend_start"` / `backend_exit"` for app-server lifecycle.

3. **Backend IO**

   - `phase: "backend_io"`, `kind: "rpc_response"` and `kind: "rpc_notification"` –
     streaming deltas, tool invocations, token counts, etc.
   - `kind: "tool_block"` events derived from JSON payloads.

4. **Client egress**

   - Streaming:
     - `phase: "client_egress"`, `kind: "client_sse"` events for each SSE frame.
     - `kind: "client_sse_done"` for `[DONE]`.
   - Non-stream:
     - `phase: "client_egress"`, `kind: "client_json"` for final JSON payloads.

5. **Usage summary**

   - `phase: "usage_summary"` entries in `TOKEN_LOG_PATH` with tokens, duration, status.

No step requires CLI proto mode; all critical logging is anchored to the JSON-RPC/app-server transport and the HTTP/SSE layers.

---

## 8. Next Steps for Implementation

1. **Create or update a dedicated tracing doc** in the repo, e.g.:

   - `docs/bmad/architecture/end-to-end-tracing-app-server.md`

   Use this updated plan as the base.

2. **Implement in phases**:

   - Phase 0–1: unify `req_id` and add HTTP ingress logging.
   - Phase 2–3: implement JSON-RPC–centric logging in `JsonRpcChildAdapter`.
   - Phase 4: add SSE/JSON egress logging.
   - Phase 5–6: tighten usage events and sanitization.

3. **Verification**

   - Add a simple dev tool/script:
     - Given a `req_id`, scan:
       - access log (stdout)
       - `PROTO_LOG_PATH`
       - `TOKEN_LOG_PATH`
     - Print a chronological trace of `TraceEvent`s for that request.

This gives you a fully app-server-compatible, end-to-end tracing story without relying on any deprecated proto-mode behavior.
