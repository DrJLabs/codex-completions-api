# Requirements Traceability Matrix

## Story: epic-responses-endpoint-parity.6.1 — Story 6.1 — Responses Endpoint Handlers

### Coverage Summary

- Total Requirements: 4
- Fully Covered: 1 (25%)
- Partially Covered: 2 (50%)
- Not Covered: 1 (25%)

### Requirement Mappings

#### AC1: `POST /v1/responses` non-stream returns the canonical envelope (id/status/output/usage/tool outputs/previous_response_id) while reusing chat normalization and sanitization

**Coverage: PARTIAL**

- `tests/integration/responses.contract.nonstream.int.test.js` → _Given_ the proxy runs with the fake Codex shim, _When_ `/v1/responses` receives the captured minimal/tool-call requests, _Then_ the sanitized JSON payload matches the golden transcripts, proving id/status/usage normalization.
- `tests/e2e/responses-contract.spec.js` → _Given_ the Playwright client calls `/v1/responses`, _When_ it submits the minimal transcript, _Then_ the returned body equals the sanitized fixture, confirming client-observed shape parity.

**Gaps:** No fixture exercises `tool_calls` or `response.previous_response_id`, so mapping of tool outputs and chaining metadata remains unverified. Sanitizer feature-parity is inferred from shared handler plumbing but lacks a targeted assertion.

#### AC2: Streaming requests emit typed SSE events (response.created/output_text.delta/output_text.done/response.completed/done) and include usage when `stream_options.include_usage` is true while reusing concurrency guard policies

**Coverage: PARTIAL**

- `tests/integration/responses.contract.streaming.int.test.js` → _Given_ the fake Codex shim streams a text response, _When_ `/v1/responses` is invoked with `stream: true`, _Then_ the parsed SSE log equals the golden transcript including typed events and usage in the completion envelope.
- `tests/e2e/responses-contract.spec.js` → _Given_ Playwright requests a streamed response, _When_ it parses the SSE conversation, _Then_ the sanitized chunks match the transcript, confirming client contract parity.

**Gaps:** No coverage for streamed tool calls or mixed content segments, and concurrency-guard reuse is implicit (delegated to chat handler) without a regression test capturing guard metrics/locking behaviour.

#### AC3: Shared handler utilities ensure `/v1/responses` and `/v1/chat/completions` honour sanitizer toggles, tool-tail controls, and fail-fast behaviour (timeouts, invalid `n`, model checks) with no regressions

**Coverage: NONE**

- No automated tests validate sanitizer toggles, invalid-parameter rejection, timeout propagation, or tool-tail throttling through the new route. Behaviour is assumed from the shared handler, but the `/v1/responses` entry point is not exercised by any of the negative/limit suites (`error.*`, `timeout.*`, `nonstream.length.*`, etc.).

#### AC4: Automated coverage (unit, integration, Playwright) compares `/v1/responses` transcripts against `/v1/chat/completions` and fails CI on divergence

**Coverage: FULL**

- `tests/integration/responses.contract.nonstream.int.test.js` and `tests/integration/responses.contract.streaming.int.test.js` → _Given_ the captured fixtures, _When_ integration tests replay non-stream and streaming flows, _Then_ sanitized payloads/chunks must equal transcripts, ensuring regression surface is enforced in CI.
- `tests/e2e/responses-contract.spec.js` → _Given_ Playwright runs against the dev server, _When_ it exercises both response modes, _Then_ observed payloads must match fixtures, providing browser-level contract coverage.
- `scripts/generate-responses-transcripts.mjs` → _Given_ golden transcript regeneration is part of the tooling, _When_ transcripts are missing or stale, _Then_ the generator refreshes them in `test-results/responses/`, keeping parity fixtures aligned.

### Critical Gaps

1. **Tool output parity** — No automated scenario covers assistant tool calls (delta aggregation or final envelope content) for `/v1/responses`, leaving AC1/AC2 tool-handling portions unverified.
2. **Chained response metadata** — `previous_response_id` passthrough lacks both fixture coverage and a regression test, risking contract gaps for follow-up calls.
3. **Negative-path parity** — Sanitizer toggles, invalid `n`, timeout propagation, and concurrency-guard enforcement are untested through the new route, so regressions would bypass CI.

### Test Design Recommendations

1. Add a non-stream transcript where the fake Codex shim emits a function/tool call and craft an integration + E2E assertion that `response.output` includes typed `tool_use` objects with deterministic placeholder IDs.
2. Author a streaming transcript that emits both text and tool deltas; verify `response.output_text.delta` and the aggregated `response.completed` payload capture the tool call.
3. Mirror critical chat error suites (`error.invalid-n`, `timeout.nonstream`, `stream.provider-usage`) for `/v1/responses` to prove shared handler parity, including sanitizer toggles and concurrency guard counters.

### Risk Assessment

- **High Risk:** Tool-call parity gaps (AC1/AC2) — Clients relying on function/tool outputs could receive malformed envelopes undetected by CI.
- **Medium Risk:** Negative-path regressions — Without targeted tests, sanitizer or fail-fast divergences may ship unnoticed.
- **Low Risk:** Transcript regeneration tooling — Already integrated and low likelihood of failure; monitored through existing workflow.
