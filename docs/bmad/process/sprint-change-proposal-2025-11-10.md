# Sprint Change Proposal — Multi-Tool Calls per Turn

**Date:** 2025-11-10  
**Prepared by:** Bob (Scrum Master)  
**Trigger Stories:** 2-8 implement ToolCallAggregator, 2-9 stream/non-stream handler parity  
**Dependent Story Blocked:** 2-10 Tool-call regression and smoke coverage

---

## 1. Issue Summary
- **Problem:** Stories 2-8 and 2-9 implemented infrastructure for tool calls but the proxy still emits **only one tool call per assistant turn**. Story 2-10 (testing) assumes multiple tool calls exist, so further testing would canonize an incomplete behavior.
- **Evidence:** `docs/codex-proxy-tool-calls.md` and FR002d in `docs/PRD.md` describe the intended multi-tool behavior, but handlers still short-circuit after the first tool call.
- **Impact of leaving as-is:** Testing work would lock in the single-call limitation, Obsidian Copilot workflows requiring chained tools would fail, and parity with OpenAI-compliant behavior would remain incomplete.

## 2. Impact Analysis
### Epic & Story Impact
- **Epic 2 scope:** Needs explicit addition of "multiple tool calls per turn" capability between Stories 2-9 and 2-10. Without it, acceptance criteria for Story 2-10 become untestable.  
- **Future epics:** Epic 4 (testing/observability) depends on richer tool-call telemetry; it requires the multi-tool foundation first.  
- **Story backlog:** Insert a new story (proposed 2-9a) dedicated to multi-tool emission semantics, ahead of Story 2-10.

### Artifact Conflicts
- **PRD:** Functional requirements lack an explicit statement about multiple tool calls per turn; MVP scope should codify it.  
- **Architecture:** The tool-call contract notes in `docs/codex-proxy-tool-calls.md` capture the target behavior and should be linked from epics/stories until a full design doc exists.  
- **Testing artifacts:** `docs/test-design-epic-2.md` and CI/Playwright specs must add regression cases for multi-call bursts, limit flags, and telemetry.  
- **Other artifacts:** Smoke scripts + QA fixtures require updates once multi-tool support lands.

### Dependencies
- Chat handler loop, SSE streaming writer, and Codex CLI transport state machines.  
- Tool routing state shared with Obsidian XML mode.  
- Integration & E2E test suites plus smoke scripts consuming transcripts.

## 3. Recommended Path
| Option | Description | Effort | Risk | Decision |
| --- | --- | --- | --- | --- |
| 1. Direct Adjustment | Add dedicated story + implementation to forward all tool calls per turn before Story 2-10 continues. | Medium | Medium | **Selected** |
| 2. Rollback | Revert Stories 2-8/2-9 and redesign. | High | High | Not viable |
| 3. PRD/MVP Scope Change | Accept single-call limitation and down-scope MVP. | Low | High (parity miss) | Not viable |

**Rationale:** Option 1 keeps prior work intact, aligns with parity commitments, and only requires inserting one focused story plus doc/test updates. Rolling back or down-scoping would either waste completed work or fail parity requirements.

## 4. Detailed Change Proposals
### 4.1 `docs/epics.md`
Insert a new story between 2.9 and 2.10:
```
**Story 2.9a: Multi-tool calls per assistant turn**

As a backend developer,
I want streaming and non-streaming handlers to forward every tool call emitted in a turn,
So that clients receive complete OpenAI-compatible tool_call arrays and Obsidian `<use_tool>` blocks before regression testing starts.

**Acceptance Criteria:**
1. Streaming handler tracks `forwardedToolCount` per choice and emits all tool-call deltas plus `<use_tool>` chunks until the final call, honoring `STOP_AFTER_TOOLS_MODE` (first|burst) and `[DONE]` semantics. [Source: docs/PRD.md#functional-requirements; docs/codex-proxy-tool-calls.md#multi-tool-turn-fidelity]
2. Non-stream handler returns all tool calls in both JSON (`tool_calls[]`, `finish_reason:"tool_calls"`) and Obsidian XML (multiple `<use_tool>` blocks, delimiter support) with tail suppression happening only after the last call. [Source: docs/PRD.md#functional-requirements; docs/codex-proxy-tool-calls.md#non-streaming-detection--flow]
3. Config gates (`TOOL_BLOCK_MAX`, `STOP_AFTER_TOOLS_MODE`, `SUPPRESS_TAIL_AFTER_TOOLS`) default to unlimited/burst but allow legacy single-call behavior via flags. [Source: docs/PRD.md#functional-requirements]
4. Telemetry counters expose per-turn tool-call counts, and docs reference the new behavior for downstream consumers. [Source: docs/codex-proxy-tool-calls.md#multi-tool-turn-fidelity]

**Prerequisites:** Stories 2.8-2.9
**Prerequisite for:** Story 2.10
```

### 4.2 `docs/stories/2-9a-multi-tool-calls-per-turn.md` (new)
Create a story file mirroring existing format:
- **Status:** drafted  
- **Story:** same wording as above.  
- **Acceptance Criteria:** detailed breakdown of streaming handler updates, non-stream updates, configuration defaults, telemetry, and backward-compatibility toggles.  
- **Tasks:**
  1. Update `src/handlers/chat/stream.js` to emit multiple tool calls per choice and manage suppression after the final call.  
  2. Update non-stream serializer to include all tool calls in JSON + Obsidian XML modes.  
  3. Extend telemetry + logging for `tool_call_count`.  
  4. Add integration tests (stream + non-stream) covering multi-call bursts, `TOOL_BLOCK_MAX`, and stop-after-tools behavior.  
  5. Update smoke scripts and docs referencing new capability.
- **References:** `docs/PRD.md`, `docs/codex-proxy-tool-calls.md`, `stories/2-8`, `stories/2-9`.

### 4.3 `docs/PRD.md#Functional Requirements`
Add explicit MVP requirement:
```
- **FR-2.9a Multi-Tool Turn Fidelity:** For any assistant turn where the Codex backend emits multiple tool calls, the proxy MUST forward every call in order for both streaming and non-streaming responses, exposing them via OpenAI `tool_calls[]` arrays and Obsidian `<use_tool>` blocks with `finish_reason:"tool_calls"`. Legacy single-call behavior is available only via deployment flags (`TOOL_BLOCK_MAX`, `STOP_AFTER_TOOLS_MODE`).
```

### 4.4 Multi-tool burst design (pending)
- Keep the change proposal + tool-call contract notes authoritative until a full design doc exists.  
- Capture any diagrams or sequence tables in the story file or `docs/codex-proxy-tool-calls.md` once implementation starts.  
- Call out required telemetry + observability hooks referenced by future epics.

### 4.5 `docs/test-design-epic-2.md` & CI/Test Harnesses
- Add multi-call scenarios to the risk register (coverage for bursts, config caps, textual fallback, disconnect).  
- Define new integration tests verifying: multi-call SSE order, proper `[DONE]` after final call, JSON vs XML parity, and multi-choice support.  
- Extend Playwright + smoke scripts to assert multiple tool calls per turn (structured + textual).  
- Ensure `npm run test:integration`, `npm test`, and `scripts/smoke/*` include these cases before Story 2-10 proceeds.

### 4.6 Secondary Artifacts
- Update `docs/codex-proxy-tool-calls.md` to describe the new behavior and config switches.  
- Refresh `scripts/smoke/dev|prod` to include chained-tool checks.  
- Add monitoring alert for abnormal `tool_call_count` spikes once telemetry lands.

## 5. Implementation Handoff
- **Scope Classification:** Moderate (requires backlog reordering + multi-disciplinary updates).  
- **Routing:**
  - Development Team — implement Story 2.9a code changes + telemetry.  
  - Product Owner/Scrum Master — update backlog ordering, PRD, epics, and sprint-status.  
  - QA/Test Architect — expand integration/E2E/smoke coverage and update test design doc.  
- **Dependencies:** tool-call contract notes, aggregator module, existing handler infrastructure.  
- **Definition of Done:** Story 2.9a accepted, Story 2.10 unblocked, docs/tests updated, telemetry operational.

## 6. Next Steps
1. Approve this change proposal and insert Story 2.9a into the sprint backlog ahead of Story 2.10.  
2. Assign development and QA owners for Story 2.9a.  
3. Update sprint-status.yaml + roadmap artifacts to reflect the new dependency.  
4. Begin implementation under existing feature branch or create `feat/multi-tool-per-turn` as needed.  
5. Re-run Epic 2 regression once multi-tool support ships, then continue with Story 2.10.

---

**Status summary:** Checklist sections 1–5 completed; Section 6 pending user approval & handoff confirmation.
