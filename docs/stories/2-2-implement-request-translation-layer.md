# Story 2.2: Implement Request Translation Layer

Status: done

## Requirements Context Summary

- The request normalization layer resides in `src/handlers/chat/request.js`, translating OpenAI request fields into JSON-RPC payloads that flow through the transport client and reuse the schema bindings established in Story 2.1. [Source: docs/tech-spec-epic-2.md#services-and-modules] [Source: docs/app-server-migration/codex-completions-api-migration.md#c-json-rpc-client-write--read]
- Parity mandates FR001–FR004 keep the HTTP contract identical while Story 2.2 focuses on translating model, tool, temperature, and streaming inputs without regressing validation or error semantics. [Source: docs/PRD.md#functional-requirements] [Source: docs/epics.md#story-22-implement-request-translation-layer]
- The tech spec sequences Story 2.2 immediately after schema work, requiring deterministic integration coverage with the transport stub to guard parity. [Source: docs/tech-spec-epic-2.md#workflows-and-sequencing] [Source: docs/test-design-epic-2.md#p0-critical---run-on-every-commit]
- The translation layer must respect latency, logging, and concurrency requirements by leveraging existing transport metrics, readiness gating, and timeout policies. [Source: docs/tech-spec-epic-2.md#performance] [Source: docs/app-server-migration/codex-completions-api-migration.md#g-concurrency--timeouts]
- Observability and parity harness expectations require emitting RPC method metadata and preserving deterministic transcripts for CI evidence. [Source: docs/tech-spec-epic-2.md#observability] [Source: docs/test-design-epic-2.md#test-strategy-summary]

## Project Structure Alignment

- Implement normalization within `src/handlers/chat/request.js`, delegating typed payload construction to `src/lib/json-rpc/schema.ts` so adapters share a single contract. [Source: docs/tech-spec-epic-2.md#services-and-modules] [Source: docs/stories/2-1-define-json-rpc-schema-bindings-for-chat.md#project-structure-notes]
- Reuse `src/services/transport/appServerClient.js` for JSON-RPC dispatch, leveraging its outstanding-request map, metrics, and readiness behavior. [Source: docs/tech-spec-epic-2.md#services-and-modules] [Source: docs/architecture.md#decision-summary]
- House deterministic integration coverage in `tests/integration/chat-jsonrpc.test.js` alongside existing parity fixtures and follow naming conventions from Epic 2. [Source: docs/tech-spec-epic-2.md#services-and-modules] [Source: docs/test-design-epic-2.md#test-coverage-plan]
- Document any regeneration or CLI pin impacts in `docs/app-server-migration/`, aligning with the migration runbook and Story 2.1 guidance. [Source: docs/app-server-migration/codex-completions-api-migration.md#a-replace-cli-invocation] [Source: docs/stories/2-1-define-json-rpc-schema-bindings-for-chat.md#dev-notes]

## Story

As an application developer,
I want `/v1/chat/completions` requests normalized into JSON-RPC calls,
so that the worker can process them without knowing OpenAI-specific shapes.

## Acceptance Criteria

1. The `/v1/chat/completions` handler maps models, messages, temperatures, tool definitions, streaming toggles, and runtime flags into `initialize`, `sendUserTurn`, and `sendUserMessage` JSON-RPC calls using the shared schema exports and deterministic request identifiers. [Source: docs/epics.md#story-22-implement-request-translation-layer] [Source: docs/tech-spec-epic-2.md#services-and-modules] [Source: docs/app-server-migration/codex-completions-api-migration.md#c-json-rpc-client-write--read]
2. Input validation and error mapping mirror existing HTTP semantics—status codes, retry hints, and error bodies remain unchanged while parity requirements FR001–FR004 continue to hold. [Source: docs/epics.md#story-22-implement-request-translation-layer] [Source: docs/PRD.md#functional-requirements] [Source: docs/tech-spec-epic-2.md#non-functional-requirements]
3. Integration coverage under `tests/integration/chat-jsonrpc.test.js` exercises baseline chat, streaming, and tool-call flows against the deterministic transport stub, failing if payload parity drifts. [Source: docs/epics.md#story-22-implement-request-translation-layer] [Source: docs/tech-spec-epic-2.md#workflows-and-sequencing] [Source: docs/test-design-epic-2.md#p0-critical---run-on-every-commit]

## Tasks / Subtasks

- [x] (AC #1) Implement normalization pipeline in `src/handlers/chat/request.js` that constructs `initialize`, `sendUserTurn`, and `sendUserMessage` envelopes from OpenAI payloads. [Source: docs/tech-spec-epic-2.md#services-and-modules]
  - [x] (AC #1) Reuse `src/lib/json-rpc/schema.ts` bindings and deterministic request/id bookkeeping supplied by `appServerClient`. [Source: docs/stories/2-1-define-json-rpc-schema-bindings-for-chat.md#completion-notes-list]
  - [x] (AC #1) Map conversation metadata, tools, streaming toggles, and runtime flags exactly as described in the migration runbook. [Source: docs/app-server-migration/codex-completions-api-migration.md#c-json-rpc-client-write--read]
- [x] (AC #2) Align validation and error handling with existing HTTP responses, reusing shared validators and error envelopes. [Source: docs/PRD.md#functional-requirements] [Source: docs/tech-spec-epic-2.md#non-functional-requirements]
  - [x] (AC #2) Add negative fixtures (e.g., missing tool definitions, invalid temperatures) ensuring retry hints and status codes match today’s contract. [Source: docs/test-design-epic-2.md#risk-assessment]
- [x] (AC #3) Extend `tests/integration/chat-jsonrpc.test.js` to cover baseline, streaming, and tool-call scenarios using the deterministic transport stub. [Source: docs/test-design-epic-2.md#p0-critical---run-on-every-commit]
  - [x] (AC #3) Capture parity transcripts and assert payload equality for streaming delta ordering and final responses. [Source: docs/tech-spec-epic-2.md#test-strategy-summary]
  - [x] (AC #3) Run `npm run test:integration` (and include in change log) to document passing coverage before submission. [Source: docs/test-design-epic-2.md#prerequisites]

## Dev Notes

- Normalize user turns by issuing `initialize` once per request and deferring to the transport’s outstanding-request map for correlation. [Source: docs/app-server-migration/codex-completions-api-migration.md#c-json-rpc-client-write--read]
- Preserve latency and retry SLAs by reusing transport timers, emitting `rpc_method` metadata, and honoring `WORKER_MAX_CONCURRENCY` gates. [Source: docs/tech-spec-epic-2.md#performance] [Source: docs/architecture.md#decision-summary]
- Extend structured logs and Prometheus counters instead of introducing new logging shapes, keeping parity harness diagnostics deterministic. [Source: docs/tech-spec-epic-2.md#observability]
- Coordinate CLI regeneration or schema changes with the migration runbook and Story 2.1 documentation to avoid drift. [Source: docs/app-server-migration/codex-completions-api-migration.md#a-replace-cli-invocation] [Source: docs/stories/2-1-define-json-rpc-schema-bindings-for-chat.md#dev-notes]

### Learnings from Previous Story

- `src/lib/json-rpc/schema.ts` already exports chat bindings—import its unions and helpers instead of re-declaring payload shapes. [Source: docs/stories/2-1-define-json-rpc-schema-bindings-for-chat.md#completion-notes-list]
- Regeneration workflow expects `@openai/codex` pinned to 0.53.0; review flagged reinstating the exact dependency version as a high-priority follow-up. [Source: docs/stories/2-1-define-json-rpc-schema-bindings-for-chat.md#action-items]
- Fixture-backed unit tests exist for schema validation; reuse their sanitized transcripts when crafting integration assertions. [Source: docs/stories/2-1-define-json-rpc-schema-bindings-for-chat.md#file-list]

### Project Structure Notes

- Align new modules with the documented project tree (`src/handlers/chat`, `src/services/transport`, `tests/integration`) and maintain naming conventions. [Source: docs/architecture.md#project-structure]
- Keep JSON-RPC related assets grouped under `scripts/jsonrpc/` or existing parity tooling directories when adding helpers. [Source: docs/stories/2-1-define-json-rpc-schema-bindings-for-chat.md#project-structure-notes]

### References

- docs/epics.md#story-22-implement-request-translation-layer
- docs/PRD.md#functional-requirements
- docs/tech-spec-epic-2.md#services-and-modules
- docs/tech-spec-epic-2.md#performance
- docs/tech-spec-epic-2.md#observability
- docs/tech-spec-epic-2.md#workflows-and-sequencing
- docs/test-design-epic-2.md#p0-critical---run-on-every-commit
- docs/test-design-epic-2.md#test-coverage-plan
- docs/app-server-migration/codex-completions-api-migration.md#c-json-rpc-client-write--read
- docs/app-server-migration/codex-completions-api-migration.md#g-concurrency--timeouts
- docs/architecture.md#decision-summary

## Dev Agent Record

### Context Reference

- docs/stories/2-2-implement-request-translation-layer.context.xml

### Agent Model Used

codex-5 (Developer Agent TBD)

### Debug Log References

- 2025-11-02: Plan to implement AC coverage:
  - Introduce `src/handlers/chat/request.js` to translate `/v1/chat/completions` payloads into `initialize`, `sendUserTurn`, and `sendUserMessage` envelopes using schema helpers.
  - Update chat handlers to call the translation layer when in app-server mode while preserving existing HTTP validation and error semantics.
  - Extend integration coverage in `tests/integration/chat-jsonrpc.test.js` for baseline, streaming, and tool-call scenarios plus error parity cases, then run `npm run test:integration`.

### Completion Notes List

- Implemented JSON-RPC normalization entrypoint `normalizeChatJsonRpcRequest` to translate chat completion payloads into `sendUserTurn`/`sendUserMessage` envelopes, including metadata, tool definitions, and runtime controls.
- Updated chat stream and non-stream handlers plus transport layer to call the normalization helper in app-server mode, propagating validation errors via existing `invalidRequestBody` responses.
- Extended JSON-RPC child adapter and transport to forward optional fields (`stream`, `include_usage`, `tools`, `temperature`, `top_p`, `max_output_tokens`) without regressing proto behaviour.
- Added deterministic integration coverage (`tests/integration/chat-jsonrpc.int.test.js`) asserting request payload parity for baseline, streaming, and negative scenarios; ensured suite passes via `npm run test:integration`.

### File List

- src/handlers/chat/request.js (new) — JSON-RPC normalization helper and validation logic.
- src/handlers/chat/nonstream.js (updated) — invoke normalization when backend mode is app-server.
- src/handlers/chat/stream.js (updated) — reuse normalization for streaming path.
- src/services/transport/index.js (updated) — accept extended turn/message parameters for JSON-RPC dispatch.
- src/services/transport/child-adapter.js (updated) — forward normalized payloads to transport.
- scripts/fake-codex-jsonrpc.js (updated) — emit capture events for integration assertions.
- tests/integration/chat-jsonrpc.int.test.js (new) — integration coverage for JSON-RPC payload parity and validation errors.
- package.json (updated) — add `jsonrpc:schema` script reference used by migration runbook.
- docs/app-server-migration/codex-completions-api-migration.md (updated) — document schema regeneration step.
- docs/sprint-status.yaml (updated) — status advanced to `review`.

## Change Log

- [x] 2025-11-01: Draft created via Scrum Master workflow; pending implementation.
- [x] 2025-11-02: Implemented JSON-RPC request normalization, validation, and integration coverage; `npm run test:integration` (pass).
