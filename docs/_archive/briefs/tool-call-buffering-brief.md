# Streaming Tool-Call Buffering Brief

## Context
- **Problem**: Obsidian-mode streaming responses currently emit textual `<use_tool>` blocks twice. The handler streams the literal block content as soon as Codex begins sending it, then replays the exact same block when the tool-call aggregator later recognizes the completed block. Example: req `HevrLsVQESL3K1M3_3dHi` in `.codev/proto-events.ndjson` shows chunked output finishing with `</use_tool` followed immediately by a second, full `<use_tool>` chunk at line `2194985`.
- **Root cause**: `appendContentSegment()` (`src/handlers/chat/stream.js:1223-1345`) streams every character immediately. The `<use_tool>` extractor cannot detect an in-flight block until the closing tag arrives, so the opener/body flush to the client. When the closing tag finally appears, `emitToolContentChunk()` (same file) sends the canonical XML block, resulting in duplicated content.

## Goal
Deliver textual `<use_tool>` blocks exactly once per Codex tool invocation while preserving existing behavior for non-Obsidian output modes and for structured (`tool_calls[]`) deltas.

## Proposed Fix
1. **Buffer active tool blocks**
   - Track per-choice buffering state (e.g., `state.activeToolBuffer`).
   - When `appendContentSegment()` sees `<use_tool` in the latest content, stop forwarding subsequent characters to the client and append them to the buffer until the corresponding `</use_tool>` is observed.
   - Once the closing tag arrives, pass the buffered literal to `emitToolContentChunk()` (which already handles dedup/telemetry) and clear the buffer.
2. **Guard against nested/partial blocks**
   - Only start buffering when we are outside an active block; ignore nested `<use_tool>` markers inside the buffer unless Codex produces malformed XML (log + flush raw text if parsing fails).
3. **Fallback**
   - If Codex drops the connection before sending `</use_tool>`, flush the buffered text as-is during cleanup so the client still sees what the model produced (even though it may be truncated).
4. **Telemetry + fixtures**
   - `src/handlers/chat/tool-buffer.js` encapsulates the per-choice tracker used by `appendContentSegment()`; the tracker enforces clamp boundaries, detects nested markers, and exposes `skipUntil` guards so the aggregator does not replay aborted blocks.
   - `src/services/metrics/chat.js` increments `tool_buffer_started_total`, `tool_buffer_flushed_total`, and `tool_buffer_aborted_total`; the counters now ride along the `/v1/usage` and `/v1/usage/raw` responses so operators and dashboards can read them without toggling `PROXY_TEST_ENDPOINTS`.
   - The fake Codex shim now supports `FAKE_CODEX_TOOL_XML_CHUNK_SIZE`, `FAKE_CODEX_TRUNCATE_TOOL_XML`, and `FAKE_CODEX_ABORT_AFTER_TOOL_XML`, enabling deterministic chunked and truncated transcripts for integration/E2E coverage, and a replay helper (`scripts/replay-codex-fixture.js`) streams captured proto transcripts such as `.codev/proto-events.ndjson` request `HevrLsVQESL3K1M3_3dHi`.

## Non-Goals
- No changes to JSON output mode (`openai-json`).
- No modifications to the tool-call aggregator data structures.

## Testing
- **Unit**: add targeted tests around the stream handler helpers to ensure buffered content isn’t emitted twice when `<use_tool>` spans multiple chunks.
- **Integration**: run `npm run test:integration` with both the fake shim chunkers and the recorded `.codev/proto-events.ndjson` transcript streamed through `scripts/replay-codex-fixture.js` to confirm only one textual `<use_tool>` block reaches the client.
- **Regression**: sanity-check a request in dev (curl or Obsidian client) and confirm SSE logs no longer show duplicate `<use_tool>` text.

## Risks / Considerations
- Buffering increases memory slightly per active tool call, but each block is typically under a few kilobytes and cleared immediately.
- Need to ensure metadata sanitization still processes the buffered text (either sanitize before buffering or sanitize the combined block before emission).
- Alignment with future `PROXY_TOOL_BLOCK_DEDUP` toggles remains intact because we dedupe at the source rather than relying on config flags.

## References
- `src/handlers/chat/stream.js:1223-1345` (textual tool detection & emission)
- `.codev/proto-events.ndjson:2191893-2194985` (sample duplicated block)
