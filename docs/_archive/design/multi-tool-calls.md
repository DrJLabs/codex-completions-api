# Design: Multi-Tool Calls per Turn

## Context

- The canonical Obsidian prompt now ships with the full tool catalog (including `writeToFile`, `replaceInFile`, `getFileTree`, etc.) and the dev stack mirrors it in `.codev/AGENTS.md`.
- Codex already emits multiple tool-call records via the JSON-RPC `ToolCallAggregator`, but our proxy handlers surface only the first call per turn, then suppress subsequent `<use_tool>` blocks and structured deltas.
- Users need to queue multiple editing actions before returning to narrative responses; today the proxy prevents that even when the model attempts it.

## Problem Statement

Streaming (`src/handlers/chat/stream.js`) uses a `toolContentEmitted` boolean to cut off assistant content immediately after the first tool block. Non-stream (`src/handlers/chat/nonstream.js`) serializes only `snapshot[0]` into XML. As a result, only the first tool call in a turn reaches clients, regardless of how many Codex emits.

## Goals

1. Allow every tool call Codex produces in a turn to reach the client in creation order (textual XML for obsidian mode, structured `delta.tool_calls` for OpenAI-compatible mode).
2. Keep finish-reason semantics (`tool_calls` once any call exists), tail suppression, and stop-after-tools safeguards.
3. Preserve existing aggregator APIs; all changes live in the chat handlers/tests/docs.

## Proposed Solution

### Streaming Handler Changes

- Track per-choice progress (`forwardedToolCount` or a `Set` of call IDs) instead of the binary `toolContentEmitted` flag.
- After each `toolCallAggregator.ingestDelta/Message`, fetch `snapshot({ choiceIndex })` and emit XML/structured deltas for every record whose ordinal is ≥ current progress.
- Update `scheduleStopAfterTools()` to act on actual counts. Respect `PROXY_TOOL_BLOCK_MAX` (default 0 = unlimited) and retain the grace timer for `PROXY_STOP_AFTER_TOOLS`.
- Ensure `SUPPRESS_TAIL_AFTER_TOOLS` continues to drop narrative text after the *final* tool block but does not block intermediate ones.

### Non-Stream Handler Changes

- When `outputMode === "obsidian-xml"`, concatenate all `toObsidianXml(record)` results into `message.content` rather than just the first entry.
- In `openai-json` mode, keep the full `tool_calls[]` array (already populated by the aggregator) but verify via tests.

### Tests

- Add integration/SSE coverage for turns with ≥ 2 tool calls, asserting:
  - Multiple `<use_tool>` blocks stream in order.
  - `delta.tool_calls.arguments` remain cumulative per call.
  - Only one finish chunk + `[DONE]` is emitted.
- Extend non-stream tests to confirm obsidian mode contains multiple XML blocks and openai-json mode includes all `tool_calls[]` entries.

### Docs & Telemetry

- Update `docs/codex-proxy-tool-calls.md` to describe multi-tool behavior and reference `PROXY_TOOL_BLOCK_MAX`.
- Consider logging `tool_call_count` in usage telemetry for observability (optional).

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Tail suppression could drop intermediate blocks | Guard emission logic with per-block tracking and add regression tests under `tests/integration/responses.stream.tool-delta.int.test.js`. |
| Clients relying on "first tool only" behavior may be impacted | Default remains unlimited, but `PROXY_TOOL_BLOCK_MAX` can enforce a cap for legacy environments; document the flag and keep existing stop-after-tools timers. |
| Duplicate finish chunks when multiple blocks arrive quickly | Keep `finishSent` guard; emit finish chunk only once per choice after all tool blocks are flushed. |
| Increased SSE payload size | No change for openai-json clients beyond the structured deltas they already receive. Obsidian mode gets multiple XML blocks by design. |

## Effort Estimate

- Code + tests: ~1 day (touching both streaming and non-streaming handlers plus fixtures).
- Docs/transcript updates + smoke validation: ~1 day.

Total: ~2 person-days including code review.

