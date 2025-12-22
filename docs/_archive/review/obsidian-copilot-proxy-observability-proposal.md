# Proxy Observability Checklist (Copilot + Responses)

Goal: remove ambiguity about proxy-side transformations and the exact payload Copilot receives.

## Scope
- Endpoints: `/v1/responses` (primary), `/v1/chat/completions` (secondary).
- Focus: proxy-side transforms, tool calls, output-mode behavior, and outbound payload visibility.

## Checklist

### 1) Outbound capture parity for chat + responses
- [ ] Add capture toggle for `/v1/chat/completions` (stream + nonstream).
  - Implementation: new env `PROXY_CAPTURE_CHAT_TRANSCRIPTS` and `PROXY_CAPTURE_CHAT_DIR`.
  - File targets:
    - `src/handlers/chat/stream.js`
    - `src/handlers/chat/nonstream.js`
    - `src/config/index.js`
- [ ] Mirror capture format used in `src/handlers/responses/capture.js`.
  - Redaction rules must match Responses capture.
  - Include `metadata` block with output mode, trace ids, route/mode, and outcome.
- [ ] Store chat captures under `test-results/chat-copilot/raw/` by default.

**Acceptance Criteria**
- AC1: With `PROXY_CAPTURE_CHAT_TRANSCRIPTS=1`, a streaming chat request generates a capture file containing:
  - SSE events exactly as emitted after any XML injection.
  - The `done` event.
- AC2: With `PROXY_CAPTURE_CHAT_TRANSCRIPTS=1`, a nonstream chat request generates a capture file containing:
  - The final JSON response sent to the client.
- AC3: Captures are sanitized (no auth headers, tool args redacted) and include trace ids.

**Tests**
- Unit:
  - Verify header/body sanitization matches Responses capture behavior.
- Integration:
  - Trigger a streaming chat request with tools and assert a capture file exists and includes XML in emitted content.
  - Trigger a nonstream chat request and assert capture contains the final payload.

### 2) Transformation summary logs per request
- [ ] Emit a single structured summary for each request:
  - `responses_transform_summary`
  - `chat_transform_summary`
- [ ] Fields must include:
  - `req_id`, `copilot_trace_id`, `route`, `output_mode_requested`, `output_mode_effective`
  - `tool_calls_detected`, `tool_calls_emitted`, `tool_names`
  - `xml_in_text` (boolean), `tool_use_items` (count)
  - `output_text_bytes`, `output_text_hash`
  - `response_shape_version`, `finish_reason`, `status`
- [ ] Ensure summaries are emitted once per request (avoid duplicates).

**Acceptance Criteria**
- AC4: Every Responses request yields exactly one `responses_transform_summary`.
- AC5: Every Chat request yields exactly one `chat_transform_summary`.
- AC6: Summaries include correct output mode and tool counts for tool-call scenarios.

**Tests**
- Unit:
  - Validate summary payload schema (required keys present).
- Integration:
  - Issue a tool-call request and assert summary log includes tool name and xml_in_text flag.

### 3) XML presence tracking for Responses output text
- [ ] Track whether `<use_tool>` appears in **Responses output text deltas**.
  - Source of truth: `response.output_text.delta` events in `src/handlers/responses/stream-adapter.js`.
- [ ] Include `xml_in_text` in `responses_transform_summary`.
- [ ] Optionally include `xml_in_text` in capture metadata for quick inspection.

**Acceptance Criteria**
- AC7: If XML appears in output text, `xml_in_text=true`; otherwise `false`.

**Tests**
- Unit:
  - Simulate a delta stream with `<use_tool>` and confirm flag toggles.
- Integration:
  - Use a fixture containing XML in deltas and assert `xml_in_text` is true.

### 4) Correlatable proxy trace id in responses
- [ ] Emit `x-proxy-trace-id` header on all responses (chat + responses).
- [ ] Include this id in:
  - capture metadata
  - transform summaries
- [ ] Ensure `x-proxy-trace-id` is stable across stream responses.

**Acceptance Criteria**
- AC8: Client receives `x-proxy-trace-id` on both endpoints.
- AC9: Logs/captures reference the same trace id.

**Tests**
- Integration:
  - Assert response headers include `x-proxy-trace-id`.
  - Compare header with captured metadata and summary log.

### 5) Non-leaky output previews (hash + byte counts)
- [ ] Log only hashes + sizes for:
  - output text
  - tool args
  - XML block sizes
- [ ] Avoid logging raw content by default.

**Acceptance Criteria**
- AC10: No raw tool args or assistant text appear in logs unless debug flags are explicitly enabled.

**Tests**
- Unit:
  - Ensure log entries include hashes and byte counts but not raw text.

## Suggested Debug Workflow (Operator Checklist)
- [ ] Enable captures: `PROXY_CAPTURE_RESPONSES_TRANSCRIPTS=1` and `PROXY_CAPTURE_CHAT_TRANSCRIPTS=1`.
- [ ] Send a tool-call request through `/v1/responses`.
- [ ] Inspect:
  - Capture file under `test-results/responses-copilot/raw/`
  - `responses_transform_summary` log entry
  - `x-proxy-trace-id` header
- [ ] Repeat via `/v1/chat/completions` and verify XML injection in chat capture.

## Notes
- All capture and summary features must be gated behind explicit env flags in production.
- Redaction rules should mirror `src/handlers/responses/capture.js` and `src/dev-trace/sanitize.js`.
