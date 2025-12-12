# Task 04 — Response Serialization & Streaming Adapters (Chat ↔ Responses)

## Scope (what this task covers)
This task maps and evaluates **how the proxy turns backend/Codex output into client-facing OpenAI-compatible responses**, with special focus on:

- **`/v1/chat/completions`**: non-stream JSON + streaming SSE (`data:` frames)
- **`/v1/responses`**: non-stream JSON + streaming **typed SSE** (`event:` + `data:` frames)
- Cross-cutting concerns: **finish_reason canonicalization**, **tool-call aggregation**, **usage emission**, **output-mode side effects**, and **streaming parity risks**

Reasoning: The request translation layer (Task 03) only guarantees the backend receives the right intent; actual client compatibility lives or dies in this layer—especially streaming ordering, tool-call semantics, and end-of-stream behavior.

---

## Primary modules (what to inspect first)

### Chat completions
- `src/handlers/chat/nonstream.js`  
  Builds the final **chat completion JSON** response. Also supports a route-level hook via `res.locals.responseTransform`.
- `src/handlers/chat/stream.js`  
  Orchestrates streaming SSE, including **role-first**, **delta emission**, **finish chunk**, **optional usage chunk**, and `[DONE]`. Also supports a route-level hook via `res.locals.streamAdapter`.

### Responses API
- `src/handlers/responses/nonstream.js`  
  **Reuses chat nonstream**, but installs `res.locals.responseTransform` to convert chat JSON into Responses JSON.
- `src/handlers/responses/stream.js`  
  **Reuses chat stream**, but installs `res.locals.streamAdapter` to convert chat SSE chunks into **typed Responses SSE events**.
- `src/handlers/responses/stream-adapter.js`  
  The typed SSE adapter. This is the “heart” of `/v1/responses` streaming.
- `src/handlers/responses/shared.js`  
  Shared conversion helpers: `convertChatResponseToResponses`, usage mapping, ID normalization, envelope builders.

### Shared primitives
- `src/services/sse.js`  
  SSE headers, keepalives, `[DONE]` handling for chat streaming.
- `src/lib/tool-call-aggregator.js`  
  Normalizes and aggregates tool calls across multiple shapes (legacy `function_call`, `tool_calls`, and typed Responses events).
- `src/lib/metadata-sanitizer.js`  
  Optional redaction/sanitization of metadata embedded in text segments.
- `src/handlers/chat/shared.js`  
  Canonical finish reasons (`stop|length|tool_calls|content_filter|function_call`) + output-mode resolution.

---

## High-level dataflow (how requests become responses)

### A) `/v1/chat/completions` — Non-stream
```
HTTP request
  -> chat/nonstream.js
     -> spawn backend / consume messages
     -> aggregate assistant content + tool calls + usage
     -> build chat completion JSON
     -> res.json(payload)
```

### B) `/v1/chat/completions` — Stream (SSE)
```
HTTP request (stream: true)
  -> chat/stream.js
     -> setSSEHeaders + keepalive loop
     -> consume backend deltas
     -> emit:
          role chunk (once)
          content deltas
          tool_call deltas (if openai-json mode)
          finish chunk (finish_reason)
          optional usage chunk (if include_usage)
          [DONE]
```

### C) `/v1/responses` — Non-stream (route-level transform)
```
HTTP request
  -> responses/nonstream.js
     -> coerce input -> chatBody.messages
     -> install res.locals.responseTransform(payload => convertChatResponseToResponses(payload))
     -> call chat/nonstream.js
         -> build chat completion JSON
         -> respondWithJson() calls responseTransform
         -> returns Responses JSON instead of Chat JSON
```

### D) `/v1/responses` — Stream (route-level adapter)
```
HTTP request (stream: true)
  -> responses/stream.js
     -> coerce input -> chatBody.messages
     -> install res.locals.streamAdapter = createResponsesStreamAdapter(...)
     -> call chat/stream.js
         -> for each chat chunk:
              if streamAdapter.onChunk returns true: do NOT send chat chunk
         -> on finish:
              if streamAdapter.onDone returns true: do NOT send chat [DONE]
         -> adapter is responsible for response.completed + done
```

---

## Key extension points (critical for correctness)

### 1) `res.locals.streamAdapter` (streaming)
In `chat/stream.js`, each would-be chat chunk is built, then:
- `streamAdapter.onChunk(chunkPayload)` is invoked
- If it returns `true`, the chat chunk is **suppressed** (not sent as chat SSE)

At stream end:
- `streamAdapter.onDone()` is invoked
- If it returns `true`, the default chat `[DONE]` is **suppressed**
- The adapter must emit its own termination event(s)

Impact: `/v1/responses` streaming correctness depends on `stream-adapter.js` emitting:
- `response.completed`
- `event: done` with `data: [DONE]`

### 2) `res.locals.responseTransform` (non-stream)
In `chat/nonstream.js`, response JSON is normally `res.json(payload)`, but:
- If `res.locals.responseTransform` exists, it is applied first
- If the transform throws, a **500** is returned

Impact: `/v1/responses` nonstream correctness depends on `convertChatResponseToResponses()` being total and robust.

---

## Chat streaming contract (what the proxy emits)

### Core ordering (chat SSE)
The intended shape is the canonical OpenAI-like lifecycle:

1. **Role-first** assistant chunk (exactly once per choice)
2. **Content deltas** (0..n)
3. **Finish chunk** with `finish_reason`
4. Optional **usage chunk** if `stream_options.include_usage`
5. Terminal `[DONE]`

Notes:
- Intermediate deltas generally keep `finish_reason: null`.
- Tool call semantics depend strongly on **output mode** (see below).

---

## Responses streaming contract (typed SSE) — as implemented

### Event sequence (typical)
The adapter emits **typed SSE events** (not plain `data:` chunks):

1. `event: response.created`  
   Includes `{ id: resp_..., status: "in_progress" }`
2. Repeating `event: response.output_text.delta`  
   Includes `{ delta, output_index }`
3. Optional tool-related events (interleaved as needed)
   - `response.output_item.added`
   - `response.function_call_arguments.delta`
   - `response.function_call_arguments.done`
   - `response.output_item.done`
4. `event: response.output_text.done`
5. `event: response.completed`  
   Includes final **Responses JSON** envelope
6. `event: done` with `data: [DONE]`

Important: The adapter is stateful and multi-choice aware (`output_index` corresponds to choice index).

---

## Responses stream adapter (state machine and semantics)

### Per-stream state
The adapter initializes state such as:
- `responseId` (e.g., `resp_<nanoid>`)
- `messageId` (e.g., `msg_<nanoid>`)
- `textSegments[]` per choice
- `toolCallAggregator` per choice (via `createToolCallAggregator()`)
- `usage` (captured from chat usage chunk when present)
- `finishReasons` + derived `status`

### What counts as “text”
When a chat chunk includes `choices[i].delta.content` as a string:
- adapter appends to the per-choice segment list
- emits `response.output_text.delta` with the exact delta

### What counts as a “tool call”
The adapter uses `ToolCallAggregator` to ingest:
- streaming `delta.tool_calls` from chat chunks
- final `message.tool_calls` (fallback ingestion)

Then it emits typed tool-call events:
- When a new tool call is detected, it emits `response.output_item.added`
- As arguments accumulate, it emits `response.function_call_arguments.delta` (cumulative)
- At finalization, it emits:
  - `response.function_call_arguments.done`
  - `response.output_item.done`

### Finish → status mapping
The adapter maps finish reasons into response status:
- `length` / `content_filter` → `incomplete`
- `failed` / `error` / `cancelled` → `failed`
- otherwise → `completed`

The final `response.completed` payload includes this status.

---

## Responses nonstream conversion (Chat JSON → Responses JSON)

### `convertChatResponseToResponses(payload)`
The conversion:
- Normalizes IDs (`chatcmpl-*` → `resp_*`)
- Converts each chat `choice` into a Responses `output[]` item:
  - `type: "message"`, `role: "assistant"`
  - `content[]` contains:
    - `output_text` (string content if present, or `""` fallback)
    - `tool_use` items (one per tool call), if tool calls exist
- Converts usage:
  - `prompt_tokens` → `input_tokens`
  - `completion_tokens` → `output_tokens`
  - `total_tokens` kept

Operational note: This conversion is triggered via `res.locals.responseTransform` installed by `responses/nonstream.js`.

---

## Output-mode coupling (high-risk parity lever)

### `PROXY_OUTPUT_MODE` default is `obsidian-xml`
Config defaults to `obsidian-xml`, with a header override `x-proxy-output-mode`. Two key modes:

- `obsidian-xml`:
  - Assistant content may include a synthesized `<use_tool>...</use_tool>` block
  - Tail suppression after tool markers is enabled
- `openai-json`:
  - Tool call metadata is emitted in OpenAI-native JSON shapes
  - When tool calls are present, assistant `content` is typically `null` (OpenAI parity expectation)

Why this matters for `/v1/responses`:
- `/v1/responses` **reuses chat handlers** and therefore inherits the output mode unless overridden.
- If running in `obsidian-xml`, `/v1/responses` output may include `<use_tool>` XML inside `output_text` *and* tool_use nodes—effectively duplicating tool intent in two different representations.

Recommendation:
- If the goal is strict OpenAI parity for `/v1/responses`, ensure **server or request** uses `openai-json`
  - Set `PROXY_OUTPUT_MODE=openai-json`, or
  - Send `x-proxy-output-mode: openai-json` on `/v1/responses` calls

Potential remediation (code-level):
- Introduce a route-level override for `/v1/responses` (e.g., `PROXY_RESPONSES_OUTPUT_MODE=openai-json` by default).

---

## Instrumentation and observability gaps (notable)

### Typed SSE bypasses `sendSSE()` logging
`src/services/sse.js` logs client egress for chat chunks via `sendSSE()`.  
When `streamAdapter.onChunk()` returns `true`, `chat/stream.js` does **not** call `sendSSE()`, and the adapter writes directly using `res.write()`.

Impact:
- Typed `/v1/responses` streaming may not appear in the standard “client SSE egress” logs.
- Debugging parity issues becomes harder.

Suggested remediation:
- Add an adapter-level logger or expose a `sendTypedSSE(event, data)` wrapper that:
  - writes SSE lines
  - flushes
  - emits a structured log with `{event, payload_size, output_index, response_id}`

---

## Contradictions / drift candidates to track

1. **Docs vs code: tool streaming**  
   Some architecture docs indicate tool calls are only aggregated into the terminal response for `/v1/responses`.  
   The current implementation **streams tool events** (`response.output_item.added`, `response.function_call_arguments.delta`, etc.) as well as including tool calls in `response.completed`.

2. **Typed SSE field minimalism vs official spec**  
   For text events, the adapter emits a simplified payload (e.g., `{ delta, output_index }`) and omits fields that some clients may expect (like `response_id`, `item_id`, `content_index`).  
   This may be intentional, but should be explicitly documented as the supported contract.

3. **Multi-choice streaming semantics**  
   `output_text.done` is emitted once without an `output_index`.  
   If `n>1` is supported for `/v1/responses` streaming, this is potentially ambiguous.

---

## Concrete checks to run (manual or via tests)

### Chat streaming parity checks
- Role chunk is emitted exactly once per choice
- No mixed content + tool_calls in same SSE frame
- Finish chunk is emitted exactly once per choice
- Usage chunk appears only when include_usage is requested
- `[DONE]` is always the last frame

### Responses streaming parity checks
- `response.created` emitted exactly once
- Every `response.output_text.delta` is ordered, no empty deltas
- Tool-call events:
  - `output_item.added` precedes argument deltas
  - argument deltas are cumulative
  - `arguments.done` + `output_item.done` appear before `response.completed`
- `event: done` appears exactly once and last

---

## Deliverables from this task
- This document: **Task 04 analysis** of response + streaming adapters, with identified parity levers and drift risks.

---

## Suggested next task (Task 05)
**Backend event ingestion & normalization**: map JSON-RPC / Codex notification shapes into the internal delta/message model that the chat handlers consume (the point where many “edge-case parity bugs” originate).
