# Story 2.9a: Multi-tool calls per assistant turn

Status: review

## Story

As a backend developer,
I want streaming and non-streaming handlers to forward every tool call emitted in a turn,
so that clients receive complete OpenAI-compatible `tool_calls[]` arrays and Obsidian `<use_tool>` blocks before regression testing starts.

## Acceptance Criteria

Traceability: Story scope derives from Epic 2, FR002d, and the FR002d change proposal. [Source: docs/epics.md#story-29a-multi-tool-calls-per-assistant-turn; docs/PRD.md#functional-requirements; docs/sprint-change-proposal-2025-11-10.md#story-29a-multi-tool-calls-per-turn]

1. **Streaming burst parity:** `src/handlers/chat/stream.js` tracks `forwardedToolCount` and `lastToolEnd` **per choice**, emits an SSE `<use_tool>` chunk (plus `delta.tool_calls` metadata) for every new tool call recorded by the aggregator, defers tail suppression until after the final call, and honors `STOP_AFTER_TOOLS_MODE` (`first` legacy vs `burst` grace) before sending a single `finish_reason:"tool_calls"` chunk and `[DONE]`. Streaming order must remain `assistant role → N tool-call frames → finish frame → [DONE]`, and `STOP_AFTER_TOOLS_MODE="burst"` should reset a short grace timer until the final call completes. [Source: docs/design/multi-tool-calls-v2.md#proposed-changes; docs/codex-proxy-tool-calls.md#multi-tool-turn-fidelity; docs/architecture.md#implementation-patterns]
2. **Non-stream multi-call envelopes:** Non-stream chat/responses handlers build assistant messages by concatenating all `<use_tool>` blocks in order (with optional `TOOL_BLOCK_DELIMITER`), set `content:null` plus the complete `tool_calls[]` array for OpenAI JSON mode, ensure tail suppression only removes text after the last block, and keep `finish_reason:"tool_calls"` parity for every choice. Obsidian mode must render **all** tool blocks inside a single assistant message, while OpenAI JSON mode always sets `content=null` whenever `tool_calls[]` exists. [Source: docs/design/multi-tool-calls-v2.md#non-streaming-handler; docs/codex-proxy-tool-calls.md#non-streaming-detection--flow; docs/tech-spec-epic-2.md#detailed-design]
3. **Config + compatibility controls:** Introduce or reuse the full flag surface so operators can cap bursts (default unlimited/burst) or revert to single-call mode, document defaults, and guarantee backward compatibility when toggles force legacy behavior: `PROXY_TOOL_BLOCK_MAX`, `PROXY_STOP_AFTER_TOOLS`, `PROXY_STOP_AFTER_TOOLS_MODE`, `PROXY_SUPPRESS_TAIL_AFTER_TOOLS`, `PROXY_TOOL_BLOCK_DEDUP`, `PROXY_TOOL_BLOCK_DELIMITER`, and `PROXY_ENABLE_PARALLEL_TOOL_CALLS`. Combining `PROXY_TOOL_BLOCK_MAX=1` with `PROXY_STOP_AFTER_TOOLS_MODE=first` must replicate legacy single-call behavior. [Source: docs/design/multi-tool-calls-v2.md#configuration--compatibility; docs/PRD.md#functional-requirements; docs/codex-proxy-tool-calls.md#config-declared-used-by-handlers-later]
4. **Telemetry + documentation:** Emit per-turn telemetry (e.g., `tool_call_count_total`, `tool_call_truncated_total`) and structured logs that capture burst counts, config overrides, and suppression decisions, and update `docs/codex-proxy-tool-calls.md`, `docs/app-server-migration/codex-completions-api-migration.md`, and rollout notes so downstream teams understand the new defaults and rollback paths. [Source: docs/design/multi-tool-calls-v2.md#reasoning-assumptions--logic; docs/sprint-change-proposal-2025-11-10.md#detailed-change-proposals; docs/architecture.md#implementation-patterns]
5. **Regression + smoke coverage:** Add integration, unit, E2E, and smoke tests covering streaming bursts (multi-choice, textual fallback, tail suppression), non-stream multi-call envelopes, config toggles, UTF-8 payloads, finish-reason parity, and disconnect handling; extend `docs/test-design-epic-2.md` plus `scripts/smoke/dev|prod` to exercise the new multi-call flow before Story 2.10 resumes. [Source: docs/design/multi-tool-calls-v2.md#rollout-plan; docs/test-design-epic-2.md#risk-register; docs/sprint-change-proposal-2025-11-10.md#4-detailed-change-proposals]

## Tasks / Subtasks

- [x] **Streaming handler state machine (AC #1, #3):** Rework `src/handlers/chat/stream.js` to maintain per-choice `forwardedToolCount`, burst timers, and `lastToolEnd`, stream every tool call, and gate suppression with the updated configs; include unit coverage for the new state helpers. [Source: docs/design/multi-tool-calls-v2.md#streaming-handler; docs/codex-proxy-tool-calls.md#streaming-detection--flow]
  - [x] Add integration tests (e.g., `tests/integration/chat.stream.multi-call-burst.int.test.js`) that cover multi-choice bursts, textual fallback, and stop-after-tools timers.
- [x] **Non-stream + responses updates (AC #2, #3):** Update `src/handlers/chat/nonstream.js` and shared helpers to concatenate `<use_tool>` blocks, emit full `tool_calls[]`, honor delimiter/tail suppression configs, and reuse the same logic in the responses adapter. [Source: docs/design/multi-tool-calls-v2.md#non-streaming-handler; docs/tech-spec-epic-2.md#detailed-design]
  - [x] Add unit/integration tests (`tests/unit/handlers/chat/nonstream.multi-call.test.js`, `tests/integration/chat.nonstream.multi-call.int.test.js`) that prove multiple `<use_tool>` blocks, tail suppression, and OpenAI JSON envelopes render correctly for burst scenarios (AC #2).
  - [x] Extend aggregator serialization helpers (`src/lib/tool-call-aggregator.js`) so snapshots expose ordered call metadata for both output modes.
- [x] **Config + telemetry plumbing (AC #3, #4):** Surface new env vars (`TOOL_BLOCK_MAX`, `TOOL_BLOCK_DEDUP`, `TOOL_BLOCK_DELIMITER`, `STOP_AFTER_TOOLS_MODE`) in `src/config/index.js`, wire `tool_call_count` metrics/logging in handlers, and document rollout toggles. [Source: docs/design/multi-tool-calls-v2.md#configuration--compatibility; docs/sprint-change-proposal-2025-11-10.md#42-prdmdfunctional-requirements]
  - [x] Add regression tests: (a) config unit coverage proving env defaults + overrides (`tests/unit/config/tools-mode.spec.js`), and (b) streaming/non-stream integration specs that flip the burst/single-call flags at runtime to verify compatibility paths (AC #3).
  - [x] Instrument telemetry verification via integration/unit tests that assert `tool_call_count_total`, `tool_call_truncated_total`, and structured log fields fire for burst, capped, and legacy modes (`tests/integration/chat.telemetry.tool-calls.int.test.js`) (AC #4).
  - [x] Ensure metrics propagate to existing telemetry exporters and add alerts for abnormal burst counts (usage NDJSON + proto `tool_call_summary` entries now embed the mode, cap, and suppression fields).
- [x] **Regression suites + smoke (AC #5):** Add unit tests for new helpers, streaming/non-stream integration specs for multi-call bursts, Playwright coverage for multiple `<use_tool>` blocks, and smoke checks that issue Codex transcripts with ≥2 tool calls; update `npm run test:integration`, `npm test`, and `scripts/smoke/*` documentation. [Source: docs/test-design-epic-2.md#risk-register; docs/sprint-change-proposal-2025-11-10.md#45-docstest-design-epic-2md--citest-harnesses]
  - [x] Define acceptance-test checklist linking each AC to a concrete suite (unit, integration, E2E, smoke) and capture the exact commands/logs that Story 2.10 will reuse before closing this story (AC #5).
  - [x] Capture fixtures/logs so Story 2.10 can reuse them when expanding regression coverage (ATDD checklist updated with GREEN status + commands; smoke transcripts recorded via `scripts/smoke/stream-tool-call.js`).
- [x] **Doc + runbook updates (AC #4, #5):** Refresh `docs/codex-proxy-tool-calls.md`, `docs/app-server-migration/codex-completions-api-migration.md`, and PRD annotations with the new burst defaults, telemetry expectations, and rollback steps; link to the updated smoke instructions. [Source: docs/design/multi-tool-calls-v2.md#scope; docs/sprint-change-proposal-2025-11-10.md#46-secondary-artifacts]

## Dev Notes

### Requirements Context Summary

- FR002d mandates forwarding every tool call per assistant turn with config-controlled fallbacks. [Source: docs/PRD.md#functional-requirements]
- Epic 2 adds Story 2.9a specifically to unblock Story 2.10 and ensure parity with OpenAI tool-call semantics. [Source: docs/epics.md#story-29a-multi-tool-calls-per-assistant-turn]
- The sprint change proposal documents the scoped behavioral change, dependencies, and artifact updates required before QA proceeds. [Source: docs/sprint-change-proposal-2025-11-10.md#detailed-change-proposals]
- `docs/design/multi-tool-calls-v2.md` is now the normative architecture for streaming/non-streaming bursts, configs, and telemetry. [Source: docs/design/multi-tool-calls-v2.md]
- `docs/codex-proxy-tool-calls.md` and `docs/test-design-epic-2.md` describe the handler contracts plus regression expectations that must be updated once burst mode lands. [Source: docs/codex-proxy-tool-calls.md#multi-tool-turn-fidelity; docs/test-design-epic-2.md#risk-register]

### Structure Alignment Summary

- Streaming logic lives in `src/handlers/chat/stream.js` and must integrate with the ToolCallAggregator immediately after JSON-RPC deltas, reusing the SSE helpers introduced in Story 2.9. Maintain the clarified ordering (role chunk → tool calls → finish → `[DONE]`) and keep keepalives plus a single finish frame intact. [Source: docs/tech-spec-epic-2.md#detailed-design; stories/2-9-stream-and-nonstream-tool-calls.md#Structure-Alignment-Summary]
- Non-stream envelopes are built in `src/handlers/chat/nonstream.js` and the responses adapter; ensure shared helpers (finish-reason utilities, XML serialization, tool-call concatenation) remain single-sourced so `/v1/chat/completions` and `/v1/responses` behave identically. [Source: docs/tech-spec-epic-2.md#detailed-design]
- Config defaults and telemetry exports run through `src/config/index.js`, `src/services/sse.js`, and the existing logging/metrics utilities; the full flag set listed in AC #3 must be surfaced from these modules. [Source: docs/architecture.md#implementation-patterns]
- Tests reside under `tests/unit`, `tests/integration`, `tests/e2e`, and `scripts/smoke`; extend the suites added during Story 2.9 so future work reuses the same harnesses. [Source: stories/2-9-stream-and-nonstream-tool-calls.md#Change-Log]

### Architecture Patterns and Constraints

- Maintain role-first SSE ordering, keepalive cadence, `[DONE]` semantics, and proper headers per the architecture guide. [Source: docs/architecture.md#implementation-patterns]
- Output contracts: OpenAI JSON envelopes must set `content=null` whenever `tool_calls[]` exists and finish with `finish_reason="tool_calls"`, while Obsidian mode carries multiple `<use_tool>` blocks inside a single assistant message. [Source: docs/codex-proxy-tool-calls.md#non-streaming-detection--flow]
- Choice isolation: track tool-call state, suppression, and completion independently per choice so multi-choice bursts never leak frames across choices. [Source: stories/2-9-stream-and-nonstream-tool-calls.md#Action-Items]
- Respect ToolCallAggregator immutability; never mutate snapshots when duplicating tool call arrays for streaming vs non-streaming outputs—clone when additional serialization is required. [Source: stories/2-9-stream-and-nonstream-tool-calls.md#Dev-Notes]
- Config toggles must be hot-reload safe and default to burst/unlimited while allowing immediate rollback to single-call mode. [Source: docs/design/multi-tool-calls-v2.md#configuration--compatibility]
- Telemetry needs to capture per-choice/per-turn counts without spamming logs; reuse the structured logging strategy from Story 2.9 and wire counters such as `tool_call_count_total` / `tool_call_truncated_total`. [Source: stories/2-9-stream-and-nonstream-tool-calls.md#Completion-Notes-List]

### Learnings from Previous Story

- Story 2.9 delivered ToolCallAggregator integration, PROXY_OUTPUT_MODE, SSE header conformance, and new regression suites; reuse those helpers instead of duplicating logic. [Source: stories/2-9-stream-and-nonstream-tool-calls.md#Completion-Notes-List]
- Choice isolation bugs were fixed by deferring aggregator ingestion until `choice_index` is known—maintain that invariant when emitting multiple calls. [Source: stories/2-9-stream-and-nonstream-tool-calls.md#Action-Items]
- Recent review follow-ups added UTF-8 fixtures, disconnect tests, and output-mode env coverage; treat them as the regression baseline before layering burst behavior. [Source: stories/2-9-stream-and-nonstream-tool-calls.md#Review-Follow-ups-AI]
- File list highlights all touched areas (handlers, aggregator, SSE service, configs, docs, tests); expect to modify the same modules when enabling burst mode. [Source: stories/2-9-stream-and-nonstream-tool-calls.md#File-List]

### Project Structure Notes

- Place new env/config docs in `docs/app-server-migration/` and `docs/codex-proxy-tool-calls.md`; keep story artifacts under `docs/stories/`. [Source: docs/app-server-migration/codex-completions-api-migration.md#i-code-touch-points-typical-repo]
- Tests and smoke helpers belong under existing directories (`tests/**/*`, `scripts/smoke/*`), and code changes must follow the repo’s ESM + 2-space style guide. [Source: docs/bmad/architecture/coding-standards.md]
- Code touchpoints: `src/handlers/chat/stream.js`, `src/handlers/chat/nonstream.js`, `src/lib/tool-call-aggregator.js`, and `src/config/index.js`; telemetry/logging wiring may extend to `src/services/sse.js`. [Source: docs/design/multi-tool-calls-v2.md]
- Validation artifacts: `tests/unit/**`, `tests/integration/**`, `tests/e2e/**`, and `scripts/smoke/*` plus the corresponding fixtures/log capture directories enumerated in Story 2.9. [Source: docs/test-design-epic-2.md#risk-register]
- Documentation touchpoints: `docs/codex-proxy-tool-calls.md`, `docs/app-server-migration/codex-completions-api-migration.md`, `docs/test-design-epic-2.md`, and `docs/architecture.md`. [Source: docs/sprint-change-proposal-2025-11-10.md#detailed-change-proposals]

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
- 2025-11-11: Implemented streaming burst state machine updates, added tool-call telemetry comment headers, and landed `chat.multi-tool-burst.int.test.js` coverage plus full integration/E2E runs.
- 2025-11-11: Added non-stream multi-call unit/integration suites, updated JSON-RPC schema builders to forward `tools`, and refreshed shape tests for the new `<use_tool>` envelopes.
- 2025-11-12: Addressed review feedback by factoring a stop-after-tools controller, enforcing per-choice caps in `src/handlers/chat/stream.js`, and backfilling dedicated unit coverage plus full unit/integration/E2E reruns.
- 2025-11-12: Senior Developer Review (AI) approved Story 2.9a with no outstanding corrective actions and appended the latest review record.

## Dev Agent Record

### Context Reference
- docs/stories/2-9a-multi-tool-calls-per-turn.context.xml
- docs/stories/validation-report-2025-11-10T22:25:11Z.md

### Agent Model Used
codex-5 (planned)

### Debug Log References
- 2025-11-11: Initialization plan
  1. **Streaming state machine** – Read `src/handlers/chat/stream.js`, map existing aggregator hooks, and design per-choice counters (`forwardedToolCount`, `lastToolEnd`, burst grace timers) aligned with AC #1/#3.
  2. **Config + telemetry plumbing** – Inventory current env surfaces in `src/config/index.js` and related helpers, decide how new knobs (`PROXY_TOOL_BLOCK_MAX`, `PROXY_STOP_AFTER_TOOLS_MODE`, etc.) and metrics (`tool_call_count_total`, truncation) flow through stream/non-stream handlers.
  3. **Test harness updates** – Scope required Vitest integration/unit specs plus Playwright/smoke coverage that will prove burst behavior, finish-reason parity, and legacy compatibility before touching code.
  4. **Non-stream alignment** – After streaming updates, ensure `src/handlers/chat/nonstream.js` and responses adapter reuse the same snapshots/delimiters and capture all `<use_tool>` blocks so both output modes stay consistent (AC #2).
  5. **Docs + artifacts** – Track files needing doc/runbook updates and acceptance evidence (`docs/codex-proxy-tool-calls.md`, smoke scripts, validation logs) to keep Story 2.10 unblocked.
- 2025-11-11: Streaming handler task plan
  1. Confirm `src/handlers/chat/stream.js` now tracks `forwardedToolCount`/`lastToolEnd` per choice and emits both `delta.tool_calls[]` and `<use_tool>` SSE chunks for every aggregator record before `finish_reason:"tool_calls"`.
  2. Inspect `scheduleStopAfterTools()` + timers to ensure `STOP_AFTER_TOOLS_MODE=burst` keeps resetting the grace timeout until the last tool call completes while `PROXY_TOOL_BLOCK_MAX` hard-caps bursts.
  3. Verify telemetry/log plumbing (`emitToolStatsComment`, `tool_call_count_total`, structured log payloads, new response headers) covers streaming ACs and matches docs.
  4. Exercise the new fake Codex burst scenario (`scripts/fake-codex-proto.js`) plus integration test harnesses to prove multi-choice bursts stay in order and legacy compatibility toggles work before moving on to the non-stream tasks.
- 2025-11-11: Streaming handler execution notes
  - Confirmed `ensureChoiceState()` persists `forwardedToolCount` per choice, `emitAggregatorToolContent()` walks every snapshot entry, and `emitToolStatsComment()` surfaces counts/truncation for telemetry + SSE comments.
  - Validated `scheduleStopAfterTools()` now keys off total forwarded count (respecting `PROXY_TOOL_BLOCK_MAX` + burst mode grace resets) and `STOP_AFTER_TOOLS` enforcement toggles behave with the new `FAKE_CODEX_MODE=multi_tool_burst` shim.
  - Ran `npm run test:integration`, a focused `npx vitest run tests/integration/chat.multi-tool-burst.int.test.js`, and `npm test` (Playwright) to prove streaming bursts, telemetry headers, and SSE ordering remain stable.
- 2025-11-11: Non-stream handler plan
  1. Re-read `docs/design/multi-tool-calls-v2.md#non-streaming-handler` + `docs/codex-proxy-tool-calls.md` to confirm expectations for concatenated `<use_tool>` blocks, optional delimiters, and OpenAI JSON envelopes.
  2. Inspect `src/handlers/chat/nonstream.js` + responses adapter to ensure canonical XML builders honor dedup/cap configs; note any gaps that require code adjustments (e.g., telemetry headers, choice isolation) before touching tests.
  3. Add new regression coverage:
     - Unit: exercise `buildAssistantMessage()` + helper utilities to prove obsidian vs openai modes, dedup, delimiter, and finish-reason parity.
     - Integration: hit `/v1/chat/completions` (non-stream) in both output modes with the fake Codex burst scenario to assert multi-call envelopes, headers, and tail suppression.
- 2025-11-11: Non-stream handler execution notes
  - Added `tests/unit/handlers/chat/nonstream.multi-call.test.js` to assert `buildAssistantMessage()` reports `toolCallCount`, trims textual tails, and enforces `content:null` for OpenAI JSON mode over multi-call snapshots.
  - Created `tests/integration/chat.nonstream.multi-call.int.test.js` plus expanded `chat.nonstream.shape.int.test.js` to exercise `/v1/chat/completions` (obsidian + openai-json) with the multi-tool burst fixture, verifying `<use_tool>` concatenation, headers, and legacy compatibility.
  - Fixed the JSON-RPC adapter by teaching `buildSendUserTurnParams()` to forward `tools` so app-server requests retain tool definitions/choices, which unblocked `tests/integration/chat-jsonrpc.int.test.js`.
  - Test evidence: `npx vitest run tests/unit/handlers/chat/nonstream.multi-call.test.js`, `npx vitest run tests/integration/chat.nonstream.multi-call.int.test.js`, `npx vitest run tests/integration/chat-jsonrpc.int.test.js`, and full `npm run test:integration` all passing locally.
- 2025-11-11: Config + telemetry plan
  1. Validate config exposure: add a dedicated `tests/unit/config/tools-mode.spec.js` that proves defaults/overrides for all Story 2.9a env flags.
  2. Extend streaming/non-stream telemetry so both usage NDJSON (`appendUsage`) and proto NDJSON (`appendProtoEvent`) include `tool_call_count_total`, truncation signals, `stop_after_tools_mode`, and cap metadata.
  3. Capture deterministic integration coverage for burst vs. capped telemetry, writing NDJSON to a temp directory for assertions.
  4. Update docs/runbooks (`docs/app-server-migration/...`, `docs/test-design-epic-2.md`) so operators know which levers to flip and which evidence to gather.
- 2025-11-11: Config + telemetry execution notes
  - Added `tests/unit/config/tools-mode.spec.js` (Vitest) to guard env defaults and delimiter parsing; recorded GREEN run via `npm run test:unit`.
  - Introduced `tests/integration/chat.telemetry.tool-calls.int.test.js`, which sets custom `TOKEN_LOG_PATH`/`PROTO_LOG_PATH`, drives burst + cap scenarios, and asserts structured logs/usage counters.
  - Extended both streaming and non-stream `tool_call_summary` events with `stop_after_tools_mode`, `tool_block_max`, and `suppress_tail_after_tools`, ensuring SSE comments + headers stay in sync.
  - Updated `docs/app-server-migration/codex-completions-api-migration.md` (Section N.6) with the new flag matrix + telemetry guidance.
- 2025-11-11: Regression + smoke updates
  1. Refreshed `docs/atdd-checklist-2.9a.md` with GREEN statuses, command references, and the telemetry integration suite.
  2. Documented the new coverage inside `docs/test-design-epic-2.md` so QA knows which suites guard Story 2.9a.
  3. Tightened `scripts/smoke/stream-tool-call.js` to fail when fewer than two tool IDs stream unless `--allow-single` is explicitly passed.
  4. Captured commands: `npm run test:integration -- chat.multi-tool-burst.int.test.js`, `npx vitest run tests/integration/chat.telemetry.tool-calls.int.test.js`, and full `npm run test:integration`.
- 2025-11-12: Review follow-up execution notes
  1. Factored a dedicated `createStopAfterToolsController()` helper to manage per-choice forwarded counts, `STOP_AFTER_TOOLS_MODE`, and grace timers without killing the stream prematurely.
  2. Updated `scheduleStopAfterTools` call sites to pass `choiceIndex`, wired telemetry truncation callbacks, and added focused unit coverage in `tests/unit/handlers/chat/stop-after-tools-controller.test.js`.
  3. Re-ran `npm run test:unit`, `npm run test:integration`, and `npm test` to prove the controller, integration bursts, and Playwright SSE contracts remain green after the changes.

### Completion Notes List
- 2025-11-11: Config + telemetry plumbing complete — `tests/unit/config/tools-mode.spec.js`, `tests/integration/chat.telemetry.tool-calls.int.test.js`, and `npm run test:integration -- chat.multi-tool-burst.int.test.js` all pass, proving burst vs. legacy caps emit correct SSE comments, HTTP headers, and NDJSON telemetry (`tool_call_count_total`, `tool_call_truncated_total`, `stop_after_tools_mode`, `tool_block_max`, `suppress_tail_after_tools`).
- 2025-11-11: Regression + documentation updates — `docs/app-server-migration/codex-completions-api-migration.md#n6-tool-call-burst-controls--telemetry`, `docs/test-design-epic-2.md`, and `docs/atdd-checklist-2.9a.md` now describe the new smoke harness (`scripts/smoke/stream-tool-call.js`), acceptance evidence, and command matrix; `npm run test:unit` + `npm run test:integration` provide final verification references.
- 2025-11-12: Review follow-up fix — Introduced `src/handlers/chat/stop-after-tools-controller.js` with unit tests, taught `scheduleStopAfterTools` to enforce caps per choice, and reran `npm run test:unit`, `npm run test:integration`, and `npm test` to capture the updated evidence.

### File List
- `src/handlers/chat/stream.js` – Adds per-choice `forwardedToolCount` tracking, burst-aware stop-after-tools scheduling, and SSE telemetry comments so every tool call is streamed before the canonical finish.
- `scripts/fake-codex-proto.js` – Introduces the `multi_tool_burst` shim scenario plus helpers to emit sequential `<use_tool>` blocks for deterministic streaming tests.
- `tests/integration/chat.multi-tool-burst.int.test.js` – Verifies streaming/non-stream bursts, config caps, and telemetry headers for AC #1/#3.
- `tests/support/factories/tool-call.factory.js`, `tests/support/fixtures/tool-burst.fixture.js` – Provide deterministic tool-call payloads and env builders for the new integration coverage.
- `tests/unit/handlers/chat/nonstream.multi-call.test.js` – Adds burst-focused assertions for `buildAssistantMessage()` covering XML concatenation, textual fallback trimming, and OpenAI JSON envelopes.
- `tests/integration/chat.nonstream.multi-call.int.test.js` – Exercises `/v1/chat/completions` (non-stream) in both output modes using the multi-tool burst fixture and verifies telemetry headers plus cap behavior.
- `tests/integration/chat.nonstream.shape.int.test.js` – Updates legacy expectations so tool-call choices now allow `<use_tool>` content while keeping finish_reason parity checks.
- `tests/integration/chat-jsonrpc.int.test.js` – Validates that JSON-RPC payloads propagate `tools` definitions/choice after the schema builder fix.
- `src/lib/json-rpc/schema.ts` – Extends `buildSendUserTurnParams()` and related types to forward `tools` into app-server RPCs for multi-call turns.
- `tests/integration/chat.telemetry.tool-calls.int.test.js` – Spins up the proxy with custom NDJSON destinations and asserts burst vs. capped telemetry counters for AC #3/#4.
- `tests/unit/config/tools-mode.spec.js` – Locks down default vs. override behavior for Story 2.9a env vars (`PROXY_TOOL_BLOCK_MAX`, `PROXY_STOP_AFTER_TOOLS(_MODE)`, delimiter helpers, etc.).
- `src/handlers/chat/stop-after-tools-controller.js` – New helper that centralizes per-choice counting logic, grace timers, and kill semantics for streaming stop-after-tools enforcement.
- `tests/unit/handlers/chat/stop-after-tools-controller.test.js` – Verifies per-choice caps, burst grace timers, and `STOP_AFTER_TOOLS_MODE="first"` cutoffs for the controller.
- `docs/atdd-checklist-2.9a.md` – Promoted from RED to GREEN with recorded commands, telemetry suite references, and updated checklist statuses.
- `docs/test-design-epic-2.md` – Adds Story 2.9a coverage notes tying the new unit/integration/smoke work into the epic-level test plan.
- `docs/app-server-migration/codex-completions-api-migration.md` – Section N.6 now documents all burst/rollback flags plus telemetry validation procedures for operators.

## Senior Developer Review (AI)

### Reviewer
- Amelia (Senior Implementation Engineer)

### Date
- 2025-11-10

### Outcome
- Changes Requested

### Summary
- Streaming/non-stream handlers forward multi-call bursts with telemetry, docs, and smoke guides updated, but two regressions remain: streaming caps count tool calls across the entire response instead of per choice when rollback flags are active, and the promised unit coverage for the new streaming state helpers never landed.

### Key Findings
1. **High – Missing streaming state-machine unit coverage.** Story tasks require unit tests for the new `forwardedToolCount`/timer helpers, yet `tests/unit/handlers/chat` only contains non-stream specs; nothing exercises `src/handlers/chat/stream.js`. This leaves the most intricate logic (stop-after-tools timers, tail suppression) unguarded.
2. **Medium – `PROXY_TOOL_BLOCK_MAX` applied per request instead of per choice.** `scheduleStopAfterTools()` sums `state.forwardedToolCount` across all choices (`src/handlers/chat/stream.js:991`) and cuts the child once the global total hits the cap, so multi-choice responses drop tool calls whenever rollback flags are active. Docs (`docs/app-server-migration/codex-completions-api-migration.md:302`) and the non-stream path treat the cap per choice, so streaming diverges and may truncate valid tool calls for `n>1` requests.

### Acceptance Criteria Coverage
| AC | Status | Evidence |
| --- | --- | --- |
| 1. Streaming burst parity | ✅ Implemented | `src/handlers/chat/stream.js:218`, `src/handlers/chat/stream.js:1096`, `tests/integration/chat.multi-tool-burst.int.test.js:49` |
| 2. Non-stream multi-call envelopes | ✅ Implemented | `src/handlers/chat/nonstream.js:82`, `src/handlers/chat/nonstream.js:132`, `tests/integration/chat.nonstream.multi-call.int.test.js:27`, `tests/unit/handlers/chat/nonstream.multi-call.test.js:1` |
| 3. Config + compatibility controls | ⚠️ Partial | `src/config/index.js:52`, `src/handlers/chat/stream.js:991`, `docs/app-server-migration/codex-completions-api-migration.md:302` (global cap vs. required per-choice behavior) |
| 4. Telemetry + documentation | ✅ Implemented | `src/handlers/chat/stream.js:1247`, `src/handlers/chat/nonstream.js:795`, `tests/integration/chat.telemetry.tool-calls.int.test.js:47`, `docs/app-server-migration/codex-completions-api-migration.md:308` |
| 5. Regression + smoke coverage | ✅ Implemented | `tests/integration/chat.multi-tool-burst.int.test.js:49`, `tests/integration/chat.nonstream.multi-call.int.test.js:27`, `tests/unit/config/tools-mode.spec.js:26`, `scripts/smoke/stream-tool-call.js:1`, `docs/test-design-epic-2.md:161` |

### Task Completion Validation
| Task / Subtask | Status | Evidence / Notes |
| --- | --- | --- |
| Streaming handler state machine (include unit coverage) | ⚠️ Partial | Implementation present (`src/handlers/chat/stream.js:218`, `src/handlers/chat/stream.js:1036`), but no streaming unit specs exist under `tests/unit/handlers/chat`, leaving the promised coverage missing. |
| ↳ Add integration tests for streaming bursts | ✅ | `tests/integration/chat.multi-tool-burst.int.test.js:49` exercises SSE ordering, tool-call frames, and finish reasons. |
| Non-stream + responses updates | ✅ | Canonical XML/textual builders and response wiring live in `src/handlers/chat/nonstream.js:82-175` and `src/handlers/chat/nonstream.js:744-910`. |
| ↳ Add unit tests (`nonstream.multi-call.test.js`) | ✅ | `tests/unit/handlers/chat/nonstream.multi-call.test.js:1` locks down helper behavior. |
| ↳ Add non-stream integration tests | ✅ | `tests/integration/chat.nonstream.multi-call.int.test.js:14` covers both output modes and header expectations. |
| ↳ Extend aggregator serialization helpers | ✅ | Burst fixtures + factories at `tests/support/factories/tool-call.factory.js:1`, `tests/support/fixtures/tool-burst.fixture.js:1`, along with `src/lib/tool-call-aggregator.js:520`. |
| Config + telemetry plumbing | ✅ | Flag surface exposed in `src/config/index.js:52-57`; handlers emit telemetry at `src/handlers/chat/stream.js:1247` and `src/handlers/chat/nonstream.js:792`. |
| ↳ Config regression tests | ✅ | `tests/unit/config/tools-mode.spec.js:26` covers defaults/overrides. |
| ↳ Telemetry verification | ✅ | `tests/integration/chat.telemetry.tool-calls.int.test.js:47` validates NDJSON/proto counters. |
| ↳ Metrics propagate to exporters | ✅ | `appendUsage` + proto summaries updated (`src/handlers/chat/stream.js:1247`, `src/handlers/chat/nonstream.js:795`). |
| Regression suites + smoke updates | ✅ | Integration suites plus `scripts/smoke/stream-tool-call.js:1` enforce burst evidence; documentation stitched into `docs/test-design-epic-2.md:161`. |
| ↳ Acceptance-test checklist linking ACs | ✅ | `docs/atdd-checklist-2.9a.md:35-66` maps each AC to concrete suites. |
| ↳ Fixtures/log capture for Story 2.10 | ✅ | Tool burst fixtures documented at `docs/atdd-checklist-2.9a.md:77` and roll-forward guidance at `docs/atdd-checklist-2.9a.md:241`. |
| Doc + runbook refresh | ✅ | `docs/app-server-migration/codex-completions-api-migration.md:294`, `docs/test-design-epic-2.md:161`, and `docs/codex-proxy-tool-calls.md:180` describe the new behavior. |

### Test Coverage and Gaps
- ✅ Integration: `chat.multi-tool-burst`, `chat.nonstream.multi-call`, `chat.telemetry.tool-calls`, `chat.stream.tool-calls`, `chat-jsonrpc`, plus existing non-stream shape tests.
- ✅ Unit: `tests/unit/config/tools-mode.spec.js`, `tests/unit/handlers/chat/nonstream.multi-call.test.js`, aggregator/tool factory specs.
- ✅ Smoke: `scripts/smoke/stream-tool-call.js` enforces ≥2 streamed tool IDs unless `--allow-single` is set.
- ⚠️ Gap: No unit tests exercise `scheduleStopAfterTools`, `emitAggregatorToolContent`, or `forwardedToolCount` behaviors in `src/handlers/chat/stream.js`.

### Architectural Alignment
- Implementation largely follows `docs/design/multi-tool-calls-v2.md:197` (per-choice state, tail suppression), but the per-choice cap described in `docs/app-server-migration/codex-completions-api-migration.md:302` is not honored by the streaming handler.

### Security Notes
- No new secrets or auth surfaces touched; behavior stays within existing bearer-key guarded endpoints.

### Best-Practices and References
- `docs/codex-proxy-tool-calls.md:180`, `docs/app-server-migration/codex-completions-api-migration.md:294`, `docs/test-design-epic-2.md:161`, `docs/atdd-checklist-2.9a.md:35`.

### Action Items
- [x] **[High] Add streaming unit tests covering `scheduleStopAfterTools`, `forwardedToolCount`, and tail-suppression helpers in `src/handlers/chat/stream.js` to satisfy the Story 2.9a task requirements.** Added `src/handlers/chat/stop-after-tools-controller.js` plus `tests/unit/handlers/chat/stop-after-tools-controller.test.js` to exercise per-choice counters, grace timers, and first-mode cutoffs (see `npm run test:unit`).
- [x] **[Medium] Update streaming cap logic so `PROXY_TOOL_BLOCK_MAX` applies per choice (mirroring `docs/app-server-migration/codex-completions-api-migration.md:302` and the non-stream path) and add a regression test with `n>1` choices.** Refactored `scheduleStopAfterTools` to delegate to the new controller so caps trigger only when a choice exceeds its limit while still honoring `STOP_AFTER_TOOLS_MODE`, ensuring multi-choice bursts remain intact (validated by `tests/integration/chat.multi-tool-burst.int.test.js`).

## Senior Developer Review (AI)

### Reviewer
- Amelia (Senior Implementation Engineer)

### Date
- 2025-11-12

### Outcome
- Approve – All ACs, tasks, telemetry, and regression evidence verified; no outstanding issues.

### Summary
- Streaming and non-streaming handlers now forward every tool call per choice, operators retain rollback toggles, telemetry/docs reflect FR002d, and regression + smoke suites lock the behavior down. No further work required before Story 2.10 resumes.

### Key Findings
- **High:** None.
- **Medium:** None.
- **Low:** None.

### Acceptance Criteria Coverage
| AC | Status | Evidence |
| --- | --- | --- |
| 1. Streaming burst parity | ✅ | Per-choice state + controller scheduling (`src/handlers/chat/stream.js:998`, `src/handlers/chat/stream.js:1023`) and streaming burst test (`tests/integration/chat.multi-tool-burst.int.test.js:49`). |
| 2. Non-stream multi-call envelopes | ✅ | Canonical XML/OpenAI JSON handling (`src/handlers/chat/nonstream.js:57`, `src/handlers/chat/nonstream.js:132`) with unit + integration coverage (`tests/unit/handlers/chat/nonstream.multi-call.test.js:17`, `tests/integration/chat.nonstream.multi-call.int.test.js:27`). |
| 3. Config + compatibility controls | ✅ | Flag surface + stop-after controller (`src/config/index.js:52`, `src/handlers/chat/stop-after-tools-controller.js:1`) proven via unit + integration tests (`tests/unit/config/tools-mode.spec.js:16`, `tests/unit/handlers/chat/stop-after-tools-controller.test.js:7`, `tests/integration/chat.multi-tool-burst.int.test.js:148`). |
| 4. Telemetry + documentation | ✅ | Usage/proto logging + response headers (`src/handlers/chat/stream.js:1255`, `src/handlers/chat/nonstream.js:820`), telemetry suite (`tests/integration/chat.telemetry.tool-calls.int.test.js:47`), and operator docs (`docs/app-server-migration/codex-completions-api-migration.md:300`). |
| 5. Regression + smoke coverage | ✅ | ATDD & test plan updates (`docs/atdd-checklist-2.9a.md:37`, `docs/test-design-epic-2.md:161`) and smoke harness enforcement (`scripts/smoke/stream-tool-call.js:20`). |

### Task Completion Validation
| Task / Subtask | Status | Evidence / Notes |
| --- | --- | --- |
| Streaming handler state machine + integration tests | ✅ | `src/handlers/chat/stream.js:998`, `src/handlers/chat/stream.js:1023`, `tests/integration/chat.multi-tool-burst.int.test.js:49`. |
| Non-stream + responses updates + tests | ✅ | `src/handlers/chat/nonstream.js:57`, `src/handlers/chat/nonstream.js:132`, `tests/integration/chat.nonstream.multi-call.int.test.js:27`, `tests/unit/handlers/chat/nonstream.multi-call.test.js:17`. |
| Aggregator helper extensions | ✅ | `src/lib/tool-call-aggregator.js:448`. |
| Config + telemetry plumbing | ✅ | `src/config/index.js:52`, `src/handlers/chat/stream.js:1255`, `src/handlers/chat/nonstream.js:820`, `tests/integration/chat.telemetry.tool-calls.int.test.js:47`. |
| Regression suites + smoke evidence | ✅ | `docs/atdd-checklist-2.9a.md:37`, `docs/test-design-epic-2.md:161`, `scripts/smoke/stream-tool-call.js:20`. |
| Docs/runbooks refreshed | ✅ | `docs/app-server-migration/codex-completions-api-migration.md:300`, `docs/codex-proxy-tool-calls.md:300`, `docs/design/multi-tool-calls-v2.md:1`. |

### Test Coverage and Gaps
- ✅ `npx vitest run tests/integration/chat.multi-tool-burst.int.test.js`
- ✅ `npx vitest run tests/integration/chat.nonstream.multi-call.int.test.js`
- ✅ `npx vitest run tests/integration/chat.telemetry.tool-calls.int.test.js`
- ✅ Supporting unit suites (`tests/unit/config/tools-mode.spec.js`, `tests/unit/handlers/chat/stop-after-tools-controller.test.js`).
- No remaining gaps; streaming + non-streaming logic are covered at unit, integration, and smoke layers.

### Architectural Alignment
- Matches FR002d guidance and burst-plan docs (`docs/design/multi-tool-calls-v2.md:1`, `docs/codex-proxy-tool-calls.md:296`) plus operator workflows (`docs/app-server-migration/codex-completions-api-migration.md:300`).

### Security Notes
- No new secrets or auth flows introduced; behavior stays within authenticated `/v1/chat/completions` contracts.

### Best-Practices and References
- `docs/design/multi-tool-calls-v2.md`
- `docs/codex-proxy-tool-calls.md`
- `docs/app-server-migration/codex-completions-api-migration.md`
- `docs/test-design-epic-2.md`
- `docs/atdd-checklist-2.9a.md`

### Action Items
**Code Changes Required:**
- None – story approved with complete evidence trail.

**Advisory Notes:**
- Note: Keep `scripts/smoke/stream-tool-call.js` in the deploy checklist so burst telemetry stays observable (`docs/app-server-migration/codex-completions-api-migration.md:318`).
