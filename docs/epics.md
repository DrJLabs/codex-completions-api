# codex-completions-api - Epic Breakdown

**Author:** drj
**Date:** 2025-10-30
**Project Level:** 3
**Target Scale:** Level 3 (Complex integration)

---

## Overview

This document provides the detailed epic breakdown for codex-completions-api, expanding on the high-level epic list in the [PRD](./PRD.md).

Each epic includes:

- Expanded goal and value proposition
- Complete story breakdown with user stories
- Acceptance criteria for each story
- Story sequencing and dependencies

**Epic Sequencing Principles:**

- Epic 1 establishes foundational infrastructure and initial functionality
- Subsequent epics build progressively, each delivering significant end-to-end value
- Stories within epics are vertically sliced and sequentially ordered
- No forward dependencies - each story builds only on previous work

---

---

## Story Guidelines Reference

**Story Format:**

```
**Story [EPIC.N]: [Story Title]**

As a [user type],
I want [goal/desire],
So that [benefit/value].

**Acceptance Criteria:**
1. [Specific testable criterion]
2. [Another specific criterion]
3. [etc.]

**Prerequisites:** [Dependencies on previous stories, if any]
```

**Story Requirements:**

- **Vertical slices** - Complete, testable functionality delivery
- **Sequential ordering** - Logical progression within epic
- **No forward dependencies** - Only depend on previous work
- **AI-agent sized** - Completable in 2-4 hour focused session
- **Value-focused** - Integrate technical enablers into value-delivering stories

---

**For implementation:** Use the `create-story` workflow to generate individual story implementation plans from this epic breakdown.

## Epic 1: App-Server Platform Foundation

### Expanded Goal

Lay the groundwork for running the Codex App Server alongside the existing proxy by introducing a supervised worker, dual-mode configuration, and baseline transport plumbing so later epics can focus on parity and rollout without touching infrastructure.

### Stories

**Story 1.1: Add app-server feature flag scaffold**

As an operator,
I want the proxy to support a runtime switch between proto and app-server,
So that we can enable or disable the new backend without redeploying. (Proto retired; flag kept only for rollback documentation.)

**Acceptance Criteria:**

1. Environment variable (e.g., `PROXY_USE_APP_SERVER`) toggles backend selection at startup (proto path deprecated; default must be app-server).
2. Configuration docs outline defaults for dev, staging, and prod (all app-server).
3. Unit tests cover app-server default; proto path is historical only and must not be used.

**Prerequisites:** None

**Story 1.2: Package Codex CLI with app-server capability**

As a platform engineer,
I want the runtime image to include the required Codex CLI version and assets,
So that the proxy can launch the app-server worker reliably across environments.

**Acceptance Criteria:**

1. Dockerfile installs/pins Codex CLI >= 0.49 with JSON-RPC support.
2. Container image exposes `CODEX_HOME` writable path without leaking secrets.
3. Verify CLI availability via smoke script inside container build/test stage.

**Prerequisites:** Story 1.1

**Story 1.3: Implement worker supervisor and lifecycle hooks**

As a backend developer,
I want a supervised process that starts, restarts, and terminates the Codex App Server cleanly,
So that the API can rely on a persistent worker without manual intervention.

**Acceptance Criteria:**

1. Proxy boots the worker on startup and captures stdout/stderr for structured logging.
2. Restart policy handles crash loops with bounded backoff and surfaces failure metrics.
3. Graceful shutdown drains requests and terminates the worker within configured timeout.

**Prerequisites:** Stories 1.1-1.2

**Story 1.4: Establish JSON-RPC transport channel**

As an application developer,
I want the proxy to open and maintain the JSON-RPC connection to the worker,
So that higher-level adapters can send requests without reimplementing transport details.

**Acceptance Criteria:**

1. Connection handshake validates worker readiness and model advertisements.
2. Transport handles request IDs, timeouts, and retryable failures consistently.
3. Integration test proves a mock request/response round-trip through the channel.

**Prerequisites:** Stories 1.1-1.3

**Story 1.5: Wire readiness and liveness probes to worker state**

As an SRE,
I want health endpoints to reflect the worker’s status,
So that orchestrators only route traffic when the app-server is actually available.

**Acceptance Criteria:**

1. Liveness probe reports process availability; readiness waits for successful handshake.
2. Probe configuration documented for docker-compose and systemd deployments.
3. Failing worker causes readiness to flip false within 5 seconds.

**Prerequisites:** Stories 1.3-1.4

**Story 1.6: Document foundation and operational controls**

As a product operator,
I want runbooks and docs explaining the new worker controls,
So that teams know how to configure environments during later rollout.

**Acceptance Criteria:**

1. README/runbook updates describe feature flag usage, CLI requirements, and health checks.
2. Environment variable matrix added to config docs (`dev`, `staging`, `prod`).
3. Change log highlights migration readiness for partner teams.

**Prerequisites:** Stories 1.1-1.5

## Epic 2: `/v1/chat/completions` JSON-RPC Parity

### Expanded Goal

Achieve full functional parity for `/v1/chat/completions` by translating requests/responses to JSON-RPC, ensuring identical streaming behavior, error semantics, and regression evidence before any production cutover.

### Stories

**Story 2.0: Establish parity verification infrastructure**

As a QA engineer,
I want deterministic parity fixtures and automation in place before feature work,
So that Epic 2 development can rely on fast regression feedback and confident cutover readiness.

**Acceptance Criteria:**

1. Transcript capture tooling records app-server outputs for baseline chat, streaming, tool-call, and error scenarios, normalizing dynamic fields and storing version metadata in the repo. Proto captures are retired.
2. A parity diff harness runs in CI, comparing app-server fixtures with developer-friendly diagnostics, failing when transcripts diverge or required scenarios are missing.
3. The Epic 1 app-server baseline is deployed and smoke-tested, with the capture process documented so fixtures reflect production-ready behavior.

**Prerequisites:** Epic 1 stories delivering transport channel and worker lifecycle.

**Story 2.1: Define JSON-RPC schema bindings for chat**

As a backend developer,
I want typed bindings between the proxy and Codex App Server schema,
So that request and response translation is type-safe and future updates are manageable.

**Acceptance Criteria:**

1. Generate or hand-author TypeScript bindings for relevant JSON-RPC methods/events.
2. Schema version pinned and documented; tooling regenerates on CLI updates.
3. Unit tests validate serialization/deserialization round-trips for sample payloads.

**Prerequisites:** Epic 1 stories delivering transport channel.

**Story 2.2: Implement request translation layer**

As an application developer,
I want `/v1/chat/completions` requests normalized into JSON-RPC calls,
So that the worker can process them without knowing OpenAI-specific shapes.

**Acceptance Criteria:**

1. Handler maps model, messages, temperature, tools, and streaming flags to JSON-RPC format.
2. Input validation errors mirror existing behavior (status codes, messages).
3. Integration tests cover representative requests (simple chat, tool call, streaming).

**Prerequisites:** Story 2.1

**Story 2.3: Implement streaming response adapter**

As an application developer,
I want JSON-RPC streaming events converted back into SSE deltas,
So that clients observe identical role/token sequencing.

**Acceptance Criteria:**

1. Adapter handles partial deltas, final `[DONE]`, finish reasons, and tool-call payloads.
2. Latency budget tracked and logged for each stream.
3. Golden transcript tests compare app-server streaming outputs byte-for-byte; proto comparisons are historical only.

**Prerequisites:** Stories 2.1-2.2

**Story 2.4: Align error handling and retries**

As an operator,
I want deterministic error translation and retry mechanisms,
So that clients encounter the same HTTP codes and retry hints as before.

**Acceptance Criteria:**

1. JSON-RPC errors map to existing error classes and status codes.
2. Timeout/retry logic honors current exponential backoff policy.
3. Negative tests simulate worker/CLI errors to confirm parity.

**Prerequisites:** Stories 2.1-2.3

**Story 2.5: Update regression suite for parity evidence**

As a QA engineer,
I want automated regression tests capturing app-server behavior,
So that we can prove no regressions before rollout (proto retired).

**Acceptance Criteria:**

1. Unit and integration tests run against deterministic JSON-RPC mocks.
2. `npm run test:integration` and `npm test` incorporate app-server path.
3. CI artifacts include app-server parity comparison results (e.g., streaming transcripts); proto parity is removed.

**Prerequisites:** Stories 2.2-2.4

**Story 2.6: Document parity verification and rollout checklist**

As a program manager,
I want documented evidence and a sign-off checklist,
So that stakeholders approve production rollout with confidence.

**Acceptance Criteria:**

1. Parity checklist enumerates test suites, manual verifications, and metrics to review.
2. Evidence stored in repo (`docs/app-server-migration/`) with summary tables.
3. Stakeholder review plan scheduled (QA, SRE, product).

**Prerequisites:** Stories 2.1-2.5

**Story 2.7: Align JSON-RPC wiring with app-server schema**

As a backend developer,
I want the proxy's JSON-RPC requests and notifications to match the Codex app-server schema,
So that the dev stack can run purely on app-server without `-32600 Invalid Request` failures.

**Acceptance Criteria:**

1. Request normalization emits `initialize` and `sendUserTurn` payloads using the exact camelCase field names and structures from [codex-app-server-rpc.md](./app-server-migration/codex-app-server-rpc.md), including `clientInfo`, `conversationId`, `items`, tool metadata, and optional schema fields.
2. Transport layer sends JSON-RPC 2.0 frames with correct ids, handles newline-delimited responses, and upgrades readiness only after a successful initialize response; streaming notifications are parsed into the existing SSE adapter without losing metadata.
3. A harness (or automated test) exercises the CLI app-server binary via stdio using the documented script, proving successful initialize → sendUserTurn → streaming flow in CI with captured payload fixtures.
4. Documentation/runbooks updated to describe the schema source of truth and harness usage for future CLI updates.

**Prerequisites:** Stories 2.1-2.4

**Story 2.8: Implement ToolCallAggregator utility**

As a backend developer,
I want a reusable aggregator that assembles structured and textual tool-call fragments from the Codex app-server,
So that `/v1/chat/completions` can emit OpenAI-compatible `tool_calls` metadata without duplicating parsing logic.

**Acceptance Criteria:**

1. Deliver `src/lib/tool-call-aggregator.{js,ts}` that ingests Codex JSON-RPC tool signals and OpenAI-style function deltas, binds fragments per choice, and exposes `ingestDelta()`, `ingestMessage()`, `snapshot()`, and `resetTurn()` APIs with immutable outputs. [Source: docs/_archive/stories/2-8-implement-tool-call-aggregator.md]
2. Provide textual fallback helpers (`extractUseToolBlocks`, `registerTextPattern`) plus optional synthesis so `<use_tool>` payloads can be detected without structured events. [Source: docs/_archive/stories/2-8-implement-tool-call-aggregator.md]
3. Ship Obsidian XML utilities (`toObsidianXml`, ordered parameter canon, XML escaping/array serialization) so downstream handlers emit canonical `<use_tool>` content. [Source: docs/_archive/stories/2-8-implement-tool-call-aggregator.md]
4. Cover the module with unit tests (streaming, idempotency, textual fallback, mixed inputs) and author `docs/dev/tool-call-aggregator.md` describing the API, behaviors, and expectations. [Source: docs/_archive/stories/2-8-implement-tool-call-aggregator.md]

**Prerequisites:** Story 2.7

**Story 2.9: Stream & non-stream handler parity for tool calls**

As an application developer,
I want the streaming and non-streaming chat handlers to integrate the aggregator and emit proper SSE/JSON payloads,
So that clients experience OpenAI-perfect tool-call semantics in both modes.

**Acceptance Criteria:**

1. Streaming handler emits one assistant role chunk per choice, relays cumulative `delta.tool_calls` when aggregator state changes, synthesizes the `<use_tool>` block (structured or textual), suppresses tail text, applies `PROXY_STOP_AFTER_TOOLS`, and finishes with a single `finish_reason:"tool_calls"` chunk followed by `[DONE]`. [Source: docs/_archive/stories/2-9-stream-and-nonstream-tool-calls.md]
2. Non-stream handler supports two output modes: `obsidian-xml` (content contains the XML block, optional `tool_calls[]`) and `openai-json` (content `null` with populated `tool_calls[]`/`function_call`), both fed by aggregator snapshots with multi-call ordering preserved. [Source: docs/_archive/stories/2-9-stream-and-nonstream-tool-calls.md]
3. Finish-reason utilities, SSE writers, and disconnect handling enforce role-first ordering, no mixed frames, post-finish drop rules, and UTF-8 safe cumulative args; integration/E2E tests cover structured + textual flows for both output modes. [Source: docs/_archive/stories/2-9-stream-and-nonstream-tool-calls.md]
4. Add `PROXY_OUTPUT_MODE` defaulting to `obsidian-xml` plus `x-proxy-output-mode` override, and ensure backend errors before/after tool calls surface according to the new contract. [Source: docs/_archive/stories/2-9-stream-and-nonstream-tool-calls.md]

**Prerequisites:** Story 2.8

**Story 2.9a: Multi-tool calls per assistant turn**

As a backend developer,
I want streaming and non-streaming handlers to forward every tool call emitted in a turn,
So that clients receive complete OpenAI-compatible tool_call arrays and Obsidian `<use_tool>` blocks before regression testing starts.

**Acceptance Criteria:**

1. Streaming handler tracks `forwardedToolCount` per choice and emits all tool-call deltas plus `<use_tool>` chunks until the final call, honoring `STOP_AFTER_TOOLS_MODE` (first|burst) and `[DONE]` semantics. [Source: docs/PRD.md#functional-requirements; docs/codex-proxy-tool-calls.md#multi-tool-turn-fidelity]
2. Non-stream handler returns all tool calls in both JSON (`tool_calls[]`, `finish_reason:"tool_calls"`) and Obsidian XML (multiple `<use_tool>` blocks, delimiter support) with tail suppression happening only after the last call. [Source: docs/PRD.md#functional-requirements; docs/codex-proxy-tool-calls.md#non-streaming-detection--flow]
3. Config gates (`TOOL_BLOCK_MAX`, `STOP_AFTER_TOOLS_MODE`, `SUPPRESS_TAIL_AFTER_TOOLS`) default to unlimited/burst but allow legacy single-call behavior via flags. [Source: docs/PRD.md#functional-requirements]
4. Telemetry counters expose per-turn tool-call counts, and docs reference the new behavior for downstream consumers. [Source: docs/codex-proxy-tool-calls.md#multi-tool-turn-fidelity]

**Prerequisites:** Stories 2.8-2.9
**Prerequisite for:** Story 2.10

**Story 2.10: Tool-call regression and smoke coverage**

As a QA engineer,
I want automated regression and smoke coverage for structured and textual tool-call flows,
So that Obsidian Copilot scenarios remain green when the app-server backend changes.

**Acceptance Criteria:**

1. Create deterministic structured + textual fixtures under `tests/e2e/fixtures/tool-calls/` and reuse them across unit, integration, Playwright, and SSE transcript tests (role order, cumulative args, single finish, `[DONE]`). [Source: docs/_archive/stories/2-10-tool-call-regression-and-smoke.md]
2. Extend `npm run test:integration`, `npm test`, and Playwright suites with scenarios that assert tail suppression, post-finish drop rules, multi-choice isolation, large-argument UTF-8 safety, backend error paths, and `PROXY_ENABLE_PARALLEL_TOOL_CALLS` behavior. [Source: docs/_archive/stories/2-10-tool-call-regression-and-smoke.md]
3. Wire authenticated tool-call checks into `scripts/smoke/dev|prod` plus CI (including disconnect handling), and upload transcripts/logs on failure for triage. [Source: docs/_archive/stories/2-10-tool-call-regression-and-smoke.md]
4. Update `docs/test-design-epic-2.md`, migration/runbook references, and Obsidian Copilot guidance to include the new fixtures, commands, and verification steps. [Source: docs/_archive/stories/2-10-tool-call-regression-and-smoke.md]

**Prerequisites:** Stories 2.8-2.9

<a id="story-211-end-to-end-tracing"></a>
**Story 2.11: End-to-end tracing for dev server requests**

As a platform engineer,
I want deterministic tracing across ingress, transport, and egress in the dev stack,
So that every `/v1/chat|completions` request can be debugged by stitching sanitized trace artifacts.

**Acceptance Criteria:**

1. `/v1/chat|completions` handlers propagate a single `req_id` from `access-log` through `JsonRpcChildAdapter`, `appendProtoEvent`, and `appendUsage`, ensuring trace joins across HTTP logs, RPC events, and usage NDJSON. [Source: .bmad-ephemeral/stories/2-11-end-to-end-tracing.md]
2. `src/dev-trace/http.js` captures sanitized ingress payloads per request mode, and the transport/runner emit `rpc_request/response/notification` plus `backend_start/backend_exit` events with redacted params. [Source: .bmad-ephemeral/stories/2-11-end-to-end-tracing.md]
3. `src/services/sse.js` wraps `sendSSE`/`finishSSE` and non-stream handlers call `logJsonResponse`, logging every SSE payload, keepalive, `[DONE]`, and JSON response; `/v1/usage` summaries persist `req_id`, route, method, and status for correlation. [Source: .bmad-ephemeral/stories/2-11-end-to-end-tracing.md]
4. `src/dev-trace/sanitize.js` enforces redaction with `LOG_PROTO`/`PROXY_TRACE_REQUIRED` guards, and new docs plus `scripts/dev/trace-by-req-id.js` teach operators how to stitch access, proto, and token logs. [Source: .bmad-ephemeral/stories/2-11-end-to-end-tracing.md]

**Prerequisites:** Story 2.10

**Story 2.12: Stream tool-call buffering for Obsidian mode**

As an application developer,
I want the streaming handler to buffer textual `<use_tool>` blocks until their closing tags arrive,
So that Obsidian-mode clients only see each tool invocation once while structured `tool_calls[]` deltas remain unchanged.

**Acceptance Criteria:**

1. `src/handlers/chat/stream.js` tracks per-choice buffering state. When `<use_tool` is detected outside an active buffer, the handler pauses emission for that choice, accumulates incoming characters until `</use_tool>`, then forwards the canonical XML via `emitToolContentChunk()` exactly once before clearing the buffer.
2. Nested or malformed `<use_tool>` markers log a warning, flush the current buffer safely, and restart buffering so the stream never deadlocks. Cleanup paths flush partial buffers verbatim (disconnects, backend aborts) to preserve whatever Codex produced.
3. Buffered text still flows through the existing sanitizer/telemetry pipeline, and new counters (`tool_buffer_started`, `tool_buffer_flushed`, `tool_buffer_aborted`) feed ops dashboards via `/v1/usage`.
4. Unit, integration, and Playwright specs reproduce chunked textual blocks like `.codev/proto-events.ndjson` request `HevrLsVQESL3K1M3_3dHi`, asserting a single textual `<use_tool>` SSE chunk, no duplicate aggregator replay, and proper finish sequencing.
5. Documentation (`docs/tool-call-buffering-brief.md`, `docs/tech-spec-epic-2.md`, `docs/test-design-epic-2.md`) references the buffering design and test strategy.

**Prerequisites:** Story 2.9

## Epic 3: Observability & Ops Hardening

### Expanded Goal

Use the tracing/usage groundwork from Epic 2 to deliver production-grade observability, controlled degradation, and compliance for the app-server path.

### Stories

**Story 3.1: Structured logging schema**

As an SRE,
I want a standardized JSON logging schema for worker lifecycle and request/trace events,
So that incident timelines are consistent and redaction rules stay enforced.

**Acceptance Criteria:**

1. Define and apply a log schema (timestamp, severity, req_id, component/event fields, worker state) to worker lifecycle logs and existing trace/usage emitters.
2. Preserve redaction rules and avoid field drift across access, trace, and worker logs.
3. Document the schema and sampling/rotation expectations for ops.

**Prerequisites:** Epic 1 worker supervision; Epic 2 tracing in place.

**Story 3.2: Metrics export and dashboards**

As a monitoring engineer,
I want Prometheus-style metrics for the app-server path,
So that dashboards and alerts cover SLIs/SLOs with parity to proto.

**Acceptance Criteria:**

1. Expose a `/metrics` endpoint (or equivalent) with request counts, latency, error buckets, restarts, and the existing `tool_buffer_*` and restart counters.
2. Histogram/summary buckets align with current conventions; metrics document labels and cardinality expectations.
3. Dashboards/alerts created or updated for throughput, latency, errors, restarts, and tool-buffer anomalies.

**Prerequisites:** Stories 2.2-2.12, 3.1

**Story 3.3: Health probe robustness**

As a reliability engineer,
I want probes and tests that reflect worker state and restart/backoff behavior,
So that orchestrators react correctly to crashes and slow starts.

**Acceptance Criteria:**

1. Tests cover crash, slow-start, and restart scenarios, asserting readyz/livez transitions within documented thresholds.
2. Compose/systemd configs consume the probe endpoints and timing guidance.
3. Probes and metrics/logs corroborate each other in docs/runbooks.

**Prerequisites:** Stories 1.5, 3.1-3.2

**Story 3.4: Alerting and runbooks**

As an on-call engineer,
I want actionable alerts and updated runbooks for the app-server path,
So that incidents are triaged quickly using the new signals.

**Acceptance Criteria:**

1. Alerts cover latency/SLO breach, restart frequency, sustained error rate, and tool-buffer anomalies, referencing the new metrics.
2. Runbooks include `req_id` trace stitching, metrics/log queries, and escalation paths; dry-run exercise validates clarity.
3. Incident dashboards link to the trace-by-id helper and schema docs.

**Prerequisites:** Stories 3.1-3.3

**Story 3.5: Maintenance flag and comms workflow**

As an incident commander,
I want a controlled maintenance mode with retry hints and comms,
So that we can degrade safely without proto fallback.

**Acceptance Criteria:**

1. `PROXY_MAINTENANCE_MODE` (and guarded toggle endpoint) returns 503 with `Retry-After` + retryable hints; gated by auth.
2. Status-page templates and comms cadence documented; maintenance on/off is observable via logs/metrics/health.
3. Runbook includes rollback/exit criteria and captures follow-ups in incident review.

**Prerequisites:** Stories 3.1-3.4

**Story 3.6: Security/compliance review**

As a security lead,
I want logging/metrics/tracing reviewed for PII/retention/compliance impact,
So that observability features meet audit requirements.

**Acceptance Criteria:**

1. Validate redaction and retention for access/trace/usage/metrics outputs; document retention knobs and defaults.
2. Update threat model/pen test scope to include app-server observability surfaces.
3. Compliance checklist signed off with any remediation tickets filed.

**Prerequisites:** Stories 3.1-3.5

**Story 3.7: Trace buffer retention**

As an observability engineer,
I want an optional, TTL-limited JSON-RPC trace buffer,
So that rare incidents can be debugged without violating data-handling policies.

**Acceptance Criteria:**

1. If enabled, trace artifacts store `{timestamp}-{req_id}.json` under `.codex-api/trace-buffer/` with TTL/count limits and structured pruning logs/metrics.
2. Enablement is gated (env or flag) and documented alongside redaction/sanitization expectations.
3. Runbooks describe how to enable, inspect, and purge the buffer and when to prefer existing trace/usage logs.

**Prerequisites:** Stories 3.1-3.3, 3.6

## Epic 4: Production Cutover & Validation

### Expanded Goal

Execute a staged rollout that transitions production traffic to the Codex App Server, monitor NFRs in real time, and formally decommission proto (already completed; proto retired).

### Stories

**Story 4.1: Stage rollout plan and environment toggles**

As a release manager,
I want a documented rollout schedule and environment toggles,
So that we can migrate traffic gradually with clear checkpoints.

**Acceptance Criteria:**

1. Rollout plan covers staging, canary, partial prod, and full cutover with exit criteria.
2. Environment configs (compose/systemd) prepared with feature flag defaults for each phase.
3. Stakeholder sign-offs captured before rollout begins.

**Prerequisites:** Epics 1-3 complete.

**Story 4.2: Execute staging and canary validation**

As a QA lead,
I want to validate the app-server path in staging and limited production scope,
So that confidence is built before full rollout.

**Acceptance Criteria:**

1. Staging traffic runs entirely on the app-server with all automated tests passing.
2. Canary subset of production traffic flipped with live monitoring on NFRs.
3. Runbook entries updated with observations and sign-off recorded.

**Prerequisites:** Story 4.1

**Story 4.3: Full production cutover**

As an operations engineer,
I want to flip all production traffic to the app-server once checks pass,
So that the service fully decommissions proto usage. (Completed; proto retired.)

**Acceptance Criteria:**

1. Feature flag defaults set to app-server in production environment configs.
2. Real-time dashboards show SLA compliance during and after the cutover window.
3. Communication sent to stakeholders confirming successful cutover.

**Prerequisites:** Stories 4.1-4.2

**Story 4.4: Post-cutover monitoring and rollback readiness**

As an incident responder,
I want heightened monitoring and predefined rollback criteria,
So that we can react quickly if regressions surface post-cutover (without proto fallback).

**Acceptance Criteria:**

1. 48-hour heightened alert mode with SRE on watch; dashboards highlight key NFRs.
2. Maintenance flag path tested as contingency (proto fallback removed).
3. Retrospective documents lessons learned and backlog items.

**Prerequisites:** Story 4.3

**Story 4.5: Decommission proto artifacts** (Completed)

As a maintainer,
I removed proto-specific code paths, configs, and docs,
So that the codebase reflects the new architecture and avoids drift.

**Acceptance Criteria:**

1. Proto handlers, scripts, and references pruned from repository. (done)
2. Documentation updated to reflect app-server as sole backend. (done)
3. Migration checklist signed off by engineering leadership. (done)

**Prerequisites:** Story 4.4

## Epic 5: `/v1/responses` Expansion (Post-Cutover)

### Expanded Goal

Leverage the stabilized app-server infrastructure to introduce the `/v1/responses` endpoint with parity to OpenAI's shape, ensuring clients gain new capabilities without jeopardizing the freshly migrated `/v1/chat/completions`.

### Stories

**Story 5.1: Scope `/v1/responses` requirements**

As a product manager,
I want to define the MVP contract for `/v1/responses`,
So that development targets a focused, high-value release.

**Acceptance Criteria:**

1. Requirements doc captures request/response schema, streaming nuances, and security considerations.
2. Stakeholders agree on priorities (tool-call support, streaming, partial responses).
3. Dependencies (CLI features, backend capabilities) documented.

**Prerequisites:** Epics 1-4 completed and stable.

**Story 5.2: Extend JSON-RPC bindings for responses**

As a backend developer,
I want schema bindings for response operations,
So that request/response translation is type-safe.

**Acceptance Criteria:**

1. Type definitions generated for responses-related methods/events.
2. Tests validate serialization/deserialization against sample transcripts.
3. Versioning strategy defined for schema updates.

**Prerequisites:** Story 5.1

**Story 5.3: Implement `/v1/responses` handlers**

As an application developer,
I want to expose the new endpoint using the existing worker transport,
So that clients can invoke responses without bespoke infrastructure.

**Acceptance Criteria:**

1. Request normalization covers conversation state, instructions, and streaming options.
2. Response adapter mirrors OpenAI contract, including incremental updates if supported.
3. Error handling matches existing policies and returns actionable retry hints.

**Prerequisites:** Stories 5.1-5.2

**Story 5.4: Regression tests and documentation**

As a QA lead,
I want automated tests and docs verifying `/v1/responses` behavior,
So that partners can adopt the endpoint confidently.

**Acceptance Criteria:**

1. Unit/integration tests cover key scenarios (non-streaming, streaming, tool calls).
2. E2E tests confirm SSE contract and latency expectations.
3. API docs and examples published alongside PRD update.

**Prerequisites:** Story 5.3

**Story 5.5: Pilot rollout and customer feedback**

As a product manager,
I want to launch `/v1/responses` with selected partners,
So that real-world feedback informs general availability.

**Acceptance Criteria:**

1. Pilot cohort identified with success metrics and feedback cadence.
2. Monitoring dashboards include responses-specific SLIs.
3. General availability decision documented with follow-up tasks.

**Prerequisites:** Stories 5.1-5.4
