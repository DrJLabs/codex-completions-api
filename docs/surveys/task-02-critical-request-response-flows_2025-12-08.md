# Task 02 — Critical request/response flows (codex-completions-api)

- Repo: `DrJLabs/codex-completions-api`
- Commit pinned for this analysis: `c8628fa5613c5d1dd86bfb0dbfec80e23e965b17`
- Generated: 2025-12-08
- Goal: map the **end-to-end HTTP request/response paths** for the primary endpoints, including middleware ordering, handler stages, backend selection (proto vs app-server), and response shaping (JSON + SSE).

## Reasoning
- This task is strictly a **flow map** (what calls what, and in what order), with **light** flagging of inconsistencies discovered while tracing.
- I treat the source as ground truth and cite locations as `path:Lx-Ly` so later cleanup work can be surgically targeted.

---

## 1) Global HTTP pipeline (Express)

### 1.1 Middleware + routing order (`src/app.js`)
Execution order (top-down):

1. JSON body parsing: `express.json({ limit: "10mb" })`  
   - `src/app.js:L22`
2. API key guard installation (implementation not traced in this task): `installApiKeyGuard(app)`  
   - `src/app.js:L23`
3. OPTIONS short-circuit: `OPTIONS /* -> 204`  
   - `src/app.js:L25-L30`
4. Global CORS: `applyGlobalCors(app)`  
   - `src/app.js:L32`
5. Access logging middleware: `accessLog()`  
   - `src/app.js:L33`
6. Rate limiting middleware: `rateLimit()`  
   - `src/app.js:L34`
7. Optional test endpoints when `config.PROXY_TEST_ENDPOINTS` is enabled  
   - `src/app.js:L35-L84`
8. Router mounting (order matters):
   - `/metrics` → `metricsRouter()` (`src/app.js:L86`)
   - health → `healthRouter()` (`src/app.js:L88`)
   - models → `modelsRouter()` (`src/app.js:L89`)
   - chat + completions → `chatRouter()` (`src/app.js:L90`)
   - responses → `responsesRouter()` (`src/app.js:L91`)
   - usage → `usageRouter()` (`src/app.js:L92`)

**Immediate observation:** the OPTIONS handler runs *before* `applyGlobalCors`. If `applyGlobalCors()` is responsible for preflight headers, the current order may produce `204` responses without the expected CORS headers for browser clients.

---

## 2) Endpoint flow maps (what happens for each request)

### 2.1 Health: `/healthz` and `/readyz` (`src/routes/health.js`)
- `GET /healthz` returns `{ ok: true }` unconditionally.  
  - `src/routes/health.js:L7-L9`
- `GET /readyz` returns `{ ok: true, ready: <bool> }` based on `isWorkerReady()`.  
  - `src/routes/health.js:L11-L16`

### 2.2 Models: `GET /v1/models` (`src/routes/models.js`)
- Returns an OpenAI-like `list` payload built from `acceptedModelIds()`.  
  - `src/routes/models.js:L5-L27`
- No explicit auth guard at the route level (at least in this router).

### 2.3 Chat Completions: `POST /v1/chat/completions` (`src/routes/chat.js`)
Router behavior:
- Reads `stream` from the JSON body and dispatches:
  - `stream=true` → `postChatStream(req, res)`
  - else → `postChatNonStream(req, res)`  
- `requireWorkerReady()` is enforced for this route.  
  - `src/routes/chat.js:L8-L17`

#### 2.3.1 Non-stream flow (`src/handlers/chat/nonstream.js` → `postChatNonStream`)
Stages (in order):

**Stage A — request id + trace context**
- `ensureReqId(res)` sets/returns a request id.
- `setHttpContext(res, { route: "/v1/chat/completions", mode: "chat_nonstream" })`  
  - `src/handlers/chat/nonstream.js:L90-L92`

**Stage B — auth gate**
- Validates `Authorization: Bearer <API_KEY>` against `config.API_KEY`; otherwise `401` with `WWW-Authenticate: Bearer`.  
  - `src/handlers/chat/nonstream.js:L98-L112`  
  - Error body helper: `authErrorBody()` (`src/lib/errors.js:L1-L5`)

**Stage C — input validation (core constraints)**
- Requires `messages` to be a non-empty array, else `400 invalid_request_error` (`param: "messages"`).  
  - `src/handlers/chat/nonstream.js:L114-L122`  
  - Error body helper: `invalidRequestBody()` (`src/lib/errors.js:L18-L27`)
- Rejects if `n > 20` (hard cap).  
  - `src/handlers/chat/nonstream.js:L124-L131`

**Stage D — optional diagnostic tracing**
- `logHttpRequest(req, reqId, "{...}", "chat_nonstream", logSanitizerToggle(...))`  
  - `src/handlers/chat/nonstream.js:L138-L152`

**Stage E — backend selection**
- Chooses backend mode via `selectBackendMode(config)`.  
  - `src/handlers/chat/nonstream.js:L227-L234`
  - Selection logic: `PROXY_USE_APP_SERVER ? BACKEND_APP_SERVER : BACKEND_PROTO`  
    - `src/services/backend-mode.js:L10-L16`

**Stage F — “app-server” path (JSON-RPC transport)**
When backend mode is `BACKEND_APP_SERVER`:
- Normalizes the incoming chat-completions body to a JSON-RPC “chat request”:  
  - `normalizeChatJsonRpcRequest(body, { requestId: reqId })`  
  - `src/handlers/chat/nonstream.js:L242-L247`
- Creates a `JsonRpcChildAdapter`:
  - `createJsonRpcChildAdapter({ requestId: reqId, timeoutMs, request: normalized, trace: traceCtx })`  
  - `src/handlers/chat/nonstream.js:L250-L259`
- The adapter is a **child-process compatibility layer** backed by the singleton JSON-RPC transport:
  - `src/services/transport/child-adapter.js:L54-L108`
- The transport request lifecycle (high-level) is managed via `JsonRpcTransport.createChatRequest(...)`, which:
  1) ensures handshake, 2) opens a conversation context, 3) sends the user message, 4) resolves on `response.done`  
  - `src/services/transport/index.js:L277-L316`  
  - handshake mechanics: `src/services/transport/index.js:L106-L149`

**Stage G — response emission**
All JSON responses go through `respondWithJson(res, payload, statusCode)` which:
- Applies an optional `res.locals.responseTransform(payload, statusCode)` hook, then sends JSON.  
  - `src/handlers/chat/nonstream.js:L42-L87`  
This hook is critical for `/v1/responses` shimming (see §2.5).

---

### 2.4 Chat Completions: streaming (`POST /v1/chat/completions`, `stream=true`)
Router dispatch: `postChatStream(req, res)` (`src/routes/chat.js:L8-L17`)

#### 2.4.1 Stream flow (`src/handlers/chat/stream.js` → `postChatStream`)
Stages (in order):

**Stage A — request id + trace context**
- `ensureReqId(res)` assigns/returns request id.
- `setHttpContext(res, { route: "/v1/chat/completions", mode: "chat_stream" })`  
  - `src/handlers/chat/stream.js:L255-L258`

**Stage B — auth gate**
- Same Bearer check as non-stream; rejects with `401` and `WWW-Authenticate: Bearer`.  
  - `src/handlers/chat/stream.js:L265-L279`

**Stage C — input validation**
- Requires `messages` to be non-empty array; caps `n <= 20`.  
  - `src/handlers/chat/stream.js:L281-L305`

**Stage D — normalize request (app-server compatibility)**
- When in app-server backend mode, normalize with:  
  - `normalizeChatJsonRpcRequest(body, { requestId: reqId })`  
  - `src/handlers/chat/stream.js:L308-L316`

**Stage E — streaming concurrency guard**
- `setupStreamGuard({ reqId, route: "/v1/chat/completions" })` and attempt `acquire()`.  
- On saturation: emits `429` and an OpenAI-like error shape (`type: "rate_limit_error"`).  
  - `src/handlers/chat/stream.js:L319-L343`  
  - Guard implementation: `src/services/concurrency-guard.js:L41-L94`

**Stage F — SSE framing + keepalives**
- Sets SSE headers and starts keepalive comments:
  - `setSSEHeaders(res)` (`src/handlers/chat/stream.js:L348`)
  - `startKeepalives(res, keepaliveMs)` (`src/handlers/chat/stream.js:L356`)
- SSE utilities:
  - `src/services/sse.js:L18-L61`

**Stage G — chunk emission (with optional stream adapter)**
Before writing each SSE chunk, the handler checks for `res.locals.streamAdapter`:
- If present and `onChunk` exists → delegate chunk serialization
- Else → default `sendSSE(res, chunk)`  
  - `src/handlers/chat/stream.js:L413-L449`
On completion, it similarly delegates to `streamAdapter.onDone(meta)` if present, else defaults to `finishSSE(res)`.  
  - `src/handlers/chat/stream.js:L451-L456`  
This is the core mechanism used to implement `/v1/responses` streaming as a shim.

**Stage H — teardown**
- Releases the concurrency guard via `release()` when the stream ends.  
  - `src/services/concurrency-guard.js:L96-L116` (via the handle returned by `setupStreamGuard`)

---

### 2.5 Responses API shim: `POST /v1/responses` (`src/routes/responses.js`)
Router behavior:
- Reads `stream` from the request body and dispatches:
  - `stream=true` → `postResponsesStream(req, res)`
  - else → `postResponsesNonStream(req, res)`  
- Also registers a trailing slash alias `/v1/responses/`.  
  - `src/routes/responses.js:L5-L13`

**Important observation:** unlike `/v1/chat/completions`, the responses router does **not** apply `requireWorkerReady()` at the route level (`src/routes/responses.js` has none). That means readiness gating depends on downstream behavior, not router-level enforcement.

#### 2.5.1 Non-stream responses (`src/handlers/responses/nonstream.js`)
Implementation strategy: convert `/v1/responses` → `/v1/chat/completions` and transform the output back.

1. Convert request:
   - `toChatCompletionRequest(req.body)`  
   - `src/handlers/responses/nonstream.js:L7-L11`
2. Install output transform:
   - `res.locals.responseTransform = toResponsesResponse`  
   - `src/handlers/responses/nonstream.js:L12-L14`
3. Delegate to chat handler:
   - `postChatNonStream({ ...req, body: chatBody }, res)`  
   - `src/handlers/responses/nonstream.js:L15-L17`

Where the transform is applied:
- The chat non-stream path calls `respondWithJson()`, which applies `res.locals.responseTransform` if present.  
  - `src/handlers/chat/nonstream.js:L42-L87`

#### 2.5.2 Streaming responses (`src/handlers/responses/stream.js`)
Implementation strategy: convert request, install a stream adapter, then delegate to chat streaming.

1. Convert request:
   - `toChatCompletionRequest(req.body)`  
   - `src/handlers/responses/stream.js:L7-L11`
2. Install stream adapter:
   - `res.locals.streamAdapter = createResponsesStreamAdapter(res)`  
   - `src/handlers/responses/stream.js:L13-L15`
3. Delegate to chat stream handler:
   - `postChatStream({ ...req, body: chatBody }, res)`  
   - `src/handlers/responses/stream.js:L16-L18`

Where the adapter is applied:
- Chat stream handler checks `res.locals.streamAdapter` and delegates chunk writing.  
  - `src/handlers/chat/stream.js:L413-L456`

---

### 2.6 Legacy completions: `POST /v1/completions` (`src/routes/chat.js`)
Router behavior:
- Reads `stream` from body and dispatches:
  - `stream=true` → `postCompletionsStream(req, res)`
  - else → `postCompletionsNonStream(req, res)`  
- `requireWorkerReady()` is enforced for this route.  
  - `src/routes/chat.js:L19-L30`

**Status in this task:** the `/v1/completions` handler implementations were not fully surfaced in the retrieved code snippets, so this document only maps routing. In the next pass, we should specifically verify:
- prompt → messages translation behavior
- route/mode labeling (`completions_*`) vs currently hard-coded `/v1/chat/completions` route tags
- parity of error semantics with `/v1/chat/completions`

---

## 3) Cross-cutting infrastructure used by the above flows

### 3.1 Request ID + access logging
- Request id is stored in `res.locals.req_id` and echoed via `X-Request-Id`.  
- Access log emits method, URL, status, duration, bytes, and `x-request-id`.  
  - `src/middleware/access-log.js:L16-L57`

### 3.2 Worker readiness gating
- `requireWorkerReady()` returns `503` when `isWorkerReady()` is false.  
  - `src/middleware/worker-ready.js:L8-L18`

### 3.3 Streaming concurrency control
- Global in-process semaphore used to cap open SSE streams.  
  - `src/services/concurrency-guard.js:L41-L139`

### 3.4 Error envelope standardization
Helpers implement OpenAI-like error payloads:
- auth error (`invalid_api_key`)  
  - `src/lib/errors.js:L1-L5`
- model not found (`model_not_found`)  
  - `src/lib/errors.js:L7-L16`
- invalid request (`invalid_request_error`)  
  - `src/lib/errors.js:L18-L27`
- SSE spawn/timeout mapping (`spawn_error` / `request_timeout`)  
  - `src/lib/errors.js:L50-L60`

---

## 4) Issues / inconsistencies discovered while flow-mapping (triage notes)

1. **Responses readiness gating**  
   - `/v1/responses` does not apply `requireWorkerReady()` at the router level (`src/routes/responses.js`).  
   Impact: readiness semantics may differ from `/v1/chat/completions`, depending on downstream failure modes.

2. **CORS + OPTIONS ordering**  
   - OPTIONS returns `204` before `applyGlobalCors(app)` (`src/app.js:L25-L32`).  
   Impact: browser preflight requests may not receive expected CORS headers.

3. **Unauthenticated operational endpoints** (verify desired posture)  
   - `/v1/usage` and `/v1/usage/raw` are exposed without auth in `usageRouter()` (`src/routes/usage.js:L37-L53`).  
   - `/metrics` route protection depends on `metricsRouter()` (not mapped here).  
   Impact: potentially sensitive operational data leakage.

4. **Legacy completions parity gap (needs confirmation)**  
   - Routing exists for `/v1/completions` (`src/routes/chat.js:L19-L30`), but handler internals were not fully traced in this task.

---

## 5) Outputs for downstream remediation planning
This task produces a baseline “flow contract” for:
- which middleware runs (and in what order),
- which handler is invoked per endpoint,
- where auth, validation, backend selection, and SSE mechanics occur,
- where shims (`/v1/responses`) hook into the pipeline.

Next tasks should build on this by:
- enumerating all configuration toggles and defaults (Task 03),
- mapping data contracts (request/response schemas) and drift vs OpenAI spec (Task 04),
- identifying dead/obsolete code paths and untested error branches (Task 05+).
