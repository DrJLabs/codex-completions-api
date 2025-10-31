# Story 1.4: Establish JSON-RPC transport channel

Status: ready-for-dev

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

- [ ] (AC #1) Implement JSON-RPC client bootstrap (`initialize`, `sendUserTurn`, `sendUserMessage`) and refuse requests until handshake succeeds. [Source](docs/app-server-migration/codex-completions-api-migration.md#c-json-rpc-client-write--read)
  - [ ] (AC #1) Consume supervisor readiness signals so adapters dispatch only after advertised models arrive. [Source](docs/stories/1-3-implement-worker-supervisor-and-lifecycle-hooks.md#dev-notes)
  - [ ] (AC #1 Testing) Add unit coverage for handshake success/failure branches and model advertisement parsing. [Source](docs/bmad/architecture/tech-stack.md#testing--qa)
- [ ] (AC #2) Build request-context tracking that maps IDs to timers, retries, and error envelopes using shared error helpers. [Source](docs/PRD.md#functional-requirements) [Source](docs/architecture.md#error-handling)
  - [ ] (AC #2) Ensure timeout paths coordinate with supervisor restart/backoff without collapsing the transport. [Source](docs/architecture.md#health--lifecycle)
  - [ ] (AC #2 Testing) Extend integration tests to assert retry hints and timeout behaviour when the worker stalls. [Source](tests/integration/backend-mode.int.test.js)
- [ ] (AC #3) Create integration fixtures that simulate JSON-RPC notifications/deltas and confirm streaming + non-streaming adapters consume them correctly. [Source](docs/app-server-migration/codex-completions-api-migration.md#d-streaming-path-sse)
  - [ ] (AC #3) Record a golden transcript for handshake and delta flow to guard against regressions. [Source](docs/bmad/architecture/tech-stack.md#testing--qa)
  - [ ] (AC #3 Testing) Add the round-trip to `npm run test:integration` and `npm test` pipelines. [Source](docs/bmad/architecture/tech-stack.md#testing--qa)

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

## Dev Agent Record

### Context Reference

- docs/stories/1-4-establish-json-rpc-transport-channel.context.xml

### Agent Model Used

codex-gpt-5 (story drafting)

### Debug Log References

### Completion Notes List

### File List
