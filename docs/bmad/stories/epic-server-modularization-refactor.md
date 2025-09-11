---
title: Epic — Modularize server.js
status: Draft
version: 0.1
updated: 2025-09-11
---

# Epic

As a maintainer, I want `server.js` refactored into cohesive modules so that the proxy is easier to test, reason about, and evolve without changing its external API behavior.

# Acceptance Criteria

1. External API shapes and headers remain compatible (see `docs/bmad/prd.md` success examples).
2. PRD smoke tests pass locally (health, models, chat non‑stream/stream, completions shim).
3. Streaming contract preserved: role‑first deltas, `[DONE]`, keepalive behavior.
4. Structured access logs include `req_id`, route, status, duration.
5. Directory layout matches the Target Architecture in `docs/bmad/architecture/server-modularization-refactor.md`.

# Tasks / Subtasks

- [ ] Phase 0 — Safety nets
  - [ ] Add structured access‑log middleware (keep console logs temporarily)
  - [ ] Capture baseline p95 for non‑stream and TTFC for stream
- [ ] Phase 1 — Config + Errors
  - [ ] Extract `src/config/index.js` and `src/config/models.js`
  - [ ] Add `src/lib/errors.js` and switch error envelopes
- [ ] Phase 2 — Health & Models routers
  - [ ] `src/routes/health.js` + mount
  - [ ] `src/routes/models.js` + mount; preserve gating in config
- [ ] Phase 3 — Chat handlers
  - [ ] `src/handlers/chat/nonstream.js`
  - [ ] `src/handlers/chat/stream.js` (SSE framing, keepalive, cut/tail)
- [ ] Phase 4 — Codex runner & SSE utils
  - [ ] `src/services/codex-runner.js` (args/env/spawn)
  - [ ] `src/services/sse.js` (send/keepalive/finish/cleanup)
- [ ] Phase 5 — Cleanup & logging
  - [ ] Remove dead code in `server.js`; prefer structured JSON logs
  - [ ] Update docs with final module map

# Dev Notes

- Non‑functional change; behavior must remain identical.
- Validate with `docs/bmad/prd.md` smoke tests after each phase.
- Consider adding minimal supertest for `/v1/models` and `/healthz` during Phase 2.

# Change Log

| Date       | Version | Description                      | Author |
| ---------- | ------- | -------------------------------- | ------ |
| 2025-09-11 | 0.1     | Initial epic + plan stub created | codex  |
