# 04 — Progress Tracker (Codex Long-Horizon)

This file is the **single source of truth** for progress during the long-horizon run.

Update rules:
- Update this file **before every commit** and **after every verification run**.
- Keep entries short, factual, and command-oriented.

---

## Current status

- Branch: chore/remediation
- Session: n/a (local)
- Active phase: Phase 1
- Last checkpoint commit: 2afb01b chore(lh): bootstrap backlog + progress tracking
- Next milestone: Start P0 remediation (LH-P0-01 usage auth) after tooling checkpoint

---

## Tooling (discovered)

### Fast loop (run after most commits)
- Command(s): `npm run test:unit`
- Typical runtime: ~1–2s (local)
- Notes: Vitest unit layer only

### Full loop (run at milestones / end)
- Command(s): `npm run verify:all` (format:check + lint + unit + integration + Playwright)
- Typical runtime: TBD (expect several minutes)
- Notes: Aligns with CI workflow

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
- [ ] Checkpoint commit: `chore(tooling): establish verification loop`

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
