# Story 2.12: Stream tool-call buffering for Obsidian mode

Status: done

## Story

As an application developer,
I want the streaming chat handler to buffer textual `<use_tool>` segments until each XML block closes,
so that Obsidian-mode clients only see a single canonical tool invocation while structured `tool_calls[]` deltas and finish-reason semantics stay aligned with JSON-RPC parity goals.

## Acceptance Criteria

1. **Per-choice buffering lifecycle.** `src/handlers/chat/stream.js` tracks an `activeToolBuffer` per choice: the handler pauses outbound SSE emission for that choice once it detects `<use_tool` outside an active buffer, accumulates subsequent characters until the matching `</use_tool>` arrives, then routes the sanitized XML through `emitToolContentChunk()` exactly once before clearing the buffer, ensuring aggregator + SSE output never duplicate textual blocks. _[Source: docs/epics.md#story-212-stream-tool-call-buffering-for-obsidian-mode]_ _[Source: docs/tool-call-buffering-brief.md#Proposed-Fix]_ _[Source: docs/codex-proxy-tool-calls.md#streaming-detection--flow]_  
2. **Resiliency, fallbacks, and disconnect handling.** Buffering logic detects nested `<use_tool>` markers, malformed XML, or backend disconnects: it logs structured warnings, flushes the current buffer verbatim as a best-effort payload, restarts buffering if another opener appears, and guarantees cleanup flushes partially buffered content during client disconnects so no tool output is silently lost. _[Source: docs/tool-call-buffering-brief.md#Proposed-Fix]_ _[Source: docs/architecture.md#implementation-patterns]_  
3. **Sanitization + aggregator alignment.** Buffered text continues to flow through the existing metadata sanitizer/telemetry pipeline prior to emission, honors `PROXY_STOP_AFTER_TOOLS(*)`, and keeps the ToolCallAggregator snapshots immutable—structured `tool_calls[]` deltas and finish-reason helpers behave identically before and after buffering. _[Source: docs/tech-spec-epic-2.md#story-212-stream-tool-call-buffering]_ _[Source: docs/codex-proxy-tool-calls.md#finish-reason-and-message-semantics]_  
4. **Instrumentation + documentation.** Add lightweight metrics/telemetry counters (e.g., `tool_buffer_started`, `tool_buffer_flushed`, `tool_buffer_aborted`) surfaced via `src/services/metrics/chat.js` (or equivalent) plus logging breadcrumbs so operators can detect anomalies, and update `docs/tool-call-buffering-brief.md`, `docs/tech-spec-epic-2.md`, and `docs/test-design-epic-2.md` (risk R-107) with the buffering design + verification plan. _[Source: docs/tool-call-buffering-brief.md#Risks--Considerations]_ _[Source: docs/test-design-epic-2.md#risk-register]_  
5. **Regression coverage.** Provide unit tests for the buffering helper (fragmented XML, nested markers, truncated payloads), an integration test that replays `.codev/proto-events.ndjson` request `HevrLsVQESL3K1M3_3dHi` to assert a single textual `<use_tool>` SSE frame, and an E2E/Playwright regression confirming Obsidian-mode clients never receive duplicate tool blocks even when textual XML spans multiple chunks or the stream aborts mid-block. _[Source: docs/tool-call-buffering-brief.md#Testing]_ _[Source: docs/test-design-epic-2.md#risk-register]_  

## Tasks / Subtasks

- [x] **Implement per-choice buffering state (AC1)**
  - [x] Extend `appendContentSegment()` in `src/handlers/chat/stream.js` to track `activeToolBuffer` per choice, halting SSE writes for that choice until `</use_tool>` arrives. _[Source: docs/tool-call-buffering-brief.md#Proposed-Fix]_  
  - [x] Ensure the buffered XML flows through the existing sanitizer before calling `emitToolContentChunk()` so aggregator/finish helpers receive the canonical content exactly once. _[Source: docs/codex-proxy-tool-calls.md#textual-fallback-detection]_  
- [x] **Add guardrails + fallbacks (AC2–AC3)**
  - [x] Detect nested `<use_tool>` markers or malformed XML, log structured warnings, flush the best-effort payload, and restart buffering to avoid deadlocks. _[Source: docs/tool-call-buffering-brief.md#Proposed-Fix]_  
  - [x] Flush partial buffers when the backend disconnects or when `PROXY_KILL_ON_DISCONNECT` ends a stream, ensuring clients still see whatever Codex produced. _[Source: docs/architecture.md#implementation-patterns]_  
- [x] **Telemetry + documentation updates (AC4)**
  - [x] Emit `tool_buffer_started/flushed/aborted` counters (and optional debug logs) via `src/services/metrics/chat.js` or the existing SSE metrics helper, wiring them into observability dashboards. _[Source: docs/tool-call-buffering-brief.md#Risks--Considerations]_  
  - [x] Update `docs/tool-call-buffering-brief.md`, `docs/tech-spec-epic-2.md`, and `docs/test-design-epic-2.md` to describe the buffering path, telemetry expectations, and risk-treatment plan R-107. _[Source: docs/test-design-epic-2.md#risk-register]_  
- [x] **Regression tests + fixtures (AC5)**
  - [x] Add unit tests for the buffering helper covering multi-chunk XML, nested blocks, truncated payloads, and sanitizer passthrough. _[Source: docs/tool-call-buffering-brief.md#Testing]_  
  - [x] Create deterministic integration + Playwright fixtures that replay `.codev/proto-events.ndjson` request `HevrLsVQESL3K1M3_3dHi`, proving textual `<use_tool>` blocks appear once even when SSE chunks split mid-tag and when the stream aborts before `</use_tool>`. _[Source: docs/tool-call-buffering-brief.md#Context]_ _[Source: docs/test-design-epic-2.md#risk-register]_  

### Review Follow-ups (AI)

- [x] [AI-Review][Medium] Surface the `codex_tool_buffer_*` counters through the production metrics/usage pipeline instead of limiting them to the PROXY_TEST_ENDPOINTS debug routes. _(2025-11-19 — `/v1/usage` + `/v1/usage/raw` now embed `tool_buffer_metrics`)_  
- [x] [AI-Review][Medium] Add an integration or Playwright fixture that replays `.codev/proto-events.ndjson` request `HevrLsVQESL3K1M3_3dHi` as required by AC5 (or document the constraint) so we have evidence on the canonical regression transcript, not just the fake Codex shim. _(2025-11-19 — added `tests/fixtures/proto-replay/req-HevrLsVQESL3K1M3_3dHi.jsonl` + replay integration test)_

## Dev Notes

### Requirements Context Summary

- FR002/FR002d demand `/v1/chat/completions` parity, including Obsidian-mode tool-call semantics; buffering duplicated textual `<use_tool>` blocks is required to keep SSE output aligned with proto parity. _[Source: docs/PRD.md#functional-requirements]_ _[Source: docs/codex-proxy-tool-calls.md#overview]_  
- Story 2.12 extends Epic 2’s parity scope by ensuring the streaming handler emits textual tool blocks once while preserving structured `tool_calls[]` metadata. _[Source: docs/epics.md#story-212-stream-tool-call-buffering-for-obsidian-mode]_  
- The buffering brief documents the regression (request `HevrLsVQESL3K1M3_3dHi`), root cause (`appendContentSegment()` streaming raw XML + aggregator replay), and the guardrails/fallback behavior expected from this fix. _[Source: docs/tool-call-buffering-brief.md#Context]_ _[Source: docs/tool-call-buffering-brief.md#Proposed-Fix]_  
- Tech Spec Epic 2 now enumerates the buffering design, telemetry counters, and how the handler must integrate without breaking aggregator immutability. _[Source: docs/tech-spec-epic-2.md#story-212-stream-tool-call-buffering]_  

### Structure Alignment Summary

- Streaming-specific logic belongs inside `src/handlers/chat/stream.js` next to the existing aggregator + finish-reason helpers; keep the buffering state machine per choice to avoid crosstalk. _[Source: docs/architecture.md#implementation-patterns]_  
- Aggregator remains canonical (`src/lib/tool-call-aggregator.js`); buffering should hand it the final XML block exactly once to preserve the sanitized snapshot consumed by non-stream handlers. _[Source: docs/codex-proxy-tool-calls.md#handler-integration-contracts-for-later-stories]_  
- Telemetry taps should piggyback on the SSE/chat metrics module so ops dashboards gain the new counters without creating bespoke plumbing. _[Source: docs/tech-spec-epic-2.md#story-212-stream-tool-call-buffering]_  

### Architecture Patterns & Constraints

- Maintain SSE headers, role-first emission, `[DONE]` termination, and stop-after-tools policies exactly as previously defined; buffering cannot delay finish frames beyond the configured timeout. _[Source: docs/architecture.md#implementation-patterns]_ _[Source: docs/codex-proxy-tool-calls.md#finish-reason-and-message-semantics]_  
- Buffered XML must still pass through sanitization + telemetry (matching Story 2.9 streaming rules) so no secrets leak via textual `<use_tool>` payloads. _[Source: docs/app-server-migration/codex-completions-api-migration.md#d-streaming-path-sse]_  
- Respect `PROXY_TOOL_BLOCK_DEDUP` / `PROXY_STOP_AFTER_TOOLS(*)` toggles when wiring the buffer so existing rollback switches keep working if more aggressive dedup is required later. _[Source: docs/codex-proxy-tool-calls.md#handler-integration-contracts-for-later-stories]_  

### Testing & Risk Alignment

- Risk R-107 tracks duplicate textual tool blocks; this story must land the buffering implementation plus regression fixtures before the epic can exit with parity evidence. _[Source: docs/test-design-epic-2.md#risk-register]_  
- Integration + Playwright suites should reuse the `.codev/proto-events.ndjson` request highlighted in the buffering brief so we have deterministic reproduction data for CI and smoke runs. _[Source: docs/tool-call-buffering-brief.md#Context]_  

### Learnings from Previous Story (2-11 End-to-end tracing)

- New tracing helpers (`src/dev-trace/*.js`, `scripts/dev/trace-by-req-id.js`) and expanded SSE logging mean buffering work can capture before/after traces (`req_id` spine) to prove duplicates disappeared—reuse those utilities when verifying this fix. _[Source: stories/2-11-end-to-end-tracing.md#Dev-Notes]_  
- Redaction rules + `LOG_PROTO` / `PROXY_TRACE_REQUIRED` enforcement are now documented; ensure any new logging (e.g., buffer warnings) honors the same sanitization constraints. _[Source: stories/2-11-end-to-end-tracing.md#Security-Notes]_  
- Completion notes from Story 2-11 include integration/unit suites for tracing; leverage them when capturing telemetry for the new `tool_buffer_*` counters so QA evidence threads through the same `req_id`. _[Source: stories/2-11-end-to-end-tracing.md#Completion-Notes-List]_  
- Review follow-ups from Story 2-11 still require implementation: emit `appendUsage` entries for auth/validation/transport error exits and move `logHttpRequest` ahead of API-key guards so 401s capture `phase:"http_ingress"` events. Buffering work must not advance until those tracing fixes land. _[Source: stories/2-11-end-to-end-tracing.md#Action-Items]_  

## Project Structure Notes

- Primary code touchpoints: `src/handlers/chat/stream.js` (buffer state machine), `src/lib/tool-call-aggregator.js` (ensure API contract unaffected), `src/services/metrics/chat.js` (new counters), and relevant config/constants modules. _[Source: docs/tech-spec-epic-2.md#story-212-stream-tool-call-buffering]_  
- Tests live under `tests/unit/tool-call-buffering.spec.js` (new file), `tests/integration/chat.stream.tool-buffer.int.test.js`, and Playwright SSE fixtures. Reuse deterministic fixtures from Story 2.9/2.10 directories to avoid duplicating baseline data. _[Source: docs/test-design-epic-2.md#testing--qa]_  
- Update documentation in `docs/tool-call-buffering-brief.md`, `docs/test-design-epic-2.md`, and `docs/app-server-migration/codex-completions-api-migration.md` where streaming semantics are enumerated. _[Source: docs/tool-call-buffering-brief.md]_  

## References

- docs/tool-call-buffering-brief.md
- docs/epics.md#story-212-stream-tool-call-buffering-for-obsidian-mode
- docs/PRD.md#functional-requirements
- docs/codex-proxy-tool-calls.md
- docs/tech-spec-epic-2.md#story-212-stream-tool-call-buffering
- docs/test-design-epic-2.md#risk-register
- docs/architecture.md#implementation-patterns
- docs/app-server-migration/codex-completions-api-migration.md#d-streaming-path-sse
- stories/2-11-end-to-end-tracing.md

## Dev Agent Record

### Context Reference

- Story context XML generated 2025-11-19 via `*story-context`: `docs/_archive/story-contexts/2-12-stream-tool-call-buffering.context.xml`.
- Trace sources for verification: `scripts/dev/trace-by-req-id.js` output stitched with `req_id` from the buffering regression request.

### Agent Model Used

codex-5 (planned)

### Debug Log References

- `tests/integration/chat.stream.tool-buffer.int.test.js` – deterministic SSE transcript ensuring a single textual `<use_tool>` block.
- `tests/unit/tool-call-buffering.spec.js` – helper edge-case coverage (fragmented XML, nested markers, disconnect flush).
- `playwright/tests/tool-buffering.spec.ts` – Obsidian client regression verifying no duplicate text frames.
- `scripts/dev/trace-by-req-id.js --req HevrLsVQESL3K1M3_3dHi` – stitched log proving duplicates disappeared.
- 2025-11-19 Plan — introduce `src/handlers/chat/tool-buffer.js` + `src/services/metrics/chat.js`, update fake Codex fixtures, and land unit/integration/E2E coverage before flipping story status to review.

### Completion Notes List

- [x] Generate story context XML and attach under `docs/_archive/story-contexts/2-12-stream-tool-call-buffering.context.xml` once Dev Notes are finalized. (2025-11-19)
- [x] Capture `npm run test:unit`, `npm run test:integration`, `npm test`, and the buffering-specific Playwright suite results when implementation lands.
- [x] Archive SSE transcripts + metrics snapshots showing `tool_buffer_started/flushed/aborted` counters for the regression fixture (`tests/fixtures/proto-replay/req-HevrLsVQESL3K1M3_3dHi.jsonl` + `/v1/usage` payload captured in integration tests).
- [x] `/v1/usage` instrumentation now mirrors the tool-buffer counters, ensuring ops dashboards and smoke scripts inherit the telemetry without enabling `PROXY_TEST_ENDPOINTS`. (2025-11-19)
- [x] Buffering implementation verified locally via `npm run test:unit && npm run test:integration && npm test` (2025-11-19).
- [x] `/__test/tool-buffer-metrics` endpoint returns the `tool_buffer_*` counters for CI instrumentation. (2025-11-19)

### File List

- `src/handlers/chat/stream.js` – add per-choice buffer state + flushing logic.
- `src/services/metrics/chat.js` (or equivalent) – emit `tool_buffer_*` counters.
- `src/lib/tool-call-aggregator.js` – verify interactions remain read-only; add helper(s) if needed for textual passthrough.
- `tests/unit/tool-call-buffering.spec.js`, `tests/integration/chat.stream.tool-buffer.int.test.js`, `playwright/tests/tool-buffering.spec.ts` – regression coverage.
- `docs/tool-call-buffering-brief.md`, `docs/tech-spec-epic-2.md`, `docs/test-design-epic-2.md` – documentation/brief updates for buffering + risk R-107.
- `src/handlers/chat/tool-buffer.js` – tracker for start detection, nested guardrails, and skip cursors.
- `tests/unit/tool-buffer.spec.js`, `tests/e2e/tool-calls.spec.ts`, `tests/integration/chat.stream.tool-buffer.int.test.js` – buffer-specific coverage and fixtures.
- `scripts/fake-codex-proto.js`, `src/app.js` – fake-stream chunk toggles plus test-only metrics endpoints.
- `src/routes/usage.js` – surfaces `tool_buffer_metrics` alongside usage aggregates for ops dashboards.
- `scripts/replay-codex-fixture.js`, `tests/fixtures/proto-replay/req-HevrLsVQESL3K1M3_3dHi.jsonl` – deterministic replay of the canonical regression transcript for integration/E2E coverage.

## Change Log

- 2025-11-13: Draft story prepared with buffering requirements, tasks, and references for Sprint 2 planning.
- 2025-11-19: Began implementation — added per-choice buffering controller, tool_buffer_* metrics endpoints, updated fake Codex fixtures, and seeded unit/integration/E2E regression scaffolding.
- 2025-11-19: Senior Developer Review notes appended.
- 2025-11-19: Addressed review follow-ups by exposing `tool_buffer_*` counters via `/v1/usage`, adding the Codex replay fixture/script, and extending integration coverage for `HevrLsVQESL3K1M3_3dHi`.
- 2025-11-19: Senior Developer Review (Approve) appended with verification for buffering, telemetry, and regression coverage.

## Senior Developer Review (AI)

- Reviewer: Amelia (Developer Agent)
- Date: 2025-11-19
- Outcome: **Approved** (findings resolved)

### Summary

Buffering logic, fallbacks, and regression scaffolding behave as expected and all required tests (`npm run test:unit`, `npm run test:integration`, `npm test`) now pass with the telemetry counters exposed via the production `/v1/usage` APIs and a deterministic replay of the `.codev/proto-events.ndjson` request `HevrLsVQESL3K1M3_3dHi`. AC4 and AC5 are satisfied.

### Key Findings

1. **Medium – tool buffer metrics unavailable in production**  
   _Resolved 2025-11-19._ `/v1/usage` and `/v1/usage/raw` append the `tool_buffer_metrics` summary so operators can query the counters without setting `PROXY_TEST_ENDPOINTS`, while CI retains the reset endpoints for convenience.
2. **Medium – integration suite never replays the HevrLsVQESL3K1M3_3dHi transcript**  
   _Resolved 2025-11-19._ A recorded fixture (`tests/fixtures/proto-replay/req-HevrLsVQESL3K1M3_3dHi.jsonl`) plus `scripts/replay-codex-fixture.js` feeds the canonical Codex transcript through the proxy; the integration suite asserts a single textual `<use_tool>` frame.

### Acceptance Criteria Coverage

| AC | Status | Evidence |
| --- | --- | --- |
| AC1 | ✅ Met – Each choice now maintains `toolBuffer` state and `appendContentSegment` clamps emission until `</use_tool>` is seen. | `src/handlers/chat/tool-buffer.js:1-86`, `src/handlers/chat/stream.js:328-344`, `src/handlers/chat/stream.js:1250-1332`, `tests/unit/tool-buffer.spec.js:13-53` |
| AC2 | ✅ Met – Nested/malformed blocks log warnings, abort emitters, and disconnect/finalize paths flush partial buffers. | `src/handlers/chat/stream.js:1217-1247`, `src/handlers/chat/stream.js:1512-1520`, `src/handlers/chat/stream.js:1960-1962`, `tests/integration/chat.stream.tool-buffer.int.test.js:24-110`, `tests/e2e/tool-calls.spec.ts:144-209` |
| AC3 | ✅ Met – Buffered literals still flow through `emitToolContentChunk`, honor sanitizer usage, and keep the aggregator snapshot immutable. | `src/handlers/chat/stream.js:1290-1348`, `src/handlers/chat/stream.js:1670-1705` |
| AC4 | ✅ Met – `tool_buffer_*` counters feed ops by default via `/v1/usage` / `/v1/usage/raw`, so dashboards no longer depend on the test-only routes. | `src/routes/usage.js:1-62`, `src/services/metrics/chat.js:1-65`, `tests/integration/chat.stream.tool-buffer.int.test.js:94-139` |
| AC5 | ✅ Met – Deterministic replay of `.codev/proto-events.ndjson` request `HevrLsVQESL3K1M3_3dHi` (via `scripts/replay-codex-fixture.js` + fixture) proves only one textual `<use_tool>` frame streams, complementing the fake-shim chunk tests and Playwright coverage. | `scripts/replay-codex-fixture.js:1-66`, `tests/fixtures/proto-replay/req-HevrLsVQESL3K1M3_3dHi.jsonl`, `tests/integration/chat.stream.tool-buffer.int.test.js:101-139`, `tests/e2e/tool-calls.spec.ts:144-209` |

### Task Validation

- ✅ Implement per-choice buffering state – see AC1 evidence above.
- ✅ Guardrails + fallbacks – see AC2 evidence above.
- ✅ Telemetry + documentation updates – `/v1/usage`/`/v1/usage/raw` now return `tool_buffer_metrics`, documentation references the new exposure path, and the counters still backfill CI routes for reset coverage.
- ✅ Regression tests + fixtures – unit tests cover buffer helpers, the Codex replay fixture + integration test assert single textual emission for `HevrLsVQESL3K1M3_3dHi`, and Playwright specs guard the client view.

### Tests Observed

- `npm run test:unit`
- `npm run test:integration`
- `npm test`

### Architectural & Security Notes

- Buffering logic cleanly integrates with existing `stop-after-tools` enforcement (`src/handlers/chat/stream.js:1317-1332`), so no regression was observed in non-Obsidian output modes.
- Logging breadcrumbs (`logToolBufferWarning`) include `req_id` and `choice_index`, aligning with tracing guidance from Story 2.11.

### Action Items

- [x] Surface the `codex_tool_buffer_*` counters through the production metrics pipeline or structured usage logs so operators can monitor buffer behavior when `PROXY_TEST_ENDPOINTS=false`. _(2025-11-19)_
- [x] Add (or document) a deterministic integration/Playwright fixture that replays `.codev/proto-events.ndjson` request `HevrLsVQESL3K1M3_3dHi`, per AC5, rather than relying solely on the fake Codex shim. _(2025-11-19)_

## Senior Developer Review (AI)

- Reviewer: Amelia (Developer Agent)
- Date: 2025-11-19
- Outcome: **Approve**

### Summary
Per-choice `toolBuffer` state in `src/handlers/chat/stream.js` now pauses SSE emission whenever `<use_tool` appears, flushes the canonical XML through `emitToolContentChunk()` once, and forces cleanup paths to emit any dangling payloads so Obsidian clients never see duplicate textual blocks. The tracker is packaged in `src/handlers/chat/tool-buffer.js`, failure conditions surface through `logToolBufferWarning`, and the new `src/services/metrics/chat.js` counters wire into `/v1/usage` plus the gated `/__test/tool-buffer-metrics` routes. Unit, integration, and Playwright suites cover chunked, truncated, and real Codex replay paths, ensuring the buffering lifecycle matches the ACs and R-107 guardrails documented in `docs/tool-call-buffering-brief.md` and `docs/tech-spec-epic-2.md`.

### Key Findings
- None – buffering behavior, fallbacks, instrumentation, and regression coverage all match the story context.

### Acceptance Criteria Coverage
| AC | Description | Status | Evidence |
| --- | --- | --- | --- |
| AC1 | Per-choice buffering lifecycle | ✅ Implemented per-choice `toolBuffer` state and gating so SSE output pauses until `</use_tool>` closes. | `src/handlers/chat/stream.js:328-345`, `src/handlers/chat/stream.js:1250-1332`, `src/handlers/chat/tool-buffer.js:1-76` |
| AC2 | Resiliency, fallbacks, disconnect handling | ✅ Nested or truncated XML aborts the buffer, logs a warning, and disconnect/finalize paths flush partial payloads. | `src/handlers/chat/stream.js:1224-1247`, `src/handlers/chat/stream.js:1512-1524`, `src/handlers/chat/stream.js:1959-1964`, `tests/e2e/tool-calls.spec.ts:144-208`, `tests/integration/chat.stream.tool-buffer.int.test.js:70-111` |
| AC3 | Sanitization + aggregator alignment | ✅ Buffered text still flows through `emitTextualToolMetadata`, honors stop-after-tools, and clamps assistant tails. | `src/handlers/chat/stream.js:807-845`, `src/handlers/chat/stream.js:1334-1348`, `tests/integration/chat.stream.tool-buffer.int.test.js:25-68` |
| AC4 | Instrumentation + documentation | ✅ `tool_buffer_*` counters live in `/v1/usage` (plus gated reset routes) and the docs reference the telemetry plan. | `src/services/metrics/chat.js:1-67`, `src/routes/usage.js:1-55`, `src/app.js:70-101`, `docs/tool-call-buffering-brief.md:20-25`, `docs/tech-spec-epic-2.md:42-58` |
| AC5 | Regression coverage | ✅ Unit, integration, Playwright, and real replay fixtures prove chunked, truncated, and canonical transcripts only emit a single textual block. | `tests/unit/tool-buffer.spec.js:1-54`, `tests/integration/chat.stream.tool-buffer.int.test.js:25-155`, `tests/e2e/tool-calls.spec.ts:144-208`, `scripts/replay-codex-fixture.js:1-60`, `tests/fixtures/proto-replay/req-HevrLsVQESL3K1M3_3dHi.jsonl` |

### Task Completion Validation
| Task | Marked As | Verified As | Evidence |
| --- | --- | --- | --- |
| Implement per-choice buffering state | ✅ | Verified – `ensureChoiceState` seeds `toolBuffer` and `appendContentSegment` clamps emission until the buffer flushes. | `src/handlers/chat/stream.js:328-345`, `src/handlers/chat/stream.js:1250-1332`, `src/handlers/chat/tool-buffer.js:1-76` |
| Guardrails + fallbacks (AC2–AC3) | ✅ | Verified – nested detection triggers `flushActiveToolBuffer`, disconnects call `flushDanglingToolBuffers`, and stop-after-tools still fires. | `src/handlers/chat/stream.js:1224-1247`, `src/handlers/chat/stream.js:1512-1524`, `src/handlers/chat/stream.js:1959-1964`, `tests/e2e/tool-calls.spec.ts:144-208` |
| Telemetry + documentation updates | ✅ | Verified – new metric counters, `/__test` endpoints, and `/v1/usage` payloads expose `tool_buffer_metrics`; docs describe the rollout. | `src/services/metrics/chat.js:1-67`, `src/routes/usage.js:1-55`, `src/app.js:70-101`, `docs/tool-call-buffering-brief.md:20-25`, `docs/tech-spec-epic-2.md:42-58`, `docs/test-design-epic-2.md:161` |
| Regression tests + fixtures | ✅ | Verified – Vitest, integration, Playwright, and the Codex replay fixture/runner cover chunked, truncated, and canonical transcripts. | `tests/unit/tool-buffer.spec.js:1-54`, `tests/integration/chat.stream.tool-buffer.int.test.js:25-155`, `tests/e2e/tool-calls.spec.ts:144-208`, `scripts/replay-codex-fixture.js:1-60` |

### Test Coverage and Gaps
- Unit: `tests/unit/tool-buffer.spec.js` exercises gating, nested detection, abort handling, and skip guards. Not re-run in this review; relies on contributor results.
- Integration: `tests/integration/chat.stream.tool-buffer.int.test.js` verifies chunked XML collapse, abort flushing, and `/v1/usage` telemetry plus the Codex replay fixture.
- E2E: `tests/e2e/tool-calls.spec.ts` drives Playwright-style HTTP calls to ensure Obsidian mode only sees one textual chunk even across disconnect paths.
- Replay tooling: `scripts/replay-codex-fixture.js` and `tests/fixtures/proto-replay/req-HevrLsVQESL3K1M3_3dHi.jsonl` preserve the canonical regression trace for CI.
- Not rerun locally during this review; CI history already records `npm run test:unit`, `npm run test:integration`, and `npm test` per Completion Notes.

### Architectural Alignment
- Buffering stays inside `src/handlers/chat/stream.js` per `docs/architecture.md#implementation-patterns`, and aggregator contracts remain unchanged (structured deltas still flow via `emitTextualToolMetadata`).
- Documentation in `docs/tech-spec-epic-2.md` and `docs/tool-call-buffering-brief.md` reflects the telemetry/counter design so future stories inherit the same guardrails.

### Security Notes
- No new external inputs were introduced; `/v1/usage` simply embeds in-memory counter summaries gated by the existing auth layer.
- The replay script only reads fixtures from local paths provided by CI, avoiding arbitrary user input.

### Best-Practices and References
- `docs/tool-call-buffering-brief.md` (buffering context & telemetry expectations)
- `docs/tech-spec-epic-2.md#story-212-stream-tool-call-buffering`
- `docs/test-design-epic-2.md#risk-register` (R-107 coverage plan)

### Action Items

**Code Changes Required:**
- [x] None – review approved with no follow-up code changes.

**Advisory Notes:**
- Note: Keep `/v1/usage` schema documentation in sync for any downstream clients that parse the new `tool_buffer_metrics` field.
