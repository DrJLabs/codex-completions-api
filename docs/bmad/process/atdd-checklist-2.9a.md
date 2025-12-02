# ATDD Checklist - Epic 2, Story 2.9a: Multi-tool calls per assistant turn

**Date:** 2025-11-10
**Author:** drj
**Primary Test Level:** Integration (HTTP contract)

---

## Story Summary

Story 2.9a ensures the OpenAI-compatible proxy forwards **every** tool call emitted inside a single Codex turn across streaming and non-streaming flows. The proxy must emit sequential `<use_tool>` blocks, expose complete `tool_calls[]` arrays, honor burst/compatibility flags, and surface telemetry so downstream systems can reason about truncation or legacy fallbacks.

**As a** backend developer
**I want** the proxy to stream/non-stream multiple tool calls exactly as Codex produced them
**So that** clients and regression suites receive OpenAI-parity transcripts before Story 2.10 resumes

---

## Acceptance Criteria

1. **Streaming burst parity** — `src/handlers/chat/stream.js` keeps per-choice state (`forwardedToolCount`, `lastToolEnd`), streams an SSE `<use_tool>` delta for every tool call, honors `STOP_AFTER_TOOLS_MODE` (`first` vs `burst`) before emitting a single `finish_reason:"tool_calls"`, and only trims tail text after the last tool block.
2. **Non-stream multi-call envelopes** — `src/handlers/chat/nonstream.js` concatenates all `<use_tool>` blocks (respecting `TOOL_BLOCK_DELIMITER`), sets `content:null` plus full `tool_calls[]` arrays for OpenAI JSON mode, keeps Obsidian output inside one assistant message, and suppresses tail text only after the final block.
3. **Config + compatibility controls** — Env flags (`PROXY_TOOL_BLOCK_MAX`, `PROXY_STOP_AFTER_TOOLS`, `PROXY_STOP_AFTER_TOOLS_MODE`, `PROXY_SUPPRESS_TAIL_AFTER_TOOLS`, `PROXY_TOOL_BLOCK_DEDUP`, `PROXY_TOOL_BLOCK_DELIMITER`, `PROXY_ENABLE_PARALLEL_TOOL_CALLS`) document defaults and allow legacy single-call behavior when `MAX=1` + `MODE=first`.
4. **Telemetry + documentation** — Emit per-turn telemetry (`tool_call_count_total`, `tool_call_truncated_total`, structured logs with burst counts + config overrides) and update docs/runbooks/smoke instructions accordingly.
5. **Regression + smoke coverage** — Extend unit/integration/E2E/smoke suites (including `scripts/smoke/*`) plus `docs/test-design-epic-2.md` to cover streaming bursts, non-stream envelopes, config toggles, UTF-8 payloads, finish-reason parity, and disconnect handling.

---

## Failing Tests Created (RED Phase)

### E2E Tests (0 tests)

- Not applicable for this ATDD pass; coverage is enforced via integration (HTTP) tests until streaming changes stabilize.

### API / Integration Tests (5 tests)

**File:** `tests/integration/chat.multi-tool-burst.int.test.js` (181 lines)

- ✅ **Test:** `streams every tool call before finish`
  - **Status:** GREEN – `npx vitest run tests/integration/chat.multi-tool-burst.int.test.js` (2025‑11‑11) now observes ≥2 `delta.tool_calls[]` frames plus `<use_tool>` blocks per choice before the single `finish_reason:"tool_calls"` chunk.
  - **Verifies:** AC #1 burst parity (`forwardedToolCount`, finish ordering, `[DONE]`).
- ✅ **Test:** `obsidian output concatenates all <use_tool> blocks`
  - **Status:** GREEN – the same run shows concatenated XML blocks and `tool_calls[]` arrays whose length matches the fake burst count.
  - **Verifies:** AC #2 textual envelopes and tail suppression.
- ✅ **Test:** `openai-json output sets content null and exposes tool_calls[]`
  - **Status:** GREEN – OpenAI JSON override now returns `message.content:null` with the full `tool_calls[]` payload while finishing with `"tool_calls"`.
  - **Verifies:** AC #2 OpenAI parity + `content:null` contract.
- ✅ **Test:** `respects PROXY_TOOL_BLOCK_MAX and exposes tool telemetry headers`
  - **Status:** GREEN – the legacy-cap scenario (`PROXY_TOOL_BLOCK_MAX=1`, `PROXY_STOP_AFTER_TOOLS_MODE=first`) produces `x-codex-tool-call-count: 1`, `x-codex-tool-call-truncated: true`, and emits the terminal SSE comment with `tool_call_truncated:true`.
  - **Verifies:** AC #3 flag compatibility + AC #4 telemetry plumbing.

**File:** `tests/integration/chat.telemetry.tool-calls.int.test.js` (158 lines)

- ✅ **Test:** `records burst stats for multi-call turns`
  - **Status:** GREEN – `npx vitest run tests/integration/chat.telemetry.tool-calls.int.test.js` validates usage NDJSON entries include `tool_call_count_total ≥ 3`, `tool_call_truncated_total: 0`, and `stop_after_tools_mode:"burst"` alongside proto `tool_call_summary` events.
  - **Verifies:** AC #4 telemetry coverage.
- ✅ **Test:** `captures truncation when stop-after-tools forces legacy mode`
  - **Status:** GREEN – the capped run writes `tool_call_count_total: 1`, `tool_call_truncated_total: 1`, and proto summaries with `tool_block_max: 1` / `stop_after_tools_mode:"first"`.
  - **Verifies:** AC #3/#4 rollback metrics.

### Component Tests (0 tests)

- Not applicable—Story 2.9a is server-side HTTP streaming only.

---

## Data Factories Created

### Tool Call Factory

**File:** `tests/support/factories/tool-call.factory.js`

**Exports:**

- `createToolCall(overrides?)` – Builds a single OpenAI-style `tool_calls[]` entry with overridable id/name/payload.
- `createToolBurst(count, overrides?)` – Returns an array of deterministic tool calls used to model expected burst sizes in tests.
- `createUseToolBlock(options?)` – Generates textual `<use_tool>` blocks to seed transcript fixtures.

**Example Usage:**

```javascript
import { createToolBurst } from "../support/factories/tool-call.factory.js";
const EXPECTED_BURST = createToolBurst(3); // -> length === 3 for assertions
```

---

## Fixtures Created

### Tool Burst Env Fixture

**File:** `tests/support/fixtures/tool-burst.fixture.js`

**Fixtures:**

- `buildBurstEnv({ burstCount, stopAfterMode, extras })` – Composes the env var set used by streaming/non-stream tests (sets `FAKE_CODEX_MODE=multi_tool_burst`, `FAKE_CODEX_TOOL_BURST_COUNT`, `PROXY_STOP_AFTER_TOOLS_MODE`, `PROXY_SUPPRESS_TAIL_AFTER_TOOLS`).
- `buildLegacyCapEnv({ burstCount, blockMax, stopAfterMode, extras })` – Extends `buildBurstEnv` and injects `PROXY_TOOL_BLOCK_MAX` to simulate legacy single-call compatibility.

**Example Usage:**

```javascript
const serverCtx = await startServer(buildBurstEnv({ burstCount: 3 }));
```

Both fixtures ensure tests auto-clean up by running inside Vitest’s lifecycle hooks.

---

## Mock Requirements

### Fake Codex Proto (scripts/fake-codex-proto.js)

- **Mode:** `FAKE_CODEX_MODE=multi_tool_burst` (new mode required). Should emit sequential `agent_message_delta` frames for each tool call and a final `agent_message` snapshot containing the entire burst.
- **Burst Count:** `FAKE_CODEX_TOOL_BURST_COUNT` (stringified integer) controls how many tool calls to emit per assistant turn.
- **Telemetry Hooks:** Shim must set `parallel_tool_calls=true`, include textual `<use_tool>` blocks for each call, and handle truncation semantics when the proxy sets `PROXY_TOOL_BLOCK_MAX`.

**Success Response Example:**

```json
{
  "type": "agent_message",
  "msg": {
    "choice_index": 0,
    "message": {
      "role": "assistant",
      "content": null,
      "tool_calls": [ { "id": "...", "type": "function", "function": { "name": "lookup_user", "arguments": "{\"id\":\"43\"}" } }, { "id": "...", "function": { "name": "send_email", "arguments": "{\"ticket\":\"abc\"}" } } ]
    }
  }
}
```

**Failure Response Example:** When cap engages, shim should continue emitting `<use_tool>` text for all calls but mark extra payloads as truncated (telemetry increments `tool_call_truncated_total`).

---

## Required data-testid Attributes

This story modifies server responses only; no DOM instrumentation or `data-testid` additions are required. Downstream UI teams can continue using the textual `<use_tool>` markers already defined in docs.

---

## Implementation Checklist

### Test: `streams every tool call before finish`
- [x] Extend fake Codex proto with `multi_tool_burst` mode + `FAKE_CODEX_TOOL_BURST_COUNT` handling.
- [x] Update streaming handler to maintain per-choice `forwardedToolCount`, `lastToolEnd`, and `burstGrace` timers.
- [x] Ensure every tool delta is forwarded before emitting `finish_reason:"tool_calls"` and `[DONE]`.
- [x] Confirm `STOP_AFTER_TOOLS_MODE=burst` delays termination until the final call completes.

### Test: `obsidian output concatenates all <use_tool> blocks`
- [x] Teach `tool-call-aggregator` to append multiple textual blocks per choice and respect `PROXY_TOOL_BLOCK_DELIMITER`.
- [x] Update non-stream builder to set `content` to concatenated tool XML only (no trailing assistant prose).
- [x] Guarantee `tool_calls[]` arrays include every call even when textual blocks are present.

### Test: `openai-json output sets content null and exposes tool_calls[]`
- [x] Normalize OpenAI JSON payloads by forcing `content:null` whenever `tool_calls[]` exists.
- [x] Keep Obsidian vs OpenAI code paths in sync using shared helpers so textual output mirrors JSON arrays.

### Test: `respects PROXY_TOOL_BLOCK_MAX and exposes tool telemetry headers`
- [x] Enforce `PROXY_TOOL_BLOCK_MAX`/`PROXY_STOP_AFTER_TOOLS_MODE` gating while streaming (drop or truncate additional calls deterministically).
- [x] Emit response headers (or structured logs) for `x-codex-tool-call-count`, `x-codex-tool-call-truncated`, and `x-codex-stop-after-tools-mode`.
- [x] Back telemetry counters (`tool_call_count_total`, `tool_call_truncated_total`) with unit coverage.
- [x] Update docs/runbooks with rollback instructions for operators.

### Shared Follow-ups
- [ ] Add integration tests for responses adapter + `/v1/responses` parity once chat path passes.
- [x] Update smoke scripts to capture multi-call transcripts and archive evidence in `test-results/chat-completions`.

---

## Running Tests

```bash
# Focused integration suite (multi-tool burst contract)
npm run test:integration -- chat.multi-tool-burst.int.test.js

# Telemetry/metrics verification
npx vitest run tests/integration/chat.telemetry.tool-calls.int.test.js

# Full integration suite after implementation
npm run test:integration
```

---

## Knowledge Base References Applied

- `fixture-architecture.md` – fixture composition (`buildBurstEnv`, auto-cleanup).
- `data-factories.md` – factory overrides + faker-style burst helpers.
- `component-tdd.md` – Red/Green discipline applied to integration scope.
- `network-first.md` – ensures SSE/HTTP tests prepare env before triggering requests.
- `test-quality.md` – deterministic assertions (no hard waits) and single responsibility per test.
- `test-healing-patterns.md` – anticipates selector/log healing via header assertions.
- `selector-resilience.md` – textual `<use_tool>` markers replace brittle heuristics.
- `timing-debugging.md` – deterministic SSE parsing instead of `waitForTimeout`.
- `test-levels-framework.md` – justifies integration focus over E2E/unit duplicates.

---

## Test Execution Evidence

**Command:** `npm run test:integration -- chat.multi-tool-burst.int.test.js`

**Results:**

```
$ NO_COLOR=1 npx vitest run tests/integration/chat.multi-tool-burst.int.test.js

 RUN  v4.0.3 /home/drj/projects/codex-completions-api

 ✓ tests/integration/chat.multi-tool-burst.int.test.js (4 tests) 2.18s
     ✓ streams every tool call before finish 0.81s
     ✓ obsidian output concatenates all <use_tool> blocks 0.43s
     ✓ openai-json output sets content null and exposes tool_calls[] 0.40s
     ✓ respects PROXY_TOOL_BLOCK_MAX and exposes tool telemetry headers 0.52s
```

**Command:** `npx vitest run tests/integration/chat.telemetry.tool-calls.int.test.js`

**Results:**

```
 RUN  v4.0.3 /home/drj/projects/codex-completions-api

 ✓ tests/integration/chat.telemetry.tool-calls.int.test.js (2 tests) 1.42s
     ✓ records burst stats for multi-call turns 0.63s
     ✓ captures truncation when stop-after-tools forces legacy mode 0.69s
```

**Summary:**

- Total tests: 6 (focused suites)
- Passing: 6
- Status: ✅ GREEN – AC #1–#4 validated by targeted integration runs; full `npm run test:integration` also passes (see developer log 2025‑11‑11).

---

## Notes

- Fake Codex proto now ships with the `multi_tool_burst` scenario plus `FAKE_CODEX_TOOL_BURST_COUNT`; keep fixtures in sync with any future schema tweaks so deterministic bursts remain available in CI.
- Telemetry expectations are codified in both HTTP headers and structured logs—if field names change, update `chat.telemetry.tool-calls.int.test.js`, `docs/codex-proxy-tool-calls.md`, and the runbooks simultaneously.
- Story deliverables also update `docs/test-design-epic-2.md` and the smoke harness; future regressions must refresh those artifacts before requesting review.

---

## Contact

**Questions or Issues?**

- Raise in daily standup or tag @Murat in Slack.
- See `bmad/bmm/testarch/knowledge/*.md` for deeper testing patterns.
- Review `docs/stories/2-9a-multi-tool-calls-per-turn.md` for AC traceability.

---

**Generated by BMad TEA Agent** - 2025-11-10
