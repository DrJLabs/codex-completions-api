# 06 — Troubleshooting + operational tips (Codex CLI)

## Common operational issues

### Codex can’t write files / refuses to run commands
- Confirm you are using `--full-auto` (or `sandbox_mode = "workspace-write"`).
- If you need network access for dependency installs, you must explicitly allow it (see runbook).

### Web search works in some sessions but not others
- Web search requires both:
  1) session flag `--search` (enables the tool), and
  2) config feature `web_search_request = true` (lets the model request searches), if you want it available consistently.

### The run is “too big” / context drifts
- In interactive mode, use `/compact` periodically (and after major milestones).
- In exec mode, prefer checkpoint commits frequently and keep each backlog item small.

### Long runs and SSH disconnects
- Always run inside tmux or screen.
- Keep logs: capture stderr (progress) and stdout (final) separately.

### You need to pause for a decision
- Write the decision request to `docs/codex-longhorizon/DECISIONS.md`.
- Stop and return a final JSON report with `status: "blocked"` and explicit next commands.

---

## Suggested directory hygiene

Add `logs/` to `.gitignore` if it’s not already ignored.

Recommended structure:

```
docs/codex-longhorizon/
logs/
```

---

## Suggested human review cadence

Even if you let Codex run unattended:
- review commits at least at each milestone boundary (Phase 0/1/2/3/4/5),
- re-run the “fast loop” yourself if results seem suspicious,
- consider squashing ghost commits before opening a PR.

