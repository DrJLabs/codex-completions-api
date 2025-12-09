# 01 — Runbook: running a multi-hour Codex CLI session with `gpt-5.1-codex-max`

This runbook is written for long-horizon, high-autonomy work while preserving reviewability and safety.

---

## 1) Install + authenticate (once)

### Install Codex CLI

```bash
npm i -g @openai/codex
codex --version
```

### Authenticate

```bash
codex login
codex status
```

If you are signed in with ChatGPT, Codex CLI can default to `gpt-5.1-codex-max` depending on your settings, but this pack pins it explicitly in the command.

---

## 2) Recommended local configuration (`~/.codex/config.toml`)

You can keep your defaults conservative and still override to “deep work” for this run using CLI flags.

Suggested baseline (safe default):

```toml
# ~/.codex/config.toml
model = "gpt-5.1-codex-max"
approval_policy = "on-request"
sandbox_mode = "read-only"
model_reasoning_effort = "medium"

[features]
# Let the model request web searches (still requires `--search` to enable the tool in-session).
web_search_request = true
# Optional: record progress via frequent lightweight commits (consider squashing later).
ghost_commit = false
```

Suggested deep-work profile (optional):

```toml
[profiles.long-horizon]
model = "gpt-5.1-codex-max"
approval_policy = "on-failure"
sandbox_mode = "workspace-write"
model_reasoning_effort = "xhigh"

[features]
web_search_request = true
ghost_commit = true
```

Then launch via:

```bash
codex --profile long-horizon
```

Notes:
- `ghost_commit` can help prevent “lost work” during long runs, but it can clutter history. Enable it only if you plan to squash or curate commits later.
- Prefer keeping network disabled unless it is clearly needed.

---

## 3) Use a durable session (tmux or screen)

Long-horizon runs should not depend on a single SSH connection. Two standard approaches:

### Option A — tmux

```bash
tmux new -As codex-lh
# run codex here
# detach: Ctrl-b then d
tmux attach -t codex-lh
```

### Option B — screen

```bash
screen -S codex-lh
# run codex here
# detach: Ctrl-a then d
screen -r codex-lh
```

---

## 4) Launch patterns

### Pattern 1 (recommended): `codex exec` with a prompt file

Pros: reproducible, logs cleanly, resumable.
Cons: less interactive steering.

From repo root:

```bash
git checkout -b codex/long-horizon
mkdir -p logs

codex exec --full-auto --search   --model gpt-5.1-codex-max   --config model_reasoning_effort="xhigh"   --output-schema docs/codex-longhorizon/codex-output-schema.json   --output-last-message logs/codex-final.json   - < docs/codex-longhorizon/05-LAUNCH-PROMPT.md   2> logs/codex-progress.log | tee logs/codex-final.txt
```

Key behaviors:
- `--full-auto` allows edits and reduces approval friction.
- `--search` enables web search as a tool (treat results as untrusted input).
- `--output-schema` forces structured final output (JSON schema in this pack).
- stderr (`2> ...`) captures streaming progress logs.

### Pattern 2: interactive Codex CLI (TUI)

Pros: you can steer, request diffs/reviews, compact context.
Cons: harder to automate and log.

```bash
codex --model gpt-5.1-codex-max --search
```

Then paste the content of `05-LAUNCH-PROMPT.md` as your first message.

---

## 5) Resuming after interruption

Codex supports resuming `exec` sessions:

```bash
codex exec resume --last
```

If needed, provide a short “continuation prompt” describing where to pick up (Codex should use `docs/codex-longhorizon/04-PROGRESS.md` as the ground truth).

---

## 6) Safety posture for long runs

Recommended defaults:
- Keep sandbox at `workspace-write`.
- Keep network disabled unless you have a clear need (dependency install, fetching specs).
- Treat any web content as untrusted and do not execute instructions copied from random pages.

If you truly need network:
- Use `--sandbox danger-full-access` only for narrowly scoped steps, and consider rerunning without network afterwards.

---

## 7) What “good” looks like

During the run you should see:
- frequent updates to `docs/codex-longhorizon/04-PROGRESS.md`
- frequent, reviewable commits with clear messages
- repeatable verification steps (tests, lint, typecheck) executed and logged
- minimal “drive-by” refactors unless they are explicitly needed to satisfy acceptance criteria

