title: Epic — OpenAI Chat Completions Parity
status: InProgress
version: 0.1
updated: 2025-09-13
owner: Product (PM)
labels: [api, compatibility, streaming, errors, usage]

# Epic

As a product, we need our `/v1/chat/completions` responses (non‑stream and streaming) to mirror the official OpenAI Chat Completions API as closely as possible so that clients written for OpenAI work against our proxy without changes.

# Acceptance Criteria

1. Non‑stream response parity

- Returns: `id` (stable), `object:"chat.completion"`, `created` (Unix), `model` (the normalized, user‑visible model identifier), `choices` (assistant message with `role:"assistant"` and aggregated `content`), `usage` (`prompt_tokens`, `completion_tokens`, `total_tokens`).
- `choices[i].finish_reason` set to one of: `stop`, `length`, `tool_calls`, `content_filter`, `function_call` (at minimum `stop`/`length` supported today).

2. Streaming SSE contract parity (when `stream:true`)

- Every chunk is an object with `id`, `object:"chat.completion.chunk"`, `created`, `model` (and optional `system_fingerprint` when available).
- First chunk: role‑only delta → `choices:[{index:0, delta:{role:"assistant"}, finish_reason:null}]`.
- Content chunks: `choices:[{index:0, delta:{content:"…"}, finish_reason:null}]`.
- Finish‑reason chunk (second‑to‑last): `choices:[{index:0, delta:{}, finish_reason:"stop"|"length"|…}]`.
- Final usage chunk (only if `stream_options.include_usage:true` or compatible toggle): `choices: []` and `usage` with token counts. All preceding chunks include `"usage": null`.
- Stream always ends with a separate `data: [DONE]` line.

3. Error envelope parity

- Error JSON: `{ error: { message, type, code?, param? } }` with appropriate HTTP status (`400 invalid_request_error`, `401 authentication_error`, `403 permission_error` or `tokens_exceeded_error`, `404 not_found_error`, `429 rate_limit_error`, `500 server_error`).
- Parameter validation includes `param` naming the offending field (e.g., `model`, `messages`, `n`).

4. Parameter handling and compatibility

- Support `stream_options.include_usage` (and accept legacy `include_usage` root flag for back‑compat) with behavior in AC‑2.
- If `n` is provided and `n>1`, either: (A) return `invalid_request_error` with `param:"n"` (initial scope), or (B) stream multi‑choice correctly (future scope). For this epic, choose (A).
- Ignore unknown optional fields gracefully (e.g., `logprobs`, `seed`, `response_format`) without breaking required behavior.

5. Metadata consistency

- `created` is identical across all chunks in a single stream; `id` is stable; `model` matches non‑stream response; if available, include `system_fingerprint`.

6. Tests and docs

- Integration tests validate non‑stream shape and error envelopes.
- E2E Playwright tests validate streaming order: role → content… → finish‑reason → usage (optional) → `[DONE]`, plus stable `id/created/model`.
- Update `docs/react-sse-compat-checklist.md` to include the finish‑reason chunk semantics.
- Add golden SSE transcripts under `test-results/` for at least one simple prompt.

# Out of Scope (for this epic)

- True multi‑choice streaming (`n>1`).
- Tool/function call streaming blocks beyond forwarding role and content deltas.
- Latency metrics in `usage` (may be planned; see below).

# Phases & Tasks

- [x] Phase A — Spec lock & contracts
  - [x] Freeze expected JSON shapes in a short spec in `docs/` (non‑stream + streaming with finish‑reason + usage chunk).
  - [x] Add contract fixtures (golden transcripts) for a minimal prompt.

- [x] Phase B — Streaming finish‑reason chunk
  - [x] Emit explicit finish‑reason chunk with empty `delta` and populated `finish_reason` before the final usage chunk.
  - [x] Ensure preceding chunks carry `finish_reason:null` and `usage:null`.

- [x] Phase C — Usage chunk semantics
  - [x] Gate on `stream_options.include_usage:true` (and root `include_usage` for back‑compat).
  - [x] Make final chunk `choices:[]` with `usage:{…}`; send `[DONE]` separately.

- [x] Phase D — Chunk metadata consistency
  - [x] Include `id`, `object`, `created`, `model` on every chunk; keep `created` stable.
  - [x] Optionally include `system_fingerprint` when available.

- [x] Phase E — Error response parity
  - [x] Add `param` in validation failures; normalize error `type`/`code` to OpenAI lexicon.
  - [x] Align HTTP codes for auth/permission/rate‑limit/context‑length.
  - [x] Story 2.4 — Phase E: Error Response Parity (docs/bmad/stories/2.4.phase-e-error-response-parity.md)

- [ ] Phase F — Non‑stream tidy
  - [x] Double‑check `finish_reason` mapping and `usage` presence.
  - [x] Ensure the returned `model` string is consistent with streaming.
  - [x] Story 2.5 — Phase F: Non‑Stream Tidy (docs/bmad/stories/2.5.phase-f-non-stream-tidy.md)

- [x] Phase G — Tests & docs
  - [x] Unit/integration: shapes for non‑stream, error envelopes.
  - [x] Playwright E2E: SSE order and fields; optional usage path.
  - [x] Update `docs/react-sse-compat-checklist.md` with finish‑reason.

- [ ] Phase H — Optional groundwork (future)
  - [ ] Add null placeholders for usage latency metrics (`time_to_first_token`, `throughput_after_first_token`) when `include_usage` is true.
  - [ ] Prepare internal hooks for tool/role blocks without exposing unstable fields.

# Dependencies & Impact

- Routes/handlers: `src/handlers/chat/stream.js`, `src/handlers/chat/nonstream.js`, `src/services/sse.js`, `src/lib/errors.js`.
- Tests: `tests/` (integration, E2E), Playwright config.
- Docs: `docs/react-sse-compat-checklist.md`, `docs/index.md`.

# Rollout & Verification

- Dev: run `npm run verify:all` (unit, integration, e2e). Ensure streaming test covers finish‑reason/usage order.
- Dev stack: `npm run dev:stack:up` and `npm run smoke:dev`.
- Prod (post‑merge): `docker compose up -d --build --force-recreate` then `npm run smoke:prod`.
- Monitor logs for `finish_reason` and stream termination; validate with curl and OpenAI‑compatible SDKs.

# Dev Notes

- Follow project Test Selection Policy: touching `server.js`/handlers → run integration + E2E.
- Keep existing keepalive behavior; clients must ignore comment lines.
- Prefer minimal diffs; preserve existing environment toggles (`PROXY_*`).

# Change Log

| Date       | Version | Description                                       | Author     |
| ---------- | ------- | ------------------------------------------------- | ---------- |
| 2025-09-13 | 0.4     | Mark F complete (non‑stream parity)               | PM (codex) |
| 2025-09-13 | 0.3     | Mark E complete (error parity); status InProgress | PM (codex) |
| 2025-09-13 | 0.2     | Mark A, B, C, D, G complete; status InProgress    | PM (codex) |
| 2025-09-13 | 0.1     | Initial epic drafted (Proposed)                   | PM (codex) |
