# Technical Research Report: Validate and refine the migration plan for Codex Completions API from Codex Proto to Codex App Server, confirming feasibility, gaps, and integration strategy.

**Date:** 2025-10-30
**Prepared by:** drj
**Project Context:** Brownfield enhancement of the existing Codex Completions API project.

---

## Executive Summary

**Recommendation**: Execute the Codex App Server migration plan, prioritizing adapter refactors, JSON-RPC mocks, and deployment runbook updates before enabling in production.
**Alternatives**: None viable—proto baseline cannot be sustained under upcoming CLI releases.

### Key Recommendation

**Primary Choice:** Codex App Server migration

**Rationale:** Codex Proto is being removed from upcoming CLI releases; adopting the JSON-RPC app-server keeps the proxy aligned with supported tooling while preserving the OpenAI-compatible surface. Migration leverages existing guides and offers better observability and reliability.

**Key Benefits:**

- Maintains compatibility with Codex updates and unlocks continued feature support.
- Reduces per-request process churn, improving latency and resource efficiency.
- Provides structured notifications that simplify debugging, testing, and future enhancements.

---

## 1. Research Objectives

### Technical Question

Validate and refine the migration plan for Codex Completions API from Codex Proto to Codex App Server, confirming feasibility, gaps, and integration strategy.

### Project Context

Brownfield enhancement of the existing Codex Completions API project.

### Requirements and Constraints

#### Functional Requirements

Ensure OpenAI-compatible endpoints remain intact and authentication parity is preserved between Codex Proto and Codex App Server.

#### Non-Functional Requirements

Maintain current performance, reliability, and developer experience characteristics after migration.

#### Technical Constraints

Retain the existing Docker + Traefik infrastructure footprint during the migration.

---

## 2. Technology Options Evaluated

- Codex App Server migration (JSON-RPC persistent process) per existing internal guides (`docs/app-server-migration/codex-proto-vs-app-server.md`, `docs/app-server-migration/codex-completions-api-migration.md`)
- Legacy Codex Proto baseline (reference only for parity validation during migration)

---

## 3. Detailed Technology Profiles

### Option 1: Codex App Server Migration

**Overview**

- Supported successor to `codex proto`, shipping in Codex CLI ≥ 0.49 (repo currently pins `@openai/codex` 0.49.0; upgrade path documented in `docs/app-server-migration/codex-completions-api-migration.md`).
- Replaces per-request child processes with a persistent JSON-RPC 2.0 server, eliminating deprecated proto event streams.
- Maintained by the Codex team; migration guides (`docs/app-server-migration/*.md`, updated 2025-10-28) track the latest CLI surface and match repo conventions.
- Mandated long-term because newer Codex CLI releases remove the `proto` subcommand (per October 2025 release notes)—production parity demands this migration.

**First Principles Summary**

- Problem: the proxy must continue serving OpenAI-compatible responses while Codex deprecates `proto`; failure to migrate breaks the service.
- Constraints: client contract, Docker + Traefik deployment, `CODEX_HOME` auth, and existing SSE/non-stream semantics cannot change.
- Primitive operations: JSON-RPC request/notification pairs provide the minimal building blocks to reimplement the adapter deterministically.
- Imperatives: build a JSON-RPC client layer, maintain stateless conversations, and guarantee parity through deterministic mocks and transcripts.

**Technical Characteristics**

- Architecture: long-lived child process accessed over JSON-RPC (`initialize` → `sendUserTurn` → `sendUserMessage`).
- Emits structured notifications (`agentMessageDelta`, `agentMessage`, `tokenCount`, tool events) that map directly to OpenAI SSE chunks and non-stream accumulators.
- Supports explicit conversation/thread lifecycle (`newConversation`, `resumeConversation`), allowing the proxy to stay stateless per request.
- Removes spawn/teardown overhead, improving tail latency and concurrency by reusing a warm process.
- Integration strategy already drafted: singleton driver (`src/bootstrap/app-server.ts`), JSON-RPC router, SSE/non-stream assemblers, plus type-safe bindings under `docs/issues/codex-app-server/`.

**Developer Experience**

- Learning curve: introduces JSON-RPC plumbing, but migration docs include driver sketches, call sequences, and binding locations.
- Documentation: existing guides cover launch flags, request wiring, event handling, and testing updates; issues provide ready-made checklists.
- Tooling: encourages generated TypeScript types (`docs/issues/codex-app-server/*`) for method/event safety; structured envelopes ease debugging compared to raw proto deltas.
- Testing: plan calls for replacing proto shim with a JSON-RPC mock, giving deterministic fixtures for unit/integration/E2E suites, and running `npm run verify:all` in app-server mode before rollout.

**Operations**

- Deployment remains Docker + Traefik; only child-process lifecycle changes.
- Requires health/readiness probes (e.g., lightweight `initialize` ping) and restart policy for the singleton worker.
- Concurrency, timeouts, and kill-on-disconnect logic stay at proxy layer; guidance includes restarting the child if it locks up.
- Credentials still reside in mounted `CODEX_HOME`, so auth flows stay unchanged.

**Ecosystem & Adoption**

- Official Codex direction; all future features land here. Proto already deprecated, so sticking with the old surface will eventually break.
- Internal issues (`docs/issues/codex-responses-endpoint--*.md`) outline concrete migration stories, confirming the path is actively supported.

**Dependency Mapping**

- Codex CLI & schema: JSON-RPC method/event definitions tied to the pinned `@openai/codex` version and generated bindings in `docs/issues/codex-app-server/`.
- Process/runtime: singleton launcher (`src/bootstrap/app-server.ts`), health/restart hooks, and credential mounts (`CODEX_HOME`).
- Proxy adapters: route handlers (`/v1/chat`, `/v1/responses`, etc.), SSE/non-stream wrappers, and usage accounting refactored to consume JSON-RPC notifications.
- Concurrency/observability: request-context tracking for conversation IDs, logging, and metrics capturing JSON-RPC activity.
- Testing/tooling: JSON-RPC mocks and transcripts replacing proto fixtures across Vitest/Playwright suites; CI scripts ensuring CLI availability.
- Docs/runbooks: migration guides (`docs/app-server-migration/*.md`), runbooks, smoke scripts (`scripts/prod-smoke.sh`), and architecture/PRD references updated to reflect the new backend.

**Costs**

- No new licensing; infrastructure footprint stays constant (Node service + Codex CLI container).
- Engineering lift covers refactoring spawn/IO adapters, introducing JSON-RPC routing, updating tests/docs—a set of tasks already scoped in the migration issues.
- Operationally more efficient due to lower process churn and clearer observability.

**Risk Considerations**

- JSON-RPC schema drift could break request/notification parsing—enforce CLI version pins and run schema/version checks on process start.
- Long-lived worker hangs would stall traffic—add readiness pings, per-request timeouts, and restart the singleton on inactivity.
- Conversation cross-talk risks leaking notifications between clients—scope conversations per request and unregister handlers once complete; regression-test concurrent turns.
- Missing `CODEX_HOME` mounts would break auth—validate credentials at boot and cover app-server mode in smoke tests before deploy.

**Peer Review Notes**

- Maintainers: ensure contract suites (`/v1/chat`, `/v1/responses`) run against a JSON-RPC mock pre-cutover and remove legacy proto paths entirely.
- Ops: update runbooks with health-check, restart, and credential-mount procedures; tie readiness probe failures to alerts.
- QA: verify SSE/tool-call parity via recorded transcripts and maintain a proto→JSON-RPC event mapping for debugging.
- Deployment: align with DevOps on the `docker compose up -d --build --force-recreate` rollout plus post-deploy smoke tests targeting app-server.

**Lessons Learned (Project Forward View)**

1. Automate CLI schema/version checks to detect protocol drift before runtime.
2. Instrument the singleton lifecycle with readiness logs and restart metrics for fast diagnostics.
3. Maintain the JSON-RPC mock and captured transcripts as the contract testing source of truth.
4. Treat architecture/PRD documentation updates as part of the migration definition of done.
5. Standardize deployment playbooks and smoke steps across environments to ensure consistent cutovers.

### Option 2: Codex Proto Baseline (Reference Only)

**Overview**

- Legacy per-request `codex proto` CLI integration, currently powering production.
- Emits ad-hoc JSON events over stdio; each HTTP request spawns a fresh child process.
- Deprecated by Codex: newer CLI builds remove the `proto` subcommand, forcing migration.

**Technical Characteristics**

- Architecture: stateless spawn, send `user_turn` / `user_input` ops, read event stream until completion, then kill process.
- Notifications use legacy naming (`assistant_message_delta`, etc.) requiring bespoke parsers.
- No formal handshake; limited introspection and tooling support.
- Higher latency due to process startup; limited concurrency because each spawn owns STDIO.

**Developer Experience**

- Familiar to current team; existing code and tests built around it.
- Poor documentation going forward; no new features will target proto.
- Debugging requires parsing heterogeneous events without schema guarantees.

**Operations**

- Works with current Docker + Traefik stack but incurs higher CPU churn and process management overhead.
- Scaling relies on spawning more short-lived processes; harder to monitor/trace individual runs.
- Unsupported in new CLI versions—future container rebuilds would fail.

**Ecosystem & Adoption**

- Being sunset; no community support beyond legacy forums.
- Internal architecture/stories (e.g., stability campaign) already flagged proto as technical debt.

**Costs**

- Continuing incurs risk of sudden breakage when CLI deprecates proto entirely.
- Ongoing maintenance burden to keep proto shims alive outweighs short-term savings of delaying migration.

---

## 4. Comparative Analysis

Codex App Server (target) delivers structured JSON-RPC flows, lower latency, ongoing support, and aligns with release notes, while the proto baseline remains only as a parity reference during verification because it is deprecated and slated for removal.

### Weighted Analysis

**Decision Priorities:**

1. Ensure compatibility with upcoming Codex CLI releases.
2. Preserve OpenAI-compatible streaming and non-stream responses.
3. Maintain Docker + Traefik operational footprint.
4. Uphold testability and observability for the long-lived app-server process.

**Weighted Comparison**

- Codex App Server: High for compatibility, future-proofing, observability; Medium for implementation effort.
- Codex Proto baseline: Low for future compatibility, Medium for current stability; High risk due to imminent deprecation.

---

## 5. Trade-offs and Decision Factors

Full migration is required to meet requirements; proto baseline is unsuitable beyond short-term reference, so no alternative path satisfies the constraints.

### Key Trade-offs

[Comparison of major trade-offs between top options]

---

## 6. Real-World Evidence

Internal migration guides and Story 6.1 follow-up docs show proto already breaking under new CLI builds; release notes confirm proto removal, underscoring urgency. Migration checklists capture real-world expectations.

---

## 7. Architecture Pattern Analysis

{{#architecture_pattern_analysis}}
{{architecture_pattern_analysis}}
{{/architecture_pattern_analysis}}

---

## 8. Recommendations

**Recommendation**: Execute the Codex App Server migration plan, prioritizing adapter refactors, JSON-RPC mocks, and deployment runbook updates before enabling in production.
**Alternatives**: None viable—proto baseline cannot be sustained under upcoming CLI releases.

### Implementation Roadmap

1. **Proof of Concept Phase**
   - Stand up the singleton app-server driver, wire initialize/sendUserTurn/sendUserMessage, and validate a sample `/v1/chat` request end-to-end in a controlled environment.
   - Capture JSON-RPC transcripts to seed mocks and fixtures.

2. **Key Implementation Decisions**
   - Confirm CLI version pin and schema compatibility strategy.
   - Determine conversation lifecycle handling (per-request vs pooled) and finalize notification routing shape.
   - Choose fallback behavior for request timeouts and worker restarts.

3. **Migration Path**
   - Refactor chat/responses adapters to consume JSON-RPC notifications behind a feature flag.
   - Replace proto mocks with JSON-RPC equivalents in unit/integration/E2E suites.
   - Update deployment manifests, runbooks, and smoke scripts to launch app-server by default.

4. **Success Criteria**
   - `npm run verify:all` passes using the JSON-RPC mock.
   - Streaming/non-streaming contract tests confirm parity with proto baselines.
   - Production smoke (`scripts/prod-smoke.sh`) succeeds against app-server.
   - Runbooks, architecture docs, and PRD references reflect the new backend.

**Migration Planning (Reasoning via Planning)**

- Model the end state: app-server JSON-RPC backend with unchanged public API, operational tooling aligned.
- Phase A (Foundations): upgrade CLI package, refresh bindings, implement singleton bootstrap with health probes.
- Phase B (Adapter Refactor): convert chat/responses adapters to JSON-RPC notifications and ensure SSE/non-stream parity.
- Phase C (Quality Gate): swap in JSON-RPC mock, regenerate fixtures, run `npm run verify:all`, capture parity transcripts.
- Phase D (Operationalization): update docs/runbooks, finalize deployment SOP (`docker compose …`, smoke), maintain feature toggle through rollout.
- Strategy: deliver working prototype early, then harden with tests/docs; document acceptance criteria before cutover.

### Risk Mitigation

- Pin CLI versions and validate schemas at startup to detect drift.
- Implement health probes, timeouts, and restarts for the singleton process.
- Scope conversations per request and unregister handlers to prevent cross-talk.
- Verify credential mounts during deploy; run app-server-targeted smoke tests.

---

## 9. Architecture Decision Record (ADR)

# ADR-APP-SERVER-MIGRATION: Adopt Codex App Server Backend

## Status

Proposed

## Context

Codex CLI is deprecating `codex proto`; the proxy must stay OpenAI-compatible while adopting a persistent JSON-RPC server.

## Decision Drivers

- Maintain compatibility with Codex releases.
- Preserve OpenAI API contracts.
- Keep Docker + Traefik infrastructure.
- Improve observability and testability.

## Considered Options

- Migrate to Codex App Server JSON-RPC backend.
- Retain Codex Proto baseline (deprecated).

## Decision

Migrate to Codex App Server with JSON-RPC adapters and singleton lifecycle management.

## Consequences

**Positive:** future-proof support, improved observability, reduced process churn.
**Negative:** refactor effort, ongoing maintenance of mocks/bindings.
**Neutral:** documentation/runbook updates.

## Implementation Notes

Follow `docs/app-server-migration/*.md`, replace proto adapters, update tests, and align deployment SOP.

## References

- docs/app-server-migration/codex-proto-vs-app-server.md
- docs/app-server-migration/codex-completions-api-migration.md
- docs/issues/codex-responses-endpoint--app-server-migration.md

---

## 10. References and Resources

### Documentation

- docs/app-server-migration/codex-proto-vs-app-server.md
- docs/app-server-migration/codex-completions-api-migration.md
- docs/issues/codex-responses-endpoint--app-server-migration.md
- docs/issues/codex-responses-endpoint--conversation-adapter.md

### Benchmarks and Case Studies

- Release notes and migration notes captured in repo issues (see above docs/issues).

### Community Resources

- Internal Codex CLI release announcements (Oct 2025) documenting proto removal.

### Additional Reading

- README.md sections on proto streaming and migration context.

---

## Appendices

### Appendix A: Detailed Comparison Matrix

To be produced once JSON-RPC mocks generate empirical comparison metrics during implementation.

### Appendix B: Proof of Concept Plan

POC plan covered in Implementation Roadmap Phase A; expanded scheduling tracked in sprint planning docs.

### Appendix C: Cost Analysis

Not applicable—CLI migration does not materially change cost footprint beyond engineering effort.

---

## Document Information

**Workflow:** BMad Research Workflow - Technical Research v2.0
**Generated:** 2025-10-30
**Research Type:** Technical/Architecture Research
**Next Review:** [Date for review/update]

---

_This technical research report was generated using the BMad Method Research Workflow, combining systematic technology evaluation frameworks with real-time research and analysis._
