# Chat Completions Request Flow (Dev Stack, Codex CLI 0.55.0)

The sequence below describes how the proxy processes a `POST /v1/chat/completions` request in the dev stack. Each step is in chronological order, highlighting the exact transformations performed and why they are required.

## 1. HTTP ingress and body capture

1. **Express JSON parser** (`src/app.js`)
   - *What*: Parses the JSON body (16 MB limit) and stores the raw bytes on `req.rawBody`.
   - *Why*: Downstream logging and diagnostics need the original request payload even if parsing succeeds.

2. **Raw request logger** (`src/app.js`)
   - *What*: Appends `{ts, route, headers, raw}` to `~/.codex/http-request-debug.ndjson` when the path matches `/v1/chat/completions`.
   - *Why*: Preserves the exact client input for replay/debug without relying on application logs.

3. **CORS application** (`src/app.js`)
   - *What*: Applies global CORS headers and short-circuits preflight `OPTIONS` requests with `204`.
   - *Why*: Ensures browser clients can call the API without manual CORS handling in each route.

4. **Access logging (plain + structured)** (`src/app.js`, `middleware/access-log.js`)
   - *What*: Emits a human-readable `[http]` line and a structured JSON record for every response.
   - *Why*: Provides latency/UA tracking and feeds downstream log processors.

5. **Rate limiting middleware** (`middleware/rate-limit.js`)
   - *What*: Optionally throttles requests based on configured window/max values.
   - *Why*: Prevents abuse and keeps compatibility with production guardrails.

## 2. Routing and readiness

6. **Route selection** (`routes/chat.js`)
   - *What*: Routes `POST /v1/chat/completions` to either the streaming or non-stream handler based on `body.stream` (truthy).
   - *Why*: Maintains OpenAI-compatible semantics where `stream: true` shifts to SSE delivery.

7. **Worker readiness check** (`middleware/worker-ready.js`)
   - *What*: If the backend mode is app-server, verifies the supervised worker handshake succeeded; otherwise responds `503 backend_unavailable` with status snapshot.
   - *Why*: Avoids queuing work when the Codex worker is still spinning up or unhealthy.

## 3. Streaming handler preflight (`handlers/chat/stream.js`)

8. **API key verification**
   - *What*: Extracts `Authorization: Bearer …`, compares to `CFG.API_KEY`, and returns `401` if missing or mismatched.
   - *Why*: Enforces bearer authentication for every non-health route.

9. **SSE concurrency guard** (`services/concurrency-guard.js`)
   - *What*: Acquires a per-process semaphore keyed by route; if the limit is exceeded it immediately returns `429`.
   - *Why*: Prevents resource exhaustion and mirrors production throttling.

10. **Choice count validation**
    - *What*: Normalizes `body.n` via `normalizeChoiceCount`, ensuring it is an integer in `[1, PROXY_MAX_CHAT_CHOICES]`.
    - *Why*: Guarantees downstream payload builders create the correct number of choice frames.

11. **Optional parameter validation** (`validateOptionalChatParams`)
    - *What*: Checks knobs such as `json_schema`, `response_format`, or `stream_options` for structural correctness.
    - *Why*: Filters unsupported/ill-formed options that would otherwise make the Codex worker error later.

12. **Model normalization** (`utils.normalizeModel`)
    - *What*: Maps the requested model ID to the effective Codex model (e.g., `codex-5` → `gpt-5`), while recording the originally requested value.
    - *Why*: Allows the proxy to advertise environment-specific aliases while routing all work to a single Codex binary.

13. **Backend argument synthesis** (`buildBackendArgs`)
    - *What*: Converts request metadata (model, sandbox level, reasoning effort, parallel tool flag) into the CLI arguments for `codex app-server`.
    - *Why*: Centralizes CLI contract knowledge so the handler does not duplicate flag wiring.

## 4. Chat payload normalization (`handlers/chat/request.js`)

14. **Message cleaning** (`stripClientInstructionMessages`)
    - *What*: Scans early assistant/user messages for `<user_instructions>` or legacy XML tool guidance, extracts canonicalized instructions (ASCII-only), and removes them from the runtime message list.
    - *Why*: Codex app-server expects instructions in dedicated config fields and rejects non-ASCII control characters.

15. **Tool definition validation** (`validateTools`)
    - *What*: Ensures client-supplied `tools[]` entries are well-formed (has `function.name`, JSON schema) and clones them.
    - *Why*: Prevents structurally invalid tool catalogs from reaching Codex and enables safe mutation.

16. **Synthetic catalog fallback** (`KNOWN_CLIENT_TOOL_DEFINITIONS`)
    - *What*: If no explicit tools are provided, infers the Obsidian tool set from instruction hints.
    - *Why*: Maintains backwards compatibility with clients that rely on implicit tool catalogs.

17. **Tool preamble injection** (`buildToolPreamble`)
    - *What*: Prepends a human-readable `# CLIENT TOOL CATALOG` block to system instructions.
    - *Why*: Ensures Codex receives schema context even when the worker language model only sees text-based instructions.

18. **Conversation config assembly** (`buildConversationConfigOverrides`)
    - *What*: Populates Codex configuration with `features.client_tools`, tool choice hints, sanitized `user_instructions`, and approval/sandbox policies.
    - *Why*: Mirrors the official app-server schema so the worker acts on the same toggles as production.

19. **Tool response extraction** (`extractToolResponses`)
    - *What*: Collects prior `role:"tool"` messages into `{callId, output}` entries.
    - *Why*: Allows the proxy to replay pending tool outputs to Codex before submitting the user turn.

20. **Turn/message envelopes**
    - *What*: Builds two JSON-RPC payloads: `turn` (new conversation state, tools, instructions) and `message` (current user items, runtime knobs, `includeUsage` flag).
    - *Why*: Matches app-server’s split between `sendUserTurn` and `sendUserMessage` requests.

21. **Normalized request result**
    - *What*: Returns `{turn, message, toolConfig, toolResponses, choiceCount, stream}` to the handler.
    - *Why*: Gives the streaming handler a single normalized contract regardless of client quirks.

## 5. Worker invocation

22. **JSON-RPC adapter creation** (`services/transport/child-adapter.js`)
    - *What*: Wraps `getJsonRpcTransport()` and writes the normalized request to the supervised Codex worker, replaying any pending `toolResponses` first.
    - *Why*: Provides a stream-like interface (stdout/stderr events) even though the worker speaks JSON-RPC over stdio.

23. **Stream bookkeeping setup** (`handlers/chat/stream.js`)
    - *What*: Initializes tool-call aggregator, finish-reason tracker, metadata sanitizer, usage counters, and SSE keepalive timers.
    - *Why*: Converts raw worker notifications into OpenAI-compatible streaming frames with minimal delay.

## 6. Event handling loop

24. **Line parsing**
    - *What*: Reads newline-delimited JSON events from the worker (`agent_message_delta`, `agent_message`, `token_count`, `task_complete`, etc.).
    - *Why*: Codex emits structured events; the handler must react per event type.

25. **Tool-call aggregation** (`createToolCallAggregator`)
    - *What*: Collects partial `tool_calls` fragments (IDs, function names, JSON argument shards) and emits `choices[].delta.tool_calls` updates once they’re complete.
    - *Why*: Delivers OpenAI’s streaming tool-call format and lets the proxy detect when arguments have fully arrived.

26. **Metadata sanitization** (`metadata-sanitizer.js`)
    - *What*: Removes sensitive key/value pairs from text deltas when `PROXY_SANITIZE_METADATA` is enabled.
    - *Why*: Prevents leaking internal rollout identifiers while preserving user-facing content.

27. **First-token timing and usage accumulation**
    - *What*: Marks the timestamp of the first emitted token/tool delta and tracks prompt/completion token counts from `token_count` events.
    - *Why*: Populates latency telemetry and usage fields for the final SSE frame.

28. **Tool cutoff enforcement**
    - *What*: Once every tool call has a fully parsed argument JSON, logs a `tool_cutoff` telemetry event, emits a finish chunk with `finish_reason:"tool_calls"`, and terminates the Codex child.
    - *Why*: Aligns with OpenAI’s contract—stream ends immediately after tool arguments so the client can execute the tool.

29. **Finish reason resolution** (`createFinishReasonTracker`)
    - *What*: Correlates evidence from deltas, task completion, and cutoff signals to pick the canonical `finish_reason` (e.g., `tool_calls`, `stop`, `length`).
    - *Why*: Prevents ambiguous endings and ensures final telemetry matches the emitted frames.

## 7. Response finalization

30. **Usage emission** (`appendUsage`)
    - *What*: Writes a usage record with prompt/completion totals, latency, finish reason, and tool-call metadata to the dev logging channel.
    - *Why*: Supports dashboards and billing evidence without requiring clients to opt into `stream_options.include_usage`.

31. **SSE termination**
    - *What*: Flushes any buffered content, sends the final `{choices:[{delta:{},finish_reason:…}], usage}` frame, writes `[DONE]`, and closes the connection.
    - *Why*: Satisfies the SSE protocol and signals clients that no further data will arrive.

32. **Cleanup**
    - *What*: Cancels idle timers, releases the SSE concurrency guard, and kills the Codex child if still alive.
    - *Why*: Avoids memory leaks and frees capacity for subsequent requests.

33. **Error paths**
    - *What*: On transport/worker failures, maps the error via `mapTransportError` or falls back to a generic `sseErrorBody`, then finalizes SSE with `releaseGuard("error")`.
    - *Why*: Provides deterministic HTTP semantics and prevents hanging sockets when the worker encounters problems.

## 8. Non-streaming handler differences

34. **Shared preflight**
    - *What*: Reuses the same normalization pipeline (steps 8–21) before invoking `postChatNonStream`.
    - *Why*: Keeps streaming and non-streaming behavior aligned.

35. **Accumulated content assembly**
    - *What*: Buffers `agent_message_delta` fragments into `content`, uses the tool-call aggregator to build `choices[].message.tool_calls`, and suppresses text when `finish_reason === "tool_calls"`.
    - *Why*: Returns OpenAI-compatible non-stream payloads that mirror the streaming contract.

36. **Final response**
    - *What*: Sends a JSON body with `choices`, `usage`, `finish_reason`, and synthetic `id` once the worker signals completion or cutoff.
    - *Why*: Matches the OpenAI Chat Completions response schema for non-stream clients.

---

**Note:** This document reflects the dev configuration using Codex CLI `0.55.0`. Production deployments share the same logical flow, but environment variables (e.g., CORS, rate limits, sandbox mode) and concurrency limits may differ.
