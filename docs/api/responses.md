# Responses (`/v1/responses`)

This endpoint aims to match the OpenAI Responses API closely and shares the same backend pipeline as chat completions.

## Enable/disable

`/v1/responses` is enabled by default. Disable it with:

```bash
PROXY_ENABLE_RESPONSES=false
```

## Auth

Bearer token is required:

```http
Authorization: Bearer <PROXY_API_KEY>
```

## Non-stream request (minimal)

```json
{
  "model": "codev-5",
  "input": "Say hello.",
  "stream": false
}
```

## Streaming (typed SSE)

When `stream:true`, the proxy emits typed SSE events such as:

- `response.created`
- `response.output_text.delta`
- `response.output_text.done`
- `response.completed`
- `done`

## Contract reference

See `../openai-endpoint-golden-parity.md` for the canonical event ordering and envelope details.
