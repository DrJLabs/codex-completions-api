# Task 04 – Response Serialization & Streaming Adapters
# Source: docs/surveys/TASK_04_Response_and_Streaming_Adapters.md

## Work done
- Added `PROXY_ENABLE_RESPONSES` gate (with HEAD/POST returning 404 when disabled) and documented `/v1/responses` in README.
- Streaming now tags responses with route/mode overrides and records stream metrics (TTFB, duration, outcomes) plus backend spans; responses share rate-limit/auth parity with chat.
- Stream observer integration ensures first-byte and outcome tracking; responses stream adapter still reuses chat pipeline with suppression hooks.
- `/v1/responses` now mirrors chat readiness gating via `requireWorkerReady`, and typed SSE parity (multi‑choice + tool events + `[DONE]`) is covered in integration/e2e tests.

## Gaps
- The typed SSE adapter is tested, but still lacks per‑event counters/log summaries (only error logs today). Consider adding lightweight metrics for adapter event counts to aid ops/debugging. Code ref: `src/handlers/responses/stream-adapter.js`.
- `docs/responses-endpoint/overview.md` remains phase‑oriented; it should be refreshed to describe the current supported typed SSE contract and output‑mode/tool‑event behavior.

## Plan / Acceptance Criteria & Tests
- AC1: Gate responses on worker readiness the same as chat. Test layer: integration. Implementation: apply readiness middleware and add tests using fake worker readiness toggles.
- AC2: Expand streaming parity tests for typed SSE covering multi-choice, tool events, suppression of chat chunks, and `[DONE]` emission. Test layer: Playwright or Vitest e2e. Implementation: add fixtures exercising tool calls and multi-choice, assert event ordering and adapter suppression behavior.
- AC3: Document supported output modes and typed SSE contract (including when tool events stream vs aggregate) and instrument adapter to log/metric event counts. Test layer: unit for adapter + metrics scrape in integration. Implementation: doc updates in README + responses overview; add counters/gauges for adapter events.
