---
title: Codex Responses Endpoint Parity — Brownfield Enhancement
status: draft
updated: 2025-10-26
owner: Product Management
---

# Codex Responses Endpoint Parity - Brownfield Enhancement

## Epic Goal

Deliver `/v1/responses` with exact OpenAI parity—including typed SSE events and transcript fixtures—while keeping the existing `/v1/chat/completions` contract aligned with the canonical golden transcripts.

## Epic Description

**Existing System Context**

- Current relevant functionality: Node/Express proxy exposing `/v1/chat/completions`, `/v1/completions`, model listing, and usage telemetry backed by Codex CLI child processes. (`docs/bmad/architecture.md:20-200`)
- Technology stack: Node.js ≥ 22, Express 4.21.2, Codex CLI (`codex proto`), Vitest, Playwright, Docker Compose, Traefik ForwardAuth. (`docs/bmad/architecture.md:82-93`)
- Integration points: Express routers (`chat.js`, `usage.js`), Codex runner service, concurrency guard, metadata sanitizer, test transcript suite (`test-results/chat-completions/*`). (`docs/bmad/architecture.md:111-200`)

**Enhancement Details**

- What's being added/changed: Introduce `/v1/responses` router/handlers sharing Codex invocation utilities, regenerate golden transcripts per `docs/openai-endpoint-golden-parity.md`, and align chat completions handlers/tests with the new canonical fixtures.
- How it integrates: Add responses-specific handlers that reuse shared validation/sanitizer modules, extend transcript tooling to capture both endpoints, and update CI contract checks to compare responses/completions fixtures uniformly.
- Success criteria: `/v1/responses` and `/v1/chat/completions` both pass parity tests against the documented transcripts; CI fails on any drift; rollout/rollback plan documented in `docs/bmad/architecture.md:252-259`; no regression in existing APIs.

## Stories

1. **Implement `/v1/responses` handlers and router** — Create responses router, shared handler utilities, metadata sanitizer integration, and typed SSE stream per spec.
2. **Regenerate and align golden transcripts** — Extend capture scripts to produce `/v1/responses` fixtures, refresh chat transcripts, and update integration/Playwright tests to enforce combined parity.
3. **Rollout readiness and documentation update** — Update deployment/runbook guidance, add smoke commands, and ensure CI gating plus rollback tooling covers the new endpoint.

## Compatibility Requirements

- [ ] Existing APIs remain unchanged (`/v1/chat/completions`, `/v1/completions`, `/v1/models`, `/v1/usage` behave identically for clients)
- [ ] Database schema changes are backward compatible (N/A — no database usage; stateless Codex interactions)
- [ ] UI changes follow existing patterns (N/A — API-only surface)
- [ ] Performance impact is minimal (validate streaming concurrency guard still meets SLOs)

## Risk Mitigation

- **Primary Risk:** Divergence between implemented responses envelope and the OpenAI canonical spec, leading to contract regressions or client breakage.
- **Mitigation:** Enforce parity through regenerated golden transcripts, integration/Playwright contract tests, and sanitizer telemetry checks; gate deployment on CI success.
- **Rollback Plan:** Revert to prior container image using `scripts/stack-rollback.sh`, disable the new `/v1/responses` router, and redeploy existing stack (documented in `docs/bmad/architecture.md:252-259`).

## Definition of Done

- [ ] All stories completed with acceptance criteria met
- [ ] Existing functionality verified through full regression (unit, integration, Playwright contract tests)
- [ ] Integration points (Codex runner, concurrency guard, sanitizer) validated for both endpoints
- [ ] Documentation updated (PRD, architecture, parity spec references, runbooks)
- [ ] No regressions observed in `/v1/chat/completions` behavior or performance

## Validation Checklist

**Scope Validation**

- [x] Epic sized for 1-3 stories
- [x] No architectural rework required beyond shared handler extraction
- [x] Enhancement follows existing proxy patterns
- [x] Integration complexity limited to handler/test layers

**Risk Assessment**

- [x] Risk to existing system is low and observable via tests
- [x] Rollback plan feasible with existing stack tooling
- [x] Testing approach covers legacy functionality plus new endpoint
- [x] Team familiar with Codex runner and transcript tooling

**Completeness Check**

- [x] Epic goal is clear and outcome-driven (parity across both endpoints)
- [x] Stories scoped to discrete deliverables
- [x] Success criteria measurable via parity tests and documentation updates
- [x] Dependencies (shared utilities, transcript scripts) identified

## Story Manager Handoff

“Please develop detailed user stories for this brownfield epic. Key considerations:

- Enhancement touches the Node/Express proxy running on Codex CLI with existing routers/handlers.
- Integration points: new `/v1/responses` router/handlers, shared metadata sanitizer, transcript capture scripts, Playwright parity suite.
- Follow established handler patterns in `src/handlers/chat/*` and reuse the concurrency guard/SSE utilities.
- Critical compatibility requirements: maintain existing `/v1/chat/completions` contract and ensure `/v1/responses` matches `docs/openai-endpoint-golden-parity.md`.
- Every story must include verification that current chat completions behavior and performance remain intact after changes.”
