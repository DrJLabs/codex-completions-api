# 04 — Progress Tracker (Codex Long-Horizon)

This file is the **single source of truth** for progress during the long-horizon run.

Update rules:
- Update this file **before every commit** and **after every verification run**.
- Keep entries short, factual, and command-oriented.

---

## Current status

- Branch: chore/remediation
- Session: n/a (local)
- Active phase: Phase 0
- Last checkpoint commit: 1537b34 fix: normalize legacy input items
- Next milestone: Finish Phase 0 checkpoint commit with backlog + progress files

---

## Tooling (discovered)

### Fast loop (run after most commits)
- Command(s): TBD in Phase 1
- Typical runtime: TBD
- Notes: Pending tooling discovery

### Full loop (run at milestones / end)
- Command(s): TBD in Phase 1
- Typical runtime: TBD
- Notes: Pending tooling discovery

### Repo entrypoints / services
- How to start the API/service: TBD (Phase 1)
- Env vars: TBD (Phase 1)
- Ports: TBD (Phase 1)
- Notes: Pending verification loop discovery

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
- [ ] Checkpoint commit: `chore(lh): bootstrap backlog + progress tracking`

### Phase 1 — Tooling / verification harness
- [ ] Identify fast loop commands
- [ ] Identify full loop commands
- [ ] Align with CI (if present)
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
