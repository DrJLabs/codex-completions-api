# 04 — Progress Tracker (Codex Long-Horizon)

This file is the **single source of truth** for progress during the long-horizon run.

Update rules:
- Update this file **before every commit** and **after every verification run**.
- Keep entries short, factual, and command-oriented.

---

## Current status

- Branch: chore/remediation
- Session: n/a (local)
- Active phase: Phase 3
- Last checkpoint commit: 8c38291 fix(security): harden auth and limits (LH-P0-01/02/03/04/05)
- Next milestone: Complete P1 schema/doc/tooling items (LH-P1-01..04)

---

## Tooling (discovered)

### Fast loop (run after most commits)
- Command(s): `npm run test:unit`
- Typical runtime: ~1–2s (local)
- Notes: Vitest unit layer only

### Full loop (run at milestones / end)
- Command(s): `npm run verify:all` (format:check + lint + unit + integration + Playwright)
- Typical runtime: TBD (expect several minutes)
- Notes: Aligns with CI workflow; latest integration run PASS (2025-12-09).

### Repo entrypoints / services
- How to start the API/service: `npm run start` (defaults to PORT=11435, binds 127.0.0.1)
- Env vars: `PORT` (default 11435), `PROXY_API_KEY`, `PROXY_USE_APP_SERVER` etc. per README
- Ports: 11435 (default local)
- Notes: Dev shim via `npm run dev`/`npm run dev:shim`; dev stack via `npm run dev:stack:up`

---

## Index + backlog status

- INDEX_TASK_DOCS.md: complete
- BACKLOG.md: complete
- DECISIONS.md: not started

---

## Milestones

### Phase 0 — Bootstrap
- [x] Create `docs/codex-longhorizon/INDEX_TASK_DOCS.md`
- [x] Create `docs/codex-longhorizon/BACKLOG.md`
- [x] Ensure this file is committed and being updated
- [x] Checkpoint commit: `chore(lh): bootstrap backlog + progress tracking`

### Phase 1 — Tooling / verification harness
- [x] Identify fast loop commands
- [x] Identify full loop commands
- [x] Align with CI (if present)
- [x] Checkpoint commit: `chore(tooling): establish verification loop`

### Phase 2 — P0 remediation
- [ ] P0 items complete (see BACKLOG.md)
- [ ] Verification logged for each item
- [ ] Checkpoint commit(s): `fix(...): ... (LH-P0-##)`

### Phase 3 — P1 remediation
- [ ] P1 items complete (see BACKLOG.md)
- [ ] Verification logged for each item

### Phase 4 — P2 remediation
- [ ] P2 items complete (see BACKLOG.md)
- [ ] Docs/examples updated with related changes

### Phase 5 — Release readiness
- [ ] Full loop passes
- [ ] Security/readiness scan notes recorded
- [ ] All acceptance criteria accounted for (Done/Blocked/Won’t do)
- [ ] Final checkpoint commit: `chore(release): long-horizon pass complete`

---

## Work log (append-only)

Add newest entries at the top.

### 2025-12-09 04:30 — Observability + deployment hygiene
- Backlog item(s): LH-P2-01, LH-P2-02, LH-P2-03
- Change summary: Added stream telemetry (TTFB/duration/end counters) and worker restart delta counter to /metrics; optional OTLP tracing via PROXY_ENABLE_OTEL + exporter URL with trace_id surfaced in access logs and backend spans; deprecated systemd installer stubbed/archived with docs declaring compose as canonical path.
- Files touched: src/services/metrics/index.js; src/routes/metrics.js; src/handlers/chat/stream.js; src/handlers/responses/stream.js; src/services/tracing.js; src/middleware/tracing.js; src/middleware/access-log.js; src/app.js; tests/integration/metrics.int.test.js; README.md; docs/bmad/architecture.md; docs/bmad/prd.md; .env.example; scripts/install.sh; docs/_archive/install.sh; package.json; package-lock.json
- Commands run:
  - `npm install`
  - `npm run test:unit` (PASS)
  - `npm run test:integration` (PASS)
- Results: New metrics exposed with bounded labels; tracing off by default with OTLP opt-in; integration + unit suites passing; legacy installer blocked and archived.

### 2025-12-09 03:20 — CI artifacts + workspace guard
- Backlog item(s): LH-P1-03
- Change summary: CI now uploads Playwright HTML/blob reports and smoke logs; workflow asserts clean git status after tests; Playwright reporter emits HTML/blob in CI; smoke log ignored in git; README documents artifact review.
- Files touched: .github/workflows/ci.yml; playwright.config.ts; .gitignore; README.md
- Commands run:
  - `npm run test:unit` (PASS)
  - `npm run lint:runbooks` (PASS)
- Results: Unit suite and doc lint pass; workflow will fail on fixture drift and retain artifacts for PR review.

### 2025-12-09 03:12 — Responses exposure flag + doc sync (partial)
- Backlog item(s): LH-P1-04, LH-P1-02 (docs portion)
- Change summary: Added `PROXY_ENABLE_RESPONSES` config (default on) gating router mount; documented env sample; added integration coverage for disabled mode (404 on HEAD/POST); docs refreshed for auth defaults (usage/test bearer + loopback), responses availability, proto/app-server policy, Express 4.21.2 version, and canonical doc index/links.
- Files touched: src/config/index.js; src/app.js; tests/integration/responses.flag.int.test.js; .env.example; README.md; docs/README.md; docs/bmad/architecture.md; docs/bmad/prd.md; docs/bmad/stories/6.1.responses-endpoint-handlers.md; docs/bmad/stories/epic-responses-endpoint-parity.md; docs/responses-endpoint/overview.md; AGENTS.md
- Commands run:
  - `npm run test:integration` (PASS, rerun after initial flake)
- Results: Responses route can be toggled per-env without changing defaults; documentation aligned with auth/sandbox/proto realities and Express version.

### 2025-12-09 02:53 — Schema workflow canonicalization
- Backlog item(s): LH-P1-01
- Change summary: Selected schema.ts as canonical source; removed template generator; kept bundle export idempotent and timestamp-free; added verify script for CI.
- Files touched: package.json; scripts/jsonrpc/export-json-schema.mjs; docs/app-server-migration/app-server-protocol.schema.json; removed scripts/jsonrpc/render-schema.mjs; scripts/jsonrpc/schema-template.ts; restored src/lib/json-rpc/schema.ts
- Commands run:
  - `node scripts/jsonrpc/export-json-schema.mjs`
  - `npm run test:unit` (PASS)
- Results: Unit suite PASS; schema bundle regenerates without drift-causing metadata.
- Commit: pending (LH-P1-01)
- Notes: `jsonrpc:schema` now a no-op (schema.ts authoritative); `jsonrpc:verify` checks bundle drift.

### 2025-12-09 02:44 — Phase 2 P0 hardening WIP
- Backlog item(s): LH-P0-01, LH-P0-02, LH-P0-03, LH-P0-04, LH-P0-05
- Change summary: Added bearer auth and loopback guard for __test and usage routes; extended rate-limit to /v1/responses; added prod fail-fast guard and explicit host binding default; introduced security check helper; added auth middleware + net utilities; updated tests for new auth and added security hardening + rate-limit coverage.
- Files touched: server.js; src/app.js; src/config/index.js; src/middleware/rate-limit.js; src/middleware/auth.js; src/routes/usage.js; src/lib/net.js; src/services/security-check.js; tests/integration/chat.stream.tool-buffer.int.test.js; tests/integration/rate-limit.int.test.js; tests/integration/responses.kill-on-disconnect.int.test.js; tests/integration/responses.stream.concurrency.int.test.js; tests/integration/server.int.test.js; tests/integration/security-hardening.int.test.js; tests/unit/security-check.spec.js
- Commands run:
  - `npm run test:unit` (PASS)
  - `npm run test:integration` (PASS)
- Results: Unit + integration suites passing (playwright skipped per default harness).
- Commit: pending (work in progress)
- Notes: Auth/rate-limit/fail-fast changes validated by integration suite.

### 2025-12-09 02:06 — Fast loop discovery
- Backlog item(s): n/a (Phase 1 tooling)
- Change summary: Selected fast/full verification commands and ran unit fast loop.
- Files touched: none (documentation updates pending)
- Commands run:
  - `npm run test:unit`
- Results: PASS (Vitest unit suite); runtime ~1.15s
- Commit: pending (tooling checkpoint)
- Notes: Warnings in logs expected from test fixtures (transport teardown); no failures.

### 2025-12-09 01:32 — Phase 0 bootstrap setup
- Backlog item(s): n/a (phase setup)
- Change summary: Copied long-horizon pack to `docs/codex-longhorizon/`; created INDEX_TASK_DOCS and BACKLOG; set up progress tracker and `logs/` directory.
- Files touched: `docs/codex-longhorizon/INDEX_TASK_DOCS.md`; `docs/codex-longhorizon/BACKLOG.md`; `docs/codex-longhorizon/04-PROGRESS.md`; `logs/`
- Commands run:
  - `cp -r docs/codex-long-horizon docs/codex-longhorizon`
  - `mkdir -p logs`
- Results: New Phase 0 artifacts created; no tests run (planning only).
- Commit: pending (Phase 0 checkpoint)
- Notes: Tooling discovery and verification loop deferred to Phase 1.
