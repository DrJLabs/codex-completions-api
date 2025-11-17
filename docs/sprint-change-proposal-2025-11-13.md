# Sprint Change Proposal — End-to-End Tracing Enablement

## 1. Issue Summary
- Trigger: Story `docs/stories/2-9a-multi-tool-calls-per-turn.md` and the broader Epic 2 failed to reach consistency because Codex responses and (especially) tool calls are non-deterministic between runs.
- Problem: Without full request tracing, we cannot pinpoint where transformations diverge between ingress, Codex JSON-RPC submission, and client egress. Tool-call timing and payloads drift without visibility.
- Evidence: Internal dev tests repeatedly hit divergent tool-call sequences. Manual log review is insufficient to reconstruct end-to-end flows.

## 2. Impact Analysis
### Epic
- Epic 2 scope must expand to include tracing instrumentation before further feature work.
- Additional stories: "Implement end-to-end tracing for dev server" (and potentially a follow-on for prod parity) under Epic 2.

### Artifacts
- **PRD:** Add tracing as a pre-MVP requirement gating future tool-call features.
- **Architecture:** Update `server.js`, `src/app.js`, `src/middleware/access-log.js`, `src/dev-logging.js`, chat handlers, `src/services/codex-runner.js`, `src/services/transport/child-adapter.js`, and `src/services/sse.js` per `docs/dev/end-to-end-tracing-plan.app-server.md`. Introduce `src/dev-trace/sanitize.js`.
- **Documentation:** Extend BMAD architecture docs plus `docs/dev/end-to-end-tracing-plan.app-server.md` as the authoritative runbook.
- **Other artifacts:** Ensure CI guidance references the trace logs; no UI/UX impact.

## 3. Recommended Approach (Option 1 — Direct Adjustment)
- Instrument the dev proxy using the app-server plan:
  - Log sanitized HTTP ingress payloads with canonical `req_id`.
  - Trace JSON-RPC requests/responses via `JsonRpcChildAdapter`.
  - Capture SSE/JSON egress frames and usage summaries.
  - Enforce tracing defaults in dev and provide sanitization helpers.
- Justification: Enables deterministic debugging without rollback or scope reductions. Medium effort/medium risk but localized to logging layers.

## 4. MVP Impact & Action Plan
- MVP remains achievable once tracing is in place.
- Actions:
  1. Convert legacy proto logging assumptions to app-server–centric tracing (Phase 0–4 in the plan).
  2. Add sanitization utilities and enforce tracing in dev (Phase 5–6).
  3. Create helper scripts/docs so engineers can reconstruct traces by `req_id`.
- Dependencies: Codex CLI ≥ 0.53 with app-server mode; dev stacks configured with LOG_PROTO.

## 5. Implementation Handoff
- **Story Creation:** Use standard BMAD story workflow to draft the tracing story (Epic 2).
- **Development:** Full-stack dev agent implements tracing instrumentation according to the plan.
- **Scrum Master/Product Owner:** Track backlog updates and ensure tracing story blocks downstream tool-call work.
- **Architect/Product Manager:** Review architecture and PRD updates for alignment.

## 6. Scope Classification & Routing
- Scope: **Moderate** — affects cross-cutting infrastructure but no full replan.
- Route to: Product Owner/Scrum Master for backlog adjustment + development team for implementation.
- Deliverables: Updated PRD section, tracing story under Epic 2, modified code modules, refreshed documentation.

