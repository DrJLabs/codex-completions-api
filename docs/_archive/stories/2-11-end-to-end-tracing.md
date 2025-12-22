# Story 2.11: End-to-end tracing for dev server requests

Status: done

## Story

As a platform engineer,
I want deterministic end-to-end tracing across the dev server request pipeline,
so that inconsistent tool-call behavior can be debugged by replaying and inspecting every transformation from HTTP ingress through JSON-RPC and SSE egress.

## Acceptance Criteria

1. **Single `req_id` spine** – `/v1/chat|completions` handlers MUST reuse `res.locals.req_id` from `access-log` (falling back to `nanoid()` only if it is unexpectedly absent), propagate it in a `ctx` object into `JsonRpcChildAdapter`, and ensure every trace event emitted via `appendProtoEvent` and every usage event via `appendUsage` includes that `req_id` so a single correlation ID spans HTTP ingress, JSON-RPC transport, client egress, and usage summaries. Under normal operation `req_id` MUST always be present once handlers run; logging helpers MUST NOT silently skip logging when `req_id` is missing (they may assert or emit an explicit error event instead)._[Source: docs/dev/end-to-end-tracing-plan.app-server.md#61-phase-0--align-request-ids-http--handlers--transport]_ _[Source: docs/tech-spec-epic-2.md#story-211-end-to-end-tracing]_ _[Source: docs/epics.md#story-211-end-to-end-tracing]_  
2. **HTTP ingress logging** – A new `src/dev-trace/http.js::logHttpRequest` helper MUST record method, route, sanitized headers (with `Authorization` and similar secret-bearing fields redacted), and the OpenAI-shaped request body as received from the client for each mode (`chat_stream`, `chat_nonstream`, `completions*`), optionally truncating large bodies with a clear truncation marker. It MUST run exactly once per request after JSON body parsing but before any semantic mutation or normalization, and each ingress event MUST include `phase:"http_ingress"`, `kind:"client_request"`, and `direction:"inbound"`._[Source: docs/dev/end-to-end-tracing-plan.app-server.md#62-phase-1--http-ingress-capture-backend-agnostic]_ _[Source: docs/tech-spec-epic-2.md#story-211-end-to-end-tracing]_ _[Source: docs/epics.md#story-211-end-to-end-tracing]_  
3. **JSON-RPC submission + IO visibility** – `JsonRpcChildAdapter` (and any wrappers) MUST route all app-server calls through a single `callRpc(ctx, method, params)` entrypoint that emits `backend_submission` events with `kind:"rpc_request"`, `phase:"backend_submission"`, and `direction:"outbound"`. The adapter MUST maintain a mapping from JSON-RPC IDs to `req_id` so that subsequent `rpc_response` and `rpc_notification` events, logged as `backend_io` (`phase:"backend_io"`, `direction:"inbound"`), carry the correct `req_id`. All RPC params/results MUST be sanitized via `src/dev-trace/sanitize.js` before logging, and tool-related payloads MUST be captured as `kind:"tool_block"` events tied to the same `req_id`._[Source: docs/dev/end-to-end-tracing-plan.app-server.md#63-phase-2--backend-submission-json-rpc-layer]_ _[Source: docs/dev/end-to-end-tracing-plan.app-server.md#64-phase-3--backend-io--lifecycle-json-rpc-events]_ _[Source: docs/tech-spec-epic-2.md#story-211-end-to-end-tracing]_ _[Source: docs/epics.md#story-211-end-to-end-tracing]_  
4. **Client egress tracing** – `src/services/sse.js` MUST tag `res.locals.httpRoute` and `res.locals.mode` and wrap SSE writes so that every user-visible SSE payload is logged as a `client_egress` event with `kind:"client_sse"`, `phase:"client_egress"`, and `direction:"outbound"`, and the terminal `[DONE]` frame is logged exactly once as `kind:"client_sse_done"` for each streaming request. Non-streaming handlers MUST call a `logJsonResponse` helper immediately before `res.status(...).json(...)`, which logs `client_egress` events with `kind:"client_json"`, `status_code`, truncated body, `req_id`, route, and mode._[Source: docs/dev/end-to-end-tracing-plan.app-server.md#65-phase-4--client-egress-sse--json]_ _[Source: docs/tech-spec-epic-2.md#story-211-end-to-end-tracing]_ _[Source: docs/epics.md#story-211-end-to-end-tracing]_  
5. **Usage/metrics linkage** – `appendUsage` (and `/v1/usage` helpers) MUST persist `req_id`, `route`, `method`, `status_code`, and `mode` (`chat_stream`, `chat_nonstream`, `completions_nonstream`, etc.) for every handled request, and when usage entries are emitted as NDJSON they MUST include `phase:"usage_summary"` to align with the trace schema. For any given `req_id`, it MUST be possible to join usage entries with HTTP ingress, JSON-RPC, and client egress trace events without relying on timestamps or heuristics._[Source: docs/dev/end-to-end-tracing-plan.app-server.md#66-phase-5--usage-events--v1usage]_ _[Source: docs/tech-spec-epic-2.md#story-211-end-to-end-tracing]_ _[Source: docs/epics.md#story-211-end-to-end-tracing]_  
6. **Dev enforcement + sanitization** – A `src/dev-trace/sanitize.js` module MUST provide shared helpers (e.g., `sanitizeHeaders`, `sanitizeBody`, `sanitizeRpcPayload`) and ALL new logging helpers (HTTP ingress, RPC submission/IO, client egress, and any usage snapshots that include payloads) MUST route through these sanitizers so no unsanitized headers or bodies are written. In `server.js`, dev mode (`PROXY_ENV=dev`) SHOULD enable tracing by default; if `PROXY_TRACE_REQUIRED=true` and `LOG_PROTO` (or the tracing flag) is not set, startup MUST fail fast with an explicit error. In non-dev modes, full tracing MUST be disabled or reduced to minimal access logs regardless of `LOG_PROTO`._[Source: docs/dev/end-to-end-tracing-plan.app-server.md#67-phase-6--enforce-logging-and-redaction-in-dev]_ _[Source: docs/tech-spec-epic-2.md#story-211-end-to-end-tracing]_ _[Source: docs/epics.md#story-211-end-to-end-tracing]_  
7. **Operator documentation & helper** – `docs/bmad/architecture/end-to-end-tracing-app-server.md` MUST include a short operator-facing "How to debug by `req_id`" section with worked examples for (a) a successful streaming chat request, (b) a tool-heavy request, and (c) a failing request, and `scripts/dev/trace-by-req-id.js` MUST accept a `req_id` CLI argument, read from access logs + `PROTO_LOG_PATH` + `TOKEN_LOG_PATH`, and output a chronologically merged view of all events for that `req_id`._[Source: docs/dev/end-to-end-tracing-plan.app-server.md#8-next-steps-for-implementation]_ _[Source: docs/sprint-change-proposal-2025-11-13.md]_ _[Source: docs/tech-spec-epic-2.md#story-211-end-to-end-tracing]_ _[Source: docs/epics.md#story-211-end-to-end-tracing]_  

## Tasks / Subtasks

- [x] **Trace spine plumbing (AC #1)** – Ensure `access-log` generates `res.locals.req_id`, update chat/completions handlers to adopt it (with `nanoid()` fallback), thread `{ reqId, httpRoute, mode }` into `JsonRpcChildAdapter`, and extend `appendProtoEvent`/`appendUsage` call sites to always include `req_id`.
- [x] **Ingress logger (AC #2)** – Implement `src/dev-trace/http.js::logHttpRequest`, wire it into all chat/completions handlers right after auth/validation and JSON parsing, and enforce `phase:"http_ingress"`, `kind:"client_request"`, `direction:"inbound"`, sanitization, and truncation rules.
- [x] **Transport instrumentation (AC #3)**  
  - [x] Extend `src/services/transport/child-adapter.js` to introduce `callRpc(ctx, method, params)` and log `rpc_request`, `rpc_response`, `rpc_error`, and `rpc_notification` events with `req_id`, `phase`, and `direction` populated via a JSON-RPC ID → `req_id` map.
  - [x] Update `src/services/codex-runner.js` (or worker supervisor) to emit `backend_start` / `backend_exit` lifecycle events and ensure all app-server traffic flows through the instrumented adapter.
- [x] **Client egress logging (AC #4)** – Enhance `src/services/sse.js` to tag `res.locals.httpRoute`/`res.locals.mode` and wrap SSE writes, add a `logJsonResponse` helper for non-streaming handlers, and add unit coverage for `client_sse`, `client_sse_done`, and `client_json` logging.
- [x] **Usage linkage (AC #5)** – Ensure all `appendUsage` code paths include `req_id`, `route`, `method`, `status_code`, and `mode`, and add regression tests for `/v1/usage`/`/v1/usage/raw` showing that usage entries can be joined to traces by `req_id`.
- [x] **Sanitization + enforcement (AC #6)** – Build `src/dev-trace/sanitize.js`, refactor logging helpers to use it for headers/bodies/params/results, and add dev-mode guardrails in `server.js` for `LOG_PROTO`, `PROXY_ENV`, and `PROXY_TRACE_REQUIRED`.
- [x] **Docs + helper script (AC #7)** – Publish the operator doc (`docs/bmad/architecture/end-to-end-tracing-app-server.md`) and implement `scripts/dev/trace-by-req-id.js` with a `req_id` CLI argument and examples for streaming, tool-heavy, and error traces; update PRD/Epic 2 notes accordingly.
- [x] **Testing – AC #1** (AC: #1) – Extend `tests/integration/chat.tracing.req-id.int.test.js` to assert that the same `req_id` appears in access-log output, dev trace events, and `/v1/usage` entries for streaming and non-stream chat/completions requests when running in app-server mode._[Source: docs/test-design-epic-2.md#risk-register]_  
- [x] **Testing – AC #2** (AC: #2) – Add unit tests for `src/dev-trace/http.js::logHttpRequest` that verify `phase`, `kind`, `direction`, header redaction, and truncation markers, and confirm it is invoked exactly once per request after JSON parsing; integrate with middleware/handler smoke tests._[Source: docs/test-design-epic-2.md#risk-register]_  
- [x] **Testing – AC #3** (AC: #3) – Instrument transport adapter tests to validate that `callRpc` logs `rpc_request`, `rpc_response`, `rpc_error`, and `rpc_notification` events with correct `req_id` via the JSON-RPC ID → `req_id` map, and that sanitized payload snapshots (including tool-blocks) land in golden trace fixtures. (`tests/unit/services/json-rpc-transport.spec.js` now simulates the worker to assert backend submission/response/notification/tool_block coverage.)_[Source: docs/test-design-epic-2.md#risk-register]_  
- [x] **Testing – AC #4** (AC: #4) – Expanded `tests/integration/chat.tracing.req-id.int.test.js` to assert `client_sse`, `client_sse_done`, and `client_json` trace events include `phase:"client_egress"`, `direction:"outbound"`, correct route/mode metadata, and exactly one `[DONE]` event per stream._[Source: docs/test-design-epic-2.md#risk-register]_  
- [x] **Testing – AC #5** (AC: #5) – Extended `tests/integration/server.int.test.js` with a `/v1/usage/raw` regression that verifies `req_id`, `route`, `method`, `status_code`, `mode`, and `phase:"usage_summary"`, and cross-checks the entry against proto logs to prove joinability._[Source: docs/test-design-epic-2.md#risk-register]_  
- [x] **Testing – AC #6** (AC: #6) – Added `tests/unit/dev-trace-sanitize.spec.js` plus `tests/unit/dev-logging.trace-env.spec.js` to cover sanitizer helpers (headers/bodies/RPC payloads) and enforcement toggles for `LOG_PROTO`/`PROXY_TRACE_REQUIRED` across dev vs. non-dev environments._[Source: docs/test-design-epic-2.md#risk-register]_  
- [x] **Testing – AC #7** (AC: #7) – Created `tests/unit/scripts/trace-by-req-id.spec.js` to validate the CLI timeline reconstruction and ran `npm run lint:runbooks` to keep the operator docs linted per tracing runbook requirements._[Source: docs/test-design-epic-2.md#risk-register]_  

### Review Follow-ups (AI)

- [x] [AI-Review][High] Invoke `logHttpRequest` immediately after JSON parsing—before the early `messages[]` / `prompt` validation branches—in all chat/completions handlers so even 4xx validation failures emit a `phase:"http_ingress"` record (see `src/handlers/chat/stream.js`, `src/handlers/chat/nonstream.js`, and the completions variants). (Fixed 2025-11-16 by moving the helper ahead of validation for stream/non-stream chat + completions and rerunning `npm run test:integration`.)
- [x] [AI-Review][High] Emit `appendUsage` entries (with `req_id`, `route`, `mode`, `method`, `status_code`) for every exit path, including auth failures and validation 4xx/5xx branches, so `/v1/usage/raw` stays joinable with HTTP ingress traces (`src/handlers/chat/stream.js`, `src/handlers/chat/nonstream.js`). ✅ 2025-11-16 — added a `logUsageFailure` helper for chat/completions stream + non-stream handlers so every early exit, transport error, and concurrency throttle path writes a usage NDJSON entry before returning.
- [x] [AI-Review][Medium] Trigger `logHttpRequest` immediately after JSON parsing even for unauthorized requests so 401s still produce `phase:"http_ingress"` events (`src/handlers/chat/stream.js`, `src/handlers/chat/nonstream.js`, `/v1/completions` handlers). ✅ 2025-11-16 — moved request-body parsing and `logHttpRequest` ahead of API-key guards across all chat/completions handlers so auth failures now log ingress traces.

## Dev Notes

- Tracing is now a gating prerequisite for completing Story 2-9a (multi-tool calls); ensure tool-block metadata survives JSON-RPC conversion so regression diagnostics can pinpoint deltas. _[Source: docs/sprint-status.yaml#development_status]_  
- Honor BMAD security guidance: logs must redact bearer keys, cookies, and large user payloads; treat `LOG_PROTO` as opt-out in dev to avoid leaking credentials. _[Source: docs/app-server-migration/codex-completions-api-migration.md#k-parity-fixture-maintenance-workflow]_  
- Structure new helpers under `src/dev-trace/` to keep observability concerns isolated from business logic; follow existing ESM + 2-space style. _[Source: docs/architecture.md#implementation-patterns]_  
- Match formatting, linting, and log-structure expectations defined in the project coding standards when adding `src/dev-trace` helpers or documentation excerpts. _[Source: docs/bmad/architecture/coding-standards.md#coding-standards]_  
- Story 2-10 remains drafted, so reuse its pending regression fixtures once tracing exposes deterministic transcripts; update dependency notes when 2-10 moves forward. _[Source: docs/_archive/stories/2-10-tool-call-regression-and-smoke.md#story-210-tool-call-regression-and-smoke-coverage]_  
- Align tracing scope with PRD goals around zero-downtime migration and observability readiness so parity evidence extends to operational debugging. _[Source: docs/PRD.md#goals-and-background-context]_  

### Plan Coverage Snapshot

- **Goal & Scope (Plan §1)** — Story phases preserve the dev-only focus, keep app-server the sole backend, and ensure no external API shape changes. _[Source: docs/dev/end-to-end-tracing-plan.app-server.md#1-goal--scope]_  
- **Current Signals (Plan §2)** — Tasks reference access logging, dev logging, handlers, SSE utilities, and transport adapter gaps the plan enumerates. _[Source: docs/dev/end-to-end-tracing-plan.app-server.md#2-current-signals-re-evaluated-for-app-server]_  
- **Gap Analysis (Plan §3)** — Acceptance Criteria #1-7 close each listed tracing gap (req_id cohesion through usage correlation). _[Source: docs/dev/end-to-end-tracing-plan.app-server.md#3-gaps-for-app-server-based-end-to-end-tracing]_  
- **Design Principles (Plan §4)** — Dev Notes reiterate the single `req_id` spine, sanitization, and non-intrusive logging principles. _[Source: docs/dev/end-to-end-tracing-plan.app-server.md#4-design-principles-app-server-aligned]_  
- **Trace Event Schema (Plan §5)** — Task list mandates consistent event shapes (`kind`, `phase`) for ingress, backend, egress, and usage traces. _[Source: docs/dev/end-to-end-tracing-plan.app-server.md#5-trace-event-schema]_  
- **Implementation Phases (Plan §6)** — Each AC/task maps to Phases 0–6 as defined in the plan, ensuring no phase is skipped. _[Source: docs/dev/end-to-end-tracing-plan.app-server.md#6-implementation-plan-phased]_  
- **App-Server Only Flow (Plan §7)** — Story references `JsonRpcChildAdapter`/`codex-runner` instrumentation so traces remain deterministic without proto fallbacks. _[Source: docs/dev/end-to-end-tracing-plan.app-server.md#7-how-this-works-with-app-server-only]_  
- **Documentation & Script (Plan §8)** — AC #7 now points to the dedicated architecture doc plus the upcoming `scripts/dev/trace-by-req-id.js` helper. _[Source: docs/dev/end-to-end-tracing-plan.app-server.md#8-next-steps-for-implementation]_  

### Architecture Patterns and Constraints

- Maintain a single `req_id` spine from HTTP ingress through JSON-RPC backend events, client egress, and usage logging so trace joins remain deterministic; all trace events MUST include `req_id`, `phase`, `kind`, and `direction` fields aligned with the app-server tracing plan. _[Source: docs/tech-spec-epic-2.md#story-211-end-to-end-tracing]_  
- Keep all new instrumentation behind `LOG_PROTO` and `PROXY_TRACE_REQUIRED` guards in `PROXY_ENV=dev`, and ensure production/non-dev configs disable full tracing by default to avoid leaking secrets or excessive payloads, consistent with app-server migration constraints. _[Source: docs/app-server-migration/codex-completions-api-migration.md#k-parity-fixture-maintenance-workflow]_  
- Record ingress, transport, and egress events in a non-blocking fashion so tracing does not materially increase request latency; use streaming writes/buffering as needed and rely on truncation rather than silently dropping large payloads, as called out in the architecture implementation patterns doc. _[Source: docs/architecture.md#implementation-patterns]_  
- Honor runtime constraints from the tech-stack runbook so tracing helpers respect default env surfaces (e.g., `PROXY_SSE_MAX_CONCURRENCY`, `PROXY_TIMEOUT_MS`, `PROXY_CODEX_WORKDIR`) when emitting logs or wiring CLI helpers, avoiding drift from documented expectations. _[Source: docs/bmad/architecture/tech-stack.md#configuration-surface-selected]_  

### Learnings from Previous Story

- Previous story 2-10 remains drafted, so no completed learnings exist yet; keep this section ready for the first review of 2-10. _[Source: docs/sprint-status.yaml#development_status]_  

### Project Structure Notes

- Code touchpoints span `server.js`, `src/app.js`, `src/middleware/access-log.js`, `src/dev-logging.js`, `src/services/codex-runner.js`, `src/services/transport/child-adapter.js`, and `src/services/sse.js`. Keep changes localized and covered by unit + integration tests. _[Source: docs/dev/end-to-end-tracing-plan.app-server.md#1-goal--scope]_  
- New documentation belongs under `docs/bmad/architecture/` per BMAD conventions; scripts live in `scripts/` and should be referenced from `package.json` if CI needs them. _[Source: docs/app-server-migration/codex-completions-api-migration.md#i-code-touch-points-typical-repo]_  
- Wire any new scripts/tests to the runtime and verification commands enumerated in the tech-stack doc (Docker build, smoke harness, `npm run verify:all`) so observability instrumentation stays aligned with required tooling. _[Source: docs/bmad/architecture/tech-stack.md#testing--qa]_  

### References

- docs/epics.md#story-211-end-to-end-tracing  
- docs/tech-spec-epic-2.md#story-211-end-to-end-tracing  
- docs/PRD.md#goals-and-background-context  
- docs/dev/end-to-end-tracing-plan.app-server.md  
- docs/_archive/dev/end-to-end-tracing-plan.md  
- docs/bmad/architecture/end-to-end-tracing-app-server.md  
- docs/bmad/architecture/tech-stack.md  
- docs/sprint-change-proposal-2025-11-13.md  
- docs/sprint-status.yaml  
- docs/architecture.md  
- docs/app-server-migration/codex-completions-api-migration.md  
- docs/_archive/stories/2-10-tool-call-regression-and-smoke.md  

## Change Log

- 2025-11-13: Draft updated with spec/epic citations, architecture constraints, testing subtasks, and tracing change-log scaffold.  
- 2025-11-16: Implemented req_id spine plumbing, dev-trace logging (HTTP ingress, backend submission/IO, SSE/JSON egress), usage enrichment, PROXY_TRACE_REQUIRED enforcement, the trace-by-req-id CLI + runbook updates, and initial unit coverage for `logHttpRequest`.  
- 2025-11-16: Added `tests/unit/services/json-rpc-transport.spec.js` coverage to validate backend submission/response/notification/tool_block plus rpc_error logging with consistent `req_id` propagation and sanitized payloads (AC #3).  
- 2025-11-16: Expanded SSE/client JSON egress and `/v1/usage` regressions plus sanitizer/env/CLI tests (`tests/integration/chat.tracing.req-id.int.test.js`, `tests/integration/server.int.test.js`, `tests/unit/dev-trace-sanitize.spec.js`, `tests/unit/dev-logging.trace-env.spec.js`, `tests/unit/scripts/trace-by-req-id.spec.js`) and ran `npm run lint:runbooks` for AC #4-#7.  
- 2025-11-16: Senior Developer Review (AI) notes appended.  
- 2025-11-16: Addressed code review findings — moved `logHttpRequest` before validation for chat/completions stream & non-stream handlers and reran `npm run test:integration` (1 High item resolved).
- 2025-11-16: Logged follow-up Senior Developer Review (AI) covering usage logging + auth-phase ingress gaps; action items captured.  
- 2025-11-16: Added failure-path usage logging plus pre-auth ingress tracing across chat/completions handlers and reran `npm run test:integration` + `npm test` to refresh evidence for the resolved review threads.

## Dev Agent Record

### Context Reference

- Story context XML: `docs/_archive/story-contexts/2-11-end-to-end-tracing.context.xml` (generated 2025-11-15T10:16:18Z via `*story-context`).
- Until additional artifacts land, keep these docs as the authoritative bundle for onboarding engineers:
  - `docs/dev/end-to-end-tracing-plan.app-server.md` (phase-by-phase trace scope)
  - `docs/bmad/architecture/end-to-end-tracing-app-server.md` (operator workflow + stitching guide)

### Agent Model Used

codex-5 (planned)

### Debug Log

- 2025-11-16T19:16:01Z — Plan for **Testing – AC #3** instrumentation coverage:
  - Mock `appendProtoEvent` inside `tests/unit/services/json-rpc-transport.spec.js` so backend trace events can be asserted directly without touching disk.
  - Spin up the mocked worker child to drive the handshake, `newConversation`, and `sendUserTurn` RPCs, then assert `rpc_request`, `rpc_response`, `rpc_notification`, and `tool_block` events all keep the same `req_id` and capture sanitized payload snapshots.
  - Add an error-path simulation where the worker returns a JSON-RPC error so `rpc_error` logging is exercised.
  - Run the focused Vitest suite for this spec after updating the tests.
- 2025-11-16T19:40:00Z — Updated `tests/integration/chat.tracing.req-id.int.test.js` to assert `client_sse`, `client_sse_done`, and `client_json` trace metadata (`phase`, `direction`, single `[DONE]`) for AC #4 and reran `npx vitest run tests/integration/chat.tracing.req-id.int.test.js --reporter=verbose`.
- 2025-11-16T19:48:00Z — Extended `tests/integration/server.int.test.js` with `/v1/usage/raw` trace-join coverage for AC #5 and executed `npx vitest run tests/integration/server.int.test.js --reporter=verbose`.
- 2025-11-16T19:55:00Z — Added `tests/unit/dev-trace-sanitize.spec.js` + `tests/unit/dev-logging.trace-env.spec.js` to cover sanitizer helpers and enforcement toggles, plus `tests/unit/scripts/trace-by-req-id.spec.js` for the CLI; ran `npx vitest run tests/unit/dev-trace-sanitize.spec.js tests/unit/dev-logging.trace-env.spec.js tests/unit/scripts/trace-by-req-id.spec.js --reporter=verbose`.
- 2025-11-16T19:57:00Z — Ran `npm run lint:runbooks` per AC #7 to keep the tracing runbook linted.
- 2025-11-16T21:05:00Z — Moved every `logHttpRequest` call to execute immediately after JSON parsing in chat/completions handlers and reran `npm run test:integration` to verify no regressions.
- 2025-11-16T22:05:00Z — Scoped the remaining review follow-ups: add a shared `logUsageFailure` helper for chat/completions stream + non-stream handlers so auth failures, validation errors, transport faults, and concurrency throttles still emit `phase:"usage_summary"` NDJSON lines; move `logHttpRequest` calls ahead of API-key checks for the `/v1/chat*` and `/v1/completions*` handlers so unauthorized requests capture `phase:"http_ingress"` events.
- 2025-11-16T22:25:00Z — Implemented the helper + call sites (early returns, `send429`, idle timers, child error handlers) in `src/handlers/chat/stream.js` and `src/handlers/chat/nonstream.js`, then reran `npm run test:integration` (passes) followed by the full Playwright suite `npm test` to cover SSE/contracts.

### Debug Log References

- `tmp/codex-proto.ndjson` (or `${PROTO_LOG_PATH}`) — appendProtoEvent traces for ingress/RPC/egress with `req_id`
- `tmp/codex-usage.ndjson` (or `${TOKEN_LOG_PATH}`) — appendUsage outputs proving AC #5 linkage
- `server.log` / stdout access log lines — confirm middleware `req_id` propagation
- `scripts/dev/trace-by-req-id.js` output (once implemented) — canonical stitched timeline for investigations

### Completion Notes List

- [x] Run `*story-context` after finalizing Dev Notes so the XML references above resolve
- [x] Capture `npx vitest run tests/integration/chat.tracing.req-id.int.test.js` output locally (passes under CODEX_BIN=scripts/fake-codex-jsonrpc.js); attach logs when publishing PR
- [x] Added RPC trace instrumentation coverage in `tests/unit/services/json-rpc-transport.spec.js` to exercise backend submission/response/notification/tool-block plus error logging with consistent `req_id` mapping.
- [x] Expanded `tests/integration/chat.tracing.req-id.int.test.js` to assert client egress metadata and `[DONE]` singletons for AC #4.
- [x] Added `/v1/usage/raw` trace join regression in `tests/integration/server.int.test.js` for AC #5.
- [x] Created CLI + sanitizer/env tests (`tests/unit/dev-trace-sanitize.spec.js`, `tests/unit/dev-logging.trace-env.spec.js`, `tests/unit/scripts/trace-by-req-id.spec.js`) and ran `npm run lint:runbooks` per AC #6-#7 expectations.
- [x] Documented sanitization behavior via `tests/unit/dev-trace-sanitize.spec.js` (covers oversized payload truncation + header redaction) — no outstanding gaps; link new spec in PR description if future regressions surface.
- [x] ✅ Resolved review finding [High]: repositioned `logHttpRequest` ahead of validation for chat/completions stream + non-stream handlers and captured proof via `npm run test:integration`.
- [x] ✅ Resolved review finding [High+Medium]: added failure-path usage logging plus pre-auth ingress tracing across chat/completions handlers and reran `npm run test:integration` + `npm test` to refresh SSE/contract evidence.

### File List

- `src/handlers/chat/stream.js`, `src/handlers/chat/nonstream.js` — moved `logHttpRequest` up immediately after JSON parsing for chat/completions stream & non-stream handlers and added `logUsageFailure` instrumentation across auth/validation/concurrency/transport error exits so ingress+usage traces exist for every request (review fix for AC #2/#5).
- `src/dev-trace/http.js` — ingress logger referenced in AC #2
- `src/dev-trace/sanitize.js` — shared redaction utilities + enforcement hooks (AC #6)
- `src/services/transport/child-adapter.js` — emits `rpc_request/response/notification` traces (AC #3)
- `src/services/codex-runner.js` — backend lifecycle logging (`backend_start/backend_exit`) (AC #3)
- `src/services/sse.js`, `src/handlers/chat/*.js` — SSE/JSON response logging (AC #4)
- `docs/bmad/architecture/end-to-end-tracing-app-server.md`, `scripts/dev/trace-by-req-id.js` — operator documentation & helper (AC #7)
- `tests/unit/services/json-rpc-transport.spec.js` — Vitest coverage for backend submission/response/notification/tool-block and rpc_error logging (AC #3)
- `tests/integration/chat.tracing.req-id.int.test.js` — SSE/client JSON integration assertions for AC #4
- `tests/integration/server.int.test.js` — `/v1/usage` and `/v1/usage/raw` coverage for AC #5
- `tests/unit/dev-trace-sanitize.spec.js` — sanitizer helper coverage for AC #6
- `tests/unit/dev-logging.trace-env.spec.js` — enforcement toggle coverage for AC #6
- `tests/unit/scripts/trace-by-req-id.spec.js` — CLI timeline integration check for AC #7

## Senior Developer Review (AI)

| Transport instrumentation (AC #3) | ✅ | `logBackendSubmission/Response/Notification` wire every RPC path with sanitized payloads and unit verification (`src/services/transport/index.js:489`, `src/services/transport/index.js:824`, `tests/unit/services/json-rpc-transport.spec.js:560`). |
| Client egress logging (AC #4) | ✅ | SSE + JSON helpers emit `client_egress` telemetry for each payload and `[DONE]`, matching integration assertions (`src/services/sse.js:70`, `tests/integration/chat.tracing.req-id.int.test.js:99`). |
| Usage linkage (AC #5) | ✅ | `logUsageFailure` covers all early exits while the success logger captures tokens/modes, and `/v1/usage/raw` tests read the metadata (`src/handlers/chat/stream.js:196`, `src/handlers/chat/nonstream.js:222`, `src/handlers/chat/stream.js:1401`, `tests/integration/server.int.test.js:163`). |
| Sanitization + enforcement (AC #6) | ✅ | Sanitizer helpers and enforcement toggles remain centralized with unit coverage (`src/dev-trace/sanitize.js:1`, `src/dev-logging.js:33`, `tests/unit/dev-trace-sanitize.spec.js:15`). |
| Docs + helper script (AC #7) | ✅ | Runbook + CLI describe and automate the operator workflow with tests confirming stitched timelines (`docs/bmad/architecture/end-to-end-tracing-app-server.md`, `scripts/dev/trace-by-req-id.js:69`, `tests/unit/scripts/trace-by-req-id.spec.js:54`). |

### Test Coverage and Gaps

- `tests/integration/chat.tracing.req-id.int.test.js:99` — streaming & non-stream chat requests log ingress, backend, client egress, and usage with the same `req_id`.
- `tests/integration/server.int.test.js:163` — `/v1/usage` aggregates plus `/v1/usage/raw` metadata remain joinable and reference proto logs.
- `tests/unit/services/json-rpc-transport.spec.js:560` — backend submission/response/notification/tool-block logging (including `rpc_error`) retains the trace context.
- `tests/unit/dev-trace-http.spec.js:15` — ingress helper redacts auth headers and is idempotent.
- `tests/unit/dev-trace-sanitize.spec.js:15` / `tests/unit/dev-logging.trace-env.spec.js:15` — guard sanitization behavior and tracing enforcement.
- `tests/unit/scripts/trace-by-req-id.spec.js:54` — CLI stitches access, proto, and usage NDJSON streams.

### Action Items

- [x] 2025-11-16 — Confirmed `appendUsage` runs for auth/validation/transport failures through `logUsageFailure` in chat/completions stream + non-stream handlers (`src/handlers/chat/stream.js:196`, `src/handlers/chat/nonstream.js:222`, `src/handlers/chat/stream.js:1958`, `src/handlers/chat/nonstream.js:1333`).
- [x] 2025-11-16 — Verified `logHttpRequest` executes immediately after JSON parsing for `/v1/chat*` and `/v1/completions*`, ensuring 4xx/401 responses still emit `phase:"http_ingress"` events (`src/handlers/chat/stream.js:158`, `src/handlers/chat/nonstream.js:320`, `src/handlers/chat/stream.js:1947`, `src/handlers/chat/nonstream.js:1323`).
