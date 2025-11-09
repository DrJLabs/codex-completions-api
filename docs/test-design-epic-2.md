# Test Design: Epic 2 - /v1/chat/completions JSON-RPC Parity

**Date:** 2025-11-08  
**Author:** Murat (QA)  
**Status:** Updated for Stories 2.8–2.10

---

## Executive Summary

- Scope now covers the tool-call surface required by Stories **2.8–2.10**: the pure `ToolCallAggregator`, streaming/non-stream handler integration, and regression/smoke coverage across structured and textual flows described in `docs/codex-proxy-tool-calls.md`.
- Existing parity diff work (proto vs. app) remains in place; this revision layers tool-call-specific risks, coverage, and CI gating on top of that baseline.
- Test responsibilities align with the knowledge-base guidance (`risk-governance`, `probability-impact`, `test-levels-framework`, `test-priorities-matrix`, `fixture-architecture`, `network-first`). Unit tests protect the pure aggregator, integration tests guard handler wiring, and Playwright/smoke flows validate end-to-end behavior.

---

## Risk Summary

- Total risks identified: **5**
- High-priority risks (score ≥6): **2** (TECH/DATA)
- Dominant categories: **TECH, DATA, OPS, PERF**

---

## Risk Assessment

### High-Priority Risks (Score ≥6)

| Risk ID | Category | Description | Probability | Impact | Score | Mitigation | Owner | Timeline |
| ------- | -------- | ----------- | ----------- | ------ | ----- | ---------- | ----- | -------- |
| R-101 | TECH | `ToolCallAggregator` may mis-order, duplicate, or drop fragments when structured (`response.function_call_arguments`) and textual (`<use_tool>`) events interleave, leading to malformed `tool_calls[]` or retained tail text. | 2 | 3 | 6 | Expand the unit matrix to cover structured/textual, multi-choice, idempotent replays, malformed JSON, and 8KB+ payloads; enforce immutable snapshots and per-choice isolation. | QA | 2025-11-11 |
| R-102 | DATA | Streaming/non-stream handlers might emit assistant text after a tool call, fail to cut off at `finish_reason:"tool_calls"`, or diverge between `obsidian-xml` and `openai-json` modes, causing client-visible regressions. | 2 | 3 | 6 | Add integration & Playwright specs for both modes that assert role-first ordering, single finish chunk, `[DONE]`, openai-json fallback, and tail suppression (structured + textual fixtures). | Dev + QA | 2025-11-12 |

### Medium-Priority Risks (Score 4–5)

| Risk ID | Category | Description | Probability | Impact | Score | Mitigation | Owner |
| ------- | -------- | ----------- | ----------- | ------ | ----- | ---------- | ----- |
| R-103 | OPS | `PROXY_OUTPUT_MODE` / `x-proxy-output-mode` overrides may diverge between environments, returning the wrong envelope shape or metrics tags. | 2 | 2 | 4 | Configuration contract tests exercise default + override headers, emit telemetry (`tool_call_mode`) and guard mismatches in CI. | Dev |
| R-104 | OPS | Smoke/CI jobs currently skip authenticated tool-call drills, so regressions in structured/textual flows or disconnect handling may ship. | 2 | 2 | 4 | Extend `scripts/smoke/dev|prod`, `npm run test:integration`, and Playwright suites with deterministic fixtures, client-disconnect smoke, and artifact uploads on failure. | QA |

### Low-Priority Risks (Score 1–3)

| Risk ID | Category | Description | Probability | Impact | Score | Action |
| ------- | -------- | ----------- | ----------- | ------ | ----- | ------ |
| R-105 | PERF | Large (>8 KB) arguments or parallel tool-call toggles could inflate memory/time if buffer trimming or UTF-8 safety is insufficient. | 1 | 2 | 2 | Monitor via perf regression test and leak detector; keep optional parallel mode behind flag. |

**Risk Category Legend:** TECH = architecture defects, DATA = schema or payload corruption, OPS = CI/smoke/process gaps, PERF = latency/resource regressions.

---

## Risk Register

The Epic 2 risk register tracks the items above so downstream stories can reference a stable anchor. Each entry follows the `risk-governance` rubric (ID, category, probability, impact, mitigation, owner, timeline). Current contents:

- **R-101 (TECH)** – Aggregator mis-ordering / fragment loss. Mitigation: expand unit matrix, enforce immutable snapshots (`tests/unit/tool-call-aggregator.spec.js`).
- **R-102 (DATA)** – Streaming/non-stream handler divergence. Mitigation: dual-mode integration + Playwright specs with `[DONE]` enforcement.
- **R-103 (OPS)** – Output-mode config drift. Mitigation: config contract tests and telemetry guards.
- **R-104 (OPS)** – Missing authenticated tool-call smoke coverage. Mitigation: upgrade `scripts/smoke/*`and CI requirements.
- **R-105 (PERF)** – Large-argument or parallel-call resource risk. Mitigation: perf regression monitors and keeping parallel mode behind a flag.

Future risks should append to this list with the same structure so linked stories (2.8–2.10) can cite `docs/test-design-epic-2.md#risk-register` for authoritative context.

---

## Test Coverage Plan

### P0 (Critical) – Run on every commit

| Requirement | Story | Test Level | Risk Link | Test Count | Owner | Notes |
| ----------- | ----- | ---------- | --------- | ---------- | ----- | ----- |
| ToolCallAggregator streaming + textual matrix (structured deltas, `<use_tool>` fallback, multi-choice, idempotent replays, 8 KB arguments) | 2.8 | Unit | R-101 | 4 | QA | Expand `tests/unit/tool-call-aggregator.spec.js` with table-driven cases, verifying immutable snapshots and bounded buffers per choice. |
| Chat streaming handler emits canonical `<use_tool>` block and single finish chunk in both `obsidian-xml` and `openai-json` modes | 2.9 | Integration + Playwright | R-102 | 2 | Dev+QA | New specs under `tests/integration/chat.stream.tool-calls.int.test.ts` and Playwright smoke asserting role-first, cumulative `delta.tool_calls`, `[DONE]`, and header overrides. |
| Chat non-stream handler snapshot + output-mode fallbacks | 2.9 | Integration | R-102, R-103 | 2 | Dev | Validate `tool_calls[]`, `function_call`, and `<use_tool>` envelopes (multi-call + legacy `content:null` shape) using deterministic fixtures. |
| Tool-call regression harness & smoke (structured + textual + client-disconnect) wired into `npm run test:integration`, `npm test`, and `scripts/smoke/*` | 2.10 | Integration + Smoke | R-104 | 3 | QA | Adds fixtures under `tests/e2e/fixtures/tool-calls/`, updates smoke scripts to assert finish reason, tail suppression, and disconnect cleanup. |

**Total P0:** 11 tests • ~8.5 hours (avg 0.75 h/test) – mandatory on every PR.

### P1 (High) – Run on PRs to `main`

| Requirement | Story | Test Level | Risk Link | Test Count | Owner | Notes |
| ----------- | ----- | ---------- | --------- | ---------- | ----- | ----- |
| Parallel tool-call mode (`PROXY_ENABLE_PARALLEL_TOOL_CALLS`) permutations incl. stop-after-first-tool vs. multi-call | 2.9 | Integration | R-101, R-103 | 2 | Dev | Extend fake Codex scenarios to emit 2 calls per choice; ensure per-choice isolation and telemetry. |
| Large-argument + UTF-8 continuity perf budget | 2.10 | Integration/Perf | R-105 | 1 | QA | Synthetic payload ensures no multibyte splits; capture memory + time budgets (<30 s integration, <2 min Playwright). |
| Output-mode header override telemetry + metric assertions | 2.9 | Integration | R-103 | 1 | Dev | Validate `x-proxy-output-mode` precedence, log tags, and metric counters for both modes. |
| Client disconnect + SSE heartbeat suppression | 2.10 | Integration/E2E | R-104 | 1 | QA | Reuse `kill-on-disconnect` harness to ensure backend drains events without residual frames. |

**Total P1:** 5 tests • ~3.8 hours – executed on main-branch PRs and nightly.

### P2 (Medium) – Nightly/Weekly

| Requirement | Story | Test Level | Risk Link | Test Count | Owner | Notes |
| ----------- | ----- | ---------- | --------- | ---------- | ----- | ----- |
| Malformed/duplicate event resilience (`ingestDelta` receiving gaps, mixed IDs) | 2.8 | Unit | R-101 | 1 | QA | Property-based fuzz suite verifying aggregator never throws and `resetTurn()` frees buffers. |
| Tool-call golden transcript diff (`npm run test:parity -- --tool-calls`) | 2.10 | CLI harness | R-104 | 1 | QA | Generates sanitized proto vs. app fixtures and uploads diff artifacts for auditing. |

### P3 (Low) – On-demand / Pre-release

- Manual review of staged transcripts + runbook dry-run with SRE to confirm observability and maintenance-mode instructions for tool-call incidents.

---

## Execution Order

1. **Smoke (≤5 min):**
   - `scripts/smoke/dev` structured tool-call scenario (stream + non-stream).
   - Textual fallback smoke + client disconnect check.
2. **P0 suites (≤10 min incremental):**
   - Aggregator unit matrix (`vitest run tests/unit/tool-call-aggregator.spec.js`).
   - Integration streaming + non-stream tests.
   - Regression harness (structured/textual) + `[DONE]` enforcement.
3. **P1 suites (~15 min):** parallel-mode permutations, large-argument perf, header overrides, disconnect handling.
4. **P2 nightly (~20 min):** fuzz + golden diff CLI job.

CI gating: PRs must pass Smoke + P0; `main` merges also run P1; nightly jobs run P2 and upload transcripts/logs.

---

## Tooling & Environment

- **Fixtures:** Add deterministic JSON-RPC + textual transcripts under `tests/e2e/fixtures/tool-calls/` with seed metadata (`codex_version`, `scenario`).
- **Fake Codex modes:** Update `scripts/fake-codex-jsonrpc.js` & `scripts/fake-codex-proto-tools.js` to emit multi-choice, large-arg, and error-after-tool scenarios controlled via env flags.
- **Config:** Introduce `PROXY_OUTPUT_MODE` + `x-proxy-output-mode` header override defaults, `PROXY_ENABLE_PARALLEL_TOOL_CALLS`, `PROXY_STOP_AFTER_TOOLS_MODE` permutations documented in `.env.example`.
- **Telemetry:** Record `tool_call_count`, `tool_call_mode`, and tail-trim indicators in structured logs/metrics for observability validation.
- **Smoke scripts:** `scripts/dev-smoke.sh`, `scripts/prod-smoke.sh`, and `scripts/dev-edge-smoke.sh` gain authenticated tool-call drills and artifact upload (`test-results/tool-calls/*`).

---

## Effort Estimates

| Priority | Test Count | Avg Hours/Test | Total Hours | Notes |
| -------- | ---------- | -------------- | ----------- | ----- |
| P0 | 11 | 0.75 | 8.25 | Includes new unit matrix + streaming/non-stream integrations. |
| P1 | 5 | 0.75 | 3.75 | Parallel/large-arg/config/disconnect scenarios. |
| P2 | 2 | 0.50 | 1.00 | Fuzz + golden diff automation. |
| P3 | 1 | 0.50 | 0.50 | Manual transcript/runbook review. |
| **Total** | **19** | – | **13.5 h (~1.7 days)** | Aligns with test-priorities matrix (P0 <10% of suite, always-on). |

---

## Quality Gate Criteria

- 100% pass rate on the expanded aggregator unit matrix; failing cases block merges.
- Streaming/non-stream integration suites enforce: single assistant role chunk per choice, cumulative `delta.tool_calls.arguments`, canonical `<use_tool>` content, one `finish_reason:"tool_calls"`, and `[DONE]` termination.
- Smoke jobs must publish structured logs, SSE transcripts, and storage-state artifacts for each scenario; CI retains them for ≥7 days.
- Any mismatch between declared `PROXY_OUTPUT_MODE` and observed envelope toggles the pipeline to **CONCERNS** per risk governance.
- Large-argument perf checks must remain within budget (integration ≤30 s, Playwright ≤2 min) or trigger follow-up issues.

---

## Mitigation Plans

- **R-101:** Merge-driven checklist ensures new aggregator API/fixtures land with updated unit tables, fuzz tests, and docs (`docs/dev/tool-call-aggregator.md`).
- **R-102:** Handler PRs must include the streaming/non-stream integration specs plus Playwright evidence (screenshots + transcripts) linked in the change summary.
- **R-103:** Introduce config contract tests plus `npm run config:lint` to validate default/header overrides; dashboards alert on mixed modes.
- **R-104:** Smoke scripts promoted to CI required jobs; failures upload SSE transcripts + server logs for debugging.
- **R-105:** Perf regression job reports memory/time; thresholds in CI convert to warnings that block release if exceeded twice.

---

## Assumptions & Dependencies

1. `docs/codex-proxy-tool-calls.md` remains the single source of truth for handler behavior and textual fallback parsing.
2. Fake Codex scripts can deterministically emit structured events for both proto and app paths (ensured by Story 2.8 scaffolding).
3. CI agents have Codex CLI ≥0.53 installed and can flip `PROXY_USE_APP_SERVER` + tool-call feature flags without manual intervention.
4. Observability stack (Prometheus + structured logs) is available in dev/staging to verify new metrics.

---

## Knowledge Base References

- `risk-governance.md` – scoring thresholds, gate decision rules.
- `probability-impact.md` – probability × impact scale applied in this document.
- `test-levels-framework.md` – justification for unit vs. integration vs. E2E coverage selection.
- `test-priorities-matrix.md` – mapping of P0–P3 priorities to execution cadence.
- `fixture-architecture.md` – guidelines for deterministic fixtures and auto-cleanup.
- `network-first.md` – SSE wait/response patterns used in integration & Playwright specs.

---

**Output artifacts:** `docs/test-design-epic-2.md` (this document) plus the referenced fixtures/tests tracked in stories **2.8–2.10**.
