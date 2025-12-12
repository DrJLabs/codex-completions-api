# `/v1/responses` — Implementation Overview (Current)

This repo implements `POST /v1/responses` (non-stream + typed SSE streaming) by reusing the existing `/v1/chat/completions` handlers and applying a small translation layer:

- **Non-stream:** build a chat request, then transform the final chat JSON into a Responses JSON envelope.
- **Stream:** run the chat SSE pipeline, but **suppress** chat chunks and emit **typed Responses SSE** events instead.

The route is gated by `PROXY_ENABLE_RESPONSES` (default: `true`).

## Key files

- Routing: `src/routes/responses.js`
- Non-stream handler: `src/handlers/responses/nonstream.js`
- Stream handler: `src/handlers/responses/stream.js`
- Typed SSE adapter: `src/handlers/responses/stream-adapter.js`
- Conversion helpers: `src/handlers/responses/shared.js`

## Request normalization (Responses → Chat)

The Responses handlers normalize to a chat-shaped request:

- `instructions` / `input` are coerced into `messages[]` via `coerceInputToChatMessages()`.
- `previous_response_id` is currently ignored in the compatibility layer.

This keeps a single backend transport path while providing a stable Responses surface for clients.

## Non-stream response shaping (Chat JSON → Responses JSON)

`src/handlers/responses/nonstream.js` delegates to `postChatNonStream()` while installing `res.locals.responseTransform`.

The transform calls `convertChatResponseToResponses()` to produce a Responses-style payload:

- Response IDs are normalized (`chatcmpl-*` → `resp_*`).
- Chat `choices[]` become Responses `output[]` items.
- Chat usage is mapped to Responses usage (`prompt_tokens → input_tokens`, `completion_tokens → output_tokens`).

## Streaming (Chat SSE → typed Responses SSE)

`src/handlers/responses/stream.js` delegates to `postChatStream()` while installing `res.locals.streamAdapter`.

The adapter (`src/handlers/responses/stream-adapter.js`) is responsible for:

- Emitting typed SSE events (`event:` + `data:` JSON) such as:
  - `response.created`
  - `response.output_text.delta` / `response.output_text.done`
  - tool events: `response.output_item.added`, `response.function_call_arguments.delta/done`, `response.output_item.done`
  - `response.completed` (contains the final Responses JSON envelope)
  - `response.failed` (on adapter failure)
- Terminating the stream with `event: done` and `data: [DONE]`
- Suppressing default chat SSE output by returning `true` from `onChunk()`/`onDone()`

## Output mode and tool-call parity

Tool calling behavior in this proxy depends on the *output mode*:

- `obsidian-xml`: `<use_tool>...</use_tool>` blocks are emitted as assistant text.
- `openai-json`: OpenAI-style tool call structures are emitted (chat: `tool_calls[]`; responses: typed tool events).

For `/v1/responses`, the proxy defaults to `openai-json` (configurable via `PROXY_RESPONSES_OUTPUT_MODE`) unless the client explicitly overrides with `x-proxy-output-mode`.

Rationale: This avoids “double tool intent” where a client could receive both:

- tool events (`response.*function_call*`) and
- the same `<use_tool>` blocks embedded inside `response.output_text.delta`.

## Observability

- Streams also record shared stream metrics (TTFB/duration/outcome) via the common chat streaming pipeline.
- The typed SSE adapter increments `codex_responses_sse_event_total{route,model,event}` and emits a one-line structured summary log (debug level) at completion/failure.

## Tests

- Typed SSE contract: `tests/e2e/responses-contract.spec.js` (golden transcript-based)
- Metrics presence: `tests/integration/metrics.int.test.js` (scrapes `/metrics` when enabled)

If you change typed SSE semantics, regenerate transcripts with:

```bash
node scripts/generate-responses-transcripts.mjs
```
