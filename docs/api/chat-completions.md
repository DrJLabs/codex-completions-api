# Chat Completions (`/v1/chat/completions`)

This endpoint aims to match the OpenAI Chat Completions API closely.

## Auth

Bearer token is required:

```http
Authorization: Bearer <PROXY_API_KEY>
```

## Non-stream

```json
{
  "model": "codev-5",
  "stream": false,
  "messages": [{ "role": "user", "content": "Say hello." }]
}
```

## Streaming (SSE)

Set `stream:true` to receive Server-Sent Events. The proxy emits a role-first delta, subsequent deltas, and terminates with `[DONE]`.

## Tool-heavy clients

The proxy supports “stop-after-tools” controls for clients that expect the stream to end after `<use_tool>` blocks:

- `PROXY_STOP_AFTER_TOOLS=true`
- `PROXY_STOP_AFTER_TOOLS_MODE=burst|first`
- `PROXY_STOP_AFTER_TOOLS_GRACE_MS=<ms>`
- `PROXY_SUPPRESS_TAIL_AFTER_TOOLS=true`

## Contract reference

See `../openai-endpoint-golden-parity.md` for the canonical streaming transcript and error envelope definitions.
