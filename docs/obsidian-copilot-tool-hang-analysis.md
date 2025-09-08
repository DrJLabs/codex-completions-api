# Obsidian Copilot — Hanging Tool Calls, Iteration Limits, and Stream Shaping

Date: 2025-09-08

## Summary

- Symptom 1: The chat pane sometimes shows "Calling …" (e.g., vault search) that never resolves and the pane becomes unstable. Root cause: assistant messages containing narrative after `</use_tool>` or malformed/partial tool tags confuse the tool-runner, leaving a persistent in-progress entry.
- Symptom 2: On larger tasks, the agent stops with "maximum iterations (6)" without finishing. Root cause: the model chooses many granular file edits across turns; Copilot enforces a hard cap per autonomous session.
- Fix implemented: Server-side stream shaping that suppresses any narrative after the last complete `<use_tool>…</use_tool>` block without ending the stream early. This keeps the assistant message tool-only, avoids the stuck "Calling …", and preserves normal iteration flow.

## Evidence and Logs

- Dev proto logs record structured `tool_block` events when complete `<use_tool>` blocks are seen.
- A failing run shows tool execution bursts with tool-only chunks followed by narrative; when narrative arrives after tools, the UI can mark the first tool as perpetually "Calling …".
- Iteration-limit runs show six full cycles (request → tool → result) with successful `writeToFile`/`replaceInFile`/`getFileTree` results but no final tool-free answer before the cap.

## Root Causes

1. Hanging tools

- Client parses the first `<use_tool>` and expects no substantive content after the last `</use_tool>`.
- Post-tool narrative or incomplete XML can desynchronize the parser and tool-runner state.

2. Iteration cap

- The client counts iterations by assistant turn, not by tools per turn. If the model keeps issuing fine-grained edits, the cap is reached before a summary.

## Design Options Considered

- Early stream cut after tools (previous guard): reliable for preventing hangs but may change the "feel" of long turns.
- Tail suppression (chosen): do not cut the stream; instead, forward only content up to the last complete tool block; drop any later narrative. Preserve keepalives and finish normally on `task_complete`.

## Implementation (Proxy)

- Env flag: `PROXY_SUPPRESS_TAIL_AFTER_TOOLS=true` (default off).
- Streaming path:
  - Track cumulative `emitted` and the index forwarded to the client.
  - After each delta, compute the last fully-closed tool block end using `extractUseToolBlocks`.
  - Forward only the new segment up to that end; log `tool_suppress_tail` once if any bytes are dropped.
- Non-stream path:
  - Before responding, slice the final content up to the last complete tool block when suppression is enabled.
- Observability: emit `tool_suppress_tail` events in dev logs (NDJSON).

## Why This Solves The Hang

- The client receives a single assistant message that is tool-only. This reliably triggers tool execution and avoids post-tool text that keeps the UI in a "Calling …" state.
- Because the stream still ends normally on `[DONE]`, Copilot’s iteration accounting remains unchanged.

## Iteration-Limit Guidance (Advisory)

- Prefer batching related file edits per turn; end with a tool-free final answer when sufficient.
- Consider raising the iteration cap for content-heavy refactors if the client allows.
- Reduce context growth by trimming earlier turns and large tool outputs.

## Configuration

- Dev recommended:
  - `PROXY_SUPPRESS_TAIL_AFTER_TOOLS=true`
  - Leave `PROXY_STOP_AFTER_TOOLS` unset/empty.

## Validation Plan

1. Multi-tool burst in one turn → expect: all tool blocks delivered; no post-tool narrative reaches client; no stuck "Calling …".
2. Narrative-after-tools attempt → expect: suppressed; client executes tools; next turn begins.
3. Long linking task → expect: normal iteration flow; completion depends on model planning, not on shaping.

## Rollback

- Disable `PROXY_SUPPRESS_TAIL_AFTER_TOOLS` to return to pass-through streaming (or re-enable early-cut guard if needed).
