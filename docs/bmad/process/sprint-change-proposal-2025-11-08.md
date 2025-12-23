# Sprint Change Proposal — Codex App-Server Tool-Call Enablement

**Date:** 2025-11-08  
**Prepared by:** John (Product Manager)  
**Change Trigger:** New app-server build remains non-functional for tool calls; prior experiments failed, requiring reset to clean state.

---

## 1. Issue Summary
- The newest Codex app-server backend does not deliver functional tool-call responses, blocking Obsidian Copilot and any client relying on OpenAI `tool_calls` semantics.
- Previous implementation attempts over the last two days failed, leaving the codebase without the aggregator/event handling described in `docs/codex-proxy-tool-calls.md`.
- Without this capability, `/v1/chat/completions` cannot match OpenAI parity, directly violating FR002–FR004 (parity) and FR013 (tests) in the PRD.

## 2. Impact Analysis
### Epic Impact
- **Epic 2** requires rescoping: add new stories after 2.7 to implement aggregator utilities, handler changes, and regression coverage. Epic 2 sequencing remains intact but gains three additional vertical slices (2.8–2.10).
- Other epics remain unaffected at this time; however, downstream observability work (Epic 3) assumes tool-call telemetry, so delaying these stories risks cascading rework.

### Story Impact
- Existing Story 2.7 delivered JSON-RPC schema alignment but stopped before tool-call semantics. Stories 2.8–2.10 will cover:
  1. `ToolCallAggregator` utility + config/telemetry.
  2. Streaming/non-streaming handler parity & finish-reason logic.
  3. Regression + smoke suites proving tool-call behavior for structured and textual flows.

### Artifact Conflicts
- **PRD:** lacks explicit functional requirements for tool-call emission and regression evidence; add FR016–FR017.
- **Architecture doc:** missing “Tool Call Aggregation & SSE Semantics” guidance and testing updates.
- **Testing & Runbooks:** `docs/test-design-epic-2.md`, app-server migration runbooks, and smoke script docs require new scenarios and commands.

### Technical Impact
- Core modules touched: `src/lib/tool-call-aggregator.js`, `src/handlers/chat/stream.js`, `src/handlers/chat/nonstream.js`, finish-reason utilities, config files, telemetry surfaces, and regression tests.
- Entire system depends on functional tool calls; failure to implement keeps app-server unusable and blocks production cutover.

## 3. Recommended Approach
- **Chosen Path:** Option 1 — Direct Adjustment within Epic 2.
- **Rationale:** Adds scoped stories that implement the documented plan without introducing a new epic or rolling back to proto. Effort is Medium, risks are manageable within existing architecture, and it directly unblocks MVP goals. Options 2 (rollback) and 3 (MVP reduction) are non-starters because no previous functional baseline exists and MVP requires tool-call parity.

## 4. Detailed Change Proposals
1. **Story 2.8 – Implement ToolCallAggregator utility**  
   - Add `src/lib/tool-call-aggregator.js`, config flags (`PROXY_STOP_AFTER_TOOLS`, `PROXY_SUPPRESS_TAIL_AFTER_TOOLS`, `PROXY_ENABLE_PARALLEL_TOOL_CALLS`), and telemetry fields (`has_tool_calls`, `tool_call_names`).  
   - Story file: `docs/_archive/stories/2-8-implement-tool-call-aggregator.md` referencing `docs/codex-proxy-tool-calls.md`.
2. **Story 2.9 – Stream & non-stream handler parity for tool calls**  
   - Update streaming/non-streaming handlers to ingest Codex structured events, emit OpenAI-style `tool_calls`, and enforce `finish_reason: "tool_calls"`. Include textual fallback suppression logic.  
   - Story file: `docs/_archive/stories/2-9-stream-and-nonstream-tool-calls.md`.
3. **Story 2.10 – Tool-call regression and smoke coverage**  
   - Extend unit/integration/E2E suites plus smoke scripts to cover structured and textual tool-call paths (Obsidian Copilot scenarios). Document in `docs/test-design-epic-2.md`, runbooks, and smoke README.  
   - Story file: `docs/_archive/stories/2-10-tool-call-regression-and-smoke.md`.
4. **PRD Update** — Add FR016–FR017 for tool-call emission and regression evidence.  
5. **Architecture & Runbooks** — Document aggregator flow, SSE constraints, and new testing/smoke procedures referencing `docs/codex-proxy-tool-calls.md`.

## 5. Implementation Handoff
- **Scope Classification:** Moderate — requires backlog updates and coordinated execution across dev + QA but no fundamental replan.
- **Handoff Recipients:**
  - **Development Team:** implement Stories 2.8–2.10, code changes, tests, smoke scripts.
  - **Product Owner/Scrum Master:** update backlog ordering (insert stories after 2.7) and ensure sprint planning reflects added scope.
  - **QA/Test Architect:** design and validate the new regression scenarios, ensure parity evidence is captured before cutover.
- **Success Criteria:**
  1. All new stories accepted with passing `npm run verify:all` and updated smoke tests.
  2. PRD/architecture/test docs updated with explicit tool-call requirements and procedures.
  3. Obsidian Copilot tool-call scenarios succeed against the app-server path.

---

**Next Steps:** Await approval, then proceed with backlog insertion, doc edits, and story execution following the batch plan above.

---

## Addendum — 2025-11-08 (Tool-call documentation alignment)

### Issue Summary
- During follow-up validation, Stories 2.8–2.10 were further refined and now diverge from the older wording in `docs/epics.md` and the PRD. The epic still mentions config-flag and telemetry work inside Story 2.8, while the PRD lacks explicit functional requirements for the aggregator, handler integration, and regression evidence that those stories now deliver.

### Impact Analysis
- **Epic 2:** Story entries must mirror the finalized story files so downstream agents work from the same acceptance criteria. No new stories are introduced; this is a documentation realignment.
- **PRD:** Needs a tool-call parity subsection under FR002 to lock in the aggregator, handler, and regression deliverables spelled out in Stories 2.8–2.10.
- **Architecture:** No structural changes required for this addendum, but future doc refreshes should cross-reference the aggregator module in diagrams.

### Recommended Approach (Batch Mode)
1. Update `docs/epics.md` Story 2.8–2.10 acceptance criteria so they reference the finalized story files (aggregator APIs, textual fallback, XML helpers, output-mode config, regression suites).
2. Add a “Tool-call Parity Enhancements” subsection to the PRD enumerating three new requirements (aggregator module, handler integration, regression/smoke coverage).

### Detailed Change Proposals
- **Epics (`docs/epics.md:276-319`):** Replace the legacy config-flag/telemetry bullets with four acceptance criteria per story that match the current drafts.
- **PRD (`docs/PRD.md:31-41`):** Insert `FR002a–FR002c` describing the aggregator, handler, and regression mandates tied to Stories 2.8–2.10.

### Handoff
- **Scope Classification:** Minor — localized documentation edits completed in this workflow session.
- **Routing:** Scrum Master reviewed changes; Product Owner to acknowledge the refreshed requirements so future planning references stay accurate.
