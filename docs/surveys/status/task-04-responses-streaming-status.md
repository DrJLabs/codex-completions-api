# Task 04 – Response Serialization & Streaming Adapters
# Source: docs/surveys/TASK_04_Response_and_Streaming_Adapters.md

## Work done
- Added `PROXY_ENABLE_RESPONSES` gate (with HEAD/POST returning 404 when disabled) and documented `/v1/responses` in README.
- Streaming now tags responses with route/mode overrides and records stream metrics (TTFB, duration, outcomes) plus backend spans; responses share rate-limit/auth parity with chat.
- Stream observer integration ensures first-byte and outcome tracking; responses stream adapter still reuses chat pipeline with suppression hooks.
- `/v1/responses` now mirrors chat readiness gating via `requireWorkerReady`, and typed SSE parity (multi‑choice + tool events + `[DONE]`) is covered in integration/e2e tests.
- AC3 implemented: `/v1/responses` now defaults to `openai-json` output mode (configurable via `PROXY_RESPONSES_OUTPUT_MODE`) unless the client sets `x-proxy-output-mode`, preventing tool intent from being duplicated inside `response.output_text.delta`.
- AC3 implemented: the typed SSE adapter now increments `codex_responses_sse_event_total{route,model,event}` and emits a one-line structured summary log (`component=responses event=sse_summary`) at completion/failure.
- Refreshed `docs/responses-endpoint/overview.md` to describe the current implementation and typed SSE contract (replacing the older phase plan).

## Gaps
- The stream concurrency guard and some error paths still log `/v1/chat/completions` as the route even when `/v1/responses` delegates to the chat streaming pipeline (functionally correct, but slightly confusing for ops logs). Prefer using the request-context route consistently when touching guard/log call sites.

## Plan / Acceptance Criteria & Tests
- AC1: Gate responses on worker readiness the same as chat. Test layer: integration. Implementation: apply readiness middleware and add tests using fake worker readiness toggles.
- AC2: Expand streaming parity tests for typed SSE covering multi-choice, tool events, suppression of chat chunks, and `[DONE]` emission. Test layer: Playwright or Vitest e2e. Implementation: add fixtures exercising tool calls and multi-choice, assert event ordering and adapter suppression behavior.
- AC3: Document supported output modes and typed SSE contract (including when tool events stream vs aggregate) and instrument adapter to log/metric event counts (complete). Test layer: integration + Playwright E2E.
