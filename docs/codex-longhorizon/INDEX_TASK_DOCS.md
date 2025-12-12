# INDEX — Task & Survey Docs

Each entry lists the path, a 5–10 line summary, explicit acceptance criteria when present, and priority/severity hints pulled from the source analysis. “PROPOSED” marks criteria inferred from findings.

## Task 01 — Repository Topology & Runtime Surfaces
- Path: `docs/surveys/2025-12-task-01-topology.md`
- Status: Complete (see `docs/surveys/status/task-01-topology-status.md`)
- Summary: Maps top-level files/dirs and runtime entrypoints; ForwardAuth now canonicalized to `auth/server.mjs` with the CJS variant guarded; remaining drift risks are unclear env/config manifests per modality, undeclared primary deployment path, and opaque infra artifacts (`rht*`, `web-bundles/`, `external/`). Highlights risk of drift between `.env*`, README, and actual runtime expectations.
- Acceptance criteria: Canonicalize ForwardAuth, publish config/deploy matrix, and document infra artifacts. All items implemented and validated in long‑horizon Phase 3.
- Priority clues: Medium/High maintainability and security posture (deployment clarity).

## Task 02 — Critical Request/Response Flows
- Path: `docs/surveys/task-02-critical-request-response-flows_2025-12-08.md`
- Status: Complete (see `docs/surveys/status/task-02-critical-flows-status.md`)
- Summary: Traces middleware order and endpoint flows for health, models, chat, responses, completions. Issues: `/v1/responses` lacks readiness gating; OPTIONS runs before CORS (preflight may miss headers); `/v1/usage*` exposed without auth; rate-limit middleware excludes `/v1/responses`; proto/legacy completions routing unverified. Provides flow contract for downstream fixes.
- Acceptance criteria: Readiness gating, CORS preflight ordering, rate‑limit/auth parity, and completions shim documentation/tests are all implemented and regression‑covered.
- Priority clues: P0 for auth/rate-limit gaps; P1 for CORS/legacy clarity.

## Task 03 — Request Translation Layer (Chat → JSON-RPC)
- Path: `docs/surveys/TASK_03_request_translation_layer.md`
- Status: Complete (see `docs/surveys/status/task-03-request-translation-status.md`)
- Summary: `normalizeChatJsonRpcRequest` now accepts full chat history (assistant/tool/developer/legacy function roles), flattens it deterministically into a labeled transcript, validates tools/tool_choice/response_format/reasoning controls, and forwards `choiceCount` to app‑server turns for proper multi‑choice semantics. Turn/message duplication is intentional and covered by unit/integration tests.
- Acceptance criteria: AC1–AC3 implemented with unit + integration coverage; multi‑choice parity validated against fake JSON‑RPC worker.
- Priority clues: Completed; remaining limitations are documented in the status file.

## Task 04 — Response Serialization & Streaming Adapters
- Path: `docs/surveys/TASK_04_Response_and_Streaming_Adapters.md`
- Status: Partially complete (see `docs/surveys/status/task-04-responses-streaming-status.md`)
- Summary: Maps chat/responses non-stream + streaming adapters, SSE contract, and hook points (`streamAdapter`, `responseTransform`). Drift notes: typed SSE payloads are minimal vs spec; tool events stream despite some docs implying aggregate-only; multi-choice semantics ambiguous; default `PROXY_OUTPUT_MODE=obsidian-xml`; typed SSE bypasses logging; parity checks enumerated for chat/responses sequences.
- Acceptance criteria (PROPOSED): Define supported streaming contracts (chat and typed responses) including multi-choice/tool event semantics; ensure `[DONE]`/finish/usage ordering and role-first chunks are tested; instrument typed SSE emission; document/output-mode defaults and supported payload shape; add parity tests covering adapter suppression paths.
- Priority clues: P1 correctness/regression risk.

## Task 05 — JSON-RPC Transport & Schema
- Path: `docs/surveys/TASK_05_JSON_RPC_TRANSPORT_AND_SCHEMA.md`
- Status: Complete (see `docs/surveys/status/task-05-jsonrpc-transport-status.md`)
- Summary: Reviews transport envelopes, schema builders, and call sequence; finds dual schema generation paths (template vs upstream export) creating drift, stale docs/runbooks, camelCase/snakeCase duplication, and fields passed but not represented in builders. Recommends single source of truth with CI guardrails.
- Acceptance criteria: Keep `src/lib/json-rpc/schema.ts` canonical; `npm run jsonrpc:schema` stays a no-op to prevent legacy overwrites; regenerate the JSON Schema bundle via `npm run jsonrpc:bundle` and enforce idempotence in CI with `npm run jsonrpc:verify`; align docs on method/notification set and field behaviors; reconcile ignored knobs and document camel/snake back-compat policy.
- Priority clues: P1 contract stability.

## Task 06 — Codex Integration & Infrastructure Surfaces
- Path: `docs/surveys/task-06-codex-integration-infra.md`
- Status: Partially complete (see `docs/surveys/status/task-06-integration-infra-status.md`)
- Summary: Charts backend selection defaults, supervisor lifecycle, CODEX_HOME/workdir handling, compose vs installer deployment, edge vs in-app controls. Findings: two deployment stories (Compose vs `scripts/install.sh`); duplicated CORS/rate-limit controls; “magic” default for `PROXY_USE_APP_SERVER`; secrets/workdir expectations; need observability for worker restart loops.
- Acceptance criteria (PROPOSED): Decide and document canonical deployment; archive/deprecate installer if unsupported; pin `PROXY_USE_APP_SERVER` in manifests and document CODEX_HOME/WORKDIR requirements and rotation; pick authoritative CORS/rate-limit layer; expose worker restart/readiness signals in health/metrics or logs.
- Priority clues: P1 operability; some security overlap.

## Task 07 — Observability & Telemetry
- Path: `docs/surveys/task-07-observability-and-telemetry.md`
- Status: Partially complete (see `docs/surveys/status/task-07-observability-status.md`)
- Summary: Inventories logging/metrics/health; strengths include correlation model and guarded metrics. Gaps: no prod-grade tracing; metrics not SLO-complete (missing streaming/worker timing, abort reasons); cardinality/PII risk if route labels drift; doc alignment uncertain. Recommends metrics allowlist parity checks and operator guidance.
- Acceptance criteria (PROPOSED): Normalize metric labels and PII policy; enforce auth for `/metrics` in prod; add streaming TTFB/duration/abort and worker restart metrics; optional OTEL tracing with log correlation; add metrics allowlist CI check and operator docs/runbook updates.
- Priority clues: P1 for PII/cardinality protections; P2 for tracing maturity.

## Task 08 — Testing & QA Posture
- Path: `docs/surveys/task-08-testing-and-qa-posture.md`
- Status: Partially complete (see `docs/surveys/status/task-08-testing-qa-status.md`)
- Summary: Catalogs unit/integration/parity/e2e/live smoke harnesses and deterministic shims. Gaps: CI missing artifact uploads and “workspace dirty” guard; coverage gating undecided; missing targeted tests for toggles (PROXY_PROTECT_MODELS, rate limit, SSE concurrency, worker restart); needs fast/slow tagging strategy and live E2E scheduling policy.
- Acceptance criteria (PROPOSED): Upload Playwright/smoke artifacts in CI and fail on uncommitted fixture changes; decide and document coverage gating; add targeted tests for auth/rate-limit/SSE concurrency/worker restart toggles; introduce test tags (`@slow` etc.) and document fast/full loops.
- Priority clues: P1 verification discipline.

## Task 09 — Security & Config Hygiene
- Path: `docs/surveys/task-09-security-and-config-hygiene.md`
- Status: Partially complete (see `docs/surveys/status/task-09-security-config-status.md`)
- Summary: Compares designed vs implemented auth. High-impact findings: `/v1/usage*` unauthenticated; `PROXY_TEST_ENDPOINTS` exposes writes without auth; rate-limit bypass via `/v1/responses`; server binds all interfaces but logs loopback; permissive defaults (test endpoints, API key); doc contradictions on model protection/test routes. Includes prioritized remediation list.
- Acceptance criteria: Enforce bearer (or explicit edge-only guard) for `/v1/usage*`; require auth + loopback default for `__test/*`; include `/v1/responses` in rate-limit scope; default bind to loopback and log actual bind; fail fast in prod when API key is missing/default or unsafe flags enabled; update docs/runbooks to match.
- Priority clues: P0 security correctness.

## Task 11 — Documentation IA & Drift
- Path: `docs/surveys/task-11-documentation-ia-and-drift.md`
- Status: Partially complete (see `docs/surveys/status/task-11-docs-ia-status.md`)
- Summary: Finds parallel doc universes (README/PRD vs BMAD vs archived) with drift on sandbox defaults, auth, responses support, proto status. Provides drift matrix and proposes a canonical IA (doc index, architecture, config reference) plus governance (doc lint, update triggers, autogenerated config refs).
- Acceptance criteria (PROPOSED): Adopt canonical doc index/IA with status markers; reconcile drift items (sandbox defaults, test endpoint auth, usage protection, responses availability, proto policy); add doc lint/metrics parity checks in CI; update README/PRD/AGENTS to point to canonical sources.
- Priority clues: P1 documentation correctness.

## Task 12 — Synthesis & Remediation Roadmap
- Path: `docs/surveys/task-12-synthesis-and-remediation-roadmap.md`
- Status: Partially complete (see `docs/surveys/status/task-12-synthesis-status.md`)
- Summary: Consolidates Tasks 1–11 into prioritized backlog: P0 (protect `/v1/usage*`, lock down test endpoints, add rate-limit to `/v1/responses`, fail-fast on insecure prod defaults, bind address clarity), P1 (canonical JSON-RPC schema workflow, doc drift fixes + canonical index, CI artifacts/guardrails for Playwright/golden diffs), P2 (streaming metrics, optional OTEL tracing, remove/relocate legacy deployment path). Includes success criteria for each.
- Acceptance criteria: Success criteria listed per item in §3 (P0–P2) of the doc; backlog should drive execution and verification.
- Priority clues: Explicit P0/P1/P2 tagging.

## Task 13 — Validation Pass & Errata
- Path: `docs/surveys/task-13-validation-pass-and-errata.md`
- Status: Partially complete (see `docs/surveys/status/task-13-validation-status.md`)
- Summary: Corrects earlier assumptions: `/v1/responses` is implemented; rate-limit excludes responses; README under-advertises responses; proto “retired” claim conflicts with tests using proto shim; Express version mismatch in docs. Adds backlog asks: responses feature flag decision, README corrections, proto policy alignment.
- Acceptance criteria (PROPOSED): Integrate rate-limit/README/proto corrections into backlog; add feature flag (or clear exposure policy) for `/v1/responses`; resolve proto retirement stance and align docs/tests; update Express version docs to match package.json.
- Priority clues: P0 for rate-limit gap; P1 for docs/feature-flag/proto policy.
