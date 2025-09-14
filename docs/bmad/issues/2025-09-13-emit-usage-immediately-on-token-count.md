---
title: P1 — Emit usage immediately when token_count arrives (#73)
date: 2025-09-13
owner: Dev
status: open
priority: P1
source: github
gh_issue: 73
gh_url: https://github.com/DrJLabs/codex-completions-api/issues/73
labels: [streaming, usage]
---

Current streaming handler defers usage emission to `task_complete`. To preserve partial/errored stream behavior, emit a usage chunk as soon as counts arrive (and/or on teardown) in addition to the finalizer path. See GH issue for context.
