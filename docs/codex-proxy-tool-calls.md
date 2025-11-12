
# Implementing OpenAI-Style Function/Tool Calls in the Codex Completions Proxy

**Goal:** Add reliable OpenAI-style function/tool call support to the proxy at `/v1/chat/completions`, using the `main` branch of the `codex-completions-api` repository as the clean foundation. Support both streaming (`stream: true`) and non-streaming (`stream: false`) modes and ensure compatibility with Obsidian Copilot’s autonomous agent tool invocation.

---

## Overview

This document describes a clean, from-scratch implementation strategy (no references or code from experimental branches) to detect, stream, and return tool/function calls that the model requests. The proxy will:

- Intercept model outputs that request tools (structured or textual).
- Return assistant messages that contain `tool_calls` (or `function_call`) and set `content` to `null`.
- Use `finish_reason: "tool_calls"` when the assistant's turn ended on a tool request.
- Handle both SSE streaming and non-streaming JSON responses.
- Not modify Obsidian Copilot or the Codex CLI — all changes are within the proxy.

---

## Tool execution policy

The Codex instances we launch for both dev and prod run with every built-in tool disabled (`shell`, `apply_patch`, `web_search`, `view_image`, plus the streamable/unified exec variants). The assistant still **emits** OpenAI-style `tool_calls` or textual `<use_tool>` blocks, but the actual execution happens entirely on the client side (Obsidian Copilot). This keeps the proxy read-only–safe while still preserving the OpenAI tool-calling contract described below.

Implications:

- Codex must always start a tool turn with the textual `<use_tool>` block (the client executes it) and may send follow-up narration after tool results arrive.
- Any mention of “can’t run shell/web” should be treated as an instruction bug—update AGENTS.md instead of re-enabling Codex tools.
- The proxy enforces all finish reasons (`tool_calls`, truncation) exactly as if it had run the tool; the only difference is that the client-supplied tool outputs enter the conversation as normal `role:"tool"` messages.

### Filtering phantom MCP noise

Codex App Server occasionally emits `function_call_output` events with payloads like `resources/list failed: unknown MCP server 'obsidian'` during startup probes. These were surfacing in SSE streams ahead of the real `<use_tool>` blocks and confusing clients into thinking a tool completed. The streaming handler now detects those error payloads and drops them server-side, keeping the wire protocol limited to genuine tool blocks.

---

## Scope

- **In scope**: the pure `ToolCallAggregator` library, textual fallback helpers, handler wiring inside `/v1/chat/completions`, and documentation/tests that prove OpenAI-compatible `tool_calls` semantics. These changes live entirely inside the proxy repo.
- **Out of scope**: altering Obsidian Copilot, Codex CLI binaries, Traefik, or transport lifecycle controls. Stories 2.9/2.10 own handler integration knobs, config flags, and smoketests that depend on this library.
- **Operating boundaries**: the aggregator remains side-effect free (no logging/telemetry), exposes immutable snapshots per choice, and defers finish-reason selection plus worker lifecycle decisions to the handlers.

---

## Architecture Changes

**Modules / Utilities to add or confirm exist:**

- `ToolCallAggregator` (utility module)  
  - Purpose: accumulate function call fragments (name + streamed `arguments`) and produce a completed function call record.
  - Location: `src/lib/tool-call-aggregator.js`.

**Handlers to modify:**

- Streaming handler: `src/handlers/chat/stream.js`  
  - Intercept streaming deltas/entities that represent function calls.  
  - Feed deltas into `ToolCallAggregator`.  
  - Stream `delta: { tool_calls: [...] }` chunks to clients as soon as call data is available.  
  - Stop further assistant content from streaming once a tool call starts (use configured cutoff).  
  - Emit terminating SSE chunk with `finish_reason: "tool_calls"`.

- Non-streaming handler: `src/handlers/chat/nonstream.js`  
  - Inspect final model payload for `tool_calls` or `function_call`.  
  - Use `ToolCallAggregator.ingestMessage()` to capture any partial/structured function call data.  
  - Build final JSON response where assistant message contains `tool_calls` (or `function_call`) and `content: null`.  
  - Set `choices[0].finish_reason` to `"tool_calls"`.

- JSON-RPC / child adapter: ensure it surfaces structured function call events (e.g., `response.output_item.added`, `response.function_call_arguments.delta`, `response.function_call_arguments.done`) to the handler so the aggregator can consume them.

---

## Public API Module Contract

`src/lib/tool-call-aggregator.js` exports a factory such as `createToolCallAggregator()` that provides:

- `ingestDelta(delta, { choiceIndex })` — accepts Codex v2 JSON-RPC deltas or OpenAI-style `delta.function_call` payloads, pins fragments to a stable call id, and returns `{ updated, deltas: ToolCallDelta[] }` where each delta contains cumulative arguments.
- `ingestMessage(message, options)` — processes final messages (`message.tool_calls`, `message.function_call`, textual `<use_tool>` blocks) and, with `emitIfMissing`, can synthesize calls purely from text markers.
- `snapshot({ choiceIndex })` — returns immutable `ToolCallRecord[]` per choice in creation order, suitable for non-stream responses and Obsidian XML synthesis.
- `resetTurn(choiceIndex?)` — clears buffers for a specific choice (or all choices) without touching registered textual parsers, ensuring bounded memory between turns.
- Helper exports (e.g., `registerTextPattern`, `extractUseToolBlocks`, `toObsidianXml`) that normalize parameter order, escape XML safely, and keep arguments as verbatim strings so downstream handlers are deterministic.

These APIs never parse JSON arguments, never mutate inputs, and encapsulate state so handlers simply observe deltas/snapshots.

---

<a id="streaming-detection--flow"></a>
## Streaming Detection & Flow (high-level)

1. Backend (Codex `app-server` v2) emits structured streaming events when the model requests a function:
   - `response.output_item.added` (type: `"function_call"`) — function name and call id appear.
   - `response.function_call_arguments.delta` — chunks of JSON-encoded arguments.
   - `response.function_call_arguments.done` — full arguments payload is complete.
   - `response.output_item.done` — function call output item finished.

2. Proxy streaming handler logic:
   - Parse events as they arrive.
   - On detection of a function call event, feed chunks into `ToolCallAggregator.ingestDelta(...)`.
   - When aggregator reports an updated/complete call, stream a chunk to the client:
     ```json
     {
       "choices": [
         {
           "index": 0,
           "delta": { "tool_calls": [ { "id": "...", "type": "function", "function": { "name": "..." }, "arguments": "...(maybe partial)..." } ] },
           "finish_reason": null
         }
       ]
     }
     ```
   - Immediately halt or prevent any further assistant content from streaming beyond the point the tool call was issued (configurable).
   - Send final SSE chunk with `delta: {}` and `finish_reason: "tool_calls"` and then `data: [DONE]`.

**Important:** Always send the assistant `role` chunk first (if not already sent) before streaming tool-call deltas.

---

<a id="non-streaming-detection--flow"></a>
## Non-Streaming Detection & Flow (high-level)

1. Backend returns a final message or event sequence. Proxy inspects final payload(s) for:
   - Structured `tool_calls` array
   - Structured `function_call` object
   - Or textual tool markers (e.g., `<use_tool>...</use_tool>` blocks)

2. Use `ToolCallAggregator.ingestMessage(finalMessage, { emitIfMissing: true })` to ensure all fragments are assembled.

3. Build assistant message for response:
   - If `toolCallsPayload` exists:
     ```json
     "message": {
       "role": "assistant",
       "tool_calls": [ { "id": "tool_xxx", "type": "function", "function": { "name": "..." }, "arguments": "..." } ],
       "content": null
     }
     ```
   - Else if `functionCallPayload` exists:
     ```json
     "message": {
       "role": "assistant",
       "function_call": { "name": "...", "arguments": "..." },
       "content": null
     }
     ```
   - Otherwise include normal `content` text.

4. Set `finish_reason: "tool_calls"` when assistant requested a tool.

---

## Textual Fallback Detection

- Implement scanning for textual patterns as a fallback (if backend does not emit structured function events):
  - Example marker: `<use_tool> ... </use_tool>` (Obsidian Copilot style).
  - Use a helper like `extractUseToolBlocks(outputBuffer)` to detect complete blocks.
  - When found:
    - Parse name & args out of the block (or hand off raw block in `arguments`).
    - Suppress any assistant content after the tool block.
    - Treat it equivalently to structured `tool_calls`.

---

## Finish Reason and Message Semantics

- When a tool is requested and no final content is produced, use:
  - `finish_reason: "tool_calls"` (canonical choice).
  - Assistant message must have `content: null`.
  - Include `tool_calls` array or `function_call` object in the assistant message.

- For single function-call-only scenarios you may optionally use Aliases (e.g., `"function_call"`), but keep `"tool_calls"` as the canonical finish reason to signal the client to execute tools.

---

## Concrete Implementation Steps

> These edits are intended to be applied to the `main` branch only.

### 1) Add `ToolCallAggregator` utility
- File: `src/lib/tool-call-aggregator.js`
- Responsibilities:
  - `createToolCallAggregator()`: returns an object with:
    - `ingestDelta(deltaPayload)`: accept streaming delta and return `{ updated: boolean, deltas: [...] }`.
    - `ingestMessage(finalMessage)`: accept final message payload and extract any `tool_calls` or function_call`.
    - `snapshot()`: return completed tool_calls array.
    - `.hasCalls()` boolean helper.
- Implementation notes:
  - Buffer `arguments` segments when they come in pieces; assemble into one JSON string.
  - Provide unique `id` for each tool call.
  - Keep objects shaped like:
    ```json
    {
      "id": "tool_abcdef",
      "type": "function",
      "function": { "name": "..." },
      "arguments": "...JSONString..."
    }
    ```

### 2) Modify streaming handler `src/handlers/chat/stream.js`
- Import the aggregator:
  ```js
  import { createToolCallAggregator } from '../../lib/tool-call-aggregator.js';
  ```
- On request start:
  ```js
  const toolCallAggregator = createToolCallAggregator();
  let hasToolCallsFlag = false;
  ```
- In the stream event loop:
  - For each parsed model event (delta):
    - If it contains `tool_calls` or `function_call` or structured function events, call `toolCallAggregator.ingestDelta(deltaPayload)`.
    - If the aggregator reports `updated`, emit SSE chunk(s) with `delta.tool_calls`.
    - If any tool call is detected, set `hasToolCallsFlag = true` and schedule halting further content per `PROXY_STOP_AFTER_TOOLS`.
  - When finalizing the stream, call finish reason tracker with `hasToolCallsFlag` to produce canonical `"tool_calls"` finish reason and emit final SSE chunk accordingly.

### 3) Modify non-stream handler `src/handlers/chat/nonstream.js`
- Import the aggregator.
- As the backend child produces output, accumulate or catch `agent_message` events and call `toolCallAggregator.ingestMessage(evtMessage)`.
- After process completes:
  - `const toolCallsPayload = toolCallAggregator.snapshot();`
  - `const hasToolCalls = toolCallsPayload.length>0;`
  - `const canonicalReason = finishReasonTracker.resolve({ hasToolCalls, hasFunctionCall });`
  - Build `assistantMsg` with `tool_calls` or `function_call` and `content: null` if `hasToolCalls`.
  - Return final JSON with `choices` and `finish_reason: canonicalReason`.

### 4) Add/ensure finish reason normalization supports `"tool_calls"`
- Update `finish-reason` logic to include `"tool_calls"` as a canonical finish reason when relevant flags are set.
- Where the code maps backends’ reasons to canonical ones, add a rule: if `hasToolCalls` then canonical reason = `"tool_calls"`.

### 5) Configuration & Flags
- Add or confirm presence of these env flags:
  - `PROXY_STOP_AFTER_TOOLS=true` — kill generation after tool call to prevent tail content.
  - `PROXY_SUPPRESS_TAIL_AFTER_TOOLS=true` — do not emit any content after tool call textual markers.
  - `PROXY_ENABLE_PARALLEL_TOOL_CALLS=false` — disable parallel calls by default (enable only when safe).
- Add default values in `.env.example` and `config/index.js`.

### 6) Logging + Telemetry
- Emit helpful telemetry when tool calls occur:
  - `has_tool_calls`, `tool_call_count`, `tool_call_names`, `tool_call_ids`.
- Keep debug logs gated behind a flag.

### 7) Tests & Smoke Scripts
- Add a smoke test script that exercises:
  - A streaming call that triggers a structured function call sequence from `app-server`.
  - A streaming call that triggers textual `<use_tool>` output.
  - Non-streaming equivalents.

---

## Example JSON Outputs

**Streaming delta for tool call (SSE chunk):**
```json
data: {
  "choices": [{
    "index": 0,
    "delta": {
      "tool_calls": [{
        "id": "tool_abc123",
        "type": "function",
        "function": { "name": "vaultSearch" },
        "arguments": "{\"query\": \"Obsidian API usage\"}"
      }]
    },
    "finish_reason": null
  }]
}
```

**Final SSE termination chunk:**
```json
data: {
  "choices": [{
    "index": 0,
    "delta": {},
    "finish_reason": "tool_calls"
  }]
}
data: [DONE]
```

**Non-streaming completion that ends with a tool call:**
```json
{
  "id": "chatcmpl-xyz",
  "object": "chat.completion",
  "created": 1700000000,
  "model": "gpt-codex-proxy",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "tool_calls": [
        {
          "id": "tool_abcdef",
          "type": "function",
          "function": { "name": "get_user" },
          "arguments": "{\"id\":\"42\"}"
        }
      ],
      "content": "<use_tool>\n  <name>get_user</name>\n  <id>42</id>\n</use_tool>"
    },
    "finish_reason": "tool_calls"
  }],
  "usage": { "prompt_tokens": 100, "completion_tokens": 2, "total_tokens": 102 }
}
```

---

<a id="behavioral-notes"></a>
## Best Practices & Notes

- **Output modes**: `PROXY_OUTPUT_MODE=obsidian-xml` (default) tells the proxy to emit literal `<use_tool>` content alongside `tool_calls[]`, matching Obsidian Copilot’s expectations. Override per request via the `x-proxy-output-mode` header (set to `obsidian-xml` or `openai-json`). When `openai-json` is selected, the proxy restores the legacy `content:null` shape so vanilla OpenAI clients keep working unchanged.

- **Prefer structured events** from `app-server v2`. They are unambiguous and stream-friendly.
- **Fallback to textual detection** only if structured signals are absent.
- **Cut generation** reliably after tool calls to avoid stray text; `PROXY_STOP_AFTER_TOOLS_MODE=burst` waits for the final call before cutting, while `PROXY_TOOL_BLOCK_MAX` caps the number of calls per turn (set `=1` with `PROXY_STOP_AFTER_TOOLS_MODE=first` to restore the legacy single-call behavior). The streaming handler enforces the cap even if `PROXY_STOP_AFTER_TOOLS=false` so operators can roll back without juggling extra flags.
- **Multi-tool turn fidelity** is required: forward every tool call produced within a turn by default (per FR002d / `docs/design/multi-tool-calls-v2.md`). Use `PROXY_TOOL_BLOCK_MAX` only as a rollback lever, and keep `PROXY_ENABLE_PARALLEL_TOOL_CALLS` disabled unless Codex + clients both support concurrent execution. Obsidian XML output concatenates every `<use_tool>` block (optionally separated by `PROXY_TOOL_BLOCK_DELIMITER`) and `PROXY_TOOL_BLOCK_DEDUP` can drop duplicated textual blocks when necessary.
- **No changes to Obsidian Copilot or Codex CLI**: all logic lives in the proxy.
- **Telemetry and logs** are valuable while rolling this out — the proxy now emits an SSE comment at the end of each streaming turn (`: {"tool_call_count":N,"tool_call_truncated":bool,"stop_after_tools_mode":"burst"}`), mirrors the same payload in structured logs/usage events, and sets HTTP headers on non-stream responses (`x-codex-stop-after-tools-mode`, `x-codex-tool-call-count`, `x-codex-tool-call-truncated`).

---

## Handler Integration Contracts for Later Stories

- **Streaming handler** responsibilities: emit the assistant `role` chunk before forwarding any `tool_calls` deltas, stop writing textual content once a tool call is detected (`PROXY_STOP_AFTER_TOOLS`), enforce one finish chunk with `finish_reason:"tool_calls"`, and drop late backend frames after sending `[DONE]`.
- **Non-stream handler** responsibilities: consume aggregator snapshots to populate `tool_calls[]` (or legacy `function_call`), set `content: null`, and honor `PROXY_OUTPUT_MODE` overrides (`obsidian-xml` vs `openai-json`) without mutating aggregated arguments.
- **Error/telemetry contract**: backend errors that occur before a tool-call render as standard error responses; errors after the tool-call chunk still require the canonical finish chunk and graceful close. Telemetry should log `has_tool_calls`, `tool_call_count`, `tool_call_names`, and `output_mode` without the aggregator itself emitting logs.
- **Config linkage**: later stories wire feature flags (`PROXY_STOP_AFTER_TOOLS`, `PROXY_ENABLE_PARALLEL_TOOL_CALLS`) and smoke tests that rely on the aggregator guarantees above; this document is the source for those acceptance criteria.

---

## Next Steps (implementation checklist)

1. Implement `ToolCallAggregator` in `src/lib/`.
2. Modify `src/handlers/chat/stream.js` to ingest deltas into the aggregator and stream `tool_calls`.
3. Modify `src/handlers/chat/nonstream.js` to ingest final messages and produce `tool_calls`-based responses.
4. Add configuration flags in `config/index.js` and `.env.example`.
5. Add smoke tests for streaming and non-streaming tool-call scenarios.
6. Deploy to a staging proxy and test with Obsidian Copilot (using the upstream client) to verify behavior.
7. Iterate on edge cases (multi-tool, malformed arguments, textual markers).

---

## Appendix: Quick Pseudocode Snippet (streaming)

```js
const toolCallAggregator = createToolCallAggregator();
let hasToolCalls = false;

child.on('data', (raw) => {
  const evt = parseJson(raw);
  if (evt.type === 'agent_message_delta') {
    const delta = evt.msg;
    // Ingest delta into aggregator
    const result = toolCallAggregator.ingestDelta(delta);
    if (result.updated) {
      // send SSE chunk with tool_calls
      sendChunk({ choices: [{ index: 0, delta: { tool_calls: result.deltas }, finish_reason: null }]});
      hasToolCalls = true;
      if (PROXY_STOP_AFTER_TOOLS) killChildProcess();
    }
    // also handle normal content until a tool call is detected
  }
});

// on stream end
if (hasToolCalls) {
  // emit final SSE finish chunk with finish_reason tool_calls
  sendChunk({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }]});
}
```

---

**End of report.**
