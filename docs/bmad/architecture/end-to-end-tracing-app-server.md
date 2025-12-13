# End-to-End Tracing — App-Server Dev Stack

This runbook distills `docs/dev/end-to-end-tracing-plan.app-server.md` into operator-facing guidance. It explains how the dev proxy captures traces for `/v1/chat/completions`, `/v1/completions`, and `/v1/responses` while running the Codex app-server backend.

## Architecture Layers

0. **Access log (stdout)** (`event:"access_log"`)
   - Source of truth for the canonical `req_id` + `X-Request-Id` response header.
   - Also captures `copilot_trace_id` (header-derived or generated), `trace_id` (when tracing is enabled), route/method/status/latency.
1. **HTTP ingress (dev trace)** (`phase:"http_ingress"`, `kind:"client_request"`)
   - Logged via `src/dev-trace/http.js::logHttpRequest` with headers/body sanitized + truncated (`src/dev-trace/sanitize.js`).
2. **Backend submission** (`phase:"backend_submission"`, `kind:"rpc_request"`)
   - JSON-RPC transport logs outgoing calls via `src/dev-trace/backend.js::logBackendSubmission`.
   - Backend lifecycle uses `src/services/codex-runner.js` → `src/dev-trace/backend.js::logBackendLifecycle` (`kind:"backend_start"|"backend_exit"`).
3. **Backend IO** (`phase:"backend_io"`, `kind:"rpc_response"|"rpc_error"|"rpc_notification"`)
   - JSON-RPC responses/notifications are persisted via `appendProtoEvent`; tool-call-ish notifications also emit `kind:"tool_block"`.
4. **Client egress**
   - Chat/completions streaming/non-stream: `src/services/sse.js` emits `phase:"client_egress"` events (`kind:"client_sse"|"client_sse_done"|"client_json"`).
   - Responses typed SSE: `src/handlers/responses/stream-adapter.js` emits per-event dev trace (`event:"responses_sse_out"`) plus structured summaries (`event:"sse_summary"`).
5. **Usage summary** (`phase:"usage_summary"`)
   - `appendUsage` writes NDJSON with `req_id`, route, method, status, and token counts, linking to `/v1/usage`.

## Implementation Phases (Plan §6)

| Phase | Summary | Key Files |
| --- | --- | --- |
| 0 | Align canonical `req_id` across handlers and transport | `src/middleware/access-log.js`, handlers |
| 1 | Log HTTP ingress with sanitization/truncation | `src/dev-trace/http.js`, `src/dev-trace/sanitize.js` |
| 2 | Emit `rpc_request` trace entries | `src/services/backend-mode.js`, `src/services/codex-runner.js` |
| 3 | Capture backend IO (`rpc_response`, notifications, tool_block`) | `src/dev-logging.js` (appendProtoEvent) |
| 4 | Trace SSE/non-stream egress | `src/services/sse.js`, chat/responses handlers |
| 5 | Persist enriched usage events | `src/dev-logging.js`, `/v1/usage` routes |
| 6 | Enforce logging in dev, introduce sanitizers and `PROXY_TRACE_REQUIRED` | `src/app.js`, `src/dev-trace/sanitize.js` |

## Operator Workflow

1. **Capture the `req_id`:** use access logs (`kind:"access"`) or HTTP response header `X-Request-Id`.
2. **Aggregate traces:** run:
   ```bash
   node scripts/dev/trace-by-req-id.js --req-id <id> \
     --access-log stdout.log \
     --proto-log ${PROTO_LOG_PATH} \
     --usage-log ${TOKEN_LOG_PATH}
   ```
   This script stitches chronological events from stdout (ingress), proto trace NDJSON (backend + egress), and usage NDJSON.
   - `--req-id` is required and matches the `X-Request-Id` header or access log entry.
   - `--access-log` should point to the JSON access log captured from stdout (one JSON line per request). When omitted, only proto/usage logs are inspected.
   - `--proto-log` and `--usage-log` default to `PROTO_LOG_PATH`/`TOKEN_LOG_PATH`, so you only need to override them when the proxy is configured to write somewhere else.
   - Output is already sorted by timestamp and shows the source (`access`, `proto`, or `usage`), phase, and payload for quick auditing.
3. **Manual fallback:** use `rg`/`jq` to filter each log for the `req_id` and compare timestamps:
   - Access log (`event:"access_log"`)
   - Dev trace / proto NDJSON (`PROTO_LOG_PATH`)
   - Usage NDJSON (`TOKEN_LOG_PATH`)
   - Responses structured logs (stdout): `event:"responses_ingress_raw"`, `event:"responses_nonstream_summary"`, `event:"sse_summary"`
4. **Redaction & compliance:** never ship logs with raw `Authorization`, cookies, or unsanitized payloads. `src/dev-trace/sanitize.js` centralizes allowed keys; extend it when new fields appear.

## Guardrails & Alerts

- `PROXY_TRACE_REQUIRED=true` fails fast if `PROXY_LOG_PROTO` disables dev tracing (see `src/dev-logging.js`).
- `PROXY_DEBUG_WIRE=1` enables small, capped previews for select dev-only trace events; keep it off unless debugging locally.
- Sanitization helpers apply to headers, params, responses, and notifications. Document new redaction rules here whenever the helpers expand.

## References

- docs/dev/end-to-end-tracing-plan.app-server.md (authoritative design)
- docs/tech-spec-epic-2.md#story-211-end-to-end-tracing
- docs/epics.md#story-211-end-to-end-tracing
- docs/PRD.md#goals-and-background-context
