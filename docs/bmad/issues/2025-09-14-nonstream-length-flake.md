---
title: Flaky integration test — chat.nonstream.length.int.test.js
date: 2025-09-14
owner: QA/Dev
labels: [test-flake, integration, nonstream]
status: open
priority: P1
---

## Summary

Intermittent failure in `tests/integration/chat.nonstream.length.int.test.js` with `TypeError: fetch failed (UND_ERR_SOCKET other side closed)` when using `scripts/fake-codex-proto-no-complete.js` (proto exits without `task_complete`).

## Repro

```bash
npx vitest run tests/integration/chat.nonstream.length.int.test.js --reporter=default
```

## Observed

- Socket closes during POST `/v1/chat/completions` (non‑stream). Test expects 200 with `finish_reason:"length"`.

## Hypothesis

- Race on child process exit and server response path in `postChatNonStream` when proto ends stdout without emitting `task_complete`.
- The handler waits for close, but fetch may see the socket end before JSON write completes.

## Proposed Fix (later)

- Treat early `stdout.end` as truncation and respond with `finish_reason:"length"` immediately.
- Alternatively, lower `PROXY_PROTO_IDLE_MS` for this test or add retry/polling in test helper.

## Impact

- Flaky integration pipeline; unrelated to Story 2.6 functional change.

## Links

- Story: docs/bmad/stories/2.6.phase-h-usage-latency-placeholders.md
- Handler: src/handlers/chat/nonstream.js
- Test: tests/integration/chat.nonstream.length.int.test.js
