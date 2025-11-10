# Story 2.9a: Multi-tool calls per assistant turn

Status: drafted

## Story

As a backend developer,
I want streaming and non-streaming handlers to forward every tool call emitted in a turn,
so that clients receive complete OpenAI-compatible `tool_calls[]` arrays and Obsidian `<use_tool>` blocks before regression testing starts.

## Acceptance Criteria

Traceability: Story scope derives from Epic 2, FR002d, and the FR002d change proposal. [Source: docs/epics.md#story-29a-multi-tool-calls-per-assistant-turn; docs/PRD.md#functional-requirements; docs/sprint-change-proposal-2025-11-10.md#story-29a-multi-tool-calls-per-turn]

1. **Streaming burst parity:** `src/handlers/chat/stream.js` tracks `forwardedToolCount` and `lastToolEnd` per choice, emits an SSE `<use_tool>` chunk (plus `delta.tool_calls` metadata) for every new tool call recorded by the aggregator, defers tail suppression until after the final call, and honors `STOP_AFTER_TOOLS_MODE` (`first` legacy vs `burst` grace) before sending a single `finish_reason:"tool_calls"` chunk and `[DONE]`. [Source: docs/design/multi-tool-calls-v2.md#proposed-changes; docs/codex-proxy-tool-calls.md#multi-tool-turn-fidelity; docs/architecture.md#implementation-patterns]
2. **Non-stream multi-call envelopes:** Non-stream chat/responses handlers build assistant messages by concatenating all `<use_tool>` blocks in order (with optional `TOOL_BLOCK_DELIMITER`), set `content:null` plus the complete `tool_calls[]` array for OpenAI JSON mode, ensure tail suppression only removes text after the last block, and keep `finish_reason:"tool_calls"` parity for every choice. [Source: docs/design/multi-tool-calls-v2.md#non-streaming-handler; docs/codex-proxy-tool-calls.md#non-streaming-detection--flow; docs/tech-spec-epic-2.md#detailed-design]
3. **Config + compatibility controls:** Introduce or reuse `TOOL_BLOCK_MAX`, `TOOL_BLOCK_DEDUP`, `TOOL_BLOCK_DELIMITER`, `STOP_AFTER_TOOLS`/`STOP_AFTER_TOOLS_MODE`, and `SUPPRESS_TAIL_AFTER_TOOLS` so operators can cap bursts (default unlimited/burst) or revert to single-call mode, document defaults, and guarantee backward compatibility when toggles force legacy behavior. [Source: docs/design/multi-tool-calls-v2.md#configuration--compatibility; docs/PRD.md#functional-requirements; docs/codex-proxy-tool-calls.md#config-declared-used-by-handlers-later]
4. **Telemetry + documentation:** Emit per-turn telemetry (e.g., `tool_call_count_total`, `tool_call_truncated_total`) and structured logs that capture burst counts, config overrides, and suppression decisions, and update `docs/codex-proxy-tool-calls.md`, `docs/app-server-migration/codex-completions-api-migration.md`, and rollout notes so downstream teams understand the new defaults. [Source: docs/design/multi-tool-calls-v2.md#reasoning-assumptions--logic; docs/sprint-change-proposal-2025-11-10.md#detailed-change-proposals; docs/architecture.md#implementation-patterns]
5. **Regression + smoke coverage:** Add integration, unit, E2E, and smoke tests covering streaming bursts (multi-choice, textual fallback, tail suppression), non-stream multi-call envelopes, config toggles, UTF-8 payloads, and disconnect handling; extend `docs/test-design-epic-2.md` plus `scripts/smoke/dev|prod` to exercise the new multi-call flow before Story 2.10 resumes. [Source: docs/design/multi-tool-calls-v2.md#rollout-plan; docs/test-design-epic-2.md#risk-register; docs/sprint-change-proposal-2025-11-10.md#4-detailed-change-proposals]

## Tasks / Subtasks

- [ ] **Streaming handler state machine (AC #1, #3):** Rework `src/handlers/chat/stream.js` to maintain per-choice `forwardedToolCount`, burst timers, and `lastToolEnd`, stream every tool call, and gate suppression with the updated configs; include unit coverage for the new state helpers. [Source: docs/design/multi-tool-calls-v2.md#streaming-handler; docs/codex-proxy-tool-calls.md#streaming-detection--flow]
  - [ ] Add integration tests (e.g., `tests/integration/chat.stream.multi-call-burst.int.test.js`) that cover multi-choice bursts, textual fallback, and stop-after-tools timers.
- [ ] **Non-stream + responses updates (AC #2, #3):** Update `src/handlers/chat/nonstream.js` and shared helpers to concatenate `<use_tool>` blocks, emit full `tool_calls[]`, honor delimiter/tail suppression configs, and reuse the same logic in the responses adapter. [Source: docs/design/multi-tool-calls-v2.md#non-streaming-handler; docs/tech-spec-epic-2.md#detailed-design]
  - [ ] Add unit/integration tests (`tests/unit/handlers/chat/nonstream.multi-call.test.js`, `tests/integration/chat.nonstream.multi-call.int.test.js`) that prove multiple `<use_tool>` blocks, tail suppression, and OpenAI JSON envelopes render correctly for burst scenarios (AC #2).
  - [ ] Extend aggregator serialization helpers (`src/lib/tool-call-aggregator.js`) so snapshots expose ordered call metadata for both output modes.
- [ ] **Config + telemetry plumbing (AC #3, #4):** Surface new env vars (`TOOL_BLOCK_MAX`, `TOOL_BLOCK_DEDUP`, `TOOL_BLOCK_DELIMITER`, `STOP_AFTER_TOOLS_MODE`) in `src/config/index.js`, wire `tool_call_count` metrics/logging in handlers, and document rollout toggles. [Source: docs/design/multi-tool-calls-v2.md#configuration--compatibility; docs/sprint-change-proposal-2025-11-10.md#42-prdmdfunctional-requirements]
  - [ ] Add regression tests: (a) config unit coverage proving env defaults + overrides (`tests/unit/config/tools-mode.test.js`), and (b) streaming/non-stream integration specs that flip the burst/single-call flags at runtime to verify compatibility paths (AC #3).
  - [ ] Instrument telemetry verification via integration/unit tests that assert `tool_call_count_total`, `tool_call_truncated_total`, and structured log fields fire for burst, capped, and legacy modes (`tests/integration/chat.telemetry.tool-calls.int.test.js`) (AC #4).
  - [ ] Ensure metrics propagate to existing telemetry exporters and add alerts for abnormal burst counts.
- [ ] **Regression suites + smoke (AC #5):** Add unit tests for new helpers, streaming/non-stream integration specs for multi-call bursts, Playwright coverage for multiple `<use_tool>` blocks, and smoke checks that issue Codex transcripts with ≥2 tool calls; update `npm run test:integration`, `npm test`, and `scripts/smoke/*` documentation. [Source: docs/test-design-epic-2.md#risk-register; docs/sprint-change-proposal-2025-11-10.md#45-docstest-design-epic-2md--citest-harnesses]
  - [ ] Define acceptance-test checklist linking each AC to a concrete suite (unit, integration, E2E, smoke) and capture the exact commands/logs that Story 2.10 will reuse before closing this story (AC #5).
  - [ ] Capture fixtures/logs so Story 2.10 can reuse them when expanding regression coverage.
- [ ] **Doc + runbook updates (AC #4, #5):** Refresh `docs/codex-proxy-tool-calls.md`, `docs/app-server-migration/codex-completions-api-migration.md`, and PRD annotations with the new burst defaults, telemetry expectations, and rollback steps; link to the updated smoke instructions. [Source: docs/design/multi-tool-calls-v2.md#scope; docs/sprint-change-proposal-2025-11-10.md#46-secondary-artifacts]

## Dev Notes

### Requirements Context Summary

- FR002d mandates forwarding every tool call per assistant turn with config-controlled fallbacks. [Source: docs/PRD.md#functional-requirements]
- Epic 2 adds Story 2.9a specifically to unblock Story 2.10 and ensure parity with OpenAI tool-call semantics. [Source: docs/epics.md#story-29a-multi-tool-calls-per-assistant-turn]
- The sprint change proposal documents the scoped behavioral change, dependencies, and artifact updates required before QA proceeds. [Source: docs/sprint-change-proposal-2025-11-10.md#detailed-change-proposals]
- `docs/design/multi-tool-calls-v2.md` is now the normative architecture for streaming/non-streaming bursts, configs, and telemetry. [Source: docs/design/multi-tool-calls-v2.md]
- `docs/codex-proxy-tool-calls.md` and `docs/test-design-epic-2.md` describe the handler contracts plus regression expectations that must be updated once burst mode lands. [Source: docs/codex-proxy-tool-calls.md#multi-tool-turn-fidelity; docs/test-design-epic-2.md#risk-register]

### Structure Alignment Summary

- Streaming logic lives in `src/handlers/chat/stream.js` and must integrate with the ToolCallAggregator immediately after JSON-RPC deltas, reusing the SSE helpers introduced in Story 2.9. [Source: docs/tech-spec-epic-2.md#detailed-design; stories/2-9-stream-and-nonstream-tool-calls.md#Structure-Alignment-Summary]
- Non-stream envelopes are built in `src/handlers/chat/nonstream.js` and the responses adapter; ensure shared helpers (e.g., finish-reason utilities, XML serialization) remain single-sourced. [Source: docs/tech-spec-epic-2.md#detailed-design]
- Config defaults and telemetry exports run through `src/config/index.js`, `src/services/sse.js`, and the existing logging/metrics utilities. [Source: docs/architecture.md#implementation-patterns]
- Tests reside under `tests/unit`, `tests/integration`, `tests/e2e`, and `scripts/smoke`; extend the suites added during Story 2.9 so future work reuses the same harnesses. [Source: stories/2-9-stream-and-nonstream-tool-calls.md#Change-Log]

### Architecture Patterns and Constraints

- Maintain role-first SSE ordering, keepalive cadence, `[DONE]` semantics, and proper headers per the architecture guide. [Source: docs/architecture.md#implementation-patterns]
- Respect ToolCallAggregator immutability; never mutate snapshots when duplicating tool call arrays for streaming vs non-streaming outputs. [Source: stories/2-9-stream-and-nonstream-tool-calls.md#Dev-Notes]
- Config toggles must be hot-reload safe and default to burst/unlimited while allowing immediate rollback to single-call mode. [Source: docs/design/multi-tool-calls-v2.md#configuration--compatibility]
- Telemetry needs to capture per-choice/per-turn counts without spamming logs; reuse the structured logging strategy from Story 2.9. [Source: stories/2-9-stream-and-nonstream-tool-calls.md#Completion-Notes-List]

### Learnings from Previous Story

- Story 2.9 delivered ToolCallAggregator integration, PROXY_OUTPUT_MODE, SSE header conformance, and new regression suites; reuse those helpers instead of duplicating logic. [Source: stories/2-9-stream-and-nonstream-tool-calls.md#Completion-Notes-List]
- Choice isolation bugs were fixed by deferring aggregator ingestion until `choice_index` is known—maintain that invariant when emitting multiple calls. [Source: stories/2-9-stream-and-nonstream-tool-calls.md#Action-Items]
- Recent review follow-ups added UTF-8 fixtures, disconnect tests, and output-mode env coverage; treat them as the regression baseline before layering burst behavior. [Source: stories/2-9-stream-and-nonstream-tool-calls.md#Review-Follow-ups-AI]
- File list highlights all touched areas (handlers, aggregator, SSE service, configs, docs, tests); expect to modify the same modules when enabling burst mode. [Source: stories/2-9-stream-and-nonstream-tool-calls.md#File-List]

### Project Structure Notes

- Place new env/config docs in `docs/app-server-migration/` and `docs/codex-proxy-tool-calls.md`; keep story artifacts under `docs/stories/`. [Source: docs/app-server-migration/codex-completions-api-migration.md#i-code-touch-points-typical-repo]
- Tests and smoke helpers belong under existing directories (`tests/**/*`, `scripts/smoke/*`), and code changes must follow the repo’s ESM + 2-space style guide. [Source: docs/bmad/architecture/coding-standards.md]

### References

- docs/epics.md#story-29a-multi-tool-calls-per-assistant-turn
- docs/PRD.md#functional-requirements
- docs/sprint-change-proposal-2025-11-10.md#story-29a-multi-tool-calls-per-turn
- docs/design/multi-tool-calls-v2.md
- docs/codex-proxy-tool-calls.md#multi-tool-turn-fidelity
- docs/architecture.md#implementation-patterns
- docs/tech-spec-epic-2.md#detailed-design
- docs/test-design-epic-2.md#risk-register
- docs/app-server-migration/codex-completions-api-migration.md
- docs/bmad/architecture/coding-standards.md
- stories/2-9-stream-and-nonstream-tool-calls.md

## Change Log

- 2025-11-09: Drafted via SM create-story workflow to unblock Story 2.10 and document FR002d burst requirements.

## Dev Agent Record

### Context Reference
<!-- Story context XML path will be recorded by story-context workflow -->

### Agent Model Used
codex-5 (planned)

### Debug Log References
- _To be added after development._

### Completion Notes List
- _To be populated when work completes._

### File List
- _To be captured during development._
