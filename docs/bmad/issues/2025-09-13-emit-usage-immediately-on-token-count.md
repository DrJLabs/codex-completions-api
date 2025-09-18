---
title: P1 — Emit usage immediately when token_count arrives (#73)
date: 2025-09-13
owner: Dev
status: resolved
priority: P1
source: github
gh_issue: 73
gh_url: https://github.com/DrJLabs/codex-completions-api/issues/73
labels: [streaming, usage]
---

Current streaming handler defers usage emission to `task_complete`. To preserve partial/errored stream behavior, emit a usage chunk as soon as counts arrive (and/or on teardown) in addition to the finalizer path. See GH issue for context.

## Resolution (2025-09-18)

- Stream handler now buffers `token_count` events and finalizes with a `finish_reason:"length"` chunk followed by a usage chunk (when requested) even if the proto exits without `task_complete`.
- Usage objects include an `emission_trigger` field (`token_count`, `task_complete`, or `provider`) and logging captures trigger metadata, emission timestamps, and provider drift.
- Added deterministic coverage:
  - `tests/integration/stream.usage-token-count.int.test.js`
  - `tests/integration/stream.provider-usage.int.test.js`
  - Updated Playwright SSE specs to assert `emission_trigger` ordering and usage semantics.
