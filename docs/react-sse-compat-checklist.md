# React SSE Compatibility — Triage Checklist

Last updated: 2025-09-10

Use this to reproduce and pin down React “minified error” crashes when streaming from the proxy.

## Quick toggles

- Disable keepalives (client or server):
  - Client: header `X-No-Keepalive: 1` or query `?no_keepalive=1`.
  - Server: `PROXY_SSE_KEEPALIVE_MS=0` (global).
- Avoid post-tool narration (dev only): `PROXY_STOP_AFTER_TOOLS=true`.
- Include usage in stream: `stream_options.include_usage=true` (client) or `include_usage=true` (body root). Expect a final `chat.completion.chunk` with `choices: []` and `usage`.

## Expected SSE shapes (chat)

All chunks in one stream now share the same `id` (e.g., `chatcmpl_…`).

1. Role chunk (first):

```
data: { "id":"chatcmpl_…","object":"chat.completion.chunk","created":<unix>,"model":"…","choices":[{"index":0,"delta":{"role":"assistant"}}] }
```

2. Content deltas (0..n):

```
data: { "id":"chatcmpl_…","object":"chat.completion.chunk","created":<unix>,"model":"…","choices":[{"index":0,"delta":{"content":"…"}}] }
```

3. Optional usage (only when requested):

```
data: { "id":"chatcmpl_…","object":"chat.completion.chunk","created":<unix>,"model":"…","choices":[],"usage":{"prompt_tokens":X,"completion_tokens":Y,"total_tokens":Z} }
```

4. Finalizer chunk (finish_reason), then terminator:

```
data: { "id":"chatcmpl_…","object":"chat.completion.chunk","created":<unix>,"model":"…","choices":[{"index":0,"delta":{},"finish_reason":"stop"}] }
```

5. Terminator:

```
data: [DONE]
```

## What to capture when it fails

- Raw SSE transcript (verbatim lines, including keepalive comments).
- Request headers/body (mask secrets): especially `Accept`, `User-Agent`, `stream_options.include_usage`, custom headers.
- Proxy logs with `PROXY_DEBUG_PROTO=1` (captures NDJSON events including tool blocks and stream boundaries).

## Common failure patterns

- Client assumes `choices[0].delta.content` always exists → crashes on role/usage chunks.
- Client splits on `\n\n` and JSON.parse each block without filtering comment lines `:` → crashes on keepalive.
- Client correlates chunks by `id` and misbehaves when ids change per chunk (fixed: ids are stable now).

## Next steps if still failing

- Try non-streaming (`stream:false`) to isolate SSE parsing entirely.
- Temporarily disable STOP_AFTER_TOOLS to check early-close interactions.
- Share the raw transcript and we’ll add a contract test for that client.
