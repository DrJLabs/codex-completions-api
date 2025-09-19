---
title: Analyst Research — Streaming Concurrency Guard Determinism
status: Draft
created: 2025-09-18
related_story: docs/bmad/stories/3.4.streaming-concurrency-guard-determinism.md
---

## Research Objectives

- Understand root causes for nondeterministic SSE concurrency guard behavior under Node.js/undici when multiple streaming requests arrive in rapid succession.
- Identify instrumentation and synchronization techniques that improve visibility and determinism without affecting production latency.
- Survey best practices for implementing per-process or distributed concurrency throttles for SSE/WebSocket style workloads.

## Methodology & Sources

- Reviewed existing project artifacts: Story 3.3 Dev Notes, issue `2025-09-12-concurrency-guard-flaky`, architecture docs, QA assessments.
- Consulted public engineering retrospectives on concurrency-limited streaming services (Cloudflare Workers SSE guidelines, Vercel Edge Functions throttling notes, 2024 NodeConf talk on `AsyncLocalStorage`-aware semaphores).
- Analyzed undici `fetch` and `Response` lifecycle behavior to map event ordering for `close`, `error`, and `aborted` hooks.

## Key Findings

1. **Race arises before header flush**
   - Undici's `Response` object defers socket reservation until headers flush; if guard increments after launching the Codex child, the second request may pass the guard because the counter reset path runs before the first stream attaches `close` listeners. Guard evaluation must occur synchronously before `spawn` and `res.flushHeaders()`.

2. **Deterministic instrumentation requires test-only headers**
   - Adding headers such as `X-Conc-Before`, `X-Conc-After`, and `X-Conc-Limit` gated behind `PROXY_TEST_ENDPOINTS` enables CI to assert the precise guard branch without polluting production responses.
   - Structured logs should capture `{req_id, event:"sse_guard", before, after, limit, outcome}` to correlate with failing runs.

3. **Semaphore-style guard with finally block**
   - Best practices recommend a small semaphore primitive with `acquire()` returning a boolean and `release()` executed from a `finally` block bound to `close`, `finish`, and `aborted` events. Using `promise.finally(() => release())` avoids double decrements on simultaneous `'close'` and `'error'`.

4. **Synthetic hold-open improves CI reliability**
   - Deterministic fixtures hold the first stream until a marker file or test endpoint releases it. Reusing `fake-codex-proto-long.js` with an explicit `/__test/conc/release` endpoint prevents timing-dependent behavior.

5. **Observability trade-offs**
   - Emitting per-request guard logs is inexpensive relative to SSE throughput; ensure logs use `debug` level or conditional enablement to avoid flooding production.

## Implementation Implications for Story 3.4

- Guard logic should use an atomic counter or lightweight semaphore stored in module scope with synchronous `if (count >= limit)` check.
- Register a single teardown handler that decrements once, using idempotent guard (e.g., boolean flag on closure) to prevent phantom counts.
- Introduce optional test endpoints/headers behind `PROXY_TEST_ENDPOINTS` to avoid leaking internals in production builds.
- Update integration test to assert on guard headers and to orchestrate the release of the first stream.

## Testing Recommendations

- Add a focused Vitest suite executing the failure scenario five times to ensure consistent 429 responses.
- Extend Playwright SSE contract tests to verify header absence when `PROXY_TEST_ENDPOINTS` is false (production simulation).

## Open Questions

- Do we need distributed coordination when multiple replicas run behind Traefik? Current per-process guard may still allow higher global concurrency; evaluate once per-replica guard is deterministic.
- Should we expose guard metrics via `/v1/usage` or rely solely on logs?
