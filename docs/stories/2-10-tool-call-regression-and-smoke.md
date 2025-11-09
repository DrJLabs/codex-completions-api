# Story 2.10: Tool-call regression and smoke coverage

Status: drafted

## Story

As a QA engineer,
I want automated regression and smoke coverage for structured and textual tool-call flows,
so that Obsidian Copilot and other clients can rely on deterministic tool_calls/function_call behavior across streaming and non-streaming modes.

## Acceptance Criteria

1. **Deterministic fixtures:** Seed-pinned fixtures for structured JSON-RPC events (function_call → arguments.delta/done) and textual `<use_tool>` fallbacks live under `tests/e2e/fixtures/tool-calls/`. [Source: docs/codex-proxy-tool-calls.md#tests--smoke-scripts]
2. **Integration tests:** Streaming + non-stream integration tests assert role order, cumulative arguments, single finish chunk, `[DONE]`, and `finish_reason:"tool_calls"` for structured/textual flows. [Source: docs/test-design-epic-2.md#risk-register]
3. **E2E/Playwright coverage:** `/v1/chat/completions` streaming/non-streaming Playwright specs validate tail suppression and finish semantics using the fixtures. [Source: docs/test-design-epic-2.md#test-strategy-summary]
4. **Obsidian Copilot smoke:** `scripts/smoke/dev|prod` include authenticated structured + textual tool-call checks (stop policy, finish reason, textual stripping). [Source: docs/codex-proxy-tool-calls.md#tests--smoke-scripts]
5. **CI wiring:** `npm run test:integration`, `npm test`, and smoke scripts execute in CI and block merges on failure. [Source: docs/openai-endpoint-golden-parity.md]
6. **Docs:** `docs/test-design-epic-2.md`, migration docs, and smoke runbooks describe tool-call verification steps, fixtures, and commands. [Source: docs/codex-proxy-tool-calls.md#next-steps-implementation-checklist]
7. **Large-args regression:** ≥8KB tool-call arguments maintain UTF-8 cumulative integrity (no broken characters). [Source: docs/codex-proxy-tool-calls.md#behavioral-notes]
8. **Multi-choice parity:** Multiple-choice scenarios confirm independent role chunks, deltas, finish chunks, and non-stream envelopes per choice. [Source: docs/codex-proxy-tool-calls.md#behavioral-notes]
9. **Golden determinism & normalization:** Fixtures/assertions normalize volatile fields while preserving ordering, IDs, cumulative arguments, role-first, single finish, and `[DONE]`. [Source: docs/openai-endpoint-golden-parity.md]
10. **SSE heartbeat tolerance:** Tests ignore comment heartbeat frames and assert non-stream responses never contain heartbeats. [Source: docs/architecture.md#implementation-patterns]
11. **Post-finish drop assertion:** Streaming fails if any assistant/content/tool frame appears after the canonical finish chunk plus `[DONE]`. [Source: docs/codex-proxy-tool-calls.md#finish-reason-and-message-semantics]
12. **Client disconnect smoke:** Smoke test closes the client after the first `delta.tool_calls` and verifies the server stops emitting, frees resources, and subsequent requests stay clean. [Source: docs/architecture.md#implementation-patterns]
13. **Backend error paths:** Tests cover backend errors before the first tool-call delta (expect error response) and after the first tool-call delta (expect canonical finish then close). [Source: docs/codex-proxy-tool-calls.md#handler-integration-contracts-for-later-stories]
14. **Parallel calls policy:** With `PROXY_ENABLE_PARALLEL_TOOL_CALLS=false`, assert single-call per turn; when true, validate multiple tool_calls occur in order with independent cumulative args. [Source: docs/codex-proxy-tool-calls.md#config-declared-used-by-handlers-later]
15. **UTF-8/multibyte resilience:** Streaming cumulative arguments never split multibyte boundaries. [Source: docs/codex-proxy-tool-calls.md#behavioral-notes]
16. **Obsidian textual parity:** Textual fallback tests reuse the Obsidian agent prompt and assert tail stripping after the last textual block. [Source: docs/codex-proxy-tool-calls.md#textual-fallback-detection]
17. **Performance budget:** Integration tests finish ≤30s each, E2E ≤2 min, or are marked `@slow` and excluded from default `npm test`. [Source: docs/test-design-epic-2.md#risk-register]
18. **Triage artifacts:** CI uploads raw SSE transcript, normalized transcript, final JSON, and server logs on failure. [Source: docs/openai-endpoint-golden-parity.md]
19. **No mixed frames:** No `data:` frame contains both assistant content and `delta.tool_calls`. [Source: docs/codex-proxy-tool-calls.md#streaming-detection--flow]
20. **Role-first exactly once:** Exactly one `delta.role:"assistant"` per choice and it precedes content/tool-call deltas. [Source: docs/codex-proxy-tool-calls.md#streaming-detection--flow]
21. **Choice routing/isolation:** Events lacking a choice index default to choice 0; for `n>1`, each choice maintains isolated role/tool/final frames. [Source: docs/codex-proxy-tool-calls.md#behavioral-notes]
22. **Function→tool_calls migration:** If backend emits `function_call` then `tool_calls[]`, the final envelope prefers `tool_calls[]`, sets `content:null`, and `finish_reason:"tool_calls"`. [Source: docs/codex-proxy-tool-calls.md#finish-reason-and-message-semantics]
23. **Deterministic ID normalization:** Normalization maps variable tool IDs to stable placeholders (`tool_<choice>_<ordinal>`) while preserving names and cumulative arguments. [Source: docs/openai-endpoint-golden-parity.md]
24. **Backpressure/coalescing:** Under throttled sockets, rapid updates per call id coalesce into a single outbound chunk containing the latest cumulative arguments. [Source: docs/architecture.md#implementation-patterns]
25. **Heartbeat rules:** Streaming parsers ignore comment frames but still validate data-frame order; non-stream responses never include heartbeat artifacts. [Source: docs/architecture.md#implementation-patterns]
26. **Disconnect leak guard:** Disconnect smoke verifies all resources/listeners return to baseline after client close. [Source: docs/architecture.md#implementation-patterns]
27. **Finish-reason precedence:** If any tool/function call exists, finish_reason must be `"tool_calls"` even when length, stop, or content_filter signals also occur. Tests cover tool_calls vs length/stop/content_filter precedence. [Source: docs/codex-proxy-tool-calls.md#finish-reason-and-message-semantics]
28. **Non-stream multi-call envelope:** When snapshot contains >1 calls, `message.tool_calls[]` includes all calls (ordered), `content:null`, `finish_reason:"tool_calls"`. [Source: docs/codex-proxy-tool-calls.md#non-streaming-detection--flow]
29. **Stream ↔ non-stream parity:** Given the same fixture, streaming and non-stream endpoints yield equivalent normalized sequences/envelopes. [Source: docs/openai-endpoint-golden-parity.md]
30. **Ordering invariant:** Per choice the frame order is `role` → (optional pre-tool content) → `delta.tool_calls` (cumulative) → single finish chunk → `[DONE]`. [Source: docs/codex-proxy-tool-calls.md#streaming-detection--flow]
31. **Single-finish invariant:** Exactly one finish chunk per choice in streaming and one final envelope per choice in non-stream. [Source: docs/codex-proxy-tool-calls.md#finish-reason-and-message-semantics]
32. **Non-stream single-call envelope:** When snapshot has one call, non-stream response sets `content:null`, emits that call as `tool_calls:[…]` (preferred) or `function_call`, and `finish_reason:"tool_calls"`. [Source: docs/codex-proxy-tool-calls.md#non-streaming-detection--flow]
33. **Sequential multi-call (parallel off):** With parallel disabled, sequential multiple tool calls within a turn still serialize in order with cumulative args and `finish_reason:"tool_calls"`. [Source: docs/codex-proxy-tool-calls.md#behavioral-notes]
34. **Normalizer stability:** Normalization keeps first-seen→placeholder mapping stable across runs and ignores insignificant whitespace while preserving raw byte artifacts. [Source: docs/openai-endpoint-golden-parity.md]
35. **Secrets redaction:** Uploaded artifacts/logs redact API keys, OAuth tokens, cookies, and Authorization headers; tests fail if secret patterns leak. [Source: docs/app-server-migration/codex-completions-api-migration.md]
36. **Backend stderr separation:** CI uploads backend stderr separately; no stderr lines may appear inside SSE data frames. [Source: docs/architecture.md#implementation-patterns]
37. **Fixture matrix:** Run fixtures against proto and app-server v2 under `PROXY_STOP_AFTER_TOOLS=true|false`; parity must hold for each matrix cell. [Source: docs/openai-endpoint-golden-parity.md]
38. **Timeout budgets:** Per-test timeouts enforced (integration ≤30s, E2E ≤2m) with failures clearly reporting budget breaches. [Source: docs/test-design-epic-2.md#risk-register]
39. **Structured→XML synthesis proof:** Fixtures with structured Codex deltas (e.g., `localSearch`) must show streaming SSE includes exactly one content delta containing the synthesized `<use_tool>` block, followed by `finish_reason:"tool_calls"` and `[DONE]`. [Source: docs/codex-proxy-tool-calls.md#streaming-detection--flow]
40. **Textual passthrough proof:** Fixtures with literal `<use_tool>` text must show both streaming and non-stream outputs forward the block unchanged (tail stripped). [Source: docs/codex-proxy-tool-calls.md#textual-fallback-detection]
41. **Obsidian loop smoke:** Run the actual Obsidian Copilot prompt: verify the proxy emits XML, Copilot sends a new turn with tool results, and the proxy resumes normal assistant output without stripping earlier XML from history. [Source: docs/app-server-migration/codex-completions-api-migration.md]
42. **Single-tool-per-turn guard:** With `PROXY_STOP_AFTER_TOOLS=true`, assert only one `<use_tool>` block occurs per assistant turn even if backend requests multiple. [Source: docs/codex-proxy-tool-calls.md#handler-integration-contracts-for-later-stories]

## Tasks / Subtasks

- [ ] **Fixtures & helpers (AC #1, #7-#42)**
  - [ ] Capture deterministic structured/textual transcripts with README + normalization rules (volatile stripping, placeholder IDs, whitespace-insensitive comparisons). [Source: docs/codex-proxy-tool-calls.md#tests--smoke-scripts]
  - [ ] Implement SSE parsers/normalizers that tag frames, drop heartbeats, coalesce per-call deltas, enforce ordering/single-finish invariants, and support throttled sockets + sequential multi-call fixtures. [Source: docs/test-design-epic-2.md#test-strategy-summary]

- [ ] **Integration suite (AC #2, #7-#42)**
  - [ ] Add coverage for large args, UTF-8, multi-choice isolation, no-mixed-frames, role-first-once, default choice routing, function→tool_calls migration, finish-reason precedence, single/multi-call envelopes (obsidian vs openai modes), sequential multi-call (parallel off), ordering invariant, secret-redaction guards, and structured→XML / textual passthrough assertions. [Source: docs/test-design-epic-2.md#risk-register]

- [ ] **E2E/Playwright (AC #3, #10-#42)**
  - [ ] Run structured/textual fixtures through streaming/non-stream endpoints across the proto/app-server × stop-policy matrix, asserting XML emission, textual passthrough, parity, precedence, ordering, disconnect leak guard, and stderr separation. Include Obsidian smoke workflow (tool call + mock tool result turn). [Source: docs/openai-endpoint-golden-parity.md]

- [ ] **Smoke scripts (AC #4, #12, #14, #16, #19-#42)**
  - [ ] Add structured + Obsidian textual cases, disconnect + throttled stream modes, sequential multi-call checks, explicit verdicts (role-first, single-finish, redaction), and artifact pointers. [Source: docs/codex-proxy-tool-calls.md#tests--smoke-scripts]

- [ ] **CI wiring (AC #5, #17-#42)**
  - [ ] Expand CI matrix (Node LTS × OS plus parallel-flag leg), gate merges on parity/precedence suites, upload raw + normalized SSE and separate stderr logs on failure, enforce per-test timeout budgets, and run the proto/app-server × stop-policy matrix for XML/parity tests. [Source: docs/openai-endpoint-golden-parity.md]

- [ ] **Documentation (AC #6, #9-#42)**
  - [ ] Document normalization rules, heartbeat expectations, disconnect/error semantics, parity workflow, redaction policies, and artifact locations in test design + runbooks. [Source: docs/app-server-migration/codex-completions-api-migration.md]

## Dev Notes

- Stories 2.8 (ToolCallAggregator) and 2.9 (handler wiring) deliver functionality; this story provides deterministic regression evidence demanded by FR013/FR017 before production cutover. [Source: docs/PRD.md#functional-requirements]
- Parity + artifact requirements derive from `docs/openai-endpoint-golden-parity.md` and `docs/codex-proxy-tool-calls.md`; keep fixtures stable and redacted.

## References

- docs/epics.md#story-210-tool-call-regression-and-smoke-coverage
- docs/PRD.md#functional-requirements
- docs/codex-proxy-tool-calls.md
- docs/test-design-epic-2.md
- docs/openai-endpoint-golden-parity.md
- docs/app-server-migration/codex-completions-api-migration.md
- docs/architecture.md
- docs/bmad/architecture/coding-standards.md
- stories/2-9-stream-and-nonstream-tool-calls.md

## Dev Agent Record

### Context Reference
<!-- Story context XML path will be recorded by story-context workflow -->

### Agent Model Used
codex-5 (planned)

### Debug Log References
- _To be added after implementation._

### Completion Notes List
- _To be updated once development is complete._

### File List
- _To be updated once development is complete._
