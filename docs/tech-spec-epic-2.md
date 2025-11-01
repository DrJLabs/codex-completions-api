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
- **Supporting config** — `src/config/models.js` for model normalization, `src/services/metrics/chat.js` to log latency budgets, and `src/services/errors/jsonrpc.js` for structured error mapping.

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

### Workflows and Sequencing

- **1. Schema Binding (Story 2.1):** Generate or author TypeScript types for command and notification payloads. Validate via unit tests using sample transcripts from the migration doc.
- **2. Request Translation (Story 2.2):** Implement normalization layer mapping OpenAI request fields to JSON-RPC parameters, covering streaming/tool variants. Add integration coverage with deterministic transport stub.
- **3. Streaming Adapter (Story 2.3):** Wire transport notifications to SSE writer, ensuring correct delta ordering, `[DONE]` emission, and latency logging.
- **4. Error Alignment (Story 2.4):** Map JSON-RPC errors/timeouts to existing HTTP error classes, integrate backoff/circuit breaker signals from supervisor.
- **5. Regression Evidence (Story 2.5):** Expand test suites and parity harness scripts in CI, capturing artifacts for review.
- **6. Rollout Checklist (Story 2.6):** Compile documentation summarizing parity results, operational readiness, and stakeholder sign-off checklist.

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

## Traceability Mapping

| Acceptance Criterion                        | Spec Sections                                                | Components / APIs                                    | Test Coverage                                                                  |
| ------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| JSON-RPC schema bindings validated          | Detailed Design → Services and Modules; Data Models          | `src/lib/json-rpc/schema.ts`                         | `tests/unit/json-rpc-schema.test.ts`                                           |
| Request translation mirrors OpenAI payloads | Detailed Design → Services and Modules / APIs and Interfaces | `src/handlers/chat/request.js`, transport client     | `tests/integration/chat-jsonrpc.test.js` (non-streaming/tool)                  |
| Streaming adapter preserves SSE contract    | Detailed Design → Workflows and Sequencing (Step 3)          | `src/handlers/chat/stream.js`                        | Golden transcripts via `scripts/parity/diff-fixtures.js`, Playwright SSE tests |
| Error handling and retries aligned          | Detailed Design → Services and Modules / NFR Reliability     | `src/services/errors/jsonrpc.js`, supervisor backoff | Integration negative tests; unit tests for error mapping                       |
| Regression suite & parity harness           | Test Strategy Summary                                        | `scripts/parity/*`, `tests/integration`, `tests/e2e` | CI pipeline artifacts, `npm test`                                              |
| Rollout checklist & documentation           | Dependencies and Integrations; Test Strategy                 | `docs/app-server-migration/*`                        | Manual checklist validation, PR review sign-off                                |

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

- [Resolved 2025-11-01][High] Story 2.1 — Reinstate strict pin of `@openai/codex` to 0.53.0 in dependencies and lockfile to preserve deterministic schema regeneration.
