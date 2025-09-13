---
title: OpenAI Chat Completions Parity — Spec & Streaming Contract
version: 0.1
updated: 2025-09-13
source-of-truth: This repository’s server behavior and tests
---

## Non‑Stream Response (POST /v1/chat/completions, stream=false)

- object: "chat.completion"
- fields:
  - id: string (e.g., "chatcmpl_abc123")
  - object: string = "chat.completion"
  - created: number (unix seconds)
  - model: string (accepts `codex-5*` and `codev-5*` aliases)
  - choices: array[0]
    - index: 0
    - message: { role: "assistant", content: string }
    - finish_reason: "stop" | "length"
  - usage: { prompt_tokens: number, completion_tokens: number, total_tokens: number }

Example (minimal):

```json
{
  "id": "chatcmpl_abc123",
  "object": "chat.completion",
  "created": 1710000000,
  "model": "codex-5",
  "choices": [
    {
      "index": 0,
      "message": { "role": "assistant", "content": "Hello!" },
      "finish_reason": "stop"
    }
  ],
  "usage": { "prompt_tokens": 6, "completion_tokens": 2, "total_tokens": 8 }
}
```

## Streaming Contract (POST /v1/chat/completions, stream=true)

- Event envelope per data line (SSE):
  - id: stable string across all chunks (e.g., "chatcmpl_abc123")
  - object: "chat.completion.chunk"
  - created: number (unix seconds)
  - model: string
  - choices: array
    - For deltas: [{ index: 0, delta: { role?"assistant" | content?string } }]
    - Finalizer: [{ index: 0, delta: {}, finish_reason: "stop" }]
  - usage: optional object only when `stream_options.include_usage=true` and tokens are known

- Required order:
  1. Initial role delta: `choices[0].delta.role = "assistant"`; `finish_reason:null`, `usage:null`.
  2. Zero or more content delta chunks: `choices[0].delta.content`; `finish_reason:null`, `usage:null`.
  3. Finalizer chunk: empty `delta`, `choices[0].finish_reason` populated; `usage:null`.
  4. Optional final usage chunk (only when `stream_options.include_usage:true`): `{ choices: [], usage: {...} }`.
  5. Terminal sentinel line: `[DONE]`.

Notes:

- Keepalive comment lines (": <ts>") may appear and should be ignored by clients.
- `stream_options.include_usage=true` adds a final usage chunk after the finish_reason chunk and before `[DONE]`.
- All chunks in a stream share the same `id` and `created` values.
- Current streaming finalizer sets `finish_reason` to `"stop"`. Non‑stream responses may use `"stop"|"length"`. We will propagate richer reasons in streaming when upstream provides them.

## Error Envelope (non‑2xx)

```json
{
  "error": {
    "message": "...",
    "type": "invalid_request_error" | "timeout_error" | "rate_limit_error" | "internal_server_error",
    "param": "<field>" | null,
    "code": "..."
  }
}
```

Examples:

- Missing `messages[]` → `400` with `param: "messages"`.
- Model not accepted → `404` with descriptive code.

## Parameters (subset)

- model: string; accepts environment‑advertised ids (see README) and normalizes aliases to an effective model.
- stream: boolean.
- stream_options.include_usage: boolean; when true, emits a usage chunk before `[DONE]`.
- reasoning.effort: "low" | "medium" | "high" | "minimal"; default implied by model.
