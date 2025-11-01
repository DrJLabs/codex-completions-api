# Story 2.4: Align error handling and retries

Status: done

## Story

As an operator,
I want deterministic error translation and retry mechanisms,
so that clients encounter the same HTTP codes and retry hints as before.

## Acceptance Criteria

1. JSON-RPC transport and worker errors return the existing OpenAI-compatible error envelope with matching HTTP status codes (429, 500, 503, 504) and retryable hints so app-server parity is indistinguishable from proto. [Source: docs/epics.md:219-229][Source: docs/tech-spec-epic-2.md:74-78][Source: docs/architecture.md:137-155]
2. Request, handshake, and worker timeouts continue to honor the documented exponential backoff/retry policy, including readiness gating and retryable signals for supervisors. [Source: docs/epics.md:225-229][Source: docs/tech-spec-epic-2.md:95-99][Source: docs/app-server-migration/codex-completions-api-migration.md:109-115]
3. Deterministic integration coverage exercises CLI/worker failure paths (handshake failure, request timeout, worker exit) and verifies response parity including retryable flags and status codes. [Source: docs/epics.md:225-229][Source: docs/test-design-epic-2.md:67-84][Source: docs/stories/2-3-implement-streaming-response-adapter.md:96-104]

## Tasks / Subtasks

- [x] Map JSON-RPC error results and transport failures to the existing error envelope and status codes by extending `mapTransportError` and related handlers. (AC: #1) [Source: docs/tech-spec-epic-2.md:74-78][Source: docs/architecture.md:137-155]
  - [x] Cover worker busy/unavailable, handshake failure, and timeout codes, ensuring retryable hints mirror proto behavior. [Source: docs/app-server-migration/codex-completions-api-migration.md:109-115][Source: docs/epics.md:219-229]
  - [x] Add regression assertions in `tests/integration/chat-jsonrpc.int.test.js` verifying 429/503/504 responses include the correct `retryable` flag and message. [Source: docs/test-design-epic-2.md:67-84]
- [x] Reaffirm supervisor/backoff integration so request and handshake timeouts emit retryable signals while preserving readiness gating. (AC: #2) [Source: docs/tech-spec-epic-2.md:95-99][Source: docs/PRD.md:37-42]
  - [x] Exercise restart/backoff paths manually or via harness to confirm readiness flips and retry budget logging. [Source: docs/app-server-migration/codex-completions-api-migration.md:133-169]
  - [x] Extend integration coverage (or targeted harness) to simulate handshake timeout and assert retry guidance is emitted. [Source: docs/test-design-epic-2.md:67-84]
- [x] Extend `tests/integration/chat-jsonrpc.int.test.js` (and supporting fixtures) with deterministic negative-path cases for CLI/worker errors. (AC: #3) [Source: docs/test-design-epic-2.md:67-84][Source: docs/stories/2-3-implement-streaming-response-adapter.md:96-104]
  - [x] Capture assertions for status codes, error bodies, and `retryable` flags across timeout, worker exit, and transport failure scenarios. [Source: docs/epics.md:225-229]
  - [x] Ensure failure fixtures document retry budget behaviour and readiness gating so future parity checks remain deterministic. [Source: docs/app-server-migration/codex-completions-api-migration.md:133-169]

### Review Follow-ups (AI)

- [x] [AI-Review][High] Restore non-retryable handling for `app_server_disabled` mapping (AC #1) [file: src/services/transport/index.js:750]
- [x] [AI-Review][Medium] Preserve worker error message detail when mapping `worker_error` results (AC #1) [file: src/services/transport/index.js:763]

## Dev Notes

- Extend `src/services/transport/index.js` and chat handlers to map JSON-RPC transport errors into the existing OpenAI-compatible envelope and status codes, preserving retryable hints for busy/unavailable/timeout cases. [Source: docs/tech-spec-epic-2.md:74-78][Source: src/services/transport/index.js]
- Tie implementation guidance directly to Epic 2 objectives and FR004 so operator expectations remain aligned with retry semantics. [Source: docs/epics.md:219-229][Source: docs/PRD.md:31-42]
- Ensure supervisor/backoff watchdogs continue to gate readiness and emit retry signals when the worker restarts or handshakes fail, leveraging architecture rules around exponential backoff and maintenance responses. [Source: docs/tech-spec-epic-2.md:95-99][Source: docs/app-server-migration/codex-completions-api-migration.md:133-169]
- Reference architecture constraints (error middleware, maintenance flag) when updating handlers so parity with proto clients remains intact. [Source: docs/architecture.md:137-155]
- Reuse existing deterministic integration harness (`tests/integration/chat-jsonrpc.int.test.js`) to cover negative-path scenarios (handshake failure, worker exit, request timeout) so parity evidence remains authoritative. [Source: docs/test-design-epic-2.md:67-84][Source: docs/stories/2-3-implement-streaming-response-adapter.md:96-104]

### Learnings from Previous Story

- **Reuse streaming adapter instrumentation:** `handleStreamingResponse` already brokers SSE emissions; extend its error hooks rather than introducing new plumbing. [Source: stories/2-3-implement-streaming-response-adapter.md#Completion Notes List]
- **Existing test harness:** `tests/integration/chat-jsonrpc.int.test.js` provides deterministic fixtures—add negative cases alongside existing parity tests to avoid drift. [Source: stories/2-3-implement-streaming-response-adapter.md#Completion Notes List]
- **Touched modules:** Expect to revisit `src/handlers/chat/stream.js`, `tests/integration/chat-jsonrpc.int.test.js`, and `tests/shared/transcript-utils.js` when broadening error coverage. [Source: stories/2-3-implement-streaming-response-adapter.md#File List]
- **Outstanding follow-ups:** No review action items remain from Story 2.3, so focus is on aligning error behaviour. [Source: stories/2-3-implement-streaming-response-adapter.md#Action Items]
- **Warnings/technical debt:** No new warnings or technical debt were flagged in Story 2.3, so this story can concentrate on parity work without cleanup dependencies. [Source: stories/2-3-implement-streaming-response-adapter.md#Completion Notes List]

### Project Structure Notes

- Keep error-alignment work in the JSON-RPC transport (`src/services/transport/index.js`) and chat handlers so app-server parity stays aligned with the architecture layering. [Source: docs/tech-spec-epic-2.md:36-40]
- Cross-check changes against central error middleware and maintenance flag routes before merging to avoid regressions. [Source: docs/architecture.md:137-155]
- Document any deviations in this story file and ensure references point to the authoritative epics, PRD, and tech-spec sections. [Source: docs/epics.md:219-229]

### References

- docs/epics.md#Story 2.4: Align error handling and retries
- docs/PRD.md#Functional Requirements
- docs/tech-spec-epic-2.md#Workflows and Sequencing
- docs/architecture.md#Error Handling
- docs/app-server-migration/codex-completions-api-migration.md#G. Concurrency & timeouts
- docs/test-design-epic-2.md#Test Coverage Plan
- src/services/transport/index.js
- stories/2-3-implement-streaming-response-adapter.md

## Dev Agent Record

### Context Reference

- docs/stories/2-4-align-error-handling-and-retries.context.xml

### Agent Model Used

codex-5 (Developer Agent TBD)

### Debug Log References

- 2025-11-02T18:02Z — `npm run test:integration -- --reporter=dot`
- 2025-11-02T18:04Z — `npm test -- --reporter=dot`

### Completion Notes List

- AC #1: Consolidated transport error mapping for handshake, busy, exit, and timeout codes in `src/services/transport/index.js`, preserving retryable hints and status parity.
- AC #1/#3: Extended `scripts/fake-codex-jsonrpc.js` to simulate handshake timeouts, worker crashes, and busy signals for deterministic parity validation.
- AC #3: Added JSON-RPC error parity coverage in `tests/integration/chat-jsonrpc.int.test.js`, exercising worker_busy, handshake timeout, request timeout, and worker exit paths with readiness polling via `/readyz`.
- AC #2/#3: Test evidence recorded in Debug Log (`npm run test:integration -- --reporter=dot`, `npm test -- --reporter=dot`) confirming readiness gating and retry guidance remain intact.
- AC #1: Restored non-retryable handling for disabled app-server mode and preserved worker error messages (`src/services/transport/index.js:701-825`).

### File List

- src/services/transport/index.js
- scripts/fake-codex-jsonrpc.js
- tests/integration/chat-jsonrpc.int.test.js
- tests/unit/services/json-rpc-transport.spec.js
- docs/sprint-status.yaml
- docs/stories/2-4-align-error-handling-and-retries.md

## Change Log

- [x] 2025-11-01: Draft created via Scrum Master workflow.
- [x] 2025-11-01: Updated to address validation findings (continuity, citations, testing subtasks).
- [x] 2025-11-02: Implementation validated via developer workflow and ready for review (AC #1-#3).
- [x] 2025-11-02: Senior Developer Review notes appended (changes requested).
- [x] 2025-11-02: Review follow-ups resolved and story resubmitted for review.

## Senior Developer Review (AI)

**Reviewer:** drj  
**Date:** 2025-11-02  
**Outcome:** Changes Requested — address the action items before re-submitting for review.

### Summary

- Expanded error mapping and deterministic integration tests improve parity coverage, but the new `app_server_disabled` mapping now returns a retryable 503 for a non-retryable configuration error (`src/services/transport/index.js:750`).
- Worker error mapping now overwrites the worker-provided message, obscuring diagnostics clients previously received (`src/services/transport/index.js:763`).
- Tests `npm run test:integration -- --reporter=dot` and `npm test -- --reporter=dot` passed, exercising the new failure-path coverage recorded in the Debug Log.

### Key Findings

- **High:** `app_server_disabled` errors are now marked retryable and return 503, contradicting the original non-retryable 500 response. Clients will loop retries when the app-server backend is disabled (`src/services/transport/index.js:750`, `src/services/transport/index.js:682`).
- **Medium:** Mapping `worker_error` now replaces the worker's detailed message with a generic string, reducing diagnosability for operators and parity with proto responses (`src/services/transport/index.js:763`).

### Acceptance Criteria Coverage

| AC  | Description                                                               | Status                                                     | Evidence                                                                                           |
| --- | ------------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| AC1 | Map JSON-RPC errors to the OpenAI envelope with correct codes/retry hints | ⚠️ Not Met – retryable hint regresses for disabled backend | `src/services/transport/index.js:750`, `src/services/transport/index.js:682`                       |
| AC2 | Timeouts honor exponential backoff and readiness gating                   | ✅ Met                                                     | `tests/integration/chat-jsonrpc.int.test.js:469`, `tests/integration/chat-jsonrpc.int.test.js:503` |
| AC3 | Negative-path integration coverage validates parity                       | ✅ Met                                                     | `tests/integration/chat-jsonrpc.int.test.js:431`, `tests/integration/chat-jsonrpc.int.test.js:517` |

Summary: 2 of 3 acceptance criteria verified; 1 requires corrective action.

### Task Completion Validation

| Task                                            | Marked As | Verified As                                            | Evidence                                         |
| ----------------------------------------------- | --------- | ------------------------------------------------------ | ------------------------------------------------ |
| Map JSON-RPC error results to existing envelope | Complete  | Issue Found – incorrect retry hint                     | `src/services/transport/index.js:750`            |
| Cover worker busy/unavailable/timeouts          | Complete  | Partially Verified – fix required for disabled backend | `src/services/transport/index.js:750`            |
| Add regression assertions in integration tests  | Complete  | Verified                                               | `tests/integration/chat-jsonrpc.int.test.js:431` |
| Reaffirm supervisor/backoff integration         | Complete  | Verified                                               | `tests/integration/chat-jsonrpc.int.test.js:469` |
| Exercise restart/backoff paths                  | Complete  | Verified                                               | `tests/integration/chat-jsonrpc.int.test.js:517` |
| Simulate handshake timeout via coverage         | Complete  | Verified                                               | `tests/integration/chat-jsonrpc.int.test.js:479` |
| Extend integration tests for failure paths      | Complete  | Verified                                               | `tests/integration/chat-jsonrpc.int.test.js:431` |
| Capture assertions across timeout/worker exit   | Complete  | Verified                                               | `tests/integration/chat-jsonrpc.int.test.js:503` |
| Document retry budget behaviour in fixtures     | Complete  | Verified                                               | `tests/integration/chat-jsonrpc.int.test.js:439` |

Summary: 9 tasks reviewed; 7 verified, 0 questionable, 2 require fixes tied to AC #1.

### Test Coverage and Gaps

- `npm run test:integration -- --reporter=dot` verifies new 429/503/504 parity cases (`tests/integration/chat-jsonrpc.int.test.js:431`).
- `npm test -- --reporter=dot` refreshes Playwright parity transcripts, confirming regressions are limited to HTTP mapping.
- No unit test covers the `worker_error` message regression — consider adding a focused test once the fix lands.

### Architectural Alignment

- Changes remain within transport layer boundaries, aligning with error-handling guidance in `docs/architecture.md` and Epic 2 tech spec (`docs/architecture.md:137`, `docs/tech-spec-epic-2.md:97`).
- Retry semantics must reflect supervisor policy; the disabled-backend regression violates FR004 (`docs/PRD.md:31`).

### Security Notes

- No new security risks identified; all changes stay within existing transport fixtures.

### Best-Practices and References

- `docs/tech-spec-epic-2.md`
- `docs/architecture.md`
- `docs/test-design-epic-2.md`

### Action Items

**Code Changes Required:**

- [x] [High] Restore non-retryable handling (status/type/message) for `app_server_disabled` errors to match proto behaviour and avoid retry loops. `src/services/transport/index.js:750`
- [x] [Medium] Preserve the worker-provided error message when mapping `worker_error` responses so diagnostics remain intact. `src/services/transport/index.js:763`

**Advisory Notes:**

- Note: Add a regression test that asserts worker error messages surface intact once the fix is applied (addressed by unit coverage in follow-up review).

## Senior Developer Review (AI)

**Reviewer:** drj  
**Date:** 2025-11-02  
**Outcome:** Approve — all acceptance criteria satisfied and follow-up items resolved.

### Summary

- Restored correct non-retryable mapping for disabled app-server mode and preserved worker error diagnostics (`src/services/transport/index.js:701-825`).
- Added unit coverage to lock the transport mapping behaviour alongside the existing integration tests (`tests/unit/services/json-rpc-transport.spec.js:78-109`).
- Re-ran unit, integration, and Playwright parity suites (`npm run test:unit -- --reporter=dot`, `npm run test:integration -- --reporter=dot`, `npm test -- --reporter=dot`).

### Key Findings

- **Low:** Suggest adding a future regression test for other transport codes if the matrix expands, but no blocking issues identified this round.

### Acceptance Criteria Coverage

| AC  | Description                                                           | Status | Evidence                                                                                           |
| --- | --------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------- |
| AC1 | Map JSON-RPC errors to OpenAI envelope with correct codes/retry hints | ✅ Met | `src/services/transport/index.js:701-825`, `tests/unit/services/json-rpc-transport.spec.js:78-109` |
| AC2 | Timeouts honor backoff/readiness policy                               | ✅ Met | `tests/integration/chat-jsonrpc.int.test.js:469-517`                                               |
| AC3 | Negative-path integration coverage verifies parity                    | ✅ Met | `tests/integration/chat-jsonrpc.int.test.js:431-538`                                               |

Summary: 3 of 3 acceptance criteria verified.

### Task Completion Validation

| Task                                            | Marked As | Verified As | Evidence                                             |
| ----------------------------------------------- | --------- | ----------- | ---------------------------------------------------- |
| Map JSON-RPC error results to existing envelope | Complete  | ✅ Verified | `src/services/transport/index.js:701-825`            |
| Cover worker busy/unavailable/timeouts          | Complete  | ✅ Verified | `tests/integration/chat-jsonrpc.int.test.js:431-517` |
| Add regression assertions in integration tests  | Complete  | ✅ Verified | `tests/integration/chat-jsonrpc.int.test.js:431-538` |
| Reaffirm supervisor/backoff integration         | Complete  | ✅ Verified | `tests/integration/chat-jsonrpc.int.test.js:469-517` |
| Exercise restart/backoff paths                  | Complete  | ✅ Verified | `tests/integration/chat-jsonrpc.int.test.js:503-513` |
| Simulate handshake timeout via coverage         | Complete  | ✅ Verified | `tests/integration/chat-jsonrpc.int.test.js:479-490` |
| Extend integration tests for failure paths      | Complete  | ✅ Verified | `tests/integration/chat-jsonrpc.int.test.js:431-538` |
| Capture assertions across timeout/worker exit   | Complete  | ✅ Verified | `tests/integration/chat-jsonrpc.int.test.js:503-533` |
| Document retry budget behaviour in fixtures     | Complete  | ✅ Verified | `tests/integration/chat-jsonrpc.int.test.js:439-456` |

Summary: 9 tasks reviewed; 9 verified, 0 questionable, 0 false completions.

### Test Coverage and Gaps

- Unit: `npm run test:unit -- --reporter=dot` (includes new `mapTransportError` assertions).
- Integration: `npm run test:integration -- --reporter=dot` (429/503/504 parity scenarios).
- E2E/Playwright: `npm test -- --reporter=dot` parity transcript refresh.
- No additional gaps observed for AC scope.

### Architectural Alignment

- Error mapping now aligns with FR004 expectations and existing proto semantics (`docs/PRD.md:31-42`).
- Transport changes remain encapsulated within the service layer, consistent with the architecture guidelines (`docs/architecture.md:137-155`).

### Security Notes

- No new security implications identified.

### Best-Practices and References

- `docs/tech-spec-epic-2.md`
- `docs/architecture.md`
- `docs/test-design-epic-2.md`

### Action Items

**Code Changes Required:**

- None.

**Advisory Notes:**

- Note: Consider extending the unit matrix if additional transport codes are introduced in future stories.
