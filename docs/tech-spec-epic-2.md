# Epic Technical Specification: /v1/chat/completions JSON-RPC Parity

Date: 2025-10-31
Author: drj
Epic ID: 2
Status: Draft

---

## Overview

This epic completes the migration of `/v1/chat/completions` onto the Codex App Server by adding JSON-RPC request/response adapters, preserving the proxy's OpenAI-compatible contract called out in FR001–FR004. Building on the supervised worker and transport channel landed in Epic 1, we translate every chat invocation into deterministic JSON-RPC calls while maintaining identical latency budgets, streaming semantics, and retry envelopes.

The work establishes automated parity evidence so production rollout can proceed with confidence. Transcript capture, schema bindings, and regression harnesses provide objective proof that the new backend matches proto behavior before we touch traffic toggles.

## Objectives and Scope

- **In Scope:**
  - Normalize `/v1/chat/completions` payloads into typed JSON-RPC requests (`sendUserTurn`, `sendUserMessage`) with full option coverage (models, tools, temperature, streaming flags).
  - Convert JSON-RPC notifications back into role-first SSE chunks and non-streaming responses, including finish reasons, tool-call payloads, and usage accounting.
  - Harden error, timeout, and retry handling so HTTP status codes, retry hints, and envelopes match existing behavior.
  - Produce deterministic parity fixtures, CI diff automation, and rollout documentation required by Stories 2.0–2.6.
- **Out of Scope:**
  - Changes to `/v1/responses`, maintenance flag behavior, or observability pipelines owned by later epics.
  - Reworking the worker supervisor, feature flag plumbing, or transport lifecycle delivered in Epic 1 except for interfaces we must consume.
  - Multi-model routing or autoscaling beyond tuning existing `WORKER_MAX_CONCURRENCY` limits.

## System Architecture Alignment

The design aligns with architecture sections mapping Epic 2 to `src/routes`, `src/handlers/chat`, and `src/lib/json-rpc*`. We rely on the single-worker transport (`src/services/transport`) introduced earlier, extend it with schema bindings, and ensure SSE gateways continue to emit OpenAI-shaped deltas. Regression evidence integrates with `tests/integration`, `tests/e2e`, and new parity harness scripts, while deployment remains governed by the Docker Compose and Traefik constraints documented in `docs/architecture.md` and `docs/app-server-migration/`.

## Detailed Design

### Services and Modules

- **`src/lib/json-rpc/schema.ts`** — houses generated or hand-authored TypeScript bindings for Codex App Server methods (`initialize`, `sendUserTurn`, `sendUserMessage`, `agentMessageDelta`, `agentMessage`, `tokenCount`, error envelopes). Exports discriminated unions and helper codecs for serialization/deserialization.
- **`src/services/transport/appServerClient.js`** — extends the Epic 1 transport to register JSON-RPC method handlers, manage outstanding request maps, and expose typed send functions consumed by chat handlers.
- **`src/handlers/chat/request.js`** — normalizes `/v1/chat/completions` payloads into JSON-RPC calls, validating inputs and mapping options (model, tools, temperature, max_tokens, n) to transport invocations.
- **`src/handlers/chat/stream.js`** — converts JSON-RPC notifications into SSE deltas, applying finish-reason mapping and usage accounting while preserving role-first emission ordering.
- **`src/handlers/chat/nonStream.js`** — accumulates JSON-RPC responses for non-streaming requests, constructing OpenAI-compatible payloads with deterministic `usage` fields.
- **`tests/integration/chat-jsonrpc.test.js`** — exercises request translation and response adapters against the deterministic Codex shim, covering chat, tool-call, streaming, and error scenarios.
- **Parity harness scripts (`scripts/parity/generate-fixtures.js`, `scripts/parity/diff-fixtures.js`)** — capture proto vs. app-server transcripts, sanitize dynamic fields, and surface CI diagnostics.
- **`src/lib/tool-call-aggregator.js`** — merges structured and textual tool-call deltas, tracks per-choice completion, and synthesizes `<use_tool>` XML used by streaming/non-streaming handlers.
- **`src/handlers/chat/stream.js` – multi-tool extensions** — maintain `forwardedToolCount`, `lastToolEnd`, and burst timers so every tool call emits before the finish frame, honoring `STOP_AFTER_TOOLS_MODE` semantics.
- **`src/handlers/chat/stream.js` – tool-call buffering (Story 2.12)** — textual `<use_tool>` content that streams over multiple SSE chunks pauses outbound emission, accumulates into a per-choice `activeToolBuffer`, and flows through `emitToolContentChunk()` once the closing tag arrives; cleanup flushes partial buffers, malformed XML logs warnings, and telemetry counters (`tool_buffer_started/flushed/aborted`) expose behavior.
- **`src/handlers/chat/tool-buffer.js`** — standalone helper that encapsulates buffer detection, nested marker handling, and `skipUntil` tracking so the streaming handler remains focused on SSE emission.
- **`src/services/metrics/chat.js`** — lightweight counters for tool-buffer lifecycle events exposed through `/v1/usage` (plus `/v1/usage/raw`) for operators, with legacy `/__test/tool-buffer-metrics` routes (gated by `PROXY_TEST_ENDPOINTS`) retained for CI resets.
- **`src/handlers/chat/nonstream.js` – multi-call envelopes** — concatenate ordered `<use_tool>` blocks, set `content:null` with `tool_calls[]` in OpenAI JSON mode, and respect delimiter/tail suppression flags for burst scenarios.
- **`src/config/index.js` + documentation (`docs/codex-proxy-tool-calls.md`, `docs/app-server-migration/codex-completions-api-migration.md`)** — expose `PROXY_TOOL_BLOCK_MAX`, `PROXY_STOP_AFTER_TOOLS`, `PROXY_STOP_AFTER_TOOLS_MODE`, `PROXY_TOOL_BLOCK_DELIMITER`, `PROXY_TOOL_BLOCK_DEDUP`, `PROXY_SUPPRESS_TAIL_AFTER_TOOLS`, and `PROXY_ENABLE_PARALLEL_TOOL_CALLS` with defaults and rollback guidance.
- **Supporting config** — `src/config/models.js` for model normalization, `src/services/metrics/chat.js` to log latency budgets, and `src/services/errors/jsonrpc.js` for structured error mapping.
- **`src/dev-trace/http.js`, `src/dev-trace/sanitize.js`, `src/services/sse.js` instrumentation, and `scripts/dev/trace-by-req-id.js`** — add deterministic tracing across ingress, JSON-RPC submission, backend lifecycle, SSE/non-stream egress, and `/v1/usage` summaries with strict sanitization + operator tooling (Story 2.11).

### Story 2.11: End-to-end tracing

Story 2.11 layers deterministic tracing on top of the parity foundation. Chat/completions handlers reuse the `access-log` `req_id` (falling back to `nanoid`) and propagate it to `JsonRpcChildAdapter`, `codex-runner`, SSE helpers, and `/v1/usage` bookkeeping so access logs, proto traces, and token summaries can be stitched together. `src/dev-trace/http.js` captures sanitized ingress payloads per request mode, `src/dev-trace/sanitize.js` centralizes redaction, and transport instrumentation emits `rpc_request`, `rpc_response`, `rpc_notification`, plus `backend_start/backend_exit` events. `src/services/sse.js` wraps `sendSSE`/`finishSSE` (plus non-stream `res.json`) to log payloads, keepalives, `[DONE]`, and HTTP statuses, while usage summaries persist `req_id`, route, method, and status for trace joins. `LOG_PROTO`/`PROXY_TRACE_REQUIRED` gates prevent accidental opt-out, and `docs/bmad/architecture/end-to-end-tracing-app-server.md` with `scripts/dev/trace-by-req-id.js` teach operators how to stitch access, proto, and token logs when debugging multi-tool regressions.

### Story 2.12: Stream tool-call buffering

Story 2.12 extends the streaming handler so textual `<use_tool>` blocks only reach clients once. Each choice maintains `activeToolBuffer`; upon detecting `<use_tool`, outbound emission pauses and characters accumulate until the matching `</use_tool>`. The buffered XML then flows through the existing sanitizer and `emitToolContentChunk()` once, after which the buffer clears. Disconnect cleanup flushes partial buffers verbatim, nested tags log warnings and restart buffering, and telemetry counters (`tool_buffer_started`, `tool_buffer_flushed`, `tool_buffer_aborted`) now surface through `/v1/usage` so ops dashboards can observe buffer behavior. Unit/integration/Playwright fixtures replay the `.codev/proto-events.ndjson` regression sample (via `scripts/replay-codex-fixture.js`) to prove the duplication fix.

### Data Models and Contracts

- **JSON-RPC Request Objects:**
  - `InitializeParams` — includes `client_info` (name/version) and capability flags.
  - `UserTurnParams` — identifies conversation context; includes optional `conversation_id` and metadata to ensure stateless per-request sessions.
  - `UserMessageParams` — carries flattened message array, tool definitions, sampling parameters, and streaming toggle.
- **JSON-RPC Notifications:**
  - `AgentMessageDeltaNotification` — partial assistant content; schema enumerates `delta_type` (text/tool_call) and payload.
  - `AgentMessageNotification` — terminal assistant message with finish reason, tool usage, and metadata.
  - `TokenCountNotification` — numeric prompt/completion totals per request.
- **Error Envelope (`JsonRpcError`)** — mirrors Codex worker error shape (code, message, data) with adapters mapping to existing HTTP error classes.
- **Parity Fixture Schema:** metadata header (CLI version, commit, timestamp) plus arrays of events representing proto/app transcripts for diffing.

### APIs and Interfaces

- **Transport API:**
  - `startAppServer()` — boots worker, resolves when `initialize` handshake completes.
  - `sendUserTurn(requestContext)` — issues JSON-RPC request, returns resolved conversation identifiers.
  - `sendUserMessage(requestContext, payload)` — streams requests; returns promise resolving when terminal response received.
- **Handler Interfaces:**
  - `normalizeChatRequest(openAiPayload)` → `{ rpcParams, options }` for transport.
  - `handleStreamingResponse(rpcStream, res)` → writes SSE chunks, manages abort/timeout semantics.
  - `materializeNonStreamingResponse(rpcResult)` → constructs OpenAI response with aggregated usage and metadata.
- **Parity Harness CLI:**
  - `generate-fixtures --scenario <name>` → captures dual transcripts, writes to `docs/app-server-migration/parity-fixtures/`.
  - `diff-fixtures` → compares fixtures, prints structured diff, fails CI on mismatch.

### Multi-tool Turn Fidelity (Stories 2.9 & 2.9a)

- Streaming handler must emit the assistant role chunk, then a `<use_tool>` frame for **every** tool call recorded by the aggregator before writing the single canonical finish chunk (`finish_reason:"tool_calls"`) and `[DONE]`. Burst handling honors `STOP_AFTER_TOOLS_MODE` (`first` legacy vs `burst` grace) and only suppresses tail text after the final call per choice.
- Non-stream handler and responses adapter build a single assistant message that contains all `<use_tool>` blocks (Obsidian mode) or `content:null` with the complete `tool_calls[]` array (OpenAI JSON). Ordered tool calls stay isolated per choice, and configurable `TOOL_BLOCK_DELIMITER` / tail suppression settings determine how blocks render.
- Configuration gates (`PROXY_TOOL_BLOCK_MAX`, `PROXY_STOP_AFTER_TOOLS`, `PROXY_STOP_AFTER_TOOLS_MODE`, `PROXY_SUPPRESS_TAIL_AFTER_TOOLS`, `PROXY_TOOL_BLOCK_DEDUP`, `PROXY_TOOL_BLOCK_DELIMITER`, `PROXY_ENABLE_PARALLEL_TOOL_CALLS`) default to unlimited/burst but allow immediate rollback to single-call behavior when capped.
- Telemetry increments `tool_call_count_total`, `tool_call_truncated_total`, and structured log fields (burst size, truncation reason, config overrides). Smoke/Playwright suites and `scripts/smoke/*` collect multi-call transcripts for regression evidence reused by Story 2.10.

### Workflows and Sequencing

- **1. Schema Binding (Story 2.1):** Generate or author TypeScript types for command and notification payloads. Validate via unit tests using sample transcripts from the migration doc.
- **2. Request Translation (Story 2.2):** Implement normalization layer mapping OpenAI request fields to JSON-RPC parameters, covering streaming/tool variants. Add integration coverage with deterministic transport stub.
- **3. Streaming Adapter (Story 2.3):** Wire transport notifications to SSE writer, ensuring correct delta ordering, `[DONE]` emission, and latency logging.
- **4. Error Alignment (Story 2.4):** Map JSON-RPC errors/timeouts to existing HTTP error classes, integrate backoff/circuit breaker signals from supervisor.
- **5. Regression Evidence (Story 2.5):** Expand test suites and parity harness scripts in CI, capturing artifacts for review.
- **6. Rollout Checklist (Story 2.6):** Compile documentation summarizing parity results, operational readiness, and stakeholder sign-off checklist.
- **7. Tool-call Parity Hardening (Story 2.9):** Integrate the ToolCallAggregator with both streaming and non-streaming handlers, enforce role-first ordering, output-mode toggles, and finish-reason normalization, and refresh transcripts/tests documenting single-call parity.
- **8. Multi-tool Turn Fidelity (Story 2.9a):** Enable burst forwarding of multiple tool calls per assistant turn, add config/telemetry controls (`PROXY_TOOL_BLOCK_MAX`, `PROXY_STOP_AFTER_TOOLS_MODE`, etc.), and extend unit/integration/E2E/smoke suites plus docs so Story 2.10 can rely on the new behavior.
- **9. Dev tracing instrumentation (Story 2.11):** Build the `req_id` spine, tracing helpers, sanitization/enforcement, `/v1/usage` linkage, and operator script/doc updates required to debug dev server requests end-to-end.

## Non-Functional Requirements

### Performance

- Leverage existing transport concurrency cap (`WORKER_MAX_CONCURRENCY`) and embed per-request timers in the translation layer to enforce NFR002’s ±5 % latency budget.
- Record streaming first-token latency and total duration via `src/services/metrics/chat.js`, emitting Prometheus histograms and logging when SLAs breached.
- Ensure request translation avoids extra serialization overhead; reuse shared buffers where possible.

### Security

- Reuse existing auth middleware and bearer validation before requests hit the translation layer; no new credentials introduced.
- Maintain sandbox and configuration flags forwarded to the worker (`sandbox_mode="workspace-write"`) without broadening filesystem access.
- Audit JSON-RPC payload logging to prevent PII exposure; rely on existing redaction utilities for transcript artifacts.

### Reliability/Availability

- Surface JSON-RPC errors through the established supervisor backoff path; failed requests bubble retryable hints as before.
- Timeouts trigger the same exponential retry policy with optional worker restart when consecutive failures occur.
- Maintain readiness gating: worker handshake must complete before the adapter accepts traffic.

### Observability

- Extend structured logs with `rpc_method`, `rpc_request_id`, and latency fields while preserving existing schema.
- Publish new Prometheus counters (`codex_rpc_requests_total`, `codex_rpc_errors_total`) and reuse existing latency histograms.
- Attach parity harness outputs to CI artifacts; include CLI version metadata for audit trails.

## Dependencies and Integrations

- Codex App Server worker (Epic 1) with supervisor, readiness probes, and feature flag.
- `@openai/codex@0.53.x` CLI providing JSON-RPC schema and notifications.
- Transport service (`src/services/transport/appServerClient.js`) for lifecycle/backoff.
- Metrics/logging pipelines to ingest new RPC telemetry.
- Parity tooling (`scripts/parity/*`) for fixture capture and diff automation.
- Coordination with support/SRE stakeholders for documentation alignment.

## Acceptance Criteria (Authoritative)

1. JSON-RPC schema bindings generated or curated in `src/lib/json-rpc/schema.ts`, with unit tests covering serialization/deserialization for all chat methods/events (Story 2.1).
2. `/v1/chat/completions` requests translate to JSON-RPC calls covering non-streaming, streaming, and tool-call scenarios; validation errors mirror existing HTTP responses (Story 2.2).
3. Streaming adapter emits role-first SSE chunks and `[DONE]` terminators identical to proto output, with golden transcript tests demonstrating parity for baseline scenarios (Story 2.3).
4. Error, timeout, and retry paths map JSON-RPC failures to existing error envelopes and backoff behavior, including retryable hints (Story 2.4).
5. Regression suite (`npm run test:integration`, `npm test`) exercises JSON-RPC path, parity harness diffs proto vs. app-server transcripts, and CI artifacts capture comparison output (Story 2.5).
6. Rollout checklist published in `docs/app-server-migration/` documenting parity evidence, metrics to monitor, and stakeholder approvals required before traffic cutover (Story 2.6).
7. Tool-call aggregator integration ensures both streaming and non-streaming handlers emit role-first assistant frames, `<use_tool>` content, and `finish_reason:"tool_calls"` per choice, with OpenAI JSON vs Obsidian modes sharing the same state (Story 2.9).
8. Multi-tool burst handling forwards every tool call emitted in a turn, honoring `PROXY_TOOL_BLOCK_MAX`, `PROXY_STOP_AFTER_TOOLS`, and `PROXY_STOP_AFTER_TOOLS_MODE` semantics so operators can cap bursts or revert to legacy single-call behavior (Story 2.9a).
9. Non-stream envelopes concatenate all `<use_tool>` blocks (with optional `TOOL_BLOCK_DELIMITER`), set `content:null` + complete `tool_calls[]` arrays, and only suppress tail text after the final block; streaming/textual fallbacks follow the same order (Story 2.9a).
10. Telemetry (`tool_call_count_total`, `tool_call_truncated_total`) and documentation (`docs/codex-proxy-tool-calls.md`, migration guide, smoke instructions) capture the new defaults, and regression suites (unit/integration/E2E/smoke) exercise multi-call bursts before Story 2.10 resumes (Story 2.9a).
11. Deterministic tracing covers ingress, JSON-RPC submission, backend lifecycle, SSE/non-stream egress, and `/v1/usage` summaries with shared `req_id`, sanitized payloads, enforcement flags (`LOG_PROTO`, `PROXY_TRACE_REQUIRED`), and operator documentation/script support (Story 2.11).

## Traceability Mapping

| Acceptance Criterion                        | Spec Sections                                                | Components / APIs                                    | Test Coverage                                                                  |
| ------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| JSON-RPC schema bindings validated          | Detailed Design → Services and Modules; Data Models          | `src/lib/json-rpc/schema.ts`                         | `tests/unit/json-rpc-schema.test.ts`                                           |
| Request translation mirrors OpenAI payloads | Detailed Design → Services and Modules / APIs and Interfaces | `src/handlers/chat/request.js`, transport client     | `tests/integration/chat-jsonrpc.test.js` (non-streaming/tool)                  |
| Streaming adapter preserves SSE contract    | Detailed Design → Workflows and Sequencing (Step 3)          | `src/handlers/chat/stream.js`                        | Golden transcripts via `scripts/parity/diff-fixtures.js`, Playwright SSE tests |
| Error handling and retries aligned          | Detailed Design → Services and Modules / NFR Reliability     | `src/services/errors/jsonrpc.js`, supervisor backoff | Integration negative tests; unit tests for error mapping                       |
| Regression suite & parity harness           | Test Strategy Summary                                        | `scripts/parity/*`, `tests/integration`, `tests/e2e` | CI pipeline artifacts, `npm test`                                              |
| Rollout checklist & documentation           | Dependencies and Integrations; Test Strategy                 | `docs/app-server-migration/*`                        | Manual checklist validation, PR review sign-off                                |
| Tool-call aggregator parity (Story 2.9)     | Detailed Design → Multi-tool Turn Fidelity; Services & Modules | `src/lib/tool-call-aggregator.js`, `src/handlers/chat/{stream,nonstream}.js` | `tests/integration/chat.stream.tool-calls.int.test.js`, `tests/integration/chat.nonstream.tool-calls.int.test.js` |
| Burst config controls (Story 2.9a)          | Detailed Design → Multi-tool Turn Fidelity; Dependencies     | `src/config/index.js`, runtime env flags             | `tests/unit/config/tools-mode.test.js`, `tests/integration/chat.multi-choice-tools.int.test.js`                  |
| Multi-call envelopes + ordering (Story 2.9a)| Detailed Design → Multi-tool Turn Fidelity                   | `src/handlers/chat/nonstream.js`, responses adapter  | `tests/integration/chat.nonstream.multi-call.int.test.js`, `tests/e2e/tool-calls.spec.ts`                       |
| Telemetry & docs for bursts (Story 2.9a)    | Observability; Detailed Design → Multi-tool Turn Fidelity    | `src/services/metrics/chat.js`, `docs/codex-proxy-tool-calls.md`, `scripts/smoke/*` | `tests/integration/chat.telemetry.tool-calls.int.test.js`, `scripts/smoke/dev|prod` evidence                      |

## Risks, Assumptions, Open Questions

- **R1 – Transcript drift between proto and app-server (Risk Score 6, TECH):** Mitigated via deterministic fixture generator, metadata stamping, and CI diff harness. Owners: QA (2025-11-05).
- **R2 – Scenario coverage gaps (Risk Score 6, DATA):** Maintain parity scenario matrix tied to acceptance criteria; harness fails if required fixtures missing. Owners: QA (2025-11-06).
- **R3 – CLI/schema drift invalidating bindings (Risk Score 4, TECH):** Pin `@openai/codex` version, regenerate bindings on version bumps, enforce mismatch failure in CI. Owners: Dev (2025-11-05).
- **R4 – Increased CI runtime (Risk Score 4, OPS):** Shard parity diffs, monitor duration (<5 min) and optimize sanitization if needed. Owners: DevOps (2025-11-07).
- **Assumptions:** App Server JSON-RPC contract remains stable for chat; proto remains available for baseline comparisons; CI agents have Codex CLI access without external dependencies.
- **Open Questions:** Need confirmation on long-term storage policy for parity fixtures (retain vs. regenerate); clarify whether tool-call streaming events require additional observability hooks (coordinate with Epic 3).

## Test Strategy Summary

- **Test Layers:**
  - Unit: Validate JSON-RPC bindings, request normalization helpers, error mapping (`npm run test:unit`).
  - Integration: Exercise `/v1/chat/completions` flow against deterministic transport shim covering chat, streaming, tool-call, and error scenarios (`npm run test:integration`).
  - E2E: Playwright suites verify SSE contract and non-streaming parity end-to-end (`npm test`).
- **Parity Harness:** Scripts under `scripts/parity/` capture proto/app transcripts (baseline, streaming, tool-call, error), sanitize dynamic fields, and diff in CI with artifacts for review.
- **Regression Cadence:**
  - P0 scenarios (baseline, streaming, error parity) run on every commit.
  - P1 scenarios (multi-turn, tool-call, latency budgeting) on PRs to `main`.
  - P2/P3 nightly suites cover extended edge cases and manual verification (per `docs/test-design-epic-2.md`).
- **Gate Criteria:** 100% pass rate on P0 parity suites, CLI version metadata match, checklist sign-off before enabling traffic flag.

## Post-Review Follow-ups

- [Resolved 2025-11-01] High priority — Story 2.1: Reinstate strict pin of `@openai/codex` to 0.53.0 in dependencies and lockfile to preserve deterministic schema regeneration.
- [Resolved 2025-11-16] Story 2.11: Ensure `logHttpRequest` fires immediately after JSON parsing (before validation or auth exits) in all chat/completions handlers so even unauthorized requests produce `phase:"http_ingress"` traces (current implementation still sits behind the API-key guard).
- [Resolved 2025-11-16] Story 2.11: Emit `appendUsage` entries (req_id/route/method/mode/status_code) for every exit path—including auth failures and validation/transport errors—so `/v1/usage/raw` stays joinable with HTTP ingress traces per Phase 5 of the tracing plan.
- [Resolved 2025-11-19] Story 2.12: Surface the `codex_tool_buffer_*` counters via the production metrics/usage pipeline so ops can monitor buffer behavior without enabling `PROXY_TEST_ENDPOINTS`.
- [Resolved 2025-11-19] Story 2.12: Capture a deterministic integration/Playwright replay of `.codev/proto-events.ndjson` request `HevrLsVQESL3K1M3_3dHi` as AC5 requires, or document why the canonical transcript cannot be used.
