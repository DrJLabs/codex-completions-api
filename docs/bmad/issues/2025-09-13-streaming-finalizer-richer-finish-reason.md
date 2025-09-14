---
title: Streaming finalizer — propagate richer finish_reason (stop|length|…) (#71)
date: 2025-09-13
owner: Dev
status: open
priority: P2
source: github
gh_issue: 71
gh_url: https://github.com/DrJLabs/codex-completions-api/issues/71
labels: [streaming, finish_reason, spec]
---

Upgrade streaming finalizer to include accurate `finish_reason` (e.g., `stop` vs `length`) when upstream signal is available. Backward compatible; default remains `stop`. See GH issue for approach and tests.
