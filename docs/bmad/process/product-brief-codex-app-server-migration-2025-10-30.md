# Product Brief: Codex App Server Migration

**Date:** 2025-10-30
**Author:** drj
**Status:** Draft for PM Review

---

## Executive Summary

Codex App Server migration safeguards the Codex Completions API as the CLI sunsets `codex proto`. By adopting the JSON-RPC app-server backend we preserve every OpenAI-compatible contract, reduce latency, and unlock future Codex feature support. The initiative focuses on replacing proto adapters with deterministic JSON-RPC routing, refreshing tests and runbooks, and operationalizing a long-lived worker so the service can ship reliable updates without customer disruption.

---

## Problem Statement

The proxy still shells out to `codex proto`, a subcommand that October 2025 Codex CLI releases remove. Continuing with proto risks immediate service failure, forces per-request process spawns that elevate latency, and leaves us without structured observability. Without migrating, all clients consuming `/v1/chat/completions` and `/v1/responses` will experience downtime once proto disappears, jeopardizing revenue and reliability goals.

---

## Proposed Solution

Migrate the backend to a persistent Codex App Server JSON-RPC process managed by a singleton driver. Adapters for chat and responses will translate JSON-RPC notifications into the existing OpenAI-compatible responses, supported by generated TypeScript bindings, health probes, and deterministic mocks that ensure parity across streaming and non-stream flows.

---

## Target Users

### Primary User Segment

Partner and customer integrations that consume the `/v1/chat/completions` and `/v1/responses` endpoints for real-time interaction tooling and agent workflows.

### Secondary User Segment

Internal platform operators and developer tooling teams who maintain Codex-backed services and rely on consistent observability, smoke tests, and deployment playbooks.

---

## Goals and Success Metrics

### Business Objectives

- Protect >99.9% availability for Codex Completions API customers.
- Maintain the OpenAI-compatible contract while modernizing the backend.
- Reduce operational overhead tied to proto-specific process churn.

### User Success Metrics

- Clients report zero breaking changes during and after migration.
- Streaming latency and completion times meet or beat current 95th percentile.
- Support tickets related to backend instability trend downward post-cutover.

### Key Performance Indicators (KPIs)

| KPI                         | Target                                      |
| --------------------------- | ------------------------------------------- |
| Production parity incidents | 0 post-cutover outages                      |
| Average request latency     | ≤ current P95 (maintain or improve)         |
| Smoke test success          | 100% for staging & prod app-server runs     |
| Observability coverage      | Logs + metrics for init, requests, restarts |

---

## Strategic Alignment and Financial Impact

### Financial Impact

Avoids downtime-related revenue loss when proto is removed and lowers infrastructure cost by eliminating per-request process spawn overhead.

### Company Objectives Alignment

Directly supports the 2025 reliability OKR and the platform modernization initiative that mandates Codex services move to supported backends.

### Strategic Initiatives

- Reliability: enables proactive adoption of supported Codex surfaces.
- Modernization: aligns with the CLI/toolchain upgrade program.
- Developer Experience: delivers structured telemetry and easier debugging.

---

## MVP Scope

### Core Features (Must Have)

- Singleton Codex App Server bootstrap with initialize/health probes.
- JSON-RPC adapters for `/v1/chat` and `/v1/responses` (stream & non-stream).
- Regression test suite updated with JSON-RPC mocks/transcripts.
- Updated deployment runbooks and smoke scripts targeting app-server.

### Out of Scope for MVP

- Introducing new client-facing features or contract changes pre-cutover.
- Overhauling authentication models beyond current parity.
- Multi-model routing optimizations (post-MVP consideration).

### MVP Success Criteria

- `npm run verify:all` passes using the JSON-RPC mock.
- Staging and production smoke (`scripts/prod-smoke.sh`) succeed with app-server.
- No customer-facing regressions detected after cutover monitoring window.

---

## Post-MVP Vision

### Phase 2 Features

- Extend app-server handling to additional endpoints (e.g., tool-call expansions).
- Enhance observability dashboards and alerting around worker health.
- Tune concurrency and autoscaling strategies once baseline stability is proven.

### Long-term Vision

- Leverage new Codex app-server capabilities (advanced tools, conversation APIs).
- Support per-model app-server fleets with intelligent routing.
- Integrate with broader platform modernization for continuous delivery.

### Expansion Opportunities

- Offer richer analytics/usage telemetry powered by structured notifications.
- Accelerate adjacent migrations (e.g., responses, tooling services) using the same adapters.

---

## Technical Considerations

### Platform Requirements

- Docker + Traefik deployment remains; containers must include CLI ≥0.49 and mount `CODEX_HOME`.
- Observability stack must capture JSON-RPC logs and metrics.

### Technology Preferences

- Keep Node 22 + Express architecture with TypeScript-friendly bindings for JSON-RPC schemas.
- Reuse existing SSE helper utilities for streaming output.

### Architecture Considerations

- Singleton driver managing child lifecycle with restart policy.
- Conversation-scoped request contexts with handler deregistration.
- Feature flag to toggle between proto and app-server during rollout.

---

## Constraints and Assumptions

### Constraints

- Migration must complete before proto is removed from Codex CLI releases.
- Limited to existing infrastructure (Docker, Traefik) during MVP.
- Requires regression coverage across all existing streaming/non-stream behaviors.

### Key Assumptions

- CLI release cadence follows announced deprecation timeline.
- Engineering capacity is available for refactors, tests, and doc updates.
- JSON-RPC schema remains stable within pinned CLI version.

---

## Risks and Open Questions

### Key Risks

- Schema drift between CLI versions could break adapters.
- Singleton worker hang causing request backlog.
- Incomplete regression tests missing edge-case parity issues.

### Open Questions

- Do we need staged rollout flags per environment?
- How will we automate regeneration of JSON-RPC bindings on CLI updates?
- What monitoring thresholds trigger automatic worker restart?

### Areas Needing Further Research

- Capture additional JSON-RPC transcripts for rare tool-call scenarios.
- Evaluate future Codex roadmap features unlocked post-migration.

---

## Appendices

### A. Research Summary

See `docs/research-technical-2025-10-30.md` for detailed technical comparison, risks, and implementation plan.

### B. Stakeholder Input

Maintain peer-review feedback from Maintainers, Ops, and QA captured in the research report (contract testing, runbooks, parity evidence).

### C. References

- docs/research-technical-2025-10-30.md
- docs/app-server-migration/codex-proto-vs-app-server.md
- docs/app-server-migration/codex-completions-api-migration.md
- docs/_archive/issues/codex-responses-endpoint--app-server-migration.md
- docs/_archive/issues/codex-responses-endpoint--conversation-adapter.md

---

_This Product Brief serves as the foundational input for Product Requirements Document (PRD) creation._

_Next Steps: Handoff to Product Manager for PRD development using the `workflow prd` command._
