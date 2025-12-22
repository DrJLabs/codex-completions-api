# Copilot Tool-Calling Alignment Brief

## Context

- Obsidian Copilot expects a pure OpenAI `/v1/chat/completions` contract with `tools[]`, `tool_choice`, and iterative `tool_calls` exchanges.
- The proxy now accepts the client’s tool catalog verbatim, injects a standardized preamble, emits structured `tool_calls`, and waits for client `role:"tool"` messages instead of synthesizing `<use_tool>` XML or executing tools server-side.
- Result: clients see canonical `assistant.tool_calls` deltas, stream completion chunks without duplicate XML, and control the tool execution loop end-to-end.

## Goals

1. Accept Copilot’s declared tool catalog verbatim and keep the agent loop identical to OpenAI’s function-calling flow.
2. Convert Codex tool intent into structured `tool_calls` deltas while stripping legacy XML from the stream.
3. Defer actual tool execution to the client; resume Codex only after receiving matching `role:"tool"` results.

## Implementation Plan

### Request Handling

- Parse `tools[]`, `tool_choice`, `parallel_tool_calls`, and any client `role:"tool"` payloads during normalization so Codex receives the exact catalog and tool outputs supplied by the caller.
- Inject a `# CLIENT TOOL CATALOG` preamble summarizing each function (name, description, schema) rather than `<use_tool>` prompts.
- Forward prior assistant/tool messages unchanged while queuing client tool outputs for replay via JSON-RPC `function_call_output`.

### Streaming / Non-Streaming Output

- Emit `delta.tool_calls` entries with stable IDs as tool intent streams and set `finish_reason:"tool_calls"` only after arguments complete. Each cutoff records a `tool_cutoff` telemetry event and terminates the Codex worker for that turn so no placeholder narration leaks into the SSE stream.
- Strip any XML remnants from streamed content so clients receive only structured tool data plus conversational text.
- Track outstanding tool calls until the client replies; never fabricate `role:"tool"` messages—wait for the client and replay outputs through `function_call_output`.

### Tool Results & Continuation

- Maintain a registry keyed by tool-call ID; when the client returns `role:"tool"` content, replay it to Codex via `function_call_output` after recording the payload.
- Repeat the loop until Codex emits a normal assistant completion (`finish_reason:"stop"`), then surface the resumed assistant content to the client.
- If the client withholds tool output the turn simply ends at `finish_reason:"tool_calls"`; operators can rely on the `tool_cutoff` telemetry event to trace the stalled interaction.

### Cleanup

- Ensure both streaming and non-stream handlers share the same tool orchestration logic and never execute tools server-side; the proxy waits for client-supplied `role:"tool"` outputs before resuming Codex.

## Testing Strategy

1. Unit coverage for request parsing (tools, tool_choice) and tool-call detection.
2. Integration replay: initial request → proxy emits tool_calls → client supplies `role:"tool"` payloads → proxy resumes with `finish_reason:"stop"`; include sequential and multi-tool turns and assert the `tool_cutoff` telemetry entry.
3. Regression pass: `npm run test:integration`, targeted smoke against dev stack (`npm run dev:stack:up`, `npm run smoke:dev`), and regenerate transcripts (`npm run transcripts:generate`, `node scripts/generate-responses-transcripts.mjs`) so golden artefacts capture the cut-off semantics.

## Risks & Mitigations

- **Codex still outputs XML**: maintain fallback parser, but prefer structured `tool_calls` when tools[] provided.
- **Token growth** from wrapping tool results: set size limits, request truncation from clients.
- **Client compatibility**: document the contract change (no more XML instructions) in README / AGENTS.md.

## Next Actions

1. Keep request/transport code aligned with the OpenAI contract as additional client features land (multi-tool, parallel execution, etc.).
2. Extend documentation and runbooks whenever new tool behaviours or telemetry hooks are introduced.
3. Regenerate parity transcripts if Codex CLI updates change streaming shapes.
4. Maintain Story 2.12 as the source of truth for future enhancements.
