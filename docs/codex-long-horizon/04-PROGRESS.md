# 04 — Progress Tracker (Codex Long-Horizon)

This file is the **single source of truth** for progress during the long-horizon run.

Update rules:
- Update this file **before every commit** and **after every verification run**.
- Keep entries short, factual, and command-oriented.

---

## Current status

- Branch: (fill in)
- Session: (Codex session id if available)
- Active phase: Phase 0 / 1 / 2 / 3 / 4 / 5
- Last checkpoint commit: (hash + subject)
- Next milestone: (one sentence)

---

## Tooling (discovered)

### Fast loop (run after most commits)
- Command(s):
- Typical runtime:
- Notes:

### Full loop (run at milestones / end)
- Command(s):
- Typical runtime:
- Notes:

### Repo entrypoints / services
- How to start the API/service:
- Env vars:
- Ports:
- Notes:

---

## Index + backlog status

- INDEX_TASK_DOCS.md: not started / in progress / complete
- BACKLOG.md: not started / in progress / complete
- DECISIONS.md: not started / in progress / complete

---

## Milestones

### Phase 0 — Bootstrap
- [ ] Create `docs/codex-longhorizon/INDEX_TASK_DOCS.md`
- [ ] Create `docs/codex-longhorizon/BACKLOG.md`
- [ ] Ensure this file is committed and being updated
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

### YYYY-MM-DD HH:MM — <short title>
- Backlog item(s): LH-...
- Change summary:
- Files touched:
- Commands run:
  - `...`
- Results:
- Commit:
- Notes:

