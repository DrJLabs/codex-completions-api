# End-to-End Tracing Plan for Dev Server

## Goal

Guarantee that every chat/completions request running through the dev server has a linear, replayable trace from ingress (raw HTTP payload) through every transformation to the final OpenAI-compatible response that leaves the proxy.

## Current Signals

- `src/app.js` & `src/middleware/access-log.js` emit text + JSON access logs with `req_id`, route, status, and duration.
- `src/dev-logging.js` maintains three NDJSON streams (usage, proto, sanitizer). `LOG_PROTO` only defaults to `true` when `PROXY_ENV=dev`.
- Chat handlers log parsed `messages[]` plus the joined prompt (`[dev][prompt][chat]`) and add `kind:"submission"` proto events.
- `appendProtoEvent` captures Codex stdout/stderr, tool-call summaries, sanitizer events, and finish telemetry; `appendUsage` records token counts and finish reasons.

These are useful for backend debugging but they miss entire stages of the request/response path, so we cannot yet reconstruct the journey of a payload end-to-end.

## Missing Coverage

1. **Canonical HTTP payload** — we never persist `req.body` verbatim, so context like `tools`, `metadata`, `response_format`, etc., is dropped.
2. **Backend submission** — the normalized JSON-RPC `turn`/`message` objects (or CLI args for the Codex binary) are not logged, meaning we cannot prove what the child process actually received after our transforms.
3. **Child stdin** — even in dev we do not emit the serialized `submission` that is written to `child.stdin`, so subtle mutations right before write() are invisible.
4. **Client-facing responses** — we log Codex deltas, but not the OpenAI-compatible frames emitted via `sendSSE`/`res.json`, so the egress shape is missing.
5. **Transport adapter visibility** — JSON-RPC mode hides `turnParams`, `sendUserMessage`, and transport events behind `JsonRpcChildAdapter`, with no proto mirrors.
6. **Proto logging guarantees** — `LOG_PROTO` can be disabled even in dev, silently removing traces.

## Implementation Steps

### 1. Log Full HTTP Request

- Location: right after the chat/completions handlers validate input.
- Emit `appendProtoEvent({ kind:"http_request" })` with `req_id`, headers of interest, and a deep copy of `req.body`.
- Gate sensitive fields via a sanitizer hook so secrets can be redacted per key.

### 2. Record Normalized Backend Payloads

- After `normalizeChatJsonRpcRequest(...)` (app-server mode) append `kind:"backend_request"` containing the normalized `turn`, `message`, approval mode, sandbox mode, and exact CLI args.
- For binary mode, log the resolved `spawnCodex` args plus the joined prompt so CLI launches can be replayed.

### 3. Capture Child stdin/stdout Contracts

- When constructing `submission` (stream + non-stream), add a `kind:"child_submission"` proto event with the precise JSON written to stdin.
- Inside `JsonRpcChildAdapter`, mirror `turnParams`/`sendUserMessage` calls and transport events (`delta`, `message`, `usage`, `result`, `notification`) into proto entries with `direction:"transport"`.

### 4. Log Outbound Client Frames

- Wrap `sendSSE` and `finishSSE` in `src/services/sse.js` to emit `kind:"client_response"` proto lines for every delta chunk, usage block, and `[DONE]`.
- For non-stream responses, log the final JSON payload (and HTTP status) before calling `res.json`.

### 5. Strengthen Proto Logging Defaults

- Force `LOG_PROTO=true` whenever `PROXY_ENV=dev`, or fail startup with a loud error if proto logging is disabled.
- Consider adding `PROXY_LOG_PROTO=mandatory` mode for CI/dev where traces are required.

### 6. Correlate & Redact

- Ensure every new proto event includes `req_id`, `route`, `model`, `stream`, and `direction` fields.
- Centralize redaction (e.g., helper in `dev-logging.js`) so we can safely log payloads without leaking credentials.

## Expected Outcome

With the above in place we can reconstruct, for any dev request:

1. The original HTTP payload and headers.
2. Each transformation (normalization, sanitizer activity, metadata filters).
3. The exact prompt/turn that reached Codex.
4. Every backend delta plus the final OpenAI frames returned to the client.

That satisfies the “end-to-end tracing of raw input and every transformation” requirement and allows deterministic replay/regression triage directly from proto logs.

