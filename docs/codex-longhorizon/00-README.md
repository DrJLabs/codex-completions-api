# Codex Long-Horizon Execution Pack (Codex CLI + gpt-5.1-codex-max)

This pack is designed to help you run a **single long-horizon Codex CLI session** that:
- ingests your existing analysis/task markdown files,
- builds an execution backlog,
- executes remediation work iteratively (with checkpoints),
- and **tracks progress** in-repo.

It assumes you will run Codex CLI locally (or on your server) against your checked-out repo.

## What’s included

- **01-RUNBOOK.md** — install/auth/config, safety posture, logging, resume/recovery, tmux/screen tips
- **02-AGENTS.md** — recommended repository instructions for Codex (copy to repo root as `AGENTS.md` if you want)
- **03-MASTER-EXECUTION-PLAN.md** — how Codex should ingest task files, prioritize, and execute safely
- **04-PROGRESS.md** — progress tracker Codex updates as it works
- **05-LAUNCH-PROMPT.md** — the exact long-horizon prompt to feed Codex
- **codex-output-schema.json** — JSON schema to enforce structured final output from `codex exec`

## Where to put these files

Recommended in your repo:

```text
docs/codex-longhorizon/
  01-RUNBOOK.md
  02-AGENTS.md
  03-MASTER-EXECUTION-PLAN.md
  04-PROGRESS.md
  05-LAUNCH-PROMPT.md
  codex-output-schema.json
```

Optionally copy **02-AGENTS.md** to your repo root as `AGENTS.md` (Codex will auto-discover it).

## Quick start (preferred “hands-off” exec mode)

From your repo root:

1) Create a working branch (so Codex never touches main directly):

```bash
git checkout -b codex/long-horizon
```

2) Run Codex in a durable terminal (tmux/screen recommended):

```bash
mkdir -p logs
codex exec --full-auto --search   --model gpt-5.1-codex-max   --config model_reasoning_effort="xhigh"   --output-schema docs/codex-longhorizon/codex-output-schema.json   --output-last-message logs/codex-final.json   - < docs/codex-longhorizon/05-LAUNCH-PROMPT.md   2> logs/codex-progress.log | tee logs/codex-final.txt
```

3) If the session stops unexpectedly, resume:

```bash
codex exec resume --last
```

(See **01-RUNBOOK.md** for more robust logging, resume, and troubleshooting guidance.)

## Operating principles

- You stay in control of approvals and sandbox level.
- Codex should checkpoint frequently (commits + PROGRESS updates).
- Anything requiring secrets, production credentials, or irreversible actions should stop and ask for human input.
