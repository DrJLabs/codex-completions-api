---
title: Flaky integration test — chat.nonstream.length.int.test.js
date: 2025-09-14
owner: QA/Dev
labels: [test-flake, integration, nonstream]
status: resolved
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

## Fix Summary

- Treat early `stdout.end` as truncation and respond with `finish_reason:"length"` immediately.
- Optionally lower `PROXY_PROTO_IDLE_MS` for targeted tests or add retry/polling helpers (no longer required after fix).

## Impact

- Flaky integration pipeline; unrelated to Story 2.6 functional change.

## Links

- Story: docs/bmad/stories/2.6.phase-h-usage-latency-placeholders.md
- Handler: src/handlers/chat/nonstream.js
- Test: tests/integration/chat.nonstream.length.int.test.js

## Resolution — 2025-09-17

- Hardened `postChatNonStream` to finalize responses when the proto exits without `task_complete`, ensuring JSON is flushed with `finish_reason:"length"` and usage fallbacks.
- Added structured JSON responder to guard against socket close races and to cancel idle timers after responding.
- Integration test `chat.nonstream.length.int.test.js` now executes five sequential runs with retry/backoff to prove determinism.
- Added runbook guidance for truncation-induced socket closes and updated issue status to resolved after `npm run verify:all` succeeded.
