# `/v1/responses` Implementation Overview

This note sketches the phases required to add a fully compatible `/v1/responses` endpoint to the Codex OpenAI proxy. Each phase lists the core objectives, primary deliverables, and key dependencies so we can schedule the work and spot cross-cutting impacts early.

## Goals & Constraints

- Match the OpenAI Responses API contract: request schema (instructions, input, response_format, metadata), streaming and non-stream shapes, tool output handling, and usage fields.
- Reuse existing infrastructure (`worker supervisor`, JSON-RPC transport, SSE helpers) without regressing `/v1/chat/completions` or `/v1/models`.
- Preserve current security/observability toggles (CORS, rate limits, dev tracing) and extend them only where necessary.
- Ship comprehensive tests (unit, integration, SSE/E2E) and documentation so clients can migrate without guesswork.

## Phase 1 – Discovery & Contract Alignment

**Objectives**

1. Compare the OpenAI Responses spec with our chat proxy to enumerate missing parameters (`instructions`, `input`, `response_format`, `metadata`, `tool_choice`, `max_output_tokens`, etc.).
2. Document required event ordering for streaming (`response.created`, `response.output_text.delta`, `tool_output.created`, `response.completed`, `response.error`).
3. Audit Codex CLI 0.58 JSON-RPC capabilities to ensure we can emit the same signals; flag any CLI gaps early.
4. Decide whether responses logic should reuse existing helpers (validation, metadata, tool aggregation) or live in dedicated modules.

**Deliverables**

- Gap-analysis table mapping every Responses request/response field to current proxy behavior with disposition (reuse/extend/new work).
- Updated JSON-RPC schema references or CLI configuration notes documenting dependencies (e.g., need `apply_patch_freeform`).
- Decision note on module organization and any CLI follow-up tasks.

**Dependencies**: OpenAI Responses API docs, Codex CLI schema, existing chat handler docs (`docs/chat-completions-request-flow.md`).

## Phase 2 – Request Normalization & Validation

**Objectives**

1. Implement dedicated schema validation for Responses requests (instructions, `input`, `response_format`, `metadata`, `modalities`, `max_output_tokens`, optional audio/image settings).
2. Extend shared utilities (`normalizeModel`, metadata sanitizer, `impliedEffortForModel`) to support any responses-only aliases or reasoning overrides.
3. Define canonical error responses (`invalid_response_format`, `unsupported_modality`, `tool_choice_conflict`).
4. Ensure request context includes every field the transport layer needs (route/mode identifiers, sandbox/workdir, approval policy, tool flags).

**Deliverables**

- `src/handlers/responses/validation.js` (or similar) with exhaustive unit coverage.
- Updates to `src/lib/errors.js` and `src/config/models.js` documenting new IDs/codes.
- Notes capturing which helper modules are now shared between chat and responses.

**Dependencies**: Phase 1 decisions, `src/utils.js`, metadata sanitizers, error helpers.

## Phase 3 – Handler & Routing Layer

**Objectives**

1. Add `/v1/responses` routing (GET/HEAD/OPTIONS) and POST handlers for both non-stream and stream flows.
2. Mirror chat handler structure while emitting the Responses payload shape (top-level `response`, `output`, `usage`, `metadata`).
3. Wire up existing middleware (authorization, rate limiting, worker-ready guard, CORS, SSE concurrency guard) and logging so `/v1/responses` shows up uniformly in metrics.

**Deliverables**

- `src/routes/responses.js` plus `src/handlers/responses/{nonstream,stream}.js` leveraging Phase 2 validators.
- Updates to `buildBackendArgs`, optional parameter resolvers, and request-context helpers.

**Dependencies**: Phase 2 validation layer, middleware contracts.

## Phase 4 – Transport & Backend Integration

**Objectives**

1. Teach `JsonRpcChildAdapter` to map Responses instructions/input arrays to Codex JSON-RPC calls (`newConversation`, `sendUserTurn`, `sendUserMessage`) and to parse new notification types.
2. Extend SSE helpers/dev tracing so we emit OpenAI-style Responses events (with appropriate phases and metadata) and keep concurrency guards accurate.
3. Update usage logging so `/v1/responses` requests roll into `/v1/usage` and dev trace NDJSON consistently.

**Deliverables**

- Transport adapter updates with focused unit tests and JSON fixtures.
- SSE/helper changes (new event names, egress logging) plus documentation updates for proto traces.
- Usage/trace instrumentation updates referencing the new route.

**Dependencies**: Phases 1–3 outputs, Codex CLI JSON-RPC capabilities.

## Phase 5 – Tool Output & Response Assembly

**Objectives**

1. Build/extend an aggregator that produces Responses `output` arrays (text chunks, tool outputs, code interpreter blocks) and `output_text` convenience values.
2. Enforce `response_format` directives (`text`, `json_schema`), `tool_choice` behavior, and `max_output_tokens` truncation.
3. Capture tool execution metadata (name, arguments, output) deterministically so clients can process them in order.

**Deliverables**

- Enhanced `src/lib/tool-call-aggregator.js` (or responses-specific builder) plus sanitizer updates for tool payloads.
- New unit fixtures covering mixed tool/text flows, json_schema outputs, and truncation cases.

**Dependencies**: Phase 4 transport plumbing, Codex CLI tool output behavior.

## Phase 6 – Testing & Observability

**Objectives**

1. Expand unit coverage for validators, normalization utilities, transport, tool aggregation, and SSE logging.
2. Add integration tests for both sync and streaming responses (with and without tools) verifying HTTP bodies, SSE order, and usage totals.
3. Extend Playwright E2E suite to exercise `/v1/responses` against the dev stack (smoke + streaming scenarios).
4. Update dev tracing/usage endpoints and docs to highlight `/v1/responses` data paths.

**Deliverables**

- Vitest specs under `tests/unit/**/responses.*` and `tests/integration/responses.*`.
- Playwright scenarios with golden traces.
- Test evidence noted in `docs/test-design-epic-2.md` or equivalent runbooks.

**Dependencies**: Phases 2–5 implementation.

## Phase 7 – Documentation, Configuration & Rollout

**Objectives**

1. Document `/v1/responses` usage (curl snippets, SSE walkthroughs, tool output interpretation) across README, AGENTS, and new `docs/responses-endpoint` materials.
2. Introduce configuration toggles/feature flags if we need a phased rollout (`PROXY_ENABLE_RESPONSES` etc.).
3. Provide migration guidance for clients (Obsidian Copilot, IDE integrations) that expect Responses semantics.
4. Update deployment runbooks (dev stack smoke, prod smoke, live tests) so `/v1/responses` is exercised before release.

**Deliverables**

- Updated documentation + runbooks, including troubleshooting and migration guidance.
- Optional feature flag wiring and docs if needed.
- Deployment checklist entries referencing new smoke/E2E coverage.

**Dependencies**: Phases 1–6 completion, launch plan.

---

This overview is intentionally high-level; each phase should get its own task brief before work begins so we can size, schedule, and staff appropriately.
