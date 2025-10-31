# Story 1.4: Establish JSON-RPC transport channel

Status: review

## Requirements Context Summary

- Epic 1.4 mandates maintaining a persistent JSON-RPC channel to the Codex App Server that validates readiness and advertised models before higher-level adapters invoke it. [Source](docs/epics.md#story-14-establish-json-rpc-transport-channel)
- PRD FR003–FR004 require the transport to translate OpenAI requests into Codex JSON-RPC calls without changing status codes, error envelopes, or retry semantics. [Source](docs/PRD.md#functional-requirements)
- Architecture decisions lock the proxy to a single supervised JSON-RPC channel with bounded concurrency and readiness gating that the transport must honor during handshake and retry flows. [Source](docs/architecture.md#decision-summary)
- Migration guidelines define the `initialize`/`sendUserTurn`/`sendUserMessage` sequence, request-id tracking, and notification routing needed for parity round-trips. [Source](docs/app-server-migration/codex-completions-api-migration.md#c-json-rpc-client-write--read) [Source](docs/app-server-migration/codex-completions-api-migration.md#d-streaming-path-sse)

## Project Structure Alignment

- Extend the transport inside `src/services/` alongside the worker supervisor delivered in Story&nbsp;1.3 so lifecycle coordination stays co-located. [Source](docs/bmad/architecture/source-tree.md#src-modules) [Source](docs/stories/1-3-implement-worker-supervisor-and-lifecycle-hooks.md#project-structure-alignment)
- Route adapters through shared chat handlers (`src/handlers/chat/nonstream.js`, `src/handlers/chat/stream.js`) to avoid duplicate protocol logic. [Source](docs/architecture.md#project-structure)
- Reuse `src/config/index.js` to surface transport timeouts, concurrency, and readiness gating rather than minting parallel config. [Source](docs/architecture.md#runtime--language)

## Story

As an application developer,  
I want the proxy to open and maintain the JSON-RPC connection to the Codex App Server worker,  
so that higher-level adapters can send requests without reimplementing transport details. [Source](docs/epics.md#story-14-establish-json-rpc-transport-channel)

## Acceptance Criteria

1. Transport startup performs the JSON-RPC handshake that validates worker readiness and advertised models before exposing the channel to adapters. [Source](docs/epics.md#story-14-establish-json-rpc-transport-channel) [Source](docs/app-server-migration/codex-completions-api-migration.md#c-json-rpc-client-write--read)
2. Transport tracks request IDs, enforces per-request timeouts, and classifies retryable failures while preserving documented error envelopes. [Source](docs/epics.md#story-14-establish-json-rpc-transport-channel) [Source](docs/PRD.md#functional-requirements)
3. Integration test exercises a mock JSON-RPC request/response round trip verifying handshake, message dispatch, and error shaping. [Source](docs/epics.md#story-14-establish-json-rpc-transport-channel) [Source](docs/app-server-migration/codex-completions-api-migration.md#d-streaming-path-sse)

## Tasks / Subtasks

- [x] (AC #1) Implement JSON-RPC client bootstrap (`initialize`, `sendUserTurn`, `sendUserMessage`) and refuse requests until handshake succeeds. [Source](docs/app-server-migration/codex-completions-api-migration.md#c-json-rpc-client-write--read)
  - [x] (AC #1) Consume supervisor readiness signals so adapters dispatch only after advertised models arrive. [Source](docs/stories/1-3-implement-worker-supervisor-and-lifecycle-hooks.md#dev-notes)
  - [x] (AC #1 Testing) Add unit coverage for handshake success/failure branches and model advertisement parsing. [Source](docs/bmad/architecture/tech-stack.md#testing--qa)
- [x] (AC #2) Build request-context tracking that maps IDs to timers, retries, and error envelopes using shared error helpers. [Source](docs/PRD.md#functional-requirements) [Source](docs/architecture.md#error-handling)
  - [x] (AC #2) Ensure timeout paths coordinate with supervisor restart/backoff without collapsing the transport. [Source](docs/architecture.md#health--lifecycle)
  - [x] (AC #2 Testing) Extend integration tests to assert retry hints and timeout behaviour when the worker stalls. [Source](tests/integration/backend-mode.int.test.js)
- [x] (AC #3) Create integration fixtures that simulate JSON-RPC notifications/deltas and confirm streaming + non-streaming adapters consume them correctly. [Source](docs/app-server-migration/codex-completions-api-migration.md#d-streaming-path-sse)
- [x] (AC #3) Record a golden transcript for handshake and delta flow to guard against regressions. [Source](docs/bmad/architecture/tech-stack.md#testing--qa)
  - [x] (AC #3 Testing) Add the round-trip to `npm run test:integration` and `npm test` pipelines. [Source](docs/bmad/architecture/tech-stack.md#testing--qa)

#### Review Follow-ups (AI)

- [x] [AI-Review][High] Add unit coverage for JsonRpcTransport handshake success/failure paths and advertised-model parsing so AC #1 testing requirements are verifiable.

## Dev Notes

- Uphold the supervised single-channel model from Story 1.3—transport readiness must mirror supervisor state rather than spinning parallel connections. [Source](docs/stories/1-3-implement-worker-supervisor-and-lifecycle-hooks.md#dev-notes)
- Map JSON-RPC notifications (`agentMessageDelta`, `agentMessage`, `tokenCount`) onto existing SSE shapers so external API contracts remain unchanged. [Source](docs/app-server-migration/codex-completions-api-migration.md#d-streaming-path-sse)
- Reuse error handling helpers to keep retry hints consistent across chat handlers and new transport errors. [Source](docs/architecture.md#error-handling)
- Maintain test coverage through `npm run test:integration` and `npm test`, leveraging the deterministic worker shim for JSON-RPC transcripts. [Source](docs/bmad/architecture/tech-stack.md#testing--qa)

### Learnings from Previous Story

**From Story 1-3-implement-worker-supervisor-and-lifecycle-hooks (Status: review)**

- **New Service Available:** `src/services/worker/supervisor.js` now manages lifecycle; transport should consume its readiness hooks instead of duplicating state. [Source](docs/stories/1-3-implement-worker-supervisor-and-lifecycle-hooks.md#file-list)
- **Structural Change:** Chat handlers already gate traffic on supervisor readiness—extend those hooks rather than introducing new switches. [Source](docs/stories/1-3-implement-worker-supervisor-and-lifecycle-hooks.md#dev-notes)
- **Testing Baseline:** Integration suites cover supervisor lifecycle; add transport fixtures alongside the existing worker supervisor tests. [Source](tests/integration/worker-supervisor.int.test.js)
- **Operational Expectation:** Supervisor logs restart warnings and metrics; transport should surface retryable worker events through the same telemetry. [Source](docs/stories/1-3-implement-worker-supervisor-and-lifecycle-hooks.md#debug-log-references)

### Project Structure Notes

- Keep transport implementation within `src/services/` and expose a facade consumed by chat handlers. [Source](docs/bmad/architecture/source-tree.md#src-modules)
- Store new integration fixtures under `tests/integration/` aligned with existing supervisor coverage. [Source](docs/bmad/architecture/source-tree.md#tests)
- Extend `src/config/index.js` for transport configuration instead of adding scattered env lookups. [Source](docs/architecture.md#runtime--language)

### References

- docs/epics.md#story-14-establish-json-rpc-transport-channel
- docs/PRD.md#functional-requirements
- docs/architecture.md#decision-summary
- docs/app-server-migration/codex-completions-api-migration.md#c-json-rpc-client-write--read
- docs/app-server-migration/codex-completions-api-migration.md#d-streaming-path-sse
- docs/bmad/architecture/tech-stack.md#testing--qa
- docs/bmad/architecture/source-tree.md#src-modules
- docs/stories/1-3-implement-worker-supervisor-and-lifecycle-hooks.md#dev-notes
- tests/integration/backend-mode.int.test.js
- tests/integration/worker-supervisor.int.test.js

## Change Log

- [x] 2025-10-31: Draft created for Story 1.4.
- [x] 2025-10-31: Story context generated and validation report saved at docs/stories/validation-report-2025-10-31T123730Z.md.
- [x] 2025-10-31: Implemented JSON-RPC transport channel, rewired chat handlers, and added integration coverage for handshake and timeout flows.
- [x] 2025-10-31: Senior Developer Review (AI) recorded with blocking follow-ups.
- [x] 2025-10-31: Added JsonRpcTransport unit tests to satisfy AC #1 testing follow-up.

## Dev Agent Record

### Context Reference

- docs/stories/1-4-establish-json-rpc-transport-channel.context.xml

### Agent Model Used

codex-gpt-5 (story drafting)

### Debug Log References

- 2025-10-31: Implemented JSON-RPC transport service with handshake tracking, request context management, and supervisor readiness hooks (`src/services/transport/index.js`, `src/services/transport/child-adapter.js`, `src/services/worker/supervisor.js`).
- 2025-10-31: Rewired chat handlers to route through the transport while keeping proto compatibility and mapped transport failures to OpenAI envelopes (`src/handlers/chat/nonstream.js`, `src/handlers/chat/stream.js`, `src/config/index.js`).
- 2025-10-31: Added app-server fixture plus targeted integration coverage for handshake success and timeout classification (`scripts/fake-codex-jsonrpc.js`, `tests/integration/json-rpc-transport.int.test.js`, `tests/integration/backend-mode.int.test.js`).

### Completion Notes List

- AC1: Handshake now runs through the shared JSON-RPC transport before adapters send traffic, blocking requests until the supervisor advertises models.
- AC2: Request contexts track IDs, enforce configurable timeouts, and surface retryable transport failures using the documented error envelopes.
- AC3: New JSON-RPC fixture and integration tests exercise the handshake-to-response round trip and ensure timeouts remain retryable in both pipelines.
- Added unit tests covering JsonRpcTransport handshake success/failure and advertised-model parsing (`tests/unit/services/json-rpc-transport.spec.js`).

### File List

- src/config/index.js
- src/handlers/chat/nonstream.js
- src/handlers/chat/stream.js
- src/services/transport/index.js
- src/services/transport/child-adapter.js
- src/services/worker/supervisor.js
- scripts/fake-codex-jsonrpc.js
- tests/integration/backend-mode.int.test.js
- tests/integration/json-rpc-transport.int.test.js
- tests/unit/services/json-rpc-transport.spec.js
- .env.example
- .env.dev

### Senior Developer Review (AI)

Reviewer: drj

Date: 2025-10-31

Outcome: Approve

#### Summary

- Transport bootstrap, request context management, and error-envelope mapping line up with the JSON-RPC migration plan, and both integration and unit suites cover handshake success, advertised-model parsing, and timeout behavior.

#### Key Findings

- No outstanding issues.

#### Acceptance Criteria Coverage

| AC  | Description                                                                                           | Status      | Evidence                                                                                                                                                                                |
| --- | ----------------------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC1 | Transport performs JSON-RPC handshake and waits for advertised models before serving adapters         | Implemented | `src/services/transport/index.js:160-233`, `tests/integration/json-rpc-transport.int.test.js:15-55`                                                                                     |
| AC2 | Transport tracks request IDs, enforces per-request timeouts, and preserves documented error envelopes | Implemented | `src/services/transport/index.js:29-352`, `src/services/transport/index.js:616-666`, `src/handlers/chat/nonstream.js:361-825`, `tests/integration/json-rpc-transport.int.test.js:57-91` |
| AC3 | Mock JSON-RPC round trip proves handshake, message dispatch, and error shaping                        | Implemented | `scripts/fake-codex-jsonrpc.js:16-107`, `tests/integration/json-rpc-transport.int.test.js:15-91`, `tests/integration/backend-mode.int.test.js:70-109`                                   |

_Summary: 3 of 3 acceptance criteria implemented._

#### Task Completion Validation

| Task                                                                                                                                       | Marked As | Verified As       | Evidence                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------ | --------- | ----------------- | -------------------------------------------------------------------------------------- |
| (AC #1) Implement JSON-RPC client bootstrap (`initialize`, `sendUserTurn`, `sendUserMessage`) and refuse requests until handshake succeeds | [x]       | Verified Complete | `src/services/transport/index.js:160-352`                                              |
| (AC #1) Consume supervisor readiness signals so adapters dispatch only after advertised models arrive                                      | [x]       | Verified Complete | `src/services/transport/index.js:163-233`, `src/services/worker/supervisor.js:200-274` |
| (AC #1 Testing) Add unit coverage for handshake success/failure branches and model advertisement parsing                                   | [x]       | Verified Complete | `tests/unit/services/json-rpc-transport.spec.js:76-139`                                |
| (AC #2) Build request-context tracking that maps IDs to timers, retries, and error envelopes                                               | [x]       | Verified Complete | `src/services/transport/index.js:29-352`, `src/services/transport/index.js:616-666`    |
| (AC #2) Ensure timeout paths coordinate with supervisor restart/backoff without collapsing the transport                                   | [x]       | Verified Complete | `src/services/transport/index.js:222-352`, `src/services/worker/supervisor.js:278-311` |
| (AC #2 Testing) Extend integration tests to assert retry hints and timeout behaviour when the worker stalls                                | [x]       | Verified Complete | `tests/integration/json-rpc-transport.int.test.js:57-91`                               |
| (AC #3) Create integration fixtures that simulate JSON-RPC notifications/deltas                                                            | [x]       | Verified Complete | `scripts/fake-codex-jsonrpc.js:16-107`                                                 |
| (AC #3) Record a golden transcript for handshake and delta flow                                                                            | [x]       | Verified Complete | `scripts/fake-codex-jsonrpc.js:16-107`                                                 |
| (AC #3 Testing) Add the round-trip to `npm run test:integration` and `npm test` pipelines                                                  | [x]       | Verified Complete | `tests/integration/json-rpc-transport.int.test.js:15-91`                               |

_Summary: 9 of 9 checked tasks verified, 0 questionable, 0 falsely marked complete._

#### Test Coverage and Gaps

- ✅ Deterministic JSON-RPC fixture (`scripts/fake-codex-jsonrpc.js`), integration suite (`tests/integration/json-rpc-transport.int.test.js`), and unit coverage (`tests/unit/services/json-rpc-transport.spec.js`) exercise handshake success, advertised-model parsing, and timeout failure paths.

#### Architectural Alignment

- Implementation follows the single-channel guidance in `docs/app-server-migration/codex-completions-api-migration.md#c-json-rpc-client-write--read` and uses supervisor readiness per `docs/architecture.md#implementation-patterns`. No architecture violations observed.

#### Security Notes

- Error mapping keeps retry hints and avoids leaking internal details; no new security regressions detected.

#### Best-Practices and References

- `docs/app-server-migration/codex-completions-api-migration.md#c-json-rpc-client-write--read`
- `docs/architecture.md#integration-points`

### Action Items

**Code Changes Required:**

- None

**Advisory Notes:**

- None
