# Codex App-Server Proxy Product Requirements Document (PRD)

**Author:** drj
**Date:** 2025-10-30
**Project Level:** 3
**Target Scale:** Level 3 (Complex integration)

> Note: The canonical BMAD PRD lives at `docs/bmad/prd.md`. This file is retained for historical context and may drift.

---

## Goals and Background Context

### Goals

- Maintain OpenAI-compatible `/v1/chat/completions` and `/v1/responses` APIs while migrating to the Codex App Server backend.
- Deliver the app-server cutover before the Codex CLI removes `codex proto`, ensuring zero customer downtime and ≥99.9% availability.
- Reduce request latency and operational overhead by adopting a persistent JSON-RPC worker with structured observability and restart controls.
- Refresh regression tests, smoke scripts, and deployment runbooks to validate JSON-RPC parity across staging and production.

### Background Context

Earlier versions of this proxy shelled out to the deprecated `codex proto` subcommand. The current default is the Codex app-server (JSON-RPC) worker path (`PROXY_USE_APP_SERVER=true`), with proto retained only as a fallback for compatibility and targeted tests.

Migrating to the Codex App Server lets us run a singleton JSON-RPC worker with deterministic adapters, enabling the proxy to preserve its OpenAI-compatible contract while gaining richer telemetry, lower latency, and a safer rollout path.

---

## Requirements

### Functional Requirements

Parity & Protocol
FR001: Preserve the existing `/v1/chat/completions` HTTP contract—headers, auth, payload schema, rate limits—when routing through the Codex App Server backend.
FR002: Match today’s streaming and non-streaming response shapes exactly (role-first SSE deltas, final `[DONE]`, finish reasons, tool-call payloads).
FR003: Translate OpenAI-formatted requests into the official Codex App Server JSON-RPC calls, including model selection, tool metadata, and conversation context.
FR004: Keep HTTP status codes, error bodies, and retry hints identical to current behavior; no client-visible regressions.

#### Tool-call Parity Enhancements (Stories 2.8–2.10)

- **FR002a – ToolCallAggregator module:** Implement a pure `src/lib/tool-call-aggregator` utility that ingests Codex JSON-RPC tool events and textual `<use_tool>` blocks, maintains per-choice state, exposes `ingestDelta()` / `ingestMessage()` / `snapshot()` / `resetTurn()`, and provides Obsidian XML helpers plus ordered parameter canon so downstream handlers emit canonical `<use_tool>` payloads without duplicating parsing logic.
- **FR002b – Handler integration:** Streaming and non-streaming chat handlers must rely on the aggregator for tool-call construction, enforce role-first SSE ordering, stop-after-first-tool semantics, configurable output modes (`obsidian-xml`, `openai-json`), and single `finish_reason:"tool_calls"` frames while suppressing tail text and dropping post-finish deltas.
- **FR002c – Regression & smoke coverage:** Provide deterministic structured/textual fixtures, extend unit/integration/Playwright suites, wire authenticated smoke tests (dev/prod) plus CI artifacts (transcripts/logs) so tool-call behavior is continuously validated, including parallel-call policy, disconnect handling, and UTF-8 safety for large arguments.
- **FR002d – Multi-tool turn fidelity:** When the Codex backend emits multiple tool calls in a single assistant turn, the proxy must forward every call in order for both streaming and non-streaming modes, set `finish_reason:"tool_calls"`, and retain configuration toggles (`TOOL_BLOCK_MAX`, `STOP_AFTER_TOOLS_MODE`, `SUPPRESS_TAIL_AFTER_TOOLS`) so legacy single-call behavior can be restored per environment. This requirement is normative per `docs/codex-proxy-tool-calls.md#multi-tool-turn-fidelity`.

Worker Lifecycle & Controls
FR005: Provide a documented runtime flag (e.g., `PROXY_USE_APP_SERVER`) that can switch between proto and app-server without redeploying.
FR006: Manage a persistent JSON-RPC worker with supervised restarts, bounded backoff, and health-based gating before accepting traffic.
FR007: Expose readiness/liveness probes that verify the worker is responsive prior to advertising the API as ready.
FR008: Support configurable concurrency limits and request timeouts so the driver can throttle or queue workloads safely.
FR009: Guarantee graceful shutdown drains in-flight requests, terminates the worker cleanly on SIGTERM/SIGINT, and reports failures.

Observability
FR010: Emit structured logs for worker lifecycle events (start, restart, exit) and per-request summaries (request id, model, tokens, latency).
FR011: Publish metrics (Prometheus-friendly) for throughput, latency percentiles, active streams, error categories, and restart counts.
FR012: Persist short-lived JSON-RPC trace artifacts that aid triage while respecting PII/secret scrubbing policies.

Testing & Tooling
FR013: Update unit, integration, and E2E suites to exercise JSON-RPC adapters with deterministic mocks and golden transcripts.
FR014: Refresh smoke scripts and CI jobs so staging/prod validation runs target the app-server by default with a documented fallback to proto.
FR015: Deliver deployment/runbook updates covering feature-flag operations, worker restart policy, rollback, and observability verification steps.

### Non-Functional Requirements

NFR001 (Availability): Maintain ≥99.9% uptime for `/v1/chat/completions` during and after the migration cutover window.
NFR002 (Latency): Streaming first-token latency and total response time must remain within ±5% of current P95 (baseline recorded pre-cutover).
NFR003 (Scalability): Worker must sustain current peak QPS with <70% CPU utilization while supporting burst scaling via configurable concurrency limits.
NFR004 (Resilience): Automatic recovery must restart the worker within 10 seconds of failure without dropping queued requests.
NFR005 (Observability): Logs, metrics, and traces must satisfy SOC audit requirements—PII redaction, retention limits, and dashboard coverage for latency, errors, and restarts.
NFR006 (Security): Preserve existing auth, rate limiting, and secrets handling; no new credentials or broader filesystem access introduced by the app-server.

---

## User Journeys

1. **Partner Streaming Request After Cutover**
   - Actors: Partner integration, API Gateway, Codex App Server worker, observability stack
   - Flow:
     1. Client sends a streaming `/v1/chat/completions` request with bearer token during peak traffic.
     2. Proxy validates auth, normalizes payload, and routes to the JSON-RPC worker via persistent channel.
     3. Worker streams role-first deltas back; proxy relays them unchanged and monitors latency budget.
     4. Metrics/logs capture request id, token counts, and latency; dashboards confirm SLA compliance (P95 within +5% baseline).
     5. Client receives `[DONE]` signal, continues conversation with zero awareness of backend switch.
     6. Support channels remain quiet; incident leads confirm no regressions.

2. **Worker Restart With Graceful Recovery**
   - Actors: App Server worker supervisor, readiness probe, SRE dashboards
   - Flow:
     1. Worker crashes due to CLI upgrade; supervisor detects exit code and initiates restart within 10 seconds.
     2. Readiness probe blocks new traffic until the worker completes initialization handshake (healthy within 8 seconds).
     3. In-flight requests drain gracefully; clients see either completed responses or retriable 5xx errors with standard retry hints.
     4. Structured logs and restart metrics trigger alert (`worker_restarts > 1`); SRE verifies stability and closes the incident once restarts stabilize.
     5. Feature flag stays on app-server; recovery completes inside SLA and error budget impact is logged for postmortem review.

3. **Codex Outage Mitigation Without Proto Fallback**
   - Actors: On-call engineer, incident commander, customer communications, Codex platform team
   - Flow:
     1. Monitoring detects Codex App Server instability; error budget burn alarm fires.
     2. Engineer toggles maintenance flag (temporary 503 with retry hints) while proto remains disabled; dashboards show controlled degradation.
     3. Incident commander posts status-page updates every 15 minutes and coordinates customer comms on workaround guidance.
     4. Ops partners with Codex platform to restore stability, validating via smoke tests and metrics before reopening traffic.
     5. Maintenance flag is cleared; post-incident review captures learnings and backlog items (e.g., `/v1/responses` epic) for future resilience.

---

## UX Design Principles

- Favor unobtrusive status cues that confirm backend health (streaming indicator, fallback status) without cluttering client UIs.
- Maintain parity in user-facing messaging; any migration-related notices should surface via status page, not API payloads.
- Prioritize accessibility in client dashboards—latency and error charts must remain screen-reader friendly and color-contrast compliant.

---

## User Interface Design Goals

- Keep existing OpenAI-compatible response formats unchanged, so tooling dashboards and clients render identically during and after cutover.
- Update internal ops dashboards to highlight app-server metrics (worker restarts, JSON-RPC latency) alongside legacy proto visuals until sunset.
- Surface feature-flag state and maintenance mode status in the operator UI for instant visibility during incidents.

---

## Epic List

1. **Epic 1: App-Server Platform Foundation** — Establish persistent Codex App Server worker, feature flag plumbing, and basic JSON-RPC adapter scaffolding. (Est. 8 stories)
2. **Epic 2: `/v1/chat/completions` JSON-RPC Parity** — Implement full request/response parity, streaming flow, and error handling over the new worker with exhaustive regression tests. (Est. 12 stories)
3. **Epic 3: Observability & Ops Hardening** — Deliver structured logging, metrics, health probes, restart policy, and updated runbooks/smoke tests for the app-server path. (Est. 7 stories)
4. **Epic 4: Production Cutover & Validation** — Execute staged rollout, monitor cutover, validate SLAs, and decommission proto fallback paths. (Est. 6 stories)
5. **Epic 5 (Post-Cutover): `/v1/responses` Expansion** — Introduce the new responses endpoint using the established JSON-RPC infrastructure once chat migration is stable. (Est. 9 stories)

> **Note:** Detailed epic breakdown with full story specifications is available in [epics.md](./epics.md)

**Epic Dependencies Summary**

- Epic 1 provides the worker, feature flag, and JSON-RPC scaffolding required for Epics 2-4.
- Epic 2 delivers request/response parity that allows observability hooks (Epic 3) to instrument real flows.
- Epic 3 equips SREs with metrics and alerts needed to execute the production cutover in Epic 4.
- Epics 1-4 collectively establish the infrastructure baseline so the `/v1/responses` expansion in Epic 5 can proceed safely post-cutover.

---

## Out of Scope

- Introducing new user-facing features or contract changes beyond existing `/v1/chat/completions` parity.
- Attempting to resurrect or rely on the deprecated `codex proto` backend after migration.
- Building `/v1/responses` or other new endpoints before the app-server cutover is complete and stable.
- Implementing multi-model routing, advanced tool integrations, or autoscaling strategies beyond baseline concurrency controls.
- Modifying authentication, billing, or rate-limit policies unrelated to the app-server migration.
