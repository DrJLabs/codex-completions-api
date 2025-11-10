# Story 2.10: Tool-call regression and smoke coverage

Status: drafted

## Story

As a QA engineer,
I want automated regression and smoke coverage for structured and textual tool-call flows,
so that Obsidian Copilot and other clients can rely on deterministic tool_calls/function_call behavior across streaming and non-streaming modes.

## Acceptance Criteria

Traceability baseline: All criteria originate from Epic 2 scope and the authoritative parity spec. [Source: docs/epics.md#story-210-tool-call-regression-and-smoke-coverage; docs/tech-spec-epic-2.md#acceptance-criteria-authoritative]

1. **Deterministic fixtures:** Seed-pinned fixtures for structured JSON-RPC events (function_call → arguments.delta/done) and textual `<use_tool>` fallbacks live under `tests/e2e/fixtures/tool-calls/`. [Source: docs/epics.md#story-210-tool-call-regression-and-smoke-coverage; docs/tech-spec-epic-2.md#test-strategy-summary; docs/codex-proxy-tool-calls.md#tests--smoke-scripts]
2. **Integration tests:** Streaming + non-stream integration tests assert role order, cumulative arguments, single finish chunk, `[DONE]`, and `finish_reason:"tool_calls"` for structured/textual flows. [Source: docs/tech-spec-epic-2.md#test-strategy-summary; docs/test-design-epic-2.md#risk-register]
3. **E2E/Playwright coverage:** `/v1/chat/completions` streaming/non-streaming Playwright specs validate tail suppression and finish semantics using the fixtures. [Source: docs/tech-spec-epic-2.md#test-strategy-summary; docs/test-design-epic-2.md#test-strategy-summary]
4. **Obsidian Copilot smoke:** `scripts/smoke/dev|prod` include authenticated structured + textual tool-call checks (stop policy, finish reason, textual stripping). [Source: docs/codex-proxy-tool-calls.md#tests--smoke-scripts]
5. **CI wiring:** `npm run test:integration`, `npm test`, and smoke scripts execute in CI and block merges on failure. [Source: docs/openai-endpoint-golden-parity.md#9-implementation-checklist-for-openai-compatible-proxies]
6. **Docs:** `docs/test-design-epic-2.md`, migration docs, and smoke runbooks describe tool-call verification steps, fixtures, and commands. [Source: docs/codex-proxy-tool-calls.md#next-steps-implementation-checklist; docs/app-server-migration/codex-completions-api-migration.md#k-parity-fixture-maintenance-workflow]
7. **Large-args regression:** ≥8KB tool-call arguments maintain UTF-8 cumulative integrity (no broken characters). [Source: docs/codex-proxy-tool-calls.md#behavioral-notes]
8. **Multi-choice parity:** Multiple-choice scenarios confirm independent role chunks, deltas, finish chunks, and non-stream envelopes per choice. [Source: docs/codex-proxy-tool-calls.md#behavioral-notes]
9. **Golden determinism & normalization:** Fixtures/assertions normalize volatile fields while preserving ordering, IDs, cumulative arguments, role-first, single finish, and `[DONE]`. [Source: docs/openai-endpoint-golden-parity.md#8-golden-transcripts-copy-ready]
10. **SSE heartbeat tolerance:** Tests ignore comment heartbeat frames and assert non-stream responses never contain heartbeats. [Source: docs/architecture.md#implementation-patterns]
11. **Post-finish drop assertion:** Streaming fails if any assistant/content/tool frame appears after the canonical finish chunk plus `[DONE]`. [Source: docs/codex-proxy-tool-calls.md#finish-reason-and-message-semantics]
12. **Client disconnect smoke:** Smoke test closes the client after the first `delta.tool_calls` and verifies the server stops emitting, frees resources, and subsequent requests stay clean. [Source: docs/architecture.md#implementation-patterns]
13. **Backend error paths:** Tests cover backend errors before the first tool-call delta (expect error response) and after the first tool-call delta (expect canonical finish then close). [Source: docs/codex-proxy-tool-calls.md#handler-integration-contracts-for-later-stories]
14. **Parallel calls policy:** With `PROXY_ENABLE_PARALLEL_TOOL_CALLS=false`, assert single-call per turn; when true, validate multiple tool_calls occur in order with independent cumulative args. [Source: docs/codex-proxy-tool-calls.md#config-declared-used-by-handlers-later]
15. **UTF-8/multibyte resilience:** Streaming cumulative arguments never split multibyte boundaries. [Source: docs/codex-proxy-tool-calls.md#behavioral-notes]
16. **Obsidian textual parity:** Textual fallback tests reuse the Obsidian agent prompt and assert tail stripping after the last textual block. [Source: docs/codex-proxy-tool-calls.md#textual-fallback-detection]
17. **Performance budget:** Integration tests finish ≤30s each, E2E ≤2 min, or are marked `@slow` and excluded from default `npm test`. [Source: docs/PRD.md#functional-requirements; docs/test-design-epic-2.md#risk-register]
18. **Triage artifacts:** CI uploads raw SSE transcript, normalized transcript, final JSON, and server logs on failure. [Source: docs/openai-endpoint-golden-parity.md#9-implementation-checklist-for-openai-compatible-proxies]
19. **No mixed frames:** No `data:` frame contains both assistant content and `delta.tool_calls`. [Source: docs/codex-proxy-tool-calls.md#streaming-detection--flow]
20. **Role-first exactly once:** Exactly one `delta.role:"assistant"` per choice and it precedes content/tool-call deltas. [Source: docs/codex-proxy-tool-calls.md#streaming-detection--flow]
21. **Choice routing/isolation:** Events lacking a choice index default to choice 0; for `n>1`, each choice maintains isolated role/tool/final frames. [Source: docs/codex-proxy-tool-calls.md#behavioral-notes]
22. **Function→tool_calls migration:** If backend emits `function_call` then `tool_calls[]`, the final envelope prefers `tool_calls[]`, sets `content:null`, and `finish_reason:"tool_calls"`. [Source: docs/codex-proxy-tool-calls.md#finish-reason-and-message-semantics]
23. **Deterministic ID normalization:** Normalization maps variable tool IDs to stable placeholders (`tool_<choice>_<ordinal>`) while preserving names and cumulative arguments. [Source: docs/openai-endpoint-golden-parity.md#8-golden-transcripts-copy-ready]
24. **Backpressure/coalescing:** Under throttled sockets, rapid updates per call id coalesce into a single outbound chunk containing the latest cumulative arguments. [Source: docs/architecture.md#implementation-patterns]
25. **Heartbeat rules:** Streaming parsers ignore comment frames but still validate data-frame order; non-stream responses never include heartbeat artifacts. [Source: docs/architecture.md#implementation-patterns]
26. **Disconnect leak guard:** Disconnect smoke verifies all resources/listeners return to baseline after client close. [Source: docs/architecture.md#implementation-patterns]
27. **Finish-reason precedence:** If any tool/function call exists, finish_reason must be `"tool_calls"` even when length, stop, or content_filter signals also occur. Tests cover tool_calls vs length/stop/content_filter precedence. [Source: docs/codex-proxy-tool-calls.md#finish-reason-and-message-semantics]
28. **Non-stream multi-call envelope:** When snapshot contains >1 calls, `message.tool_calls[]` includes all calls (ordered), `content:null`, `finish_reason:"tool_calls"`. [Source: docs/codex-proxy-tool-calls.md#non-streaming-detection--flow]
29. **Stream ↔ non-stream parity:** Given the same fixture, streaming and non-stream endpoints yield equivalent normalized sequences/envelopes. [Source: docs/openai-endpoint-golden-parity.md#8-golden-transcripts-copy-ready]
30. **Ordering invariant:** Per choice the frame order is `role` → (optional pre-tool content) → `delta.tool_calls` (cumulative) → single finish chunk → `[DONE]`. [Source: docs/codex-proxy-tool-calls.md#streaming-detection--flow]
31. **Single-finish invariant:** Exactly one finish chunk per choice in streaming and one final envelope per choice in non-stream. [Source: docs/codex-proxy-tool-calls.md#finish-reason-and-message-semantics]
32. **Non-stream single-call envelope:** When snapshot has one call, non-stream response sets `content:null`, emits that call as `tool_calls:[…]` (preferred) or `function_call`, and `finish_reason:"tool_calls"`. [Source: docs/codex-proxy-tool-calls.md#non-streaming-detection--flow]
33. **Sequential multi-call (parallel off):** With parallel disabled, sequential multiple tool calls within a turn still serialize in order with cumulative args and `finish_reason:"tool_calls"`. [Source: docs/codex-proxy-tool-calls.md#behavioral-notes]
34. **Normalizer stability:** Normalization keeps first-seen→placeholder mapping stable across runs and ignores insignificant whitespace while preserving raw byte artifacts. [Source: docs/openai-endpoint-golden-parity.md#8-golden-transcripts-copy-ready]
35. **Secrets redaction:** Uploaded artifacts/logs redact API keys, OAuth tokens, cookies, and Authorization headers; tests fail if secret patterns leak. [Source: docs/app-server-migration/codex-completions-api-migration.md#k-parity-fixture-maintenance-workflow]
36. **Backend stderr separation:** CI uploads backend stderr separately; no stderr lines may appear inside SSE data frames. [Source: docs/architecture.md#implementation-patterns]
37. **Fixture matrix:** Run fixtures against proto and app-server v2 under `PROXY_STOP_AFTER_TOOLS=true|false`; parity must hold for each matrix cell. [Source: docs/openai-endpoint-golden-parity.md#9-implementation-checklist-for-openai-compatible-proxies]
38. **Timeout budgets:** Per-test timeouts enforced (integration ≤30s, E2E ≤2m) with failures clearly reporting budget breaches. [Source: docs/test-design-epic-2.md#risk-register]
39. **Structured→XML synthesis proof:** Fixtures with structured Codex deltas (e.g., `localSearch`) must show streaming SSE includes exactly one content delta containing the synthesized `<use_tool>` block, followed by `finish_reason:"tool_calls"` and `[DONE]`. [Source: docs/codex-proxy-tool-calls.md#streaming-detection--flow]
40. **Textual passthrough proof:** Fixtures with literal `<use_tool>` text must show both streaming and non-stream outputs forward the block unchanged (tail stripped). [Source: docs/codex-proxy-tool-calls.md#textual-fallback-detection]
41. **Obsidian loop smoke:** Run the actual Obsidian Copilot prompt: verify the proxy emits XML, Copilot sends a new turn with tool results, and the proxy resumes normal assistant output without stripping earlier XML from history. [Source: docs/app-server-migration/codex-completions-api-migration.md#f-conversation-lifecycle]
42. **Single-tool-per-turn guard:** With `PROXY_STOP_AFTER_TOOLS=true`, assert only one `<use_tool>` block occurs per assistant turn even if backend requests multiple. [Source: docs/codex-proxy-tool-calls.md#handler-integration-contracts-for-later-stories]

## Tasks / Subtasks

- [ ] **Traceability & planning (AC #1-#6)** Align acceptance criteria with upstream docs before implementation. [Source: docs/epics.md#story-210-tool-call-regression-and-smoke-coverage]
  - [ ] Map each AC to the relevant anchors in `docs/tech-spec-epic-2.md`, `docs/PRD.md`, and this story, updating the shared tracker. [Source: docs/tech-spec-epic-2.md#test-strategy-summary]
  - [ ] Confirm migration/runbook docs expose the anchors referenced here; create stubs where needed. [Source: docs/app-server-migration/codex-completions-api-migration.md#k-parity-fixture-maintenance-workflow]
  - [ ] Update `docs/sprint-status.yaml` when this story changes states to keep automation accurate. [Source: docs/epics.md#story-210-tool-call-regression-and-smoke-coverage]

- [ ] **Structured fixtures (AC #1, #7-#15, #39)** Capture canonical JSON-RPC transcripts from proto + app-server. [Source: docs/codex-proxy-tool-calls.md#tests--smoke-scripts]
  - [ ] Generate deterministic structured transcripts for each tool family with placeholder substitution logs. [Source: docs/openai-endpoint-golden-parity.md#8-golden-transcripts-copy-ready]
  - [ ] Store fixture metadata (model, stop policy, backend, environment) under `tests/e2e/fixtures/tool-calls/*.json`. [Source: docs/tech-spec-epic-2.md#test-strategy-summary]
  - [ ] Document fixture provenance, redaction rules, and regeneration commands inside the fixtures README. [Source: docs/app-server-migration/codex-completions-api-migration.md#k-parity-fixture-maintenance-workflow]

- [ ] **Textual fixtures & large-arg cases (AC #7, #16, #40)** Extend fixtures to cover textual fallbacks and 8KB+ payloads. [Source: docs/codex-proxy-tool-calls.md#textual-fallback-detection]
  - [ ] Capture literal `<use_tool>` traces with UTF-8 multi-byte characters plus tail-stripping expectations. [Source: docs/codex-proxy-tool-calls.md#behavioral-notes]
  - [ ] Add regression data proving cumulative arguments remain valid JSON after every chunk. [Source: docs/openai-endpoint-golden-parity.md#8-golden-transcripts-copy-ready]

- [ ] **Normalizer & tooling (AC #9, #19-#35)** Build reusable diff helpers for SSE + non-stream envelopes. [Source: docs/openai-endpoint-golden-parity.md#8-golden-transcripts-copy-ready]
  - [ ] Implement frame tagging (role/content/tool/done) with validation that enforces ordering + finish invariants. [Source: docs/codex-proxy-tool-calls.md#streaming-detection--flow]
  - [ ] Add ID-placeholder mapping utilities with stable seed + deterministic redaction. [Source: docs/openai-endpoint-golden-parity.md#8-golden-transcripts-copy-ready]
  - [ ] Provide CLI to diff proto vs app-server outputs and emit JSON + markdown artifacts for CI uploads. [Source: docs/openai-endpoint-golden-parity.md#9-implementation-checklist-for-openai-compatible-proxies]

- [ ] **Integration suite – streaming (AC #2, #10-#33)** Expand Vitest coverage for streaming-only invariants. [Source: docs/test-design-epic-2.md#risk-register]
  - [ ] Assert heartbeat filtering, post-finish drops, and disconnect cleanup logic using deterministic transport shim. [Source: docs/architecture.md#implementation-patterns]
  - [ ] Cover role-first ordering, cumulative `delta.tool_calls`, and single finish chunk semantics for `n=1` and `n>1`. [Source: docs/codex-proxy-tool-calls.md#streaming-detection--flow]
  - [ ] Validate `PROXY_ENABLE_PARALLEL_TOOL_CALLS` toggles, ensuring sequential fallback path remains deterministic. [Source: docs/codex-proxy-tool-calls.md#config-declared-used-by-handlers-later]

- [ ] **Integration suite – non-stream & multi-choice (AC #2, #21-#34)** Ensure JSON envelopes obey parity rules. [Source: docs/tech-spec-epic-2.md#test-strategy-summary]
  - [ ] Verify content-null + `tool_calls[]` construction for single and multi-call responses, including openai-json vs obsidian-xml modes. [Source: docs/codex-proxy-tool-calls.md#non-streaming-detection--flow]
  - [ ] Confirm deterministic ID normalization and placeholder stability with golden snapshots. [Source: docs/openai-endpoint-golden-parity.md#8-golden-transcripts-copy-ready]

- [ ] **Integration suite – error & disconnect (AC #13, #24-#27, #36)** Reproduce backend failures mid-stream. [Source: docs/codex-proxy-tool-calls.md#handler-integration-contracts-for-later-stories]
  - [ ] Simulate errors before and after first tool-call delta to validate envelope differences. [Source: docs/codex-proxy-tool-calls.md#finish-reason-and-message-semantics]
  - [ ] Assert listeners + resources are freed post-disconnect and no SSE frames are emitted after `[DONE]`. [Source: docs/architecture.md#implementation-patterns]

- [ ] **E2E/Playwright – streaming (AC #3, #10-#33)** Run browser-level SSE tests. [Source: docs/test-design-epic-2.md#test-strategy-summary]
  - [ ] Cover XML synthesis, role-first delta, and finish chunk semantics under both proto and app-server backends. [Source: docs/codex-proxy-tool-calls.md#streaming-detection--flow]
  - [ ] Inject throttle + retry scenarios to ensure Playwright watchers keep pace with heartbeat cadence. [Source: docs/architecture.md#implementation-patterns]

- [ ] **E2E/Playwright – non-stream/perf (AC #3, #17, #28-#34)** Validate envelope + timing budgets. [Source: docs/test-design-epic-2.md#risk-register]
  - [ ] Assert non-stream responses honor `finish_reason:"tool_calls"`, include normalized tool calls, and exclude heartbeats. [Source: docs/codex-proxy-tool-calls.md#non-streaming-detection--flow]
  - [ ] Track wall-clock durations to fail tests exceeding documented budgets, flagging them `@slow` when required. [Source: docs/PRD.md#functional-requirements]

- [ ] **E2E/Playwright – disconnect & leak guard (AC #12, #26, #37)** Stress-client behavior around mid-stream closures. [Source: docs/architecture.md#implementation-patterns]
  - [ ] Drop the connection after first `delta.tool_calls` and ensure the server shuts down streaming loop promptly. [Source: docs/codex-proxy-tool-calls.md#handler-integration-contracts-for-later-stories]
  - [ ] Verify subsequent requests start clean with no leaked listeners or stray frames. [Source: docs/architecture.md#implementation-patterns]

- [ ] **Smoke scripts – structured (AC #4, #19-#32)** Extend `scripts/smoke/{dev,prod}.sh`. [Source: docs/codex-proxy-tool-calls.md#tests--smoke-scripts]
  - [ ] Add verdict output (role-first, finish reason, `[DONE]`), referencing saved fixture transcripts for parity. [Source: docs/openai-endpoint-golden-parity.md#9-implementation-checklist-for-openai-compatible-proxies]
  - [ ] Ensure scripts fail fast on mismatched tool-call ordering or missing finish chunks. [Source: docs/codex-proxy-tool-calls.md#streaming-detection--flow]

- [ ] **Smoke scripts – textual & disconnect (AC #4, #12, #16, #37)** Cover fallback XML + client close cases. [Source: docs/codex-proxy-tool-calls.md#textual-fallback-detection]
  - [ ] Reuse Obsidian prompt to validate textual `<use_tool>` passthrough and tail stripping. [Source: docs/app-server-migration/codex-completions-api-migration.md#f-conversation-lifecycle]
  - [ ] Add mode that cancels the request mid-stream, asserting cleanup logs plus optional `PROXY_KILL_ON_DISCONNECT`. [Source: docs/architecture.md#implementation-patterns]

- [ ] **CI matrix & gating (AC #5, #17-#38)** Keep pipelines aligned with production constraints. [Source: docs/openai-endpoint-golden-parity.md#9-implementation-checklist-for-openai-compatible-proxies]
  - [ ] Run matrix across Node LTS versions, OS variants, and `PROXY_ENABLE_PARALLEL_TOOL_CALLS` toggles. [Source: docs/test-design-epic-2.md#risk-register]
  - [ ] Fail builds unless parity, streaming, and smoke suites pass; wire results into GitHub required checks. [Source: docs/PRD.md#functional-requirements]
  - [ ] Gate merges on artifact upload success (transcripts, normalized JSON, backend stderr). [Source: docs/openai-endpoint-golden-parity.md#9-implementation-checklist-for-openai-compatible-proxies]

- [ ] **Artifact publishing (AC #18, #35-#36)** Automate evidence uploads. [Source: docs/app-server-migration/codex-completions-api-migration.md#k-parity-fixture-maintenance-workflow]
  - [ ] Capture raw SSE stream, normalized stream, final JSON, and stderr into predictable artifact folders. [Source: docs/openai-endpoint-golden-parity.md#8-golden-transcripts-copy-ready]
  - [ ] Redact secrets prior to upload and document the redaction filters. [Source: docs/app-server-migration/codex-completions-api-migration.md#k-parity-fixture-maintenance-workflow]

- [ ] **Performance budgets & @slow labeling (AC #17, #38)** Keep suites fast locally. [Source: docs/test-design-epic-2.md#risk-register]
  - [ ] Annotate long-running tests with `@slow` (excluded from default `npm test`) and document alternate commands. [Source: docs/PRD.md#functional-requirements]

- [ ] **Documentation – runbooks (AC #6, #35-#41)** Update operator references. [Source: docs/app-server-migration/codex-completions-api-migration.md#k-parity-fixture-maintenance-workflow]
  - [ ] Expand runbooks with new smoke commands, fixture locations, and troubleshooting tables. [Source: docs/openai-endpoint-golden-parity.md#9-implementation-checklist-for-openai-compatible-proxies]
  - [ ] Capture client-disconnect remediation steps and expected logs/screenshots. [Source: docs/architecture.md#implementation-patterns]

- [ ] **Documentation – architecture & test design (AC #6, #7-#9)** Keep strategy docs current. [Source: docs/tech-spec-epic-2.md#test-strategy-summary]
  - [ ] Update `docs/test-design-epic-2.md` risk matrix with new cases (parallel flag, textual fallback, disconnect). [Source: docs/test-design-epic-2.md#risk-register]
  - [ ] Append appendix to `docs/codex-proxy-tool-calls.md` describing normalization heuristics and placeholder grammar. [Source: docs/codex-proxy-tool-calls.md#tests--smoke-scripts]

- [ ] **Developer workflow & coding standards (AC #5, #33)** Keep contributions consistent. [Source: docs/bmad/architecture/coding-standards.md]
  - [ ] Ensure new helpers follow existing lint rules (ESM modules, 2-space indent) and add unit coverage under `tests/unit`. [Source: docs/tech-spec-epic-2.md#detailed-design]

- [ ] **Secrets & retention policy (AC #35)** Protect sensitive data. [Source: docs/app-server-migration/codex-completions-api-migration.md#k-parity-fixture-maintenance-workflow]
  - [ ] Verify fixture transcripts contain no Authorization headers, API keys, or customer data before publishing. [Source: docs/openai-endpoint-golden-parity.md#8-golden-transcripts-copy-ready]

## Dev Notes

### Architecture Patterns & Constraints
- Tool-call regression builds on handler wiring from Stories 2.8 and 2.9; preserve SSE header order, role-first deltas, and post-finish drop logic in `src/handlers/chat/stream.js`. [Source: stories/2-9-stream-and-nonstream-tool-calls.md; docs/architecture.md#implementation-patterns]
- Normalization helpers should live alongside existing parity scripts (`scripts/parity/*`) so both proto and app-server runs share logic. [Source: docs/openai-endpoint-golden-parity.md#9-implementation-checklist-for-openai-compatible-proxies]

### Project Structure Notes
- Fixture JSON lives under `tests/e2e/fixtures/tool-calls/`, smoke helpers in `scripts/smoke/`, and new docs inside `docs/` per repository layout guidance. [Source: docs/app-server-migration/codex-completions-api-migration.md#i-code-touch-points-typical-repo]
- Update `package.json` scripts when adding new parity or smoke commands so CI runners can invoke them consistently. [Source: docs/openai-endpoint-golden-parity.md#9-implementation-checklist-for-openai-compatible-proxies]

### Test & Artifact Guidance
- Deterministic transcripts, diff harnesses, and regression layering follow the Tech Spec Test Strategy and the test-design risk register; treat structured and textual flows as equally authoritative. [Source: docs/tech-spec-epic-2.md#test-strategy-summary; docs/test-design-epic-2.md#risk-register]
- CI evidence must attach normalized + raw SSE logs plus backend stderr to satisfy FR013/FR017 before cutover. [Source: docs/PRD.md#functional-requirements]
- Use budget-friendly tagging (`@slow`, matrix filters) so `npm test` stays fast while `npm run verify:all` exercises the full parity grid. [Source: docs/test-design-epic-2.md#risk-register]

### Learnings from Previous Story
- Story 2.9 is still `drafted`, so no completion notes exist yet; reuse its handler diagrams and acceptance criteria when constructing regression cases. [Source: stories/2-9-stream-and-nonstream-tool-calls.md]
- Monitor `docs/sprint-status.yaml` for when Story 2.9 moves to `ready-for-dev` or beyond, then import any review action items into this story's future "Learnings" updates. [Source: docs/sprint-status.yaml]

## References

- docs/epics.md#story-210-tool-call-regression-and-smoke-coverage
- docs/PRD.md#functional-requirements
- docs/tech-spec-epic-2.md#test-strategy-summary
- docs/tech-spec-epic-2.md#acceptance-criteria-authoritative
- docs/codex-proxy-tool-calls.md#tests--smoke-scripts
- docs/test-design-epic-2.md#risk-register
- docs/test-design-epic-2.md#test-strategy-summary
- docs/openai-endpoint-golden-parity.md#8-golden-transcripts-copy-ready
- docs/openai-endpoint-golden-parity.md#9-implementation-checklist-for-openai-compatible-proxies
- docs/app-server-migration/codex-completions-api-migration.md#k-parity-fixture-maintenance-workflow
- docs/app-server-migration/codex-completions-api-migration.md#f-conversation-lifecycle
- docs/architecture.md#implementation-patterns
- docs/bmad/architecture/coding-standards.md
- docs/sprint-status.yaml
- stories/2-9-stream-and-nonstream-tool-calls.md

## Change Log

- 2025-11-09: Added traceability links, expanded tasks, and detailed architecture/test guidance per story validation feedback.

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
