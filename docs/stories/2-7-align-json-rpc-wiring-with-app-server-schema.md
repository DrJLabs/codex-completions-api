# Story 2.7: Align JSON-RPC wiring with app-server schema

Status: done

## Story

As a backend developer,
I want the proxy's JSON-RPC requests and notifications to match the Codex app-server schema,
so that the dev stack can run purely on app-server without `-32600 Invalid Request` failures.

## Acceptance Criteria

1. `/v1/chat/completions` request normalization emits `initialize` and `sendUserTurn` payloads that mirror the camelCase fields from the app-server reference (`clientInfo`, `conversationId`, `items`, `finalOutputJsonSchema`, etc.), preserving OpenAI-facing behavior per FR003. [Source: docs/app-server-migration/codex-app-server-rpc.md#22-senduserturn][Source: docs/PRD.md#functional-requirements]
2. JSON-RPC transport promotes readiness only after a successful `initialize` handshake, maintains newline-delimited framing, and forwards streaming notifications into the SSE adapter without dropping metadata. [Source: docs/app-server-migration/codex-app-server-rpc.md#1-transport--framing][Source: docs/architecture.md#implementation-patterns]
3. A schema bundle export is generated (Option A or B) and exercised by an automated harness/test that runs the documented `initialize → sendUserTurn` flow against the CLI, failing if payloads drift. [Source: docs/app-server-migration/codex-app-server-rpc.md#4-get-the-authoritative-json-schema][Source: docs/app-server-migration/codex-app-server-rpc.md#3-tiny-node-harness-stdio-json-rpc][Source: docs/tech-spec-epic-2.md#test-strategy-summary]
4. Runbooks and developer docs reference the schema source of truth and harness workflow so future CLI updates can regenerate bindings without guesswork. [Source: docs/app-server-migration/codex-app-server-rpc.md#7-next-steps-for-the-coding-agent][Source: docs/app-server-migration/codex-completions-api-migration.md#n-runbook-checklist-updates]

## Tasks / Subtasks

- [x] (AC: #1) Update `src/handlers/chat/request.js` to build `initialize`/`sendUserTurn` params using schema-driven helpers (`clientInfo`, `items`, tool metadata, `finalOutputJsonSchema`) from `src/lib/json-rpc/`. [Source: docs/tech-spec-epic-2.md#detailed-design][Source: docs/app-server-migration/codex-app-server-rpc.md#22-senduserturn]
  - [x] (AC: #1) Extend `src/lib/json-rpc/schema.js` (or equivalent) with camelCase serializers and unit tests that assert round-trips against schema fixtures. [Source: docs/tech-spec-epic-2.md#schema-bindings]
- [x] (AC: #2) Refactor `src/services/transport/index.js` (and related helpers) to maintain newline-delimited JSON framing, emit readiness after `initialize` success, and surface notifications to the SSE adapter untouched. [Source: docs/app-server-migration/codex-app-server-rpc.md#1-transport--framing][Source: docs/architecture.md#implementation-patterns]
  - [x] (AC: #2) Add integration coverage ensuring streaming notifications map into existing SSE deltas without losing metadata (e.g., role, tool calls). [Source: docs/tech-spec-epic-2.md#detailed-design]
- [x] (AC: #3) Automate schema export via Rust example or CLI flag, storing `docs/app-server-migration/app-server-protocol.schema.json` with version metadata. [Source: docs/app-server-migration/codex-app-server-rpc.md#4-get-the-authoritative-json-schema]
  - [x] (AC: #3) Wire a CI-targetable harness (Node or Vitest) that executes `initialize → sendUserTurn` against `codex app-server`, failing tests on `-32600` or schema drift. [Source: docs/app-server-migration/codex-app-server-rpc.md#3-tiny-node-harness-stdio-json-rpc]
- [x] (AC: #4) Update migration runbook and developer docs to describe schema regeneration, harness usage, and validation workflow, citing the exported bundle. [Source: docs/app-server-migration/codex-app-server-rpc.md#7-next-steps-for-the-coding-agent][Source: docs/app-server-migration/codex-completions-api-migration.md#n-runbook-checklist-updates]
  - [x] (AC: #4) Capture parity harness linkage so Story 2.5/2.6 evidence remains authoritative (manifest references, transcript paths). [Source: stories/2-5-update-regression-suite-for-parity-evidence.md#completion-notes][Source: docs/app-server-migration/parity-rollout-checklist.md][Source: docs/epics.md#story-27-align-json-rpc-wiring-with-app-server-schema]

## Dev Notes

### Requirements Context Summary

- FR003 requires translating OpenAI requests into the official Codex app-server JSON-RPC contract without altering client-visible behavior. [Source: docs/PRD.md#functional-requirements]
- Epic 2’s detailed design maps this story to `src/handlers/chat/request.js`, transport wiring, and schema bindings in `src/lib/json-rpc/`. [Source: docs/tech-spec-epic-2.md#detailed-design]
- The app-server RPC reference provides the canonical camelCase field names, payload examples, and schema export workflow needed to resolve `-32600 Invalid Request` errors. [Source: docs/app-server-migration/codex-app-server-rpc.md#22-senduserturn][Source: docs/app-server-migration/codex-app-server-rpc.md#4-get-the-authoritative-json-schema]
- Architecture patterns require readiness gating after the worker handshake and structured logging/metrics once JSON-RPC payloads replace proto calls. [Source: docs/architecture.md#implementation-patterns]

### Learnings from Previous Story

- Reuse the parity harness, transcript generator, and manifest from Story 2.5; update CLI metadata and manifest entries instead of forking tooling. [Source: stories/2-5-update-regression-suite-for-parity-evidence.md#completion-notes]
- Story 2.6 documented the parity checklist and evidence package—reference those completion notes when adding schema guidance so rollout tracking stays unified. [Source: stories/2-6-document-parity-verification-and-rollout-checklist.md#completion-notes]
- Capture readiness and smoke outcomes from Story 2.6 to ensure schema validation steps feed the same evidence tables. [Source: stories/2-6-document-parity-verification-and-rollout-checklist.md#debug-log-references]

### Architecture patterns and constraints

- Maintain readiness gating: only mark the proxy ready after `initialize` succeeds, mirroring the architecture mandate. [Source: docs/architecture.md#implementation-patterns]
- Emit structured logging and metrics for the JSON-RPC path so observability additions in Epic 3 have consistent data. [Source: docs/architecture.md#implementation-patterns]
- Keep schema-driven validation alongside transport updates to prevent manual casing drift and ensure CLI compatibility. [Source: docs/app-server-migration/codex-app-server-rpc.md#4-get-the-authoritative-json-schema]

### Implementation & Validation Notes

- Prefer schema-driven builders around `initialize`/`sendUserTurn` to avoid manual casing mistakes; add unit tests that compare against exported schema fixtures. [Source: docs/app-server-migration/codex-app-server-rpc.md#4-get-the-authoritative-json-schema]
- Ensure readiness flips only after the worker acknowledges `initialize`, and log payloads via the existing structured logging scaffolding to support observability later in Epic 3. [Source: docs/architecture.md#implementation-patterns]
- The automated harness should run in CI with deterministic prompts, storing captured payloads alongside parity artifacts for regression detection. [Source: docs/app-server-migration/codex-app-server-rpc.md#3-tiny-node-harness-stdio-json-rpc]

### Testing Expectations

- Extend unit and integration suites to cover schema builders, transport readiness transitions, and streaming notifications. [Source: docs/tech-spec-epic-2.md#test-strategy-summary]
- Add an automated CLI harness test invoked via `npm run test:integration` or a dedicated script, failing on `-32600` or mismatched schema fields. [Source: docs/app-server-migration/codex-app-server-rpc.md#3-tiny-node-harness-stdio-json-rpc]
- Maintain linkage with parity suites (`npm run test:parity`, `npm test`) so schema changes surface in both harness and parity evidence. [Source: docs/openai-endpoint-golden-parity.md#81-capture-workflow-proto--app-server-parity]

### Project Structure Notes

- Keep JSON-RPC helpers under `src/lib/json-rpc/` and transport updates within `src/services/transport/` to align with existing architecture boundaries. [Source: docs/tech-spec-epic-2.md#detailed-design]
- Store exported schema under `docs/app-server-migration/` next to the RPC reference so documentation and tooling share one authoritative location. [Source: docs/app-server-migration/codex-app-server-rpc.md#4-get-the-authoritative-json-schema]
- Update runbooks in place rather than adding new directories, maintaining a single operational surface for app-server migration. [Source: docs/app-server-migration/codex-completions-api-migration.md#n-runbook-checklist-updates]

### References

- docs/app-server-migration/codex-app-server-rpc.md
- docs/PRD.md
- docs/tech-spec-epic-2.md
- docs/architecture.md
- docs/app-server-migration/parity-rollout-checklist.md
- docs/openai-endpoint-golden-parity.md
- stories/2-5-update-regression-suite-for-parity-evidence.md

## Dev Agent Record

### Context Reference

- docs/stories/2-7-align-json-rpc-wiring-with-app-server-schema.context.xml

### Agent Model Used

codex-5

### Debug Log References

- 2025-11-02: `npm run test:unit`
- 2025-11-02: `npm run test:integration`
- 2025-11-02: `npm test`
- 2025-11-02: `npm run smoke:dev`
- 2025-11-02: `npx vitest run tests/integration/json-rpc-schema-validation.int.test.js --reporter=default`
- 2025-11-02: `npm run jsonrpc:bundle`

### Deployment / Stack Notes

- Refreshed `.codev/auth.json` from `~/.codex/auth.json`, rebuilt the dev stack (`npm run dev:stack:down && npm run dev:stack:up`), and observed clean streaming completions with the updated schema wiring.

### Completion Notes List

- Updated request normalization, schema helpers, and transport readiness gating to match app-server expectations.
- Added schema bundle exporter + validation harness and refreshed migration runbooks with regeneration workflow.
- Validated streaming responses end-to-end (E2E + dev smoke) after redeploying the dev stack with refreshed auth credentials.

### File List

- docs/app-server-migration/app-server-protocol.schema.json
- docs/app-server-migration/codex-app-server-rpc.md
- docs/app-server-migration/codex-completions-api-migration.md
- src/handlers/chat/request.js
- src/services/transport/index.js
- src/services/worker/supervisor.js
- scripts/jsonrpc/export-json-schema.mjs
- tests/integration/json-rpc-schema-validation.int.test.js
- tests/unit/json-rpc-schema-bundle.test.js
- tsconfig.schema.json
- docs/stories/2-7-align-json-rpc-wiring-with-app-server-schema.md

## Change Log

- 2025-10-30: Initial draft generated; ready for Story Context workflow.
- 2025-11-02: Story context assembled and status advanced to ready-for-dev.
- 2025-11-02: Implemented schema-aligned JSON-RPC wiring, harness + docs, and generated schema bundle.
- 2025-11-02: Executed unit/integration suites and schema validation harness.
- 2025-11-02: Rebuilt dev stack with refreshed auth, ran full Playwright suite plus dev smoke to confirm streaming completions, and moved story to done.
