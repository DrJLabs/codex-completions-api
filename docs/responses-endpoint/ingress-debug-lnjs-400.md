# Debug Note — `/v1/responses` 400 (`messages[] required`) from `ln/JS 6.5.0`

This note documents a real-world `/v1/responses` failure observed via the new **raw ingress logging** (`event:"responses_ingress_raw"`), plus the root cause and fix.

## What we saw in logs

The last failing requests were `POST /v1/responses` with:

- `ua="ln/JS 6.5.0"` (auth present)
- `stream=true`
- `model="gpt-5.2-codev-L"`
- `output_mode_effective="openai-json"` (defaulted)
- `has_input=true`, `input_is_array=true`, `input_item_types=["message"]`
- `has_messages=false`, `has_instructions=false`, `has_tools=false`
- Access log status: `400`

Example (shape-only) ingress event fields that mattered:

```json
{
  "event": "responses_ingress_raw",
  "route": "/v1/responses",
  "mode": "responses_stream",
  "stream": true,
  "model": "gpt-5.2-codev-L",
  "input_item_types": ["message"],
  "output_mode_effective": "openai-json"
}
```

## Why it returned 400

The proxy implements `/v1/responses` by rewriting the request into a chat-shaped body and delegating to `/v1/chat/completions` handlers.

The 400 payload was:

```json
{"error":{"message":"messages[] required","type":"invalid_request_error","param":"messages","code":"invalid_request_error"}}
```

This error is emitted when the rewritten chat request ends up with an empty `messages[]`.

### Repro (pre-fix)

This Responses-style message item uses `content` as a string:

```json
{
  "model": "gpt-5.2-codev-L",
  "stream": false,
  "input": [{ "type": "message", "role": "user", "content": "Say hello." }]
}
```

Before the fix, this produced `messages[] required` because the proxy failed to extract text from `content` when it is a string.

## Root cause (code)

- `src/handlers/responses/shared.js` builds chat `messages[]` from `instructions` + `input` via `coerceInputToChatMessages()`.
- The input flattener `extractTextFromInputItems()` only handled:
  - items that are strings
  - objects with `text: string`
  - objects with `content: []` (recursing)
- It did **not** handle `content: string` (common in some SDK payloads), so it extracted no text → no user message → empty `messages[]` → 400.

## Fix (current)

`extractTextFromInputItems()` now also treats `content: string` as text (and recurses into `content` objects), so the same request shape yields a non-empty `messages[]` and no longer fails validation.

Tests:

- Unit coverage added in `tests/unit/responses.shared.spec.js` to ensure `coerceInputToChatMessages()` accepts message items with string content.

## Observability note

For these fast-fail cases, dev trace may only show `phase:"http_ingress"` and no `client_json` egress entry (because the stream path can return early JSON errors before JSON egress logging is installed). This is tracked as `GAP-STREAM-JSON` in `docs/logging-gaps/README.md`.

