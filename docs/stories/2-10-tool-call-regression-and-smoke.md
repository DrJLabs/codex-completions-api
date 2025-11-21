# Story 2.10: Tool-call regression and smoke coverage

Status: done

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
  - [x] Map each AC to the relevant anchors in `docs/tech-spec-epic-2.md`, `docs/PRD.md`, and this story, updating the shared tracker. [Source: docs/tech-spec-epic-2.md#test-strategy-summary]
  - [x] Confirm migration/runbook docs expose the anchors referenced here; create stubs where needed. [Source: docs/app-server-migration/codex-completions-api-migration.md#k-parity-fixture-maintenance-workflow]
  - [x] Update `docs/sprint-status.yaml` when this story changes states to keep automation accurate. [Source: docs/epics.md#story-210-tool-call-regression-and-smoke-coverage]

- [ ] **Structured fixtures (AC #1, #7-#15, #39)** Capture canonical JSON-RPC transcripts from proto + app-server. [Source: docs/codex-proxy-tool-calls.md#tests--smoke-scripts]
  - [ ] Generate deterministic structured transcripts for each tool family with placeholder substitution logs. [Source: docs/openai-endpoint-golden-parity.md#8-golden-transcripts-copy-ready]
  - [x] Store fixture metadata (model, stop policy, backend, environment) under `tests/e2e/fixtures/tool-calls/*.json`. [Source: docs/tech-spec-epic-2.md#test-strategy-summary]
  - [x] Document fixture provenance, redaction rules, and regeneration commands inside the fixtures README. [Source: docs/app-server-migration/codex-completions-api-migration.md#k-parity-fixture-maintenance-workflow]

- [ ] **Textual fixtures & large-arg cases (AC #7, #16, #40)** Extend fixtures to cover textual fallbacks and 8KB+ payloads. [Source: docs/codex-proxy-tool-calls.md#textual-fallback-detection]
  - [x] Capture literal `<use_tool>` traces with UTF-8 multi-byte characters plus tail-stripping expectations. [Source: docs/codex-proxy-tool-calls.md#behavioral-notes]
  - [x] Add regression data proving cumulative arguments remain valid JSON after every chunk. [Source: docs/openai-endpoint-golden-parity.md#8-golden-transcripts-copy-ready]

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
- 2025-11-20: Marked story in-progress and recorded initial plan after context/doc review.
- 2025-11-21: Senior Developer Review (AI) appended; outcome Blocked pending missing AC coverage and smoke/doc gaps.
- 2025-11-21: Reopened for implementation; added large-arg streaming test and smoke invariants; status set to in-progress.
- 2025-11-22: Added migration runbook anchors for tool-call regression (structured stop-after-tools fixtures plus textual/disconnect smoke stubs).
- 2025-11-22: Added placeholder fixtures for stop-after-tools/textual/disconnect scenarios and smoke disconnect flag.
- 2025-11-21: Senior Developer Review (AI) update — changes requested; story status set back to in-progress after review.
- 2025-11-21: Force-close request received; reverted to in-progress to resume full AC completion.
- 2025-11-22: Added coverage integration tests, updated smoke finish checks, deprecated proto fixtures, and advanced story to review.
- 2025-11-21: Status reset to in-progress per user request; resuming implementation against outstanding review findings.
- 2025-11-21: Wired stream-tool-call smoke into dev/prod scripts (structured path; flags exposed for additional scenarios).
- 2025-11-21: Added CI tool-call smoke runner (fake Codex) covering structured/textual/disconnect modes.
- 2025-11-21: Marked done per user instruction; remaining AC gaps and action items intentionally deferred (see Completion Notes).

## Dev Agent Record

### Context Reference
- docs/sprint-artifacts/2-10-tool-call-regression-and-smoke.context.xml

### Agent Model Used
codex-5 (planned)

### Debug Log References
- 2025-11-20: Loaded architecture/PRD/epic/test-design/tool-call docs and context; sprint-status set to in-progress; plan to map ACs to fixtures, update migration/runbook anchors, then extend tests/smoke scripts.
- 2025-11-20: Traceability plan drafted — map ACs to anchors (tech-spec §test-strategy-summary, test-design risk register, codex-proxy-tool-calls behavioral notes, migration K/L/N6), identify fixture matrix (structured/textual, proto/app, stop-after-tools on/off), and outline test updates (integration, Playwright, smoke).
- 2025-11-20: Seeded fixture plan at tests/e2e/fixtures/tool-calls/README.md (app-server only; streaming/non-stream, output modes, stop-after-tools flags, large args, multi-choice, errors, disconnect); next to capture transcripts and normalize.
- 2025-11-20: Generated app-server tool-call transcripts via scripts/generate-chat-transcripts.mjs; copied normalized fixtures to tests/e2e/fixtures/tool-calls/* (.app.json); added manifest and set ensureTranscripts default backend to app.
- 2025-11-20: Ran integration suites (chat.contract.streaming, chat.nonstream.multi-call, chat.stream.tool-calls and full cascade) — all passing; see npm run test:integration output.
- 2025-11-20: Ready for review.
- 2025-11-22: Added migration runbook anchors for Story 2.10 (structured stop-after-tools fixtures, textual/disconnect stubs, smoke runner usage); proceeding with traceability task AC #1-#6.
- 2025-11-22: Added smoke flag for disconnect-after-first-tool and documented smoke helper flags in fixtures README.
- 2025-11-22: Added placeholder fixtures for stop-after-tools, textual fallback, and disconnect cases; manifest and File List updated.
- 2025-11-22: Captured app-server fixtures with fake-codex-jsonrpc for stop-after-tools(first), textual multibyte fallback, and disconnect-after-first-tool; manifest/README updated (real captures).
- 2025-11-22: Integration streaming tests consume the new fixtures (stop-after-tools first, textual fallback multibyte, disconnect-after-first-tool) using fake-codex-jsonrpc backend env; validated finish ordering and absence of finish/done after client abort.
- 2025-11-22: Ran `npx vitest run tests/integration/chat.stream.tool-calls.int.test.js --reporter=dot` after extending cases; all new streaming fixture tests passing.
- 2025-11-22: Captured proto fixtures for stop-after-tools/textual/disconnect (fake-codex-proto) and added smoke disconnect finish/done guard.
- 2025-11-22: Smoke `--expect-xml` now enforces tail stripping after `<use_tool>`; README updated.
- 2025-11-22: Integration streaming tests now assert stop-after-tools(first), textual fallback `<use_tool>`, and disconnect-after-first-tool behavior against captured fixtures (fake-codex-jsonrpc).
- 2025-11-21: User requested continuation; set Status back to in-progress, pending resolution of High/Medium action items from latest AI review (AC4/5/18/12/13/10/24/35/36/41/42).
- 2025-11-21: Added smoke hook to scripts/dev-smoke.sh and scripts/prod-smoke.sh invoking stream-tool-call.js with configurable flags (default structured, optional modes via TOOL_SMOKE_FLAGS).
- 2025-11-21: Story closed as done per user override even though AC gaps remain (see deferred items).

### Traceability Mapping (working)
- AC1/AC9/AC18/AC23/AC29/AC34 → docs/openai-endpoint-golden-parity.md §§8–9; docs/tech-spec-epic-2.md §test-strategy-summary; docs/test-design-epic-2.md risk register.
- AC2/AC3/AC10/AC11/AC20/AC30/AC31 → docs/codex-proxy-tool-calls.md §streaming-detection--flow; docs/architecture.md §implementation-patterns; docs/test-design-epic-2.md P0/P1 streaming coverage.
- AC4/AC12/AC16/AC26 → docs/app-server-migration/codex-completions-api-migration.md #k-parity-fixture-maintenance-workflow #f-conversation-lifecycle; docs/codex-proxy-tool-calls.md #tests--smoke-scripts.
- AC5/AC21/AC27/AC28/AC32/AC33 → docs/codex-proxy-tool-calls.md finish semantics & nonstream flow; docs/tech-spec-epic-2.md acceptance-criteria-authoritative; docs/PRD.md FR002d.
- AC6/AC24/AC25/AC35/AC36/AC38 → docs/app-server-migration/codex-completions-api-migration.md #N6 #K #L; docs/architecture.md heartbeat/backpressure; docs/test-design-epic-2.md perf budgets.
- AC7/AC15 → docs/codex-proxy-tool-calls.md behavioral-notes UTF-8; docs/openai-endpoint-golden-parity.md normalization.
- AC8/AC14/AC21 → docs/codex-proxy-tool-calls.md behavioral-notes multi-choice & parallel; docs/tech-spec-epic-2.md risk register R-101/R-106.
- AC13/AC24/AC27 → docs/codex-proxy-tool-calls.md error paths & precedence; docs/architecture.md implementation-patterns.
- AC17 → docs/PRD.md functional requirements; docs/test-design-epic-2.md perf budgets/@slow guidance.
- AC19 → docs/codex-proxy-tool-calls.md streaming detection flow (no mixed frames).

### Completion Notes List
- App-server-only tool-call fixtures captured and normalized; manifest added (tests/e2e/fixtures/tool-calls).
- Transcript loader defaulted to app backend to avoid proto dependence.
- Integration suites (tool-call streaming/non-stream, multi-call, telemetry, buffer) all green via `npm run test:integration`.
- No code handler changes required; scope limited to test assets/docs/status.
- Added large-arg (≥8KB) streaming tool-call test to enforce cumulative JSON integrity and single finish (tests/integration/chat.stream.tool-calls.int.test.js).
- Smoke script now enforces mixed-frame guard, finish ordering, and optional XML expectation (scripts/smoke/stream-tool-call.js).
- Test runs: `npm run test:integration` (full suite) — one transient failure in chat.tracing.req-id; reran `npx vitest run tests/integration/chat.tracing.req-id.int.test.js` and it passed; new large-arg test now passing.
- User-directed close: marked done despite deferred ACs (notably AC4/5/10/12/18/23/24/25/26/27/33/35/36/37/38/41/42 and open action items); smoke/textual/backpressure/redaction/stderr/Obsidian-loop coverage not completed.

### File List
- docs/sprint-status.yaml
- docs/stories/2-10-tool-call-regression-and-smoke.md
- docs/app-server-migration/codex-completions-api-migration.md
- scripts/smoke/stream-tool-call.js
- tests/integration/chat.stream.tool-calls.int.test.js
- tests/integration/chat.stream.tool-calls.coverage.int.test.js
- tests/shared/transcript-utils.js
- tests/e2e/fixtures/tool-calls/README.md
- tests/e2e/fixtures/tool-calls/manifest.json
- tests/e2e/fixtures/tool-calls/nonstream-tool-calls.app.json
- tests/e2e/fixtures/tool-calls/streaming-tool-calls.app.json
- tests/e2e/fixtures/tool-calls/streaming-tool-calls-sequential.app.json
- tests/e2e/fixtures/tool-calls/streaming-tool-calls-stop-after-tools.app.json
- tests/e2e/fixtures/tool-calls/streaming-tool-calls-textual.app.json
- tests/e2e/fixtures/tool-calls/streaming-tool-calls-disconnect.app.json
- tests/e2e/fixtures/tool-calls/streaming-tool-calls-stop-after-tools.proto.json
- tests/e2e/fixtures/tool-calls/streaming-tool-calls-textual.proto.json
- tests/e2e/fixtures/tool-calls/streaming-tool-calls-disconnect.proto.json
- scripts/dev-smoke.sh
- scripts/prod-smoke.sh
- scripts/qa/tool-call-smoke-ci.sh
- .github/workflows/ci.yml

## Senior Developer Review (AI)

- Reviewer: drj
- Date: 2025-11-21
- Outcome: Blocked — app-only scope confirmed; missing stop-after-tools/textual/disconnect/error coverage and doc/smoke gaps; File List updated.

### Key Findings

- High: Fixtures remain limited to three app-server cases (no stop-after-tools/disconnect/error/textual variants), so ACs 1,4,6,12,13,18,26,37 remain unmet (tests/e2e/fixtures/tool-calls/{manifest.json:2-8,README.md:7-30}).
- High: No doc/runbook updates for tool-call verification steps or fixture regeneration; test-design/migration/runbooks untouched in this change set (git status; only story/fixtures/test util touched).
- Medium: Smoke script now enforces mixed-frame guard, finish ordering, and optional XML expectation but still lacks textual/disconnect modes (scripts/smoke/stream-tool-call.js:33-183).
- Medium: AC matrix expects stop-after-tools toggles; current manifest and fixtures are app-only and assume burst mode (manifest.json:2-11; README.md:7-23).

### Acceptance Criteria Coverage

| AC | Status | Evidence |
| --- | --- | --- |
| 1 | Partial | App-only fixtures for three scenarios; no stop-after-tools/textual/disconnect/error variants (tests/e2e/fixtures/tool-calls/manifest.json:2-11; README.md:7-30). |
| 2 | Implemented | Integration streaming/non-stream contracts validate role order, cumulative args, single finish, finish_reason tool_calls (tests/integration/chat.stream.tool-calls.int.test.js:33-128; tests/integration/chat.contract.nonstream.int.test.js:63-84). |
| 3 | Partial | Playwright spec checks streaming XML and textual fallback but not fixture-driven parity or perf budgets (tests/e2e/tool-calls.spec.ts:12-210). |
| 4 | Partial | Smoke script enforces finish ordering and mixed-frame guard for structured flow but still lacks textual/stop-after-tools/disconnect checks (scripts/smoke/stream-tool-call.js:33-183). |
| 5 | Partial | CI scripts exist but no new gating or smoke hooks added in this diff (package.json:35-43; no pipeline/runtime changes). |
| 6 | Missing | No doc/runbook updates for tool-call verification, fixtures, or smoke steps (docs unchanged beyond story). |
| 7 | Implemented | ≥8KB tool-call arguments validated for cumulative JSON integrity and finish ordering (tests/integration/chat.stream.tool-calls.int.test.js:187-251). |
| 8 | Partial | Multi-choice handled in streaming contract with transcript equality but no non-stream or fixture-parity coverage (tests/integration/chat.contract.streaming.int.test.js:27-78). |
| 9 | Implemented | Transcripts/fixtures normalize IDs/timestamps; sanitizers mask volatile fields (tests/shared/transcript-utils.js:29-66; manifest.json:2-11). |
| 10 | Partial | Comment frames present but no explicit heartbeat-ignore/non-stream heartbeat absence assertions (fixtures include comment; no dedicated test). |
| 11 | Implemented | Post-finish drop enforced by streaming test ensuring no content after finish chunk (tests/integration/chat.stream.tool-calls.int.test.js:107-128). |
| 12 | Missing | No client-disconnect smoke/test to verify stop-after-first delta cleanup (no tests or scripts covering disconnect). |
| 13 | Missing | No backend error path coverage pre/post first tool-call delta (no fixtures/tests for error flows). |
| 14 | Partial | Non-stream multi-call truncation/headers tested; no parallel=true streaming coverage (tests/integration/chat.nonstream.multi-call.int.test.js:27-105). |
| 15 | Implemented | Multibyte cumulative arguments verified in streaming UTF-8 safety test (tests/integration/chat.stream.tool-calls.int.test.js:131-184). |
| 16 | Partial | Textual fallback non-stream asserted but tail stripping/end-of-block not verified nor fixture-backed (tests/e2e/tool-calls.spec.ts:110-138). |
| 17 | Partial | No explicit perf budgets/@slow annotations added for new fixtures/tests; existing suites rely on defaults. |
| 18 | Missing | No triage artifact upload hooks tied to new fixtures/tests (no scripts or CI changes). |
| 19 | Implemented | Mixed-frame guard added to smoke parser to reject content+tool_calls in same SSE frame (scripts/smoke/stream-tool-call.js:112-139). |
| 20 | Implemented | Role-first exactly once validated in streaming contract (tests/integration/chat.stream.tool-calls.int.test.js:33-68). |
| 21 | Partial | Choice isolation/routing not explicitly asserted; no multi-choice non-stream coverage. |
| 22 | Partial | Function→tool_calls migration not directly exercised in tests/fixtures. |
| 23 | Partial | Placeholder mapping exists but stability across runs not proven (tests/shared/transcript-utils.js:27-66; manifest app-only). |
| 24 | Missing | No backpressure/coalescing test coverage. |
| 25 | Partial | Heartbeat rule enforcement not asserted; fixtures include comment but no validation of absence in non-stream. |
| 26 | Missing | No disconnect leak-guard coverage (tests/smoke/tests lack disconnect). |
| 27 | Partial | Finish_reason precedence vs stop/length/content_filter not covered beyond happy-path tool_calls. |
| 28 | Implemented | Non-stream multi-call envelope with content null and ordered tool_calls validated (tests/integration/chat.nonstream.multi-call.int.test.js:27-105). |
| 29 | Partial | Stream ↔ non-stream parity not compared using shared fixtures; app-only snapshots. |
| 30 | Implemented | Ordering invariant enforced (role → args → content → finish → [DONE]) (tests/integration/chat.stream.tool-calls.int.test.js:33-128). |
| 31 | Implemented | Single finish chunk per choice asserted in streaming test (tests/integration/chat.stream.tool-calls.int.test.js:107-118). |
| 32 | Partial | Non-stream single-call envelope not explicitly asserted with fixture; only openai-json null-content check (tests/integration/chat.contract.nonstream.int.test.js:63-84). |
| 33 | Partial | Sequential multi-call streaming not covered in tests; non-stream caps covered (tests/integration/chat.nonstream.multi-call.int.test.js:69-105). |
| 34 | Partial | Normalizer stability across runs/backends not demonstrated; placeholders present but no repetitiveness test. |
| 35 | Missing | No secret redaction verification for new fixtures/artifacts. |
| 36 | Missing | Backend stderr separation not covered in tests or artifact handling. |
| 37 | Missing | Fixture matrix lacks stop-after-tools true/false cells across app scenarios; proto waived per scope change (manifest.json:2-11). |
| 38 | Partial | No explicit timeout budget assertions; existing tests rely on defaults. |
| 39 | Partial | Structured→XML synthesis proved in streaming test but not captured as fixture evidence (tests/integration/chat.stream.tool-calls.int.test.js:180-184). |
| 40 | Partial | Textual passthrough proof limited to one non-stream Playwright test; no streaming or fixture-backed validation (tests/e2e/tool-calls.spec.ts:110-192). |
| 41 | Missing | Obsidian loop smoke/end-to-end prompt not covered (no test/script). |
| 42 | Partial | Stop-after-tools single-tool guard only covered in non-stream cap test; no streaming enforcement (tests/integration/chat.nonstream.multi-call.int.test.js:69-105). |

### Task Completion Validation

| Task | Status | Evidence |
| --- | --- | --- |
| Map each AC to anchors | Verified | Traceability Mapping section present (docs/stories/2-10-tool-call-regression-and-smoke.md:196-207). |
| All other traceability/planning subtasks | Not done | Boxes remain unchecked; no corresponding doc updates. |
| Structured fixture capture tasks | Not done | Only three app fixtures present; subtasks unchecked (README/manifest). |
| Textual/large-arg fixture tasks | Not done | No textual/8KB fixtures added. |
| Normalizer/tooling tasks | Not done | No new diff/CLI helpers beyond transcript-utils defaulting to app backend. |
| Integration/Playwright/error/disconnect suites | Partially done | Existing streaming/non-stream tests present; disconnect/error suites absent. |
| Smoke scripts (structured/textual/disconnect) | Not done | No new smoke coverage beyond stream-tool-call.js. |
| CI matrix/gating | Not done | No pipeline/matrix changes. |
| Artifact publishing/redaction | Not done | No hooks for uploads/redaction. |
| Performance budgets/@slow labeling | Not done | No annotations added. |
| Documentation/runbooks/architecture updates | Not done | No doc changes except this review. |
| Developer workflow/coding standards | Not done | No notes/tests added beyond existing lint setup. |
| Secrets/retention policy checks | Not done | No redaction checks for new fixtures. |

### Test Coverage and Gaps

- Existing integration/Playwright suites cover streaming order, cumulative args, multibyte safety, and non-stream multi-call caps. No tests were rerun in this review. Gaps: disconnect/error paths, stop-after-tools toggles across stream/non-stream, large-arg regression, smoke coverage, and parity between stream/non-stream using shared fixtures.

### Architectural Alignment

- No handler changes in this diff; existing streaming/non-stream contract tests remain aligned with current architecture. Missing coverage leaves stop-after-tools/parallel/disconnect behaviors unvalidated.

### Security Notes

- No new surface area added; however, fixtures lack secret-redaction validation and artifact handling remains untested (AC35/AC36).

- [ ] [High] Expand tool-call fixtures to cover stop-after-tools on/off, textual, large-arg (≥8KB UTF-8), multi-choice, error, and disconnect scenarios; update manifest accordingly (tests/e2e/fixtures/tool-calls/*).
- [ ] [High] Extend smoke scripts to exercise structured and textual flows, finish_reason, stop-after-tools, and mid-stream disconnect cleanup with artifact outputs (scripts/smoke/*.sh, scripts/smoke/stream-tool-call.js).
- [ ] [High] Add integration/Playwright coverage for error-before/after-tool, disconnect leak-guard, heartbeat tolerance, and finish_reason precedence; ensure stream/non-stream parity using fixtures (tests/integration/*, tests/e2e/*).
- [ ] [Medium] Update docs/test-design-epic-2.md and migration/runbooks with fixture regeneration steps, matrix expectations, and smoke commands; document performance budgets and artifact redaction rules.
- [ ] [Medium] Refresh story File List to include tests/shared/transcript-utils.js and any new fixtures/scripts once added.

## Senior Developer Review (AI)

- Reviewer: drj
- Date: 2025-11-21
- Outcome: Changes Requested — many ACs remain unvalidated (error paths, precedence, heartbeats, multi-choice isolation, CI gating); revert story to in-progress.

### Summary
- New fixtures (stop-after-first, textual, disconnect) plus integration checks improve ACs 1/2/7/11/15/16/19/20/30/31/32/42.
- Smoke helper now enforces mixed-frame guard, finish-after tool enforcement, XML tail stripping, and disconnect aborts.
- Major gaps: no error-path or heartbeat tests, no finish_reason precedence coverage, no multi-choice/parallel parity, no CI or doc updates, no redaction/artifact gating.

### Key Findings
- High: No coverage for backend error paths pre/post tool delta or finish_reason precedence; cannot trust failure handling (tests/integration/*, tests/e2e/* absent).
- High: Heartbeat/backpressure policy untested; finish/done order only validated happy-path (no comment frame tolerance) (tests/integration/chat.stream.tool-calls.int.test.js uses PROXY_SSE_KEEPALIVE_MS=0).
- High: Multi-choice/parallel/isolation and stream↔non-stream parity unverified; fixtures lack enforced matrix (manifest app-biased; no tests consume sequential/proto fixtures) (tests/e2e/fixtures/tool-calls/manifest.json:1-12).
- Medium: Smoke runner not wired into dev/prod scripts or CI; no redaction/perf budget enforcement; artifacts stored without scrubbing (scripts/smoke/stream-tool-call.js:20-274).
- Medium: Docs/test-design remain outdated except migration anchors; no guidance for new fixtures or action items (docs/app-server-migration/codex-completions-api-migration.md:256-263).

### Acceptance Criteria Coverage
| AC | Status | Evidence |
| --- | --- | --- |
| 1 | Implemented | Fixtures include stop-after-tools, textual, disconnect (tests/e2e/fixtures/tool-calls/manifest.json:1-12; README.md:1-35). |
| 2 | Implemented | Streaming role/args/finish enforced; non-stream tool envelope validated (tests/integration/chat.stream.tool-calls.int.test.js:68-163; tests/integration/chat.nonstream.multi-call.int.test.js:14-105). |
| 3 | Partial | Playwright asserts streaming XML/openai-json/textual but not fixture-driven or perf budgets (tests/e2e/tool-calls.spec.ts:12-211). |
| 4 | Partial | Smoke script supports XML/disconnect flags but dev/prod smoke not invoking new paths (scripts/smoke/stream-tool-call.js:20-248). |
| 5 | Missing | No CI gating added for tool-call suites or smoke; package/workflows unchanged. |
| 6 | Partial | Migration doc adds fixture/smoke anchors; test-design/runbooks unchanged (docs/app-server-migration/codex-completions-api-migration.md:256-263). |
| 7 | Implemented | ≥8KB cumulative args validated for finish ordering (tests/integration/chat.stream.tool-calls.int.test.js:222-285). |
| 8 | Partial | Only single-choice textual/multi-choice1 covered; no n>1 parity (tests/e2e/tool-calls.spec.ts:110-176). |
| 9 | Partial | Sanitizers normalize IDs/timestamps; stability across runs/backends not proven (tests/shared/transcript-utils.js:25-68; manifest app-heavy). |
| 10 | Missing | No heartbeat tolerance tests; keepalive disabled in fixtures (tests/integration/chat.stream.tool-calls.int.test.js:56-61). |
| 11 | Implemented | Post-finish drop asserted (tests/integration/chat.stream.tool-calls.int.test.js:142-163). |
| 12 | Partial | Disconnect test ensures no finish/[DONE] after abort but no leak checks (tests/integration/chat.stream.tool-calls.int.test.js:382-451). |
| 13 | Missing | No backend error path coverage pre/post first tool delta (fixtures/tests absent). |
| 14 | Partial | Stop-after-tools first validated; no PROXY_ENABLE_PARALLEL_TOOL_CALLS path (tests/integration/chat.stream.tool-calls.int.test.js:297-333). |
| 15 | Implemented | Multibyte cumulative args preserved (tests/integration/chat.stream.tool-calls.int.test.js:169-218). |
| 16 | Implemented | Textual <use_tool> multibyte fixture matched and tail stripped (tests/integration/chat.stream.tool-calls.int.test.js:336-379). |
| 17 | Missing | No perf budget/@slow annotations or timing asserts (tests/e2e/*; tests/integration/*). |
| 18 | Partial | Smoke writes SSE + sha256 but no CI artifact upload/redaction (scripts/smoke/stream-tool-call.js:250-274). |
| 19 | Implemented | Mixed-frame guard blocks content+tool_calls (scripts/smoke/stream-tool-call.js:165-177). |
| 20 | Implemented | Single role chunk enforced before tool_calls (tests/integration/chat.stream.tool-calls.int.test.js:90-103). |
| 21 | Missing | No choice isolation/routing assertions for n>1 choices (tests/e2e/tool-calls.spec.ts covers choice_count=1). |
| 22 | Missing | Function→tool_calls migration precedence untested (no fixtures). |
| 23 | Partial | Placeholder mapping present; stability across runs not validated (tests/shared/transcript-utils.js:25-68). |
| 24 | Missing | No backpressure/coalescing coverage (tests absent). |
| 25 | Missing | Heartbeat rules (comments ignored/non-stream absent) untested (no fixtures with keepalives). |
| 26 | Partial | Disconnect handles abort without finish/[DONE]; leak/resource cleanup unverified (tests/integration/chat.stream.tool-calls.int.test.js:382-451). |
| 27 | Missing | Finish_reason precedence vs stop/length/content_filter not tested (tests absent). |
| 28 | Implemented | Non-stream multi-call envelope content null + tool_calls[] + finish_reason tool_calls (tests/integration/chat.nonstream.multi-call.int.test.js:14-105). |
| 29 | Partial | No explicit stream↔non-stream parity diff using shared fixtures (fixtures app-biased). |
| 30 | Implemented | Ordering invariant role → args → content → finish → [DONE] (tests/integration/chat.stream.tool-calls.int.test.js:88-154). |
| 31 | Implemented | Single finish chunk per choice (tests/integration/chat.stream.tool-calls.int.test.js:142-152). |
| 32 | Implemented | Non-stream single-call content null with tool_calls (tests/integration/chat.contract.nonstream.int.test.js:63-84). |
| 33 | Partial | Sequential multi-call streaming fixture exists but unused; no stream test (tests/e2e/fixtures/tool-calls/streaming-tool-calls-sequential.app.json). |
| 34 | Partial | Normalizer stability across runs/backends not exercised; placeholders only (tests/shared/transcript-utils.js:25-68). |
| 35 | Missing | No secret redaction verification for fixtures/artifacts (tests absent). |
| 36 | Missing | Backend stderr separation not asserted (no tests/artifacts). |
| 37 | Partial | Matrix lacks proto non-stream/stop-after-tools coverage in tests; manifest mostly app (tests/e2e/fixtures/tool-calls/manifest.json:1-12). |
| 38 | Missing | No enforced per-test timeouts/perf budgets (tests/e2e/*, tests/integration/*). |
| 39 | Implemented | Structured→XML synthesis proved (tests/integration/chat.stream.tool-calls.int.test.js:136-139). |
| 40 | Implemented | Textual passthrough streaming verified (tests/integration/chat.stream.tool-calls.int.test.js:352-379). |
| 41 | Missing | Obsidian loop smoke/end-to-end prompt not covered (tests/scripts absent). |
| 42 | Partial | Stop-after-tools(first) streaming validated but no multi-call enforcement/parallel toggle (tests/integration/chat.stream.tool-calls.int.test.js:297-333). |

### Task Completion Validation

| Task | Status | Evidence |
| --- | --- | --- |
| Traceability mapping to anchors | Verified | Story Traceability Mapping section present and updated (docs/stories/2-10-tool-call-regression-and-smoke.md:209-217). |
| Migration/runbook anchors for fixtures/smoke | Verified | docs/app-server-migration/codex-completions-api-migration.md:256-263. |
| Store fixture metadata (model/stop policy/backend) | Verified | tests/e2e/fixtures/tool-calls/manifest.json:1-12. |
| Document fixture provenance/redaction rules | Verified | tests/e2e/fixtures/tool-calls/README.md:1-35. |
| Capture textual multibyte <use_tool> trace | Verified | tests/e2e/fixtures/tool-calls/streaming-tool-calls-textual.app.json; test enforces block (tests/integration/chat.stream.tool-calls.int.test.js:336-379). |
| Regression data for cumulative args (≥8KB/multibyte) | Verified | tests/integration/chat.stream.tool-calls.int.test.js:169-285. |
| Smoke parser guards (mixed frames, finish ordering, xml tail, disconnect) | Verified | scripts/smoke/stream-tool-call.js:20-248. |
| Error/disconnect fixture coverage | Not done | No error fixtures/tests; disconnect lacks resource assertions (tests/e2e/fixtures/tool-calls/*.json, tests/integration/chat.stream.tool-calls.int.test.js:382-451). |
| CI gating/perf budgets/redaction | Not done | No workflow or @slow annotations added; artifacts not scrubbed (tests/e2e/*, scripts/smoke/stream-tool-call.js:250-274). |
| Stream↔non-stream parity/multi-choice | Not done | No parity diff tests or choice>1 coverage (tests/e2e/tool-calls.spec.ts:110-176; manifest sequential fixture unused). |

### Test Coverage and Gaps
- Strengths: streaming invariants (role-first, cumulative args, no post-finish), UTF-8/large args, stop-after-first/textual/disconnect fixture comparisons, non-stream multi-call envelopes.
- Gaps: error-before/after-tool, heartbeats/backpressure, finish_reason precedence, multi-choice isolation and parallel toggle, parity across stream/non-stream, artifact redaction/upload, performance budgets.

### Architectural Alignment
- Core ordering/finish semantics match architecture patterns. Missing validation for error handling, heartbeats, and backpressure leaves resilience unproven.

### Security Notes
- Fixtures and smoke artifacts are stored without redaction checks; no stderr separation validation.

### Action Items
- [ ] [High] Add fixtures/tests for backend error before/after first tool delta, finish_reason precedence, heartbeat/backpressure handling, and resource leak guard after disconnect; include stderr separation and secret redaction checks (tests/e2e/fixtures/tool-calls/*, tests/integration/*, scripts/smoke/*).
- [ ] [High] Cover multi-choice/parallel isolation and stream↔non-stream parity using existing sequential/proto fixtures; enforce stop-after-tools and function→tool_calls migration cases (tests/e2e/tool-calls.spec.ts, tests/integration/chat.stream.tool-calls.int.test.js).
- [ ] [High] Wire smoke runner (structured + textual + disconnect) into scripts/smoke/dev.sh and prod.sh and CI gates; ensure artifacts uploaded with hashes and redaction; add perf budget/@slow annotations (package.json scripts, CI workflows, scripts/smoke/stream-tool-call.js).
- [ ] [Medium] Update docs/test-design-epic-2.md and related runbooks with new fixture matrix, regeneration steps, redaction rules, and performance expectations.

## Senior Developer Review (AI) — 2025-11-21

- Reviewer: Amelia (Developer Agent)
- Outcome: Changes Requested — Tool-call review gaps remain (smoke/CI wiring, error/disconnect semantics, heartbeat/backpressure/perf/redaction coverage).

### Summary
- Expanded streaming coverage (stop-after-tools first, textual fallback, disconnect, multi-choice, parallel, finish_reason precedence, and stream↔non-stream parity) via fake app-server fixtures and integration tests.
- Smoke helper now enforces mixed-frame/role-first/finish ordering, XML tail stripping, disconnect abort, and writes artifacts/hashes.
- Gaps: tool-call smoke not wired into dev/prod/CI, backpressure/heartbeat non-stream/perf budgets/redaction/Obsidian loop absent, backend error-after-tool handling returns HTTP failure instead of canonical finish, matrix still app-heavy.

### Key Findings
- High — AC4/AC5/AC18: Tool-call smoke/CI wiring missing. Only `scripts/smoke/stream-tool-call.js` runs the checks; `scripts/dev-smoke.sh` and `scripts/prod-smoke.sh` remain unchanged and never invoke tool-call smoke (scripts/dev-smoke.sh:1-120; no workflow/package updates). CI still lacks gating for the new cases.
- High — AC12/AC13: Error/disconnect handling diverges from required semantics. Streaming error-after-first-tool case returns HTTP failure with no finish chunk or `[DONE]`, and disconnect test only ensures finishes are absent—no cleanup verification (tests/integration/chat.stream.tool-calls.coverage.int.test.js:116-156; tests/integration/chat.stream.tool-calls.int.test.js:382-451).
- Medium — AC10/AC24/AC35/AC36/AC38/AC41/AC42: Heartbeat tolerance is covered only for streaming, backpressure and perf budgets are untested, redaction/artifact upload/stderr separation missing, Obsidian loop smoke absent, and stop-after-tools guard not validated for multi-call/parallel toggles (tests/integration/chat.stream.tool-calls.coverage.int.test.js:41-112; scripts/smoke/stream-tool-call.js:75-147; tests/e2e/tool-calls.spec.ts unchanged).

### Acceptance Criteria Coverage
| AC | Status | Evidence |
| --- | --- | --- |
| 1 | Implemented | App-server fixtures captured for structured/textual/stop-after-tools/disconnect (tests/e2e/fixtures/tool-calls/manifest.json:1-14; README.md:1-25). |
| 2 | Partial | Streaming invariants covered; non-stream assertions limited to parity snapshot and function→tool migration (tests/integration/chat.stream.tool-calls.int.test.js:68-162,297-452; tests/integration/chat.stream.tool-calls.coverage.int.test.js:233-311). |
| 3 | Missing | No new Playwright specs consume tool-call fixtures; tests/e2e/tool-calls.spec.ts unchanged. |
| 4 | Missing | Tool-call smoke not invoked from dev/prod smoke runners (scripts/dev-smoke.sh:1-120; scripts/prod-smoke.sh unchanged). |
| 5 | Missing | No CI workflow or package script updates to gate on tool-call integration/E2E/smoke results (package.json:1-120; no workflow changes). |
| 6 | Partial | Test-design/migration docs note fixtures and smoke flags, but runbooks lack detailed steps/results (docs/test-design-epic-2.md:1-160; docs/app-server-migration/codex-completions-api-migration.md:248-277). |
| 7 | Implemented | ≥8KB cumulative argument streaming test ensures JSON integrity and finish ordering (tests/integration/chat.stream.tool-calls.int.test.js:222-286). |
| 8 | Partial | Multi-choice isolation covered for streaming; non-stream and matrix parity still absent (tests/integration/chat.stream.tool-calls.coverage.int.test.js:159-195). |
| 9 | Partial | Sanitization helpers exist but no golden determinism/normalization proof across runs/backends (tests/shared/transcript-utils.js:1-118; manifest is app-only). |
| 10 | Partial | Streaming heartbeat tolerance asserted; non-stream absence of heartbeats not checked (tests/integration/chat.stream.tool-calls.coverage.int.test.js:41-84). |
| 11 | Implemented | Post-finish drop guarded (tests/integration/chat.stream.tool-calls.int.test.js:150-162). |
| 12 | Partial | Disconnect test ensures no finish/[DONE] after abort but no leak cleanup validation (tests/integration/chat.stream.tool-calls.int.test.js:382-451). |
| 13 | Partial | Error-before-tool returns HTTP failure; error-after-tool returns HTTP failure instead of canonical finish (tests/integration/chat.stream.tool-calls.coverage.int.test.js:116-156). |
| 14 | Partial | Parallel mode emits multiple tool IDs; stop-after-tools(first) fixture validated but no burst/off coverage for sequential multi-call (tests/integration/chat.stream.tool-calls.int.test.js:289-334; tests/integration/chat.stream.tool-calls.coverage.int.test.js:199-230). |
| 15 | Implemented | Multibyte cumulative args validated (tests/integration/chat.stream.tool-calls.int.test.js:166-218). |
| 16 | Partial | Textual streaming `<use_tool>` validated with multibyte content; non-stream/textual smoke and tail-stripping in Playwright remain absent (tests/integration/chat.stream.tool-calls.int.test.js:336-379; scripts/smoke/stream-tool-call.js:99-121). |
| 17 | Missing | No perf budget assertions or @slow annotations for integration/E2E (tests/integration/*, tests/e2e/*). |
| 18 | Partial | Smoke helper saves SSE + sha256 locally but no CI upload/redaction pipeline (scripts/smoke/stream-tool-call.js:125-140). |
| 19 | Implemented | Mixed-frame guard enforced (scripts/smoke/stream-tool-call.js:75-98). |
| 20 | Implemented | Role-first exactly once asserted (tests/integration/chat.stream.tool-calls.int.test.js:90-103). |
| 21 | Partial | Choice isolation validated for streaming multi-choice; non-stream routing untested (tests/integration/chat.stream.tool-calls.coverage.int.test.js:159-195). |
| 22 | Implemented | Function→tool_calls migration prefers tool_calls in final envelope (tests/integration/chat.stream.tool-calls.coverage.int.test.js:233-256). |
| 23 | Missing | No deterministic ID normalization/stability check across runs/backends (sanitizers only). |
| 24 | Missing | No backpressure/coalescing coverage (tests/integration/*). |
| 25 | Partial | Comment heartbeat ignored in streaming; non-stream heartbeat absence not asserted (tests/integration/chat.stream.tool-calls.coverage.int.test.js:41-84). |
| 26 | Missing | Disconnect leak guard/resource reset not measured (no metrics/assertions). |
| 27 | Partial | Finish_reason precedence tested only for tool_calls beating length; stop/content_filter precedence untested (tests/integration/chat.stream.tool-calls.coverage.int.test.js:87-112). |
| 28 | Partial | Non-stream multi-call envelope not revalidated with new fixtures; existing tests not updated for stop-after-tools/parallel toggles. |
| 29 | Partial | Stream↔non-stream parity compared for single fixture; lacks multi-choice/parallel/stop-off variants (tests/integration/chat.stream.tool-calls.coverage.int.test.js:259-311). |
| 30 | Implemented | Ordering invariant enforced (tests/integration/chat.stream.tool-calls.int.test.js:90-162). |
| 31 | Implemented | Single finish chunk per choice (tests/integration/chat.stream.tool-calls.int.test.js:282-285). |
| 32 | Partial | Non-stream single-call envelope only indirectly covered via migration test; no explicit fixture-based assertion. |
| 33 | Partial | Sequential multi-call with parallel disabled not exercised (no fixture/test). |
| 34 | Partial | Normalizer stability across runs/backends not exercised (tests/shared/transcript-utils.js:1-118). |
| 35 | Missing | No secret redaction verification for fixtures/artifacts (tests absent). |
| 36 | Missing | Backend stderr separation not asserted or captured (no tests/artifacts). |
| 37 | Partial | Matrix remains app-heavy; proto/stop-after-tools-off cells absent (tests/e2e/fixtures/tool-calls/manifest.json:1-14; README.md:1-25). |
| 38 | Missing | No enforced per-test timeouts/perf budgets (tests/integration/*, tests/e2e/*). |
| 39 | Implemented | Structured→XML synthesis proved (tests/integration/chat.stream.tool-calls.int.test.js:135-139). |
| 40 | Implemented | Textual passthrough streaming verified (tests/integration/chat.stream.tool-calls.int.test.js:352-379). |
| 41 | Missing | Obsidian loop smoke/end-to-end prompt absent (no tests/scripts). |
| 42 | Partial | Stop-after-tools(first) streaming validated; single-tool-per-turn not asserted for multi-call/parallel combinations (tests/integration/chat.stream.tool-calls.int.test.js:297-334; coverage test lacks enforcement). |

### Task Completion Validation
| Task | Status | Evidence |
| --- | --- | --- |
| Map each AC to anchors | Verified | Story Traceability Mapping section captures AC→doc anchors (docs/stories/2-10-tool-call-regression-and-smoke.md:212-223). |
| Migration/runbook anchors for fixtures/smoke | Partial | K.1 adds anchor bullets but still describes placeholders/stubs rather than runnable steps (docs/app-server-migration/codex-completions-api-migration.md:248-277). |
| Store fixture metadata (model/stop policy/backend) | Verified | Fixture manifest records backend/model/fixtures (tests/e2e/fixtures/tool-calls/manifest.json:1-14). |
| Document fixture provenance/redaction rules | Partial | README lists usage/matrix but omits redaction filters or regeneration commands (tests/e2e/fixtures/tool-calls/README.md:1-25). |
| Capture textual multibyte `<use_tool>` trace | Verified | Textual streaming fixture and test assert multibyte XML block (tests/integration/chat.stream.tool-calls.int.test.js:336-379; tests/e2e/fixtures/tool-calls/streaming-tool-calls-textual.app.json). |
| Regression data for cumulative args (≥8KB/multibyte) | Verified | UTF-8 and ≥8KB streaming tests ensure cumulative JSON integrity (tests/integration/chat.stream.tool-calls.int.test.js:166-286). |

### Action Items
- [ ] [High] Wire tool-call smoke into `scripts/dev-smoke.sh` / `scripts/prod-smoke.sh` and CI; publish artifacts (SSE + hashes) with redaction; add perf/@slow budgets and finish_reason/role-first enforcement (AC4/5/18/17/35/36).
- [ ] [High] Align error/disconnect semantics with AC12/AC13: ensure post-tool errors produce canonical finish + `[DONE]` (or documented contract), add leak/cleanup assertions, and capture stderr artifacts (tests/integration/chat.stream.tool-calls.coverage.int.test.js:116-156). 
- [ ] [High] Expand fixture matrix and coverage for proto vs. app, stop-after-tools on/off, multi-choice/parallel, function→tool migration, and sequential multi-call to satisfy AC8/14/27/29/33/37/42.
- [ ] [Medium] Add non-stream heartbeat absence/backpressure tests, Obsidian loop smoke, and explicit redaction/normalization stability checks (AC10/24/25/34/35/41).
