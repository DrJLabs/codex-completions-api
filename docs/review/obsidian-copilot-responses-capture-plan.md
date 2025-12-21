# Plan: Capture Real Copilot `/v1/responses` Traffic as Fixtures

Goal: implement the third task from `docs/review/obsidian-copilot-compatibility-audit_proxy-vs-copilot.md` (#3 in Executive Summary): capture real Copilot `/v1/responses` requests (shape + headers + SSE) and pin them as fixtures/tests to remove guesswork around LangChain `useResponsesApi` serialization and streaming handling.

Scope: primary focus on `/v1/responses`. Secondary (brief) note on `/v1/chat/completions` only if Copilot falls back there.
Constraints: no Copilot code changes; capture must be proxy/edge-side only; sanitize secrets and dynamic IDs.

## References (sources to inspect)
- Copilot request builder (Responses): `external/obsidian-copilot/src/LLMProviders/chatModelManager.ts`
- Copilot XML parsing + streaming behavior: `external/obsidian-copilot/src/LLMProviders/chainRunner/utils/xmlParsing.ts`, `external/obsidian-copilot/src/LLMProviders/chainRunner/utils/ThinkBlockStreamer.ts`
- Proxy Responses ingress logging: `src/handlers/responses/ingress-logging.js` (`summarizeResponsesIngress`, `logResponsesIngressRaw`)
- Proxy Responses stream/nonstream flow: `src/handlers/responses/stream.js`, `src/handlers/responses/nonstream.js`, `src/handlers/responses/stream-adapter.js`
- Existing transcript tooling: `scripts/generate-responses-transcripts.mjs`, `tests/shared/transcript-utils.js`

## End-to-end Plan (Checklist)

### Phase 0 — Discovery and capture design
- [ ] Inventory Copilot Responses request fields and headers from `external/obsidian-copilot/src/LLMProviders/chatModelManager.ts` (and any adjacent request builders) to confirm what must be preserved: `model`, `input` structure, `instructions`, `metadata`, `stream`, `stream_options`, `tools`, `tool_choice`, `text` fields, etc.
- [ ] Map which fields are currently summarized only (ingress logs) vs. needed for fixtures. Confirm which fields must be preserved verbatim vs. sanitized.
- [ ] Decide capture trigger mechanism:
  - Proposed: `PROXY_CAPTURE_RESPONSES_TRANSCRIPTS=true` + optional `x-proxy-capture-id` header (edge-injected or manual) to name captures deterministically.
  - Default off; capture only when flag/header present.

### Phase 1 — Implement capture instrumentation (proxy-side)
- [ ] Add config flags in `src/config/index.js`:
  - `PROXY_CAPTURE_RESPONSES_TRANSCRIPTS` (boolean, default false).
  - `PROXY_CAPTURE_RESPONSES_DIR` (path, default `test-results/responses-copilot/raw` or `./tmp/responses-copilot`).
  - Optional allowlist for captured headers (e.g., `PROXY_CAPTURE_RESPONSES_HEADERS`).
- [ ] Create capture helper module (e.g., `src/handlers/responses/capture.js` or `src/lib/responses/capture.js`) with:
  - `sanitizeCopilotRequest(body, headers)` to strip secrets, remove binary payloads, and replace user text with placeholders when needed.
  - `sanitizeCopilotResponse(payload)` and `sanitizeCopilotStream(entries)` (mirror logic from `tests/shared/transcript-utils.js` without test imports).
  - `writeCapture({ scenarioId, request, response, stream, metadata })` to persist JSON to capture dir.
- [ ] Wire capture into:
  - `src/handlers/responses/nonstream.js` after response body is known.
  - `src/handlers/responses/stream-adapter.js` to accumulate outbound SSE chunks (parsed or raw) and flush on stream end.
  - Ensure capture can store `output_mode_effective`, `copilot_trace_id`, and ingress summary from `summarizeResponsesIngress`.
- [ ] Ensure capture is safe-by-default (no `Authorization`, `Cookie`, or user-identifiable content).

### Phase 2 — Capture runbook (manual or edge-injected)
- [ ] Add a short runbook (doc update) describing how to capture:
  - Enable `PROXY_CAPTURE_RESPONSES_TRANSCRIPTS=true`.
  - Optionally set `x-proxy-capture-id` at the edge for named scenarios (e.g., `copilot-responses-stream-tool`).
  - Use Copilot to generate at least two scenarios: non-stream text and stream with tool call.
- [ ] Validate raw captures are written and include:
  - Request body shape and sanitized headers.
  - For streaming: SSE event list that includes `response.created` -> deltas -> `response.completed` -> `[DONE]`.

### Phase 3 — Promote captures to fixtures
- [ ] Add a script (e.g., `scripts/normalize-copilot-responses-capture.mjs`) to:
  - Load raw capture JSONs from capture dir.
  - Sanitize/normalize IDs and timestamps consistently.
  - Write curated fixtures under `tests/fixtures/obsidian-copilot/responses/`.
  - Emit a `manifest.json` with scenario names, capture date, and proxy version.
- [ ] Keep fixtures small and anonymized; replace user content with placeholders where needed.

### Phase 4 — Tests that consume the fixtures
- [ ] Add unit test to validate request normalization does not drop Copilot fields:
  - Suggested: `tests/unit/responses.copilot.capture.spec.js`
  - Load fixture request; run through `coerceInputToChatMessages` and `resolveResponsesOutputMode`.
  - Assert the shape is accepted (no errors) and key flags are present.
- [ ] Add integration test to validate stream handling against fixture request:
  - Suggested: `tests/integration/responses.copilot.capture.int.test.js`
  - Spin server with fake codex; send fixture request; parse SSE; assert ordered events and presence of text blocks (including `<use_tool>` when output mode is `obsidian-xml`).
  - Use deterministic `FAKE_CODEX_MODE=tool_call` when fixture expects tools.
- [ ] (Secondary) Add a small note/fixture if Copilot falls back to `/v1/chat/completions`; keep it lightweight.

## Acceptance Criteria (ACs)
- [ ] AC1: At least two sanitized Copilot Responses captures exist as fixtures:
  - `responses-nonstream.json` (non-stream, text-only)
  - `responses-stream-tool.json` (stream, includes tool call / `<use_tool>` block)
- [ ] AC2: Fixtures include request body + sanitized headers + output mode + trace metadata.
- [ ] AC3: Unit test proves captured request shape passes proxy normalization without errors.
- [ ] AC4: Integration test proves streaming path returns valid SSE sequence and preserves `<use_tool>` in `obsidian-xml` mode.
- [ ] AC5: Capture instrumentation is off by default and does not log secrets or raw user content.

## Tests to Verify ACs
- [ ] Unit: `tests/unit/responses.copilot.capture.spec.js`
  - Load fixture; run `coerceInputToChatMessages` and `resolveResponsesOutputMode`.
  - Assert required fields/flags preserved.
- [ ] Integration: `tests/integration/responses.copilot.capture.int.test.js`
  - Send fixture request to `/v1/responses`.
  - Parse SSE with `parseSSE` (or equivalent); assert event ordering and `response.completed` exists.
- [ ] Optional e2e: reuse `tests/e2e/responses-contract.spec.js` to ensure fixture-based request does not regress current contract.

## Deliverables
- Capture feature flag + helper module.
- Capture runbook doc update.
- Sanitized fixtures under `tests/fixtures/obsidian-copilot/responses/`.
- Unit + integration tests tied to the fixtures.
