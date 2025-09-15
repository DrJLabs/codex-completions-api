---
title: Epic — Stability & CI Hardening (Sep 2025)
status: Proposed
version: 0.1
updated: 2025-09-15
owner: Product (PM)
labels: [stability, ci, parity, streaming, nonstream, edge]
---

# Epic

Our proxy is functionally aligned with OpenAI’s Chat Completions API, but a handful of high‑impact gaps and flaky behaviors remain. This epic focuses on urgent stabilization work that unblocks the dev edge environment, reduces CI flakiness, and locks in parity via golden/contract checks.

# Acceptance Criteria

1. Dev edge non‑stream POST to `/v1/chat/completions` returns within timeout with correct JSON, matching prod.
2. Non‑stream truncation case consistently returns `finish_reason:"length"` without socket errors; integration test is green and deterministic.
3. Streaming handler emits usage as soon as counts are known and always before `[DONE]` when requested, preserving behavior on early termination.
4. Streaming concurrency guard test deterministically returns 429 for the second stream at concurrency limit.
5. Golden transcripts + contract checks cover non‑stream and streaming order (role → content → finish_reason → usage? → `[DONE]`) and are integrated into CI.
6. All work captured below is linked and closed; docs updated where relevant.

# Priorities

- P0
  - 2025‑09‑13 — Dev edge: non‑stream POST timeout (GH #74) — `docs/bmad/issues/2025-09-13-dev-edge-nonstream-timeout.md`

- P1
  - 2025‑09‑14 — Flaky integration: non‑stream length truncation — `tests/integration/chat.nonstream.length.int.test.js` — `docs/bmad/issues/2025-09-14-nonstream-length-flake.md`
  - 2025‑09‑13 — Golden transcripts + contract checks (GH #77) — `docs/bmad/issues/2025-09-13-chat-golden-transcripts-contract-checks.md`
  - 2025‑09‑13 — Emit usage immediately on token_count (GH #73) — `docs/bmad/issues/2025-09-13-emit-usage-immediately-on-token-count.md`
  - 2025‑09‑12 — Streaming concurrency guard flaky 429 (local QA) — `docs/bmad/issues/2025-09-12-concurrency-guard-flaky.md`

- P2 (stretch)
  - 2025‑09‑14 — Release/backup hardening (GH #80) — `docs/bmad/issues/2025-09-14-release-backup-hardening.md`
  - 2025‑09‑13 — Streaming finalizer richer finish_reason (GH #71) — `docs/bmad/issues/2025-09-13-streaming-finalizer-richer-finish-reason.md`
  - 2025‑09‑12 — QA — Graceful shutdown SIGTERM test — `docs/bmad/issues/2025-09-12-graceful-shutdown-sigterm.md`

# Phases & Tasks

- [ ] Phase 0 — Contracts first (guardrails)
  - [ ] Expand golden transcripts to include: minimal prompt, multi‑chunk content, truncation path; store under `test-results/` with clear naming.
  - [ ] Add contract checks in integration/E2E to validate order: role → content… → finish_reason → usage? → `[DONE]`.

- [ ] Phase 1 — Dev edge non‑stream timeout (P0)
  - [ ] Reproduce on dev edge; confirm prod parity. Inspect Cloudflare/WAF, Traefik, and origin timeouts.
  - [ ] Add tracing headers in dev for visibility; verify body fully flushes before connection close.
  - [ ] Close GH #74 with evidence (cURL and Playwright smoke on dev domain).

- [ ] Phase 2 — Non‑stream truncation flake
  - [ ] Treat early proto `stdout.end` as truncation and return `finish_reason:"length"` immediately.
  - [ ] Harden `tests/integration/chat.nonstream.length.int.test.js` for determinism.

- [ ] Phase 3 — Streaming usage timing
  - [ ] Emit usage as soon as counts arrive and on teardown; preserve finalizer order; keep `[DONE]` separate.
  - [ ] Verify with Playwright stream collector and contract checks.

- [ ] Phase 4 — Concurrency guard determinism
  - [ ] Add test‑only headers (`X-Conc-*`) for observability; adjust guard timing if needed.
  - [ ] Ensure repeatable 429 on the second concurrent stream at limit.

- [ ] Phase 5 — Docs & runbooks
  - [ ] Update `docs/openai-chat-completions-parity.md` if order/toggles are clarified.
  - [ ] Add a runbook snippet for dev edge timeouts (checks + usual culprits).

# Dependencies & Impact

- Issues: see Priorities section.
- Code: `src/handlers/chat/nonstream.js`, `src/handlers/chat/stream.js`, `src/services/sse.js`.
- Tests: `tests/integration/*`, Playwright E2E config, stream collector helper.
- Ops: Cloudflare/Traefik settings for dev edge.

# Rollout & Verification

- Local: `npm run verify:all` (unit, integration, e2e) — ensure newly added contract checks are green.
- Dev stack: `npm run dev:stack:up` → run `npm run smoke:dev`; validate dev edge non‑stream with cURL.
- Prod parity confirmation (no config flips): observe logs and run `npm run smoke:prod` after deploy when applicable.

# Change Log

| Date       | Version | Description                     | Author |
| ---------- | ------- | ------------------------------- | ------ |
| 2025-09-15 | 0.1     | Initial epic drafted (Proposed) | PM     |
