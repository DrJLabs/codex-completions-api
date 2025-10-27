# NFR Assessment — Story 6.1 — Responses Endpoint Handlers

## Summary

- Assessed NFRs: security, performance, reliability, maintainability
- Overall Result: **CONCERNS** (quality score 70)

## Security — CONCERNS

- **Evidence:** `/v1/responses` delegates to the existing chat handlers, preserving bearer validation, rate limiting, and metadata sanitization (`src/routes/responses.js`, `src/handlers/responses/nonstream.js`, `src/handlers/chat/nonstream.js`). Architecture guidance confirms the transform path keeps sanitizer rules intact (#188-205 in `docs/bmad/architecture.md`).
- **Gap:** No automated coverage verifies tool-call serialization or `previous_response_id` handling, so sensitive tool arguments could bypass sanitization or leak if the transform regresses. Negative-path suites (`error.*`, `timeout.*`) never exercise the new route, leaving auth/sanitizer toggles unproven for Responses.

## Performance — PASS

- **Evidence:** Non-stream flow reuses Codex spawning and usage aggregation with only a lightweight envelope transform (`convertChatResponseToResponses` in `src/handlers/responses/shared.js`). Streaming relies on the existing concurrency guard and SSE plumbing while appending event writes per delta (`src/handlers/responses/stream-adapter.js`). Integration and Playwright transcripts demonstrate parity without additional round-trips (`tests/integration/responses.contract.*`, `tests/e2e/responses-contract.spec.js`).
- **Notes:** No new timers or blocking I/O were introduced; adapter buffers text in-memory and flushes once on completion, matching chat handler cost profile.

## Reliability — CONCERNS

- **Evidence:** Typed SSE adapter emits the documented event sequence and terminates streams cleanly, with transcripts validated in integration and E2E suites. Delegation to chat handlers keeps timeout, model validation, and concurrency guard logic centralised.
- **Gap:** Absence of regression tests for error paths (timeouts, invalid `n`, sanitizer toggles, guard saturation) means Responses could diverge silently from chat under failure conditions. Tool-call streaming is untested, so aggregator edge cases may break without detection.

## Maintainability — CONCERNS

- **Evidence:** Shared helpers (`src/handlers/responses/shared.js`) consolidate ID normalization, tool-call mapping, and usage conversion, and documentation/runbooks reference the new endpoint (`docs/bmad/architecture.md`).
- **Gap:** Helper logic lacks unit coverage, and transcripts omit tool-call/previous-response chaining scenarios, reducing safety nets for future refactors. Duplicated logic between chat and responses (e.g., message coercion, tool aggregation) raises long-term drift risk unless tests are expanded.

## Recommendations

1. Extend transcript generator to cover tool-call and chained-response cases, then add corresponding integration & Playwright assertions.
2. Mirror critical chat negative-path tests for `/v1/responses` to prove sanitizer toggles, rate limits, and guard behaviour stay aligned.
3. Add focused unit tests for `mapChoiceToOutput`, `coerceInputToChatMessages`, and the streaming adapter to catch regressions before integration layers.
