---
title: Epic — Chat Completions Canonical Parity
status: Done
version: 1.0
updated: 2025-09-24
owner: Product (PM)
labels: [api, compatibility, streaming, nonstream, errors]
---

# Epic

OpenAI clients still encounter edge-case mismatches when pointed at our `/v1/chat/completions` endpoint. This epic raises the implementation from "mostly compatible" to "canonical parity" so that automation, SDKs, and moderation-aware workflows behave identically out of the box.

# Epic Goal

Deliver the remaining protocol features (finish reasons, streaming tool calls, multi-choice responses, error lexicon) so our proxy can be dropped into OpenAI-flavored clients without feature flags or conditionals.

# Epic Description

**Existing System Context:**

- Current relevant functionality: Proxy normalizes non-stream and streaming chat completions with role-first deltas and usage finalizers.
- Technology stack: Node.js (Express), SSE streaming helpers, integration and Playwright contract tests.
- Integration points: Chat handlers (`src/handlers/chat/stream.js`, `src/handlers/chat/nonstream.js`), SSE service, error mapping utilities, contract fixtures under `tests/` and `test-results/`.

**Enhancement Details:**

- What's being added/changed: Expand finish-reason coverage, emit streaming tool_calls deltas, support `n>1` choices, and align error `type` strings with OpenAI's published list.
- How it integrates: Extend existing handler pipelines, surface upstream metadata from Codex CLI, and update contract/golden tests along with docs.
- Success criteria: OpenAI SDKs (Python/JS) pass their compatibility suites against our endpoint with no code tweaks; internal contract tests assert new fields and multi-choice flows.

# Stories

1. **Story 4.1 — Finish-Reason Canonicalization (Done 2025-09-24):** Broaden finish reason mapping (non-stream + stream finalizer) to include `content_filter`, `tool_calls`, and legacy `function_call`, plus audit tests/docs.
2. **Story 4.2 — Streaming Tool Call Blocks (Done 2025-09-24):** Stream OpenAI-style `tool_calls` deltas (id/type/json args chunks) and ensure non-stream payloads mirror final tool call aggregates.
3. **Story 4.3 — Multi-Choice & Error Lexicon (Done 2025-09-24):** Implement `n>1` choice aggregation/streaming, update error `type` values to OpenAI canonical names, and cover ignored params (`logprobs`, `response_format`, `seed`) with deterministic handling.

# Compatibility Requirements

- [x] Multi-choice responses preserve deterministic ordering and include per-choice usage when requested.
- [x] Streaming tool call frames follow OpenAI structure (`delta.tool_calls[{id,type,function:{name,arguments}}]`).
- [x] Error envelope maintains `{error:{message,type,param?,code?}}` shape while adopting canonical `type` strings (`authentication_error`, `permission_error`, etc.).

# Risk Mitigation

- **Primary Risk:** Introducing tool call streaming and multi-choice paths could regress existing single-choice flows or break SSE ordering guarantees.
- **Mitigation:** Expand golden transcripts to cover tool call and multi-choice scenarios; add integration tests for finish reason permutations; gate new behavior behind feature flags until verified.
- **Rollback Plan:** Retain current handler code paths behind a config toggle (`PROXY_CHAT_PARITY_CANONICAL=false`) to revert quickly if regressions surface.

# Definition of Done

- [x] Finish-reason matrix updated with tests and docs; non-stream + stream return canonical values.
- [x] Streaming tool_calls supported end-to-end with contract tests and documentation updates.
- [x] `n>1` choices fully supported (non-stream + stream) with deterministic coverage and usage accounting.
- [x] Error type lexicon aligned and validated via integration tests; docs reflect new mapping.
- [x] Docs and runbooks updated (e.g., `docs/openai-chat-completions-parity.md`, SDK guidance) and smoke tests cover new scenarios.

# Scope Validation

- [x] Enhancement fits within three focused stories.
- [x] Architectural changes limited to existing handlers/services; no new subsystems required.
- [x] Integration complexity limited to SSE and error mapping surfaces.
- [x] Enhancement follows existing streaming/non-stream patterns.

# Risk Assessment

- [x] Regression risk mitigated via expanded contract fixtures.
- [x] Rollback toggle documented and validated.
- [x] Testing plan covers new and existing functionality.
- [x] Team has clarity on tool call semantics and Codex CLI outputs.

# Completeness Check

- [x] Epic goal is clear, measurable, and user-focused.
- [x] Stories cover remaining parity gaps without overlap.
- [x] Success criteria include SDK validation and contract tests.
- [x] Dependencies (handlers, tests, docs) are captured.

# Story Manager Handoff

"Please develop detailed user stories for this brownfield epic. Key considerations:

- This is an enhancement to the existing SSE/non-stream chat proxy implemented in Node.js/Express.
- Integration points: `src/handlers/chat/stream.js`, `src/handlers/chat/nonstream.js`, `src/services/sse.js`, and error normalization utilities.
- Existing patterns to follow: role-first streaming deltas, finalizer chunk ordering, integration + Playwright contract fixtures.
- Critical compatibility requirements: canonical finish reasons, tool call streaming structure, multi-choice aggregation, and OpenAI error type lexicon.

The epic should maintain system integrity while delivering canonical parity for OpenAI Chat Completions clients."

## Reference Materials

- [Research — OpenAI Chat Completions Streaming Reference](../research/2025-09-24-openai-chat-completions-streaming-reference.md)

# Out of Scope

- Model identifier renaming (intentionally retains `codex-*` / `codev-*`).
- Streaming function/tool execution orchestration beyond emitting OpenAI-compatible payloads.
- Advanced parameters beyond parity MVP (`logprobs_top_k`, JSON schema validation, etc.).

# Change Log

| Date       | Version | Description                            | Author |
| ---------- | ------- | -------------------------------------- | ------ |
| 2025-09-24 | 0.1     | Initial epic drafted (Proposed)        | PM     |
| 2025-09-24 | 1.0     | Stories 4.1–4.3 completed; epic closed | PM     |
