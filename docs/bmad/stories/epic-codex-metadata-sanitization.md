---
title: Epic — Codex Metadata Sanitization
status: In Progress
version: 0.2
updated: 2025-10-24
owner: Product (PM)
labels: [brownfield, response-integrity, telemetry]
---

# Epic

Codex responses currently leak internal rollout telemetry (for example `rollout_path` values under `/app/.codex-api/sessions/...`). The proxy forwards these metadata events verbatim, so downstream clients ingest filesystem paths as part of the assistant message. This epic delivers a narrow brownfield fix that strips Codex-only metadata before we shape the assistant response while keeping surrounding functionality untouched.

# Epic Goal

Prevent Codex rollout telemetry from surfacing in client-visible content without regressing the existing Chat Completions contract.

# Epic Description

**Existing System Context:**

- Current relevant functionality: Non-stream (`src/handlers/chat/nonstream.js`) and streaming (`src/handlers/chat/stream.js`) handlers accumulate JSONL events from `codex proto` and build the assistant payload verbatim.
- Technology stack: Node 22, Express, Codex CLI (`codex proto`) emitting JSONL with event types such as `agent_message_delta`, `agent_message`, and `metadata` (includes rollout info).
- Integration points: Aggregated assistant content returned in proxy responses; downstream tooling (tag parsers, validation scripts) consume `choices[].message.content`.

**Enhancement Details:**

- What's being added/changed: Introduce filtering in both chat handlers so Codex metadata events (e.g., `rollout_path`, `session_id`, other telemetry) are captured for logs but excluded from client payloads.
- How it integrates: Enhance existing event-processing loops to recognize metadata envelopes and prevent them from mutating `content`, while optionally forwarding them to structured logs for observability.
- Rollout safety: Ship the sanitizer behind a `PROXY_SANITIZE_METADATA` feature toggle with staged activation (dev → canary → prod) and documented rollback.
- Success criteria: Sample prod request (full tagging prompt) no longer appends rollout telemetry; contract tests and downstream tag parsers see no spurious slash-delimited tokens; streaming/non-stream parity preserved; operators can flip the toggle to restore prior behavior if anomalies surface.

# Stories

1. **Guard metadata in non-stream responses** (Done 2025-10-24) — Update `chat/nonstream` event ingestion to ignore or redact metadata messages before finalizing assistant content; add unit coverage and integration regression. See [Story 5.1](./5.1.nonstream-metadata-sanitizer.md).
2. **Guard metadata in streaming responses** — Apply identical filtering in the stream handler so SSE deltas never include rollout telemetry; add Playwright stream assertion.
3. **Telemetry + documentation updates** — Record sanitized metadata in structured logs for debugging, update PRD/architecture requirements, and document QA verification (curl + parser smoke) plus alerting coverage.
4. **Flagged rollout & comms** — Implement the `PROXY_SANITIZE_METADATA` toggle, script the canary/rollback steps, and coordinate downstream communication so consumers know how to report anomalies.

# Compatibility Requirements

- [ ] Maintain existing `/v1/chat/completions` envelope (id/model/usage/finish_reason unchanged).
- [ ] Streaming chunk order remains role → content deltas → finish_reason/usage → `[DONE]`.
- [ ] Tool call and function call payloads remain untouched.
- [ ] Sanitization only applies to Codex telemetry events; genuine assistant content containing paths must still pass through.

# Risk Mitigation

- **Primary Risk:** Overzealous filtering could remove legitimate assistant output that resembles telemetry.
- **Mitigation:** Gate on explicit metadata event types/keys emitted by Codex; include regression smoke with prompts that deliberately ask for filesystem paths to confirm they still return.
- **Rollback Plan:** Revert handler changes and redeploy; no schema migrations involved.

# Definition of Done

- [ ] All stories complete with acceptance criteria met.
- [ ] Sanitization verified in non-stream and streaming paths (unit + integration + Playwright).
- [ ] Telemetry/logging captures metadata for internal debugging without exposing it to clients.
- [ ] Documentation (PRD, architecture) updated to reflect the new response-integrity requirement and toggle behavior.
- [ ] Downstream parser no longer emits rollout paths in tagged reports.
- [ ] `PROXY_SANITIZE_METADATA` rollout plan executed with QA canary evidence captured and rollback steps documented.

# Validation Checklist

**Scope Validation:**

- [ ] Enhancement fits within 1–3 focused stories.
- [ ] No architectural overhaul required; leverages existing handler structure.
- [ ] Integration complexity limited to event parsing and tests.
- [ ] Success criteria measurable via existing smoke/contract tooling.

**Risk Assessment:**

- [ ] Low risk to existing system functionality.
- [ ] Clear rollback path (code revert).
- [ ] Testing covers both response modes and regression cases.
- [ ] Team understands Codex event schema for safe filtering.

**Completeness Check:**

- [ ] Epic goal and success metrics are explicit.
- [ ] Stories scoped and sequenced.
- [ ] Dependencies noted (tests, docs, logging).
- [ ] No unresolved external dependencies.

# Story Manager Handoff

"Please develop detailed user stories for this brownfield epic. Key considerations:

- This enhancement touches the existing chat handlers in Node/Express (`chat/nonstream.js`, `chat/stream.js`) that ingest Codex CLI JSONL.
- Integration points: assistant message shaping, streaming SSE emission, structured logging in `src/dev-logging.js`.
- Follow established handler patterns (event loops, finish reason tracker) and keep tool/function payload handling untouched.
- Critical compatibility requirements: Preserve envelope parity and streaming order; ensure sanitization is limited to Codex metadata events.
- Each story must verify that existing functionality remains intact via unit, integration, and stream smoke tests."
