# Logging & Tracing Gaps — Progress Tracker

This document tracks remaining observability gaps from **HTTP ingress → app-server (JSON-RPC) → client egress**.

## How to use

- Treat this as the source of truth for what’s missing, what “done” means (ACs), and how we verify it (tests).
- When implementing an item, update:
  - its checkbox status,
  - the linked PR/branch (if applicable),
  - and add/adjust the referenced tests.

## Current pipeline map (what we already log)

### 1) Access log (structured stdout)

- Where: `src/middleware/access-log.js`
- Emits: `event:"access_log"` (one line per request, on `res.finish`)
- Correlation: `req_id` (also returned as `X-Request-Id`), `trace_id` (if OTEL enabled), `copilot_trace_id`
- Notes: OPTIONS preflight returns before access-log middleware, so there is no `req_id` for `204` preflights.

### 2) Dev trace ingress (NDJSON, dev-only)

- Where: `src/dev-trace/http.js` (called by chat/completions handlers)
- Emits (via `appendProtoEvent` → `PROTO_LOG_PATH`): `phase:"http_ingress", kind:"client_request"`
- Safety: request `headers` + `body` are sanitized by `src/dev-trace/sanitize.js`, but then stored under keys that are redacted by `src/services/logging/schema.js` (`payload/body/headers/...`).

### 3) Responses raw ingress (structured stdout, pre-rewrite)

- Where: `src/handlers/responses/stream.js`, `src/handlers/responses/nonstream.js`
- Emits: `event:"responses_ingress_raw"` (shape-only; no content)
- Captures: `output_mode_requested/effective`, `has_tool_output_items`, model presence, etc.

### 4) Backend submission + IO (NDJSON, dev-only)

- Where: `src/services/transport/index.js` → `src/dev-trace/backend.js`
- Emits (via `appendProtoEvent`):
  - `phase:"backend_submission", kind:"rpc_request"`
  - `phase:"backend_io", kind:"rpc_response"|"rpc_error"|"rpc_notification"`, plus `kind:"tool_block"` when tool-like payloads appear
- Safety: RPC payloads are logged under `payload` and are redacted by `src/services/logging/schema.js`.

### 5) Client egress (NDJSON, dev-only)

- Where: `src/services/sse.js`
- Emits (via `appendProtoEvent`): `phase:"client_egress"`
  - Streaming: `kind:"client_sse"`, `kind:"client_sse_done"`
  - Non-stream: `kind:"client_json"` via `installJsonLogger(res)`
- Safety: response payloads are logged under `payload` and are redacted by `src/services/logging/schema.js`.

### 6) Typed Responses SSE egress (dev-only + summaries)

- Where: `src/handlers/responses/stream-adapter.js`
- Emits:
  - Dev trace: `phase:"responses_sse_out"` per typed SSE event with `stream_event_seq` (gated by `PROXY_LOG_PROTO`)
  - Dev trace: `phase:"tool_call_arguments_done"` with args byte counts + JSON validity (no args content)
  - Structured stdout: `event:"sse_summary"` enriched with usage + `previous_response_id_hash`

## Gap tracker (what’s missing)

### GAP-READY — Structured logging for worker-not-ready responses

- Status: [ ] TODO
- Problem: `requireWorkerReady` returns `503` with `console.warn` only; no structured event that can be joined by `req_id`.
- Acceptance criteria:
  - `POST /v1/chat/completions|/v1/completions|/v1/responses` returning `503 worker_not_ready` emits a structured log event containing `req_id`, `route`, `method`, `status`, `trace_id?`, `copilot_trace_id?`, and `worker_status`.
  - Event is emitted exactly once per request, and does not leak secrets.
- Tests:
  - Add: `tests/integration/worker-ready.logging.int.test.js` capturing stdout, asserting the event exists and matches `X-Request-Id`.

### GAP-RATE — Structured logging for rate-limited responses

- Status: [ ] TODO
- Problem: rate limiting returns `429` JSON with no dedicated structured/proto event beyond access logs.
- Acceptance criteria:
  - When the rate limiter blocks a guarded path, emit a structured event with `req_id`, `route`, `status=429`, and `retry_after_s` (if set).
  - Do not log API keys; do not log `Authorization`.
- Tests:
  - Extend/add: `tests/integration/rate-limit.int.test.js` to capture stdout and assert presence of `event:"rate_limited"` (or similar) correlated by `req_id`.

### GAP-STREAM-JSON — Ensure stream handlers log early JSON egress

- Status: [ ] TODO
- Problem: streaming handlers often return JSON on auth/validation failures without `installJsonLogger`, so `client_json` proto egress is missing for those cases.
- Acceptance criteria:
  - For streaming endpoints, any early JSON response (< 400/401/429/etc) emits a `client_json` proto event (or a structured equivalent), correlated by `req_id`.
- Tests:
  - Add: integration test that calls `/v1/chat/completions` with `stream:true` and missing bearer; assert a `client_json` egress proto event exists for the same `req_id`.

### GAP-ERR-STREAM — Deterministic stream error-path logging

- Status: [ ] TODO
- Problem: failures can produce mixed signals (chat `error` SSE vs adapter-emitted `response.failed`), and it isn’t deterministically logged which happened.
- Acceptance criteria:
  - On any stream-fatal error, emit exactly one structured `event:"stream_error_detected"` with:
    - `req_id`, `route`, `mode`, `endpoint_mode`
    - `adapter_present` and `adapter_failed_emitted`
    - `done_sentinel_written` = `"chat_done"|"responses_done"|"none"`
  - No raw error message logging unless explicitly gated.
- Tests:
  - Add: integration test that forces backend failure mid-stream in both chat and responses modes and asserts `stream_error_detected` presence + fields.

### GAP-UPSTREAM — Request-level upstream boundary logs

- Status: [ ] TODO
- Problem: transport logs exist per JSON-RPC call, but there’s no single “upstream request start/end” envelope per HTTP request.
- Acceptance criteria:
  - Exactly one `upstream_request_start` and one `upstream_response_end` per proxied request with:
    - `req_id`, `route`, `mode`, `latency_ms`, `http_status_upstream` (if meaningful), and `outcome`
  - No payload capture in these boundary logs.
- Tests:
  - Add: integration test that performs a successful request and asserts both boundary events exist and `latency_ms` is non-negative.

### GAP-CORR — Propagate `trace_id` + `copilot_trace_id` into backend trace events

- Status: [ ] TODO
- Problem: JSON-RPC trace context currently includes `{ reqId, route, mode }` but not `trace_id`/`copilot_trace_id`, so joining across log families is harder.
- Acceptance criteria:
  - `rpc_request` / `rpc_response` / `rpc_notification` events include `trace_id` and `copilot_trace_id` when present.
  - These fields originate from `res.locals` at handler ingress and are stable for the request.
- Tests:
  - Add: extend `tests/integration/chat.tracing.req-id.int.test.js` to assert `trace_id`/`copilot_trace_id` are present in backend events when enabled.

### GAP-CHAT-INGRESS — Chat ingress shape summary (content-free)

- Status: [ ] TODO
- Problem: there is no content-free, shape-only ingress summary for chat/completions (analogous to `responses_ingress_raw`).
- Acceptance criteria:
  - Emit a structured event like `chat_ingress_summary` with:
    - `req_id`, route/mode, `stream`, `output_mode_requested/effective`
    - shape flags (`messages_count`, `has_tools`, `has_tool_choice`, etc.)
  - Never log message text or tool args in this summary event.
- Tests:
  - Add: unit test for the summarizer helper + integration test asserting the event exists.

### GAP-DEV-LEAKAGE — Dev trace raw stdout/event payload safety

- Status: [ ] TODO
- Problem: chat streaming dev trace logs `kind:"stdout"` and `kind:"event"` which can include raw content/tool args.
- Acceptance criteria:
  - Decide policy:
    - either gate raw content logging behind an explicit flag (e.g. `PROXY_DEBUG_WIRE=1`), or
    - ensure those keys are redacted consistently via schema rules.
  - Ensure default dev runs don’t persist raw content beyond what transcript tests require.
- Tests:
  - Add: unit test that verifies raw content keys are redacted or gated off by default; keep transcript harness working.

## Verification baseline (already present)

- Access log correlation: `tests/integration/access-log.int.test.js`
- End-to-end dev trace linkage: `tests/integration/chat.tracing.req-id.int.test.js`
- Worker supervisor logging hygiene: `tests/integration/worker-supervisor.int.test.js`
- Responses SSE / non-stream contracts: `tests/e2e/responses-contract.spec.js`, `tests/integration/responses.*.int.test.js`

