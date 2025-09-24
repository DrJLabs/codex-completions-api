---
title: Streaming finalizer — propagate richer finish_reason (stop|length|…) (#71)
date: 2025-09-13
owner: Dev
status: closed
priority: P2
source: github
gh_issue: 71
gh_url: https://github.com/DrJLabs/codex-completions-api/issues/71
labels: [streaming, finish_reason, spec]
---

Upgrade streaming finalizer to include accurate `finish_reason` (e.g., `stop` vs `length`) when upstream signal is available. Backward compatible; default remains `stop`. See GH issue for approach and tests.

## Resolution — 2025-09-22

- Story 3.9 merged, propagating upstream finish reasons through the streaming finalizer, updating telemetry, tests, and documentation.
- QA gate PASS (`docs/bmad/qa/gates/3.9-streaming-finalizer-richer-finish-reason.yml`); follow-up telemetry dashboards tracked in `docs/bmad/issues/2025-09-22-finish-reason-follow-ups.md`.
