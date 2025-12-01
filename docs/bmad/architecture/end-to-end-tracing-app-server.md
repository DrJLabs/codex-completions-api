# End-to-End Tracing — App-Server Dev Stack

This runbook distills `docs/dev/end-to-end-tracing-plan.app-server.md` into operator-facing guidance. It explains how the dev proxy captures every `/v1/chat|completions` request when running the Codex app-server backend exclusively.

## Architecture Layers

1. **HTTP ingress** (`phase:"http_ingress"`, `kind:"http_request"`)
   - Source of truth for the canonical `req_id` emitted by `src/middleware/access-log.js`.
   - Logged via `src/dev-trace/http.js::logHttpRequest` immediately after validation, with headers sanitized per `sanitizeHeaders`. See plan §2.1 and §6.1.
2. **Backend submission** (`phase:"backend_submission"`)
   - JSON-RPC adapter emits `rpc_request` events plus `backend_start/backend_exit` lifecycle facts captured by `src/services/codex-runner.js`. See plan §2.5, §6.3.
3. **Backend IO** (`phase:"backend_io"`)
   - Every JSON-RPC response/notification (deltas, tool calls, token counts) is persisted via `appendProtoEvent`. Tool-block metadata comes from app-server notifications (plan §6.4).
4. **Client egress** (`phase:"client_egress"`)
   - Streaming routes wrap `sendSSE`/`finishSSE`; non-stream routes call `logJsonResponse` before `res.json`, recording payloads, keepalives, and `[DONE]` markers (plan §6.5).
5. **Usage summary** (`phase:"usage_summary"`)
   - `appendUsage` writes NDJSON with `req_id`, route, method, status, and token counts, linking to `/v1/usage` (plan §6.6).

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
   - Access log (`kind:"access"`)
   - Proto trace (`phase` fields above)
   - Usage (`phase:"usage_summary"`)
4. **Redaction & compliance:** never ship logs with raw `Authorization`, cookies, or unsanitized payloads. `src/dev-trace/sanitize.js` centralizes allowed keys; extend it when new fields appear.

## Guardrails & Alerts

- `PROXY_ENV=dev` with `LOG_PROTO=false` triggers a console warning; `PROXY_TRACE_REQUIRED=true` can fail fast (plan §6.7).
- Sanitization helpers apply to headers, params, responses, and notifications. Document new redaction rules here whenever the helpers expand.

## References

- docs/dev/end-to-end-tracing-plan.app-server.md (authoritative design)
- docs/tech-spec-epic-2.md#story-211-end-to-end-tracing
- docs/epics.md#story-211-end-to-end-tracing
- docs/PRD.md#goals-and-background-context
