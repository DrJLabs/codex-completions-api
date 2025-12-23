# Copilot <-> Proxy Compatibility Audit (Responses-First) -- Design

## Purpose
Produce a source-cited compatibility audit describing how Obsidian Copilot communicates with the proxy, with emphasis on `/v1/responses`. The audit should map request/response mechanics, tool-call signaling, streaming behavior, and observability, then identify gaps and actionable fixes without changing code.

## Scope
- Primary: `/v1/responses` requests and typed SSE streaming.
- Secondary (brief): `/v1/chat/completions` differences that matter for Copilot fallback models.
- In scope: Obsidian Copilot submodule code, proxy handlers/config, and internal docs.
- Out of scope: Modifying Copilot or the proxy implementation.

## Sources of Truth
- Copilot code: `external/obsidian-copilot/src/LLMProviders/*`, especially `chatModelManager.ts`, `chainRunner/*`, `utils/xmlParsing.ts`, `utils/modelAdapter.ts`, `utils/ThinkBlockStreamer.ts`.
- Proxy code: `src/routes/responses.js`, `src/handlers/responses/*`, `src/handlers/chat/*`, `src/lib/tool-call-aggregator.js`, `src/lib/tools/obsidianToolsSpec.js`, `src/config/index.js`.
- Internal docs: `docs/responses-endpoint/overview.md`, `docs/codex-proxy-tool-calls.md`, `docs/tool-calling-brief.md`, `docs/Integrating Codex Proxy with Obsidian Copilot for Tool Calls.md`, `docs/responses-endpoint/ingress-debug-obsidian-cross-chat-weather.md`.

## Approach
1. Build a contract table for Copilot <-> proxy interactions (ingress, streaming, tool calls, finalization).
2. For each contract item, cite Copilot source, proxy source, and strictness.
3. Separate confirmed facts (by code) from inferred/likely behaviors (e.g., LangChain `useResponsesApi` serialization).
4. Identify gaps: output-mode defaults, missing headers/trace IDs, unhandled Responses input variants (e.g., `tool_output` items).
5. Provide a phased improvement plan with acceptance criteria and test suggestions.

## Deliverable
New report in `docs/review/` with sections mirroring the Codex audit style:
- Executive Summary
- Baseline contract sources
- Systems under review
- Findings (must-fix / should-fix / nice-to-have)
- Underused/optional features for parity
- Improvement plan
- Appendix (mapping tables + file index)

## Acceptance Criteria
- Every contract item cites Copilot code and proxy code paths.
- `/v1/responses` is the primary focus, `/v1/chat/completions` is secondary.
- Tool-call mechanics are mapped to XML parsing expectations and output-mode behavior.
- Gaps/unknowns are explicit with validation steps.
- No code changes; doc is self-contained and actionable.
