# Story 2.9: Stream & non-stream handler parity for tool calls

Status: drafted

## Story

As an application developer,
I want the streaming and non-streaming chat handlers to integrate the ToolCallAggregator and emit OpenAI-compatible tool call payloads,
so that clients experience consistent tool_calls/function_call semantics with correct finish reasons in both modes.

## Acceptance Criteria

1. **Streaming integration (Obsidian mode):** Streaming handler emits one assistant role chunk, then when the first tool call completes it writes a single content delta containing the synthesized `<use_tool>` block (from structured or textual data), suppresses tail text, honors `PROXY_STOP_AFTER_TOOLS(*)`, emits one finish chunk with `finish_reason:"tool_calls"`, and closes with `[DONE]`. [Source: docs/codex-proxy-tool-calls.md#streaming-detection--flow]
2. **Non-stream integration (Obsidian mode):** Non-stream responses set `choices[n].message.content` to the `<use_tool>` block (synthesized or passthrough), optionally include `tool_calls[]` metadata, and set `finish_reason:"tool_calls"`. [Source: docs/codex-proxy-tool-calls.md#non-streaming-detection--flow]
3. **Textual fallback passthrough:** Literal XML blocks from the backend are forwarded unchanged (stream + non-stream) and any assistant text beyond the closing tag is dropped. [Source: docs/codex-proxy-tool-calls.md#textual-fallback-detection]
4. **Finish-reason normalization:** Finish reason helpers/tests prioritize `"tool_calls"` whenever the aggregator has calls and guarantee only one finish chunk per choice. [Source: docs/codex-proxy-tool-calls.md#finish-reason-and-message-semantics]
5. **Output-mode config:** Add `PROXY_OUTPUT_MODE` (default `obsidian-xml`) plus `x-proxy-output-mode` header override. `obsidian-xml` emits content XML; `openai-json` restores legacy `content:null` + `tool_calls`. [Source: docs/app-server-migration/codex-completions-api-migration.md]
6. **Test coverage:** Integration/E2E suites cover structured + textual flows for both modes, asserting XML emission, tail suppression, single finish chunk, `[DONE]`, finish reason precedence, and parity. [Source: docs/test-design-epic-2.md#risk-register]
7. **Role-first & idempotent streaming:** Assistant role chunk is emitted exactly once per choice before any deltas; `delta.tool_calls` appear only when aggregator state changes. [Source: docs/codex-proxy-tool-calls.md#streaming-detection--flow]
8. **Cumulative arguments per delta:** Each streamed `delta.tool_calls[*].arguments` carries the cumulative JSON text gathered so far. [Source: docs/codex-proxy-tool-calls.md#streaming-detection--flow]
9. **Single canonical finish:** After emitting the XML block, stream outputs exactly one finish chunk (`finish_reason:"tool_calls"`) and `[DONE]`; no further assistant content or finish frames follow. [Source: docs/codex-proxy-tool-calls.md#finish-reason-and-message-semantics]
10. **Post-finish drop rules:** After the finish chunk, streaming handler drops late backend events to avoid duplicate frames. [Source: docs/codex-proxy-tool-calls.md#handler-integration-contracts-for-later-stories]
11. **OpenAI JSON parity:** When `openai-json` mode is selected, handler returns `content:null` + `tool_calls[]`/`function_call` while retaining stop-after-first-tool semantics. [Source: docs/codex-proxy-tool-calls.md#non-streaming-detection--flow]
12. **No mixed frames:** No SSE `data:` frame may contain both assistant content and `delta.tool_calls`. [Source: docs/codex-proxy-tool-calls.md#streaming-detection--flow]
13. **SSE headers & flushing:** Ensure streaming responses set proper headers (`Content-Type`, `Cache-Control`, `Connection`, `X-Accel-Buffering`) and flush after each chunk. [Source: docs/architecture.md#implementation-patterns]
14. **Backend error precedence:** Errors before a tool-call emit normal error envelopes; errors after the XML block still emit the canonical finish chunk and close, no error frames appended. [Source: docs/codex-proxy-tool-calls.md#handler-integration-contracts-for-later-stories]
15. **UTF-8 & large-args safety:** Arguments remain opaque UTF-8 text; cumulative deltas never split multibyte sequences. [Source: docs/codex-proxy-tool-calls.md#behavioral-notes]
16. **Choice routing & isolation:** Events lacking `choice_index` target choice 0; for `n>1`, role/content/tool/finish frames remain isolated per choice. [Source: docs/codex-proxy-tool-calls.md#behavioral-notes]
17. **Client disconnect handling:** If the client closes mid-turn, stop emitting, detach listeners, and drain backend events. [Source: docs/architecture.md#implementation-patterns]
18. **Non-stream multi-call envelope:** When snapshot contains >1 calls, `message.tool_calls[]` includes all calls (ordered), `content:null` in openai-json mode, and `content` equals the `<use_tool>` block (first call) in obsidian-xml mode. [Source: docs/codex-proxy-tool-calls.md#non-streaming-detection--flow]
19. **Tool_calls precedence:** If both `function_call` and `tool_calls[]` appear, prefer `tool_calls[]`, set `finish_reason:"tool_calls"`, and ensure XML content is emitted in obsidian mode. [Source: docs/codex-proxy-tool-calls.md#finish-reason-and-message-semantics]
20. **Input-shape tolerance:** Handlers accept Codex v2 and OpenAI-style delta/message shapes without external normalization. [Source: docs/codex-proxy-tool-calls.md#behavioral-notes]
21. **Textual stripping:** After textual tool markers, no trailing assistant content is emitted (stream or non-stream). [Source: docs/codex-proxy-tool-calls.md#textual-fallback-detection]
## Tasks / Subtasks

- [ ] **Streaming handler wiring (AC #1-#21)**
  - [ ] Instantiate one `createToolCallAggregator()` per request, track per-choice state (roleSent[i], finishEmitted[i]), feed every JSON-RPC event with `choiceIndex`, emit the assistant role chunk exactly once per choice, and when the first tool call completes emit a single `delta.content` containing `toObsidianXml(record)` (or the captured textual block). [Source: docs/codex-proxy-tool-calls.md#streaming-detection--flow]
  - [ ] Immediately set `tool_in_flight=true`, respect `PROXY_STOP_AFTER_TOOLS(*)`, emit exactly one finish chunk (`finish_reason:"tool_calls"`) followed by `[DONE]`, drop/ignore subsequent backend events, and detach listeners when clients disconnect. [Source: docs/architecture.md#implementation-patterns]
  - [ ] Apply `PROXY_SUPPRESS_TAIL_AFTER_TOOLS` when textual fallback indices indicate tail content, and enforce no-mixed-frame invariant (never send content + tool delta together). [Source: docs/codex-proxy-tool-calls.md#textual-fallback-detection]
  - [ ] Set SSE headers (`Content-Type`, `Cache-Control`, `Connection`, `X-Accel-Buffering`), flush after each chunk, and maintain UTF-8 integrity (no multi-byte splits). [Source: docs/architecture.md#implementation-patterns]
  - [ ] Implement backend error precedence and log source metadata (`mode=obsidian-xml|openai-json`, `source=structured|textual`). [Source: docs/codex-proxy-tool-calls.md#handler-integration-contracts-for-later-stories]
- [ ] **Non-stream response builder (AC #2, #3, #11-#21)**
  - [ ] Before building choices call `ingestMessage()`/`snapshot()`, compute the `<use_tool>` block via aggregator helpers when output_mode=`obsidian-xml` (or pass through textual XML), set `message.content` accordingly, set `finish_reason:"tool_calls"`, and include `tool_calls[]` metadata for logging. For `openai-json`, set `content:null` and populate `tool_calls[]`/`function_call` as before. [Source: docs/codex-proxy-tool-calls.md#non-streaming-detection--flow]
  - [ ] Treat arguments as opaque UTF-8 strings—no parsing or pretty-printing—and ensure response serialization remains UTF-8 safe. [Source: docs/codex-proxy-tool-calls.md#behavioral-notes]
- [ ] **Finish-reason utilities/tests (AC #4, #9, #15, #18, #21)**
  - [ ] Update canonical finish-reason helper/tests so per-choice state enforces at most one finish chunk and `tool_calls` precedence wins over length/stop/content_filter for stream & non-stream. [Source: docs/tech-spec-epic-2.md#detailed-design]
  - [ ] Add tests ensuring no mixed frames after tool-call detection and backend-error precedence behaves as specified. [Source: docs/codex-proxy-tool-calls.md#handler-integration-contracts-for-later-stories]
- [ ] **Config + docs touchpoints (AC #5)**
  - [ ] Add `PROXY_OUTPUT_MODE` env/README docs, describe header override, and document default `obsidian-xml` behavior plus stop-policy expectations. [Source: docs/architecture.md#runtime-config]
- [ ] **Testing (AC #6-#21)**
  - [ ] Add integration/E2E coverage for: (a) structured → synthesized XML, (b) textual passthrough, (c) openai-json mode, (d) n>1 choices, (e) client disconnect mid-turn, (f) SSE header/flush, (g) backend error precedence, (h) UTF-8 integrity, (i) default choice routing. Include assertions that only one `<use_tool>` block and one finish chunk are emitted. [Source: docs/test-design-epic-2.md#test-strategy-summary]

## Dev Notes

### Requirements Context Summary

- FR002–FR004 + FR016–FR017 require `/v1/chat/completions` parity (stream and non-stream) including tool-call semantics; this story wires handlers to the aggregator built in Story 2.8. [Source: docs/PRD.md#functional-requirements]
- `docs/codex-proxy-tool-calls.md` defines handler responsibilities (streaming SSE flow, non-stream message construction, config usage, finish reasoning). [Source: docs/codex-proxy-tool-calls.md]
- Tech spec Epic 2 describes JSON-RPC notification shapes and handler layering; reuse `AgentMessageDeltaNotification` parsing already in transport. [Source: docs/tech-spec-epic-2.md#detailed-design]
- Obsidian Copilot requires literal `<use_tool>` blocks; Story 2.8 now exposes XML helpers so this story must surface those blocks in assistant content while still supporting legacy `openai-json` clients. [Source: docs/app-server-migration/codex-completions-api-migration.md]

### Structure Alignment Summary

- Streaming handler: `src/handlers/chat/stream.js` orchestrates SSE; integrate aggregator immediately after JSON-RPC adapter deltas, before SSE emission. [Source: docs/architecture.md#implementation-patterns]
- Non-stream handler: `src/handlers/chat/nonstream.js` builds final response envelopes; aggregator snapshot lives right before `choices` creation. [Source: docs/tech-spec-epic-2.md#detailed-design]
- Use the new `toObsidianXml()` helper from Story 2.8 when emitting XML content; finish reason normalization likely resides in shared helper (`src/lib/finish-reason.js` or equivalent) to keep behavior consistent across chat/responses.

### Architecture patterns and constraints

- Maintain role-first SSE contracts, `text/event-stream` headers, keepalive cadence, and `[DONE]` termination. [Source: docs/architecture.md#implementation-patterns]
- Obey config gating: stop policy cannot kill the worker; handlers just stop writing SSE after aggregator detection. [Source: docs/codex-proxy-tool-calls.md#handler-integration-contracts-for-later-stories]
- Keep module boundaries clean: aggregator stays pure (no telemetry), handlers handle stop timing and finish reasoning.

### Learnings from Previous Story

**From Story 2-8-implement-tool-call-aggregator (Status: drafted)**

- Aggregator already exposes cumulative deltas, textual fallback indices, immutability guarantees, and choice-aware state; reuse the exported API and do not fork logic. [Source: stories/2-8-implement-tool-call-aggregator.md]
- Handlers should not mutate aggregator snapshots (immutability contract); treat outputs as read-only.
- `docs/dev/tool-call-aggregator.md` (created by Story 2.8) documents API usage—follow examples when instantiating within handlers.

### Project Structure Notes

- Place new handler logic inside existing files (`src/handlers/chat/stream.js`, `src/handlers/chat/nonstream.js`) without relocating routers; maintain existing lint/style rules. [Source: docs/bmad/architecture/coding-standards.md]
- Finish-reason updates belong in shared util; update corresponding tests under `tests/unit/` or `tests/integration/chat`. [Source: docs/test-design-epic-2.md#test-strategy-summary]

### References

- docs/epics.md#story-29-stream--non-stream-handler-parity-for-tool-calls
- docs/codex-proxy-tool-calls.md
- docs/PRD.md#functional-requirements
- docs/tech-spec-epic-2.md#detailed-design
- docs/architecture.md#implementation-patterns
- docs/test-design-epic-2.md#risk-register
- docs/bmad/architecture/coding-standards.md
- stories/2-8-implement-tool-call-aggregator.md

## Dev Agent Record

### Context Reference

<!-- Path(s) to story context XML will be added here by context workflow -->

### Agent Model Used

codex-5 (planned)

### Debug Log References

- TBD — populate after implementation

### Completion Notes List

- _To be updated once development is complete._

### File List

- _To be updated once development is complete._
