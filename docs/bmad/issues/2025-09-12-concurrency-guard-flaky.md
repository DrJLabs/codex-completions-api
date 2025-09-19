---
title: Streaming Concurrency Guard – Flaky Integration Test
date: 2025-09-12
owner: QA (assign: Quinn)
status: resolved
priority: P1
source: qa
labels: [streaming, rate-limit, test-flake]
---

## Summary

The integration test that asserts a 429 for a second concurrent streaming request occasionally returns 200 in the CI harness, despite the server’s global SSE concurrency guard being active and a deterministic shim readiness signal in place.

Test: `tests/integration/rate-limit.int.test.js` ("streaming concurrency limit returns 429…")
Shim: `scripts/fake-codex-proto-long.js` (writes `STREAM_READY_FILE` after first delta)
Guard: `src/handlers/chat/stream.js` (`PROXY_SSE_MAX_CONCURRENCY`)

## Observed Behavior

- First stream starts and emits at least one delta.
- `/__test/conc` confirms conc >= 1.
- Second stream still returns 200 rather than 429.

## Hypotheses

- Node/undici streaming lifecycle differs across environments; the first stream may not be counted as active at the instant second request is evaluated.
- The harness’s fetch ReadableStream reader may not keep the connection state that our guard expects, despite background reading.

## Plan

1. Instrument the guard path to emit a response header on acceptance/rejection (e.g., `X-Conc-Before`, `X-Conc-After`, `X-Conc-Limit`) for test builds only.
2. Update the test to assert on those headers to determine the guard’s evaluation state precisely.
3. If the guard is not evaluated before child spawn reliably, move the guard increment to the earliest possible point (already done) and/or add a tiny microtask yield to ensure synchronous completion before replying.
4. If still flaky, make the shim hold a server-side lock via a test endpoint to simulate long-lived streams deterministically, then re-run.

## Acceptance

- Test consistently returns 429 on the second stream with `PROXY_SSE_MAX_CONCURRENCY=1`.
- All suites remain green.

## Notes

- The non-stream rate limit 429 test passes and covers app-level rate limiting.
- This test may be temporarily skipped; guard remains enabled in production code.

## Resolution (2025-09-18)

- Adopted semaphore-based guard in `src/handlers/chat/stream.js` and legacy stream path to ensure acquisition happens before `spawnCodex`, with idempotent release tied to `close`, `finish`, and `aborted` events.
- Added test-only instrumentation behind `PROXY_TEST_ENDPOINTS=true`:
  - Guard headers (`X-Conc-Before`, `X-Conc-After`, `X-Conc-Limit`).
  - `GET /__test/conc` and `POST /__test/conc/release` helpers for CI harnesses.
  - Structured guard logs (`scope:"sse_guard"`) including `before/after/limit` for each outcome.
- Hardened `scripts/fake-codex-proto-long.js` to hold open streams until `STREAM_RELEASE_FILE` appears, enabling deterministic concurrency scenarios.
- Refactored `tests/integration/rate-limit.int.test.js` to run the streaming guard scenario five times, assert guard headers, and verify headers are hidden when `PROXY_TEST_ENDPOINTS=false`.
- Updated `docs/openai-chat-completions-parity.md` with instrumentation notes and added guard troubleshooting guidance to the dev→prod playbook.
