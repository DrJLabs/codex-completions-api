# Obsidian Copilot <-> Proxy Compatibility Audit (Responses-First)

## 1. Executive Summary

### Top 10 compatibility improvements (ranked)
1. **Force `obsidian-xml` output mode for Copilot `/v1/responses` traffic** (or set `x-proxy-output-mode` client-side) so `<use_tool>` blocks survive streaming. Copilot's autonomous agent only parses XML tool blocks; the proxy defaults `/v1/responses` to `openai-json`, which suppresses XML in text deltas. (Sources: `external/obsidian-copilot/src/LLMProviders/chainRunner/utils/xmlParsing.ts`, `external/obsidian-copilot/src/LLMProviders/chainRunner/utils/modelAdapter.ts`, `src/config/index.js`, `src/handlers/responses/stream.js`, `docs/responses-endpoint/overview.md`)
2. **Add an explicit Copilot identifier header** (e.g., `x-copilot-trace-id`) from the client so the proxy can correlate sessions and optionally select `obsidian-xml` defaults. Copilot code does not set this today. (Sources: `src/lib/trace-ids.js`, `src/handlers/responses/ingress-logging.js`)
3. **Capture real Copilot `/v1/responses` requests** (shape + headers) and pin them as fixtures/tests to remove guesswork around LangChain `useResponsesApi` serialization and SSE handling. (Sources: `external/obsidian-copilot/src/LLMProviders/chatModelManager.ts`, `src/handlers/responses/ingress-logging.js`)
4. **Document the GPT-5 Responses path as Copilot's primary route** and warn that changes to typed SSE or output-mode behavior will directly impact Copilot. (Sources: `external/obsidian-copilot/src/LLMProviders/chatModelManager.ts`, `src/routes/responses.js`)
5. **Align docs that still describe function_call deltas** (legacy OpenAI tool-calling) with current Copilot XML behavior to avoid breaking changes. (Sources: `docs/Integrating Codex Proxy with Obsidian Copilot for Tool Calls.md`, `docs/tool-calling-brief.md`, `external/obsidian-copilot/src/LLMProviders/chainRunner/utils/xmlParsing.ts`)
6. **Preserve `<use_tool>` text in Responses SSE** even if typed tool events are emitted, because Copilot's streaming parser only reads `chunk.content`. (Sources: `external/obsidian-copilot/src/LLMProviders/chainRunner/utils/ThinkBlockStreamer.ts`, `src/handlers/responses/stream-adapter.js`, `src/handlers/chat/stream.js`)
7. **Keep `PROXY_INGRESS_GUARDRAIL=true` for Copilot** to reduce cross-chat contamination when `<recent_conversations>` appears in prompts. (Sources: `docs/responses-endpoint/ingress-debug-obsidian-cross-chat-weather.md`, `src/lib/ingress-guardrail.js`)
8. **Audit `previous_response_id` usage** (Copilot may send it, proxy never forwards it upstream); clarify that the proxy is stateless for Responses. (Sources: `src/handlers/responses/nonstream.js`, `src/handlers/responses/shared.js`, `docs/responses-endpoint/overview.md`)
9. **Extend Responses tests to cover XML tool calls** (obsidian-xml mode) so Copilot compatibility is enforced in CI. (Sources: `docs/codex-proxy-tool-calls.md`, `docs/test-design-epic-2.md`)
10. **Log a minimal `User-Agent` summary** in Responses ingress logs to confirm traffic origin and guide output-mode decisions. (Sources: `src/handlers/responses/ingress-logging.js`, `docs/responses-endpoint/overview.md`)

### Biggest must-fix parity gaps
- **Output-mode mismatch for `/v1/responses`:** Copilot's autonomous agent requires XML tool blocks, but the proxy defaults Responses to `openai-json`, which suppresses XML content. (Sources: `external/obsidian-copilot/src/LLMProviders/chainRunner/utils/xmlParsing.ts`, `src/config/index.js`, `src/handlers/responses/stream.js`, `docs/responses-endpoint/overview.md`)
- **No explicit Copilot trace/header:** The proxy cannot reliably detect Copilot traffic or correlate sessions across logs without a client-sent identifier. (Sources: `src/lib/trace-ids.js`, `src/handlers/responses/ingress-logging.js`)
- **No pinned Copilot Responses fixtures:** We lack verified examples of actual Copilot Responses requests/streams, so changes to typed SSE or request normalization could regress without detection. (Sources: `external/obsidian-copilot/src/LLMProviders/chatModelManager.ts`, `docs/responses-endpoint/overview.md`)

### Top 3 changes most likely to reduce "mysterious" Copilot failures
1. **Force `obsidian-xml` on `/v1/responses` for Copilot**, or set `x-proxy-output-mode: obsidian-xml` client-side.
2. **Add a Copilot trace/header** (and log it) to tie client behavior to proxy logs.
3. **Capture/lock a Copilot Responses transcript** (non-stream + stream) and add it to integration tests.

> Note: Tool calls are currently working, which strongly suggests either (a) Copilot is running in `obsidian-xml` output mode in your deployment, or (b) the GPT-5 Responses path is not using the autonomous agent XML parser for the flows you tested. The audit below treats this as an implicit dependency to verify and formalize.

---

## 2. Baseline: Copilot Contract Sources (What We're Using)

**Primary sources (Copilot + proxy + docs):**
- Copilot GPT-5 uses Responses API: `external/obsidian-copilot/src/LLMProviders/chatModelManager.ts` (`useResponsesApi`).
- XML tool call contract + parser: `external/obsidian-copilot/src/LLMProviders/chainRunner/utils/modelAdapter.ts` (XML prompt contract), `external/obsidian-copilot/src/LLMProviders/chainRunner/utils/xmlParsing.ts` (parser), `external/obsidian-copilot/src/LLMProviders/chainRunner/README.md` (format examples).
- Streaming assembly + truncation logic: `external/obsidian-copilot/src/LLMProviders/chainRunner/utils/ThinkBlockStreamer.ts` (truncates to last `</use_tool>`).
- Autonomous agent execution flow: `external/obsidian-copilot/src/LLMProviders/chainRunner/AutonomousAgentChainRunner.ts` (tool parsing, execution, loop).
- Responses endpoint design and output-mode defaults: `docs/responses-endpoint/overview.md`.
- Proxy tool-call handling + XML synthesis: `src/lib/tool-call-aggregator.js`, `src/lib/tools/obsidianToolsSpec.js`, `src/handlers/chat/stream.js`.
- Copilot prompt contamination case: `docs/responses-endpoint/ingress-debug-obsidian-cross-chat-weather.md`.

**Contract items (with strictness):**
- **Responses API is primary for GPT-5** (required for GPT-5): `external/obsidian-copilot/src/LLMProviders/chatModelManager.ts`.
- **Autonomous agent requires XML `<use_tool>` blocks in assistant text** (hard-required): `external/obsidian-copilot/src/LLMProviders/chainRunner/utils/modelAdapter.ts`, `external/obsidian-copilot/src/LLMProviders/chainRunner/utils/xmlParsing.ts`.
- **Streaming parser only inspects text content, not tool_calls fields** (hard-required): `external/obsidian-copilot/src/LLMProviders/chainRunner/utils/ThinkBlockStreamer.ts`.
- **Tool execution loop is client-side** and tool results are reintroduced as messages, not `tool_output` items (required): `external/obsidian-copilot/src/LLMProviders/chainRunner/AutonomousAgentChainRunner.ts`.
- **Proxy defaults `/v1/responses` to `openai-json`** unless `x-proxy-output-mode` is set (required by proxy config): `src/config/index.js`, `src/handlers/responses/stream.js`, `docs/responses-endpoint/overview.md`.
- **Proxy can emit XML in obsidian-xml mode** using `toObsidianXml()` (optional but required for Copilot tool calls): `src/lib/tools/obsidianToolsSpec.js`, `src/handlers/chat/stream.js`.

---

## 3. Systems Under Review

### Proxy (key components)
- `/v1/responses` routing: `src/routes/responses.js`
- Responses non-stream transform: `src/handlers/responses/nonstream.js`
- Responses stream adapter (typed SSE): `src/handlers/responses/stream-adapter.js`
- Responses -> chat normalization: `src/handlers/responses/shared.js`
- Output-mode config: `src/config/index.js`
- Tool-call aggregation + XML synthesis: `src/lib/tool-call-aggregator.js`, `src/lib/tools/obsidianToolsSpec.js`
- Copilot trace IDs and ingress logging: `src/lib/trace-ids.js`, `src/handlers/responses/ingress-logging.js`

### Obsidian Copilot (key components)
- GPT-5 Responses API toggle: `external/obsidian-copilot/src/LLMProviders/chatModelManager.ts`
- XML tool call prompt + parsing: `external/obsidian-copilot/src/LLMProviders/chainRunner/utils/modelAdapter.ts`, `external/obsidian-copilot/src/LLMProviders/chainRunner/utils/xmlParsing.ts`
- Streaming assembly + truncation: `external/obsidian-copilot/src/LLMProviders/chainRunner/utils/ThinkBlockStreamer.ts`
- Tool execution loop: `external/obsidian-copilot/src/LLMProviders/chainRunner/AutonomousAgentChainRunner.ts`

---

## 4. Audit Findings: Proxy vs Copilot Contract (Reference-Driven)

### Must-fix incompatibilities (blocking)

**[Confirmed] Copilot XML tool calls can be suppressed on `/v1/responses`.**
- **Contract expects:** `<use_tool>` blocks appear in assistant text; Copilot parses XML only. (Sources: `external/obsidian-copilot/src/LLMProviders/chainRunner/utils/modelAdapter.ts`, `external/obsidian-copilot/src/LLMProviders/chainRunner/utils/xmlParsing.ts`)
- **Proxy currently does:** Defaults `/v1/responses` to `openai-json` via `PROXY_RESPONSES_OUTPUT_MODE`, which suppresses XML in text deltas and emits typed tool events instead. (Sources: `src/config/index.js`, `src/handlers/responses/stream.js`, `docs/responses-endpoint/overview.md`)
- **Impact:** Copilot autonomous agent won't detect tool calls if XML is suppressed, even though tool calls might still be logged/structured.
- **Recommended fix:** For Copilot deployments, set `PROXY_RESPONSES_OUTPUT_MODE=obsidian-xml` or add `x-proxy-output-mode: obsidian-xml` in Copilot's HTTP client. Optionally auto-select obsidian-xml when `User-Agent` or `x-copilot-trace-id` indicates Copilot.

**[Confirmed] Copilot does not set a trace/header to identify itself.**
- **Contract expects:** Proxy can correlate Copilot sessions to logs (for debugging tool loops and memory bleed). (Source: `docs/responses-endpoint/ingress-debug-obsidian-cross-chat-weather.md`)
- **Proxy currently does:** Generates `copilot_trace_id` server-side if no header exists, but cannot link it across client sessions. (Sources: `src/lib/trace-ids.js`, `src/handlers/responses/ingress-logging.js`)
- **Impact:** "Mysterious" tool loops or cross-chat contamination are harder to diagnose; output-mode overrides can't be made safely per client.
- **Recommended fix:** Add `x-copilot-trace-id` or `x-request-id` to Copilot requests and log it server-side; optionally reuse it for output-mode routing.

### Should-fix inconsistencies (high value)

**[Confirmed] Doc drift on Copilot tool-call contract.**
- **Contract expects:** XML `<use_tool>` parsing; Copilot ignores `tool_calls`/`function_call` in streaming. (Sources: `external/obsidian-copilot/src/LLMProviders/chainRunner/utils/xmlParsing.ts`, `external/obsidian-copilot/src/LLMProviders/chainRunner/utils/ThinkBlockStreamer.ts`)
- **Proxy docs currently say:** Copilot expects `function_call` deltas and OpenAI tool-calling semantics. (Sources: `docs/Integrating Codex Proxy with Obsidian Copilot for Tool Calls.md`, `docs/tool-calling-brief.md`)
- **Impact:** Engineers might "fix" the proxy by removing XML support, breaking Copilot.
- **Recommended fix:** Update/flag those docs as legacy; cross-link to this audit and the current XML contract.

**[Confirmed] Responses mode is primary for Copilot GPT-5 but treated as a compatibility shim.**
- **Contract expects:** `/v1/responses` is the first-class path for GPT-5. (Source: `external/obsidian-copilot/src/LLMProviders/chatModelManager.ts`)
- **Proxy currently does:** Implements `/v1/responses` as a translation layer over chat handlers. (Sources: `src/routes/responses.js`, `src/handlers/responses/*`)
- **Impact:** Changes intended for Codex compatibility can directly break Copilot.
- **Recommended fix:** Treat `/v1/responses` as a first-class Copilot endpoint in docs/tests; add Copilot-specific fixtures.

**[Inferred] LangChain `useResponsesApi` request shape is not yet validated against proxy normalization.**
- **Contract expects:** Requests may include `input[]`, `instructions`, `text.verbosity`, and other Responses fields. (Sources: `external/obsidian-copilot/src/LLMProviders/chatModelManager.ts`)
- **Proxy currently does:** Coerces Responses input into `messages[]` and drops non-text `input` item fields; does not forward `previous_response_id` upstream. (Sources: `src/handlers/responses/shared.js`, `src/handlers/responses/nonstream.js`)
- **Impact:** If Copilot begins sending richer Responses inputs or relies on server-side `previous_response_id`, behavior could drift silently.
- **Recommended fix:** Capture real Copilot payloads, then either (a) extend `coerceInputToChatMessages` to preserve needed fields or (b) document the stateless limitation clearly.

**[Confirmed] `<recent_conversations>` can leak tool context across chats.**
- **Contract expects:** Copilot embeds recent conversation summaries; proxy should mitigate unintended tool actions. (Source: `docs/responses-endpoint/ingress-debug-obsidian-cross-chat-weather.md`)
- **Proxy currently does:** Supports an ingress guardrail injection to mitigate these patterns. (Source: `src/lib/ingress-guardrail.js`)
- **Impact:** Without guardrails or logs, cross-chat contamination appears as "mysterious" tool calls.
- **Recommended fix:** Keep `PROXY_INGRESS_GUARDRAIL=true` for Copilot and monitor `responses_ingress_raw` markers.

### Nice-to-have improvements (low risk / future-proofing)

**[Inferred] Responses `tool_output` items are not preserved.**
- **Contract expects:** Responses clients can submit `tool_output` items and associate them with tool calls. (General Responses spec; not observed in Copilot code)
- **Proxy currently does:** Flattens Responses input to text and ignores `tool_output` items. (Source: `src/handlers/responses/shared.js`)
- **Impact:** Low for Copilot today, but blocks adopting OpenAI-style tool outputs in Responses.
- **Recommended fix:** Add a translation path from `tool_output` -> `role:"tool"` messages when needed.

**[Inferred] Typed SSE tool events omit a `call_id` field.**
- **Contract expects:** Some clients rely on `call_id` for tool events. (OpenAI Responses spec; not used in Copilot)
- **Proxy currently does:** Emits `response.output_item.*` without `call_id`. (Source: `src/handlers/responses/stream-adapter.js`)
- **Impact:** Low for Copilot; high for strict Responses clients.
- **Recommended fix:** Add `call_id` for strict clients, but guard for Copilot output-mode.

### Secondary: `/v1/chat/completions` notes (brief)
- Copilot does **not** set `x-proxy-output-mode`; `/v1/chat/completions` therefore uses `PROXY_OUTPUT_MODE` (default `obsidian-xml`), which preserves `<use_tool>` blocks and keeps autonomous agent parsing intact. (Sources: `src/config/index.js`, `src/handlers/chat/stream.js`)
- Switching `/v1/chat/completions` to `openai-json` would suppress XML tool blocks and likely break Copilot's XML parser unless the client switches to structured tool calling (not shown in Copilot code). (Sources: `external/obsidian-copilot/src/LLMProviders/chainRunner/utils/xmlParsing.ts`, `src/handlers/chat/stream.js`)
- The proxy's finish-reason normalization (`tool_calls` precedence) is compatible with Copilot's loop as long as XML is preserved in text. (Sources: `src/handlers/chat/shared.js`, `src/handlers/chat/stream.js`)
---

## 5. Underused Responses/Proxy Features (Adoption Opportunities)

- **Client-set trace IDs:** Copilot does not emit `x-copilot-trace-id` or similar headers; adding one would greatly improve triage. (Sources: `src/lib/trace-ids.js`, `src/handlers/responses/ingress-logging.js`)
- **`previous_response_id` chaining:** Proxy echoes it but does not forward upstream; if Copilot wants server-side threading, this must be implemented or documented as unsupported. (Sources: `src/handlers/responses/shared.js`, `docs/responses-endpoint/overview.md`)
- **Response metadata:** Copilot currently appears to rely on content text only; there is no evidence it consumes Responses `output[]` metadata. Validating this would let us safely evolve typed SSE without breaking clients.
- **Structured tool outputs (`tool_output` items):** Not used by Copilot; could enable future OpenAI-style tool loops if desired.

---

## 6. Compatibility Improvement Plan

### Phase 0 -- Immediate safety rails
**AC0.1**: Configure Copilot `/v1/responses` traffic to use `obsidian-xml` output mode.  
**Suggested test:** Manual smoke with Copilot + verify `responses_ingress_raw.output_mode_effective=obsidian-xml` and `<use_tool>` present.

**AC0.2**: Add client-side trace/header and log it server-side.  
**Suggested test:** Confirm `responses_ingress_raw.candidate_header_keys` contains the trace header; cross-link to access logs.

### Phase 1 -- Evidence + regression protection
**AC1.1**: Capture a real Copilot `/v1/responses` request/response transcript (stream + non-stream).  
**Suggested test:** Add a golden transcript to `test-results/responses/` and a new integration test that compares sanitized output.

**AC1.2**: Document Copilot XML contract and deprecate legacy "function_call" doc paths.  
**Suggested test:** Doc lint or PR checklist referencing this audit.

### Phase 2 -- Compatibility hardening
**AC2.1**: Add optional translation for Responses `tool_output` items (if Copilot ever adopts them).  
**Suggested test:** Unit test in `tests/unit` for `coerceInputToChatMessages` with `tool_output` items.

**AC2.2**: Add a feature-flagged `call_id` field in typed SSE tool events for strict clients (guarded to avoid Copilot regressions).  
**Suggested test:** Integration test for typed SSE events with `call_id` in openai-json mode only.

---

## 7. Appendix

### A) Copilot <-> Proxy mapping (Responses-first)

| Contract item | Copilot source | Proxy source | Notes |
| --- | --- | --- | --- |
| GPT-5 uses Responses API | `external/obsidian-copilot/src/LLMProviders/chatModelManager.ts` | `src/routes/responses.js` | `/v1/responses` is primary for GPT-5. |
| XML tool call contract | `external/obsidian-copilot/src/LLMProviders/chainRunner/utils/modelAdapter.ts` | `src/lib/tools/obsidianToolsSpec.js` | XML format must be preserved in text. |
| XML parser | `external/obsidian-copilot/src/LLMProviders/chainRunner/utils/xmlParsing.ts` | `src/handlers/chat/stream.js` | Proxy must not suppress `<use_tool>` in obsidian-xml. |
| Streaming truncation to last tool | `external/obsidian-copilot/src/LLMProviders/chainRunner/utils/ThinkBlockStreamer.ts` | `src/handlers/chat/stream.js` | Truncation logic relies on valid XML blocks. |
| Responses default output mode | -- | `src/config/index.js`, `src/handlers/responses/stream.js` | Default `openai-json` conflicts with XML. |
| Ingress diagnostics | -- | `src/handlers/responses/ingress-logging.js` | Logs markers for `<use_tool>` and `<recent_conversations>`. |


### B) File index (paths + purpose)
- `external/obsidian-copilot/src/LLMProviders/chatModelManager.ts` -- sets `useResponsesApi` for GPT-5.
- `external/obsidian-copilot/src/LLMProviders/chainRunner/utils/modelAdapter.ts` -- XML tool call prompt rules.
- `external/obsidian-copilot/src/LLMProviders/chainRunner/utils/xmlParsing.ts` -- XML tool call parser.
- `external/obsidian-copilot/src/LLMProviders/chainRunner/utils/ThinkBlockStreamer.ts` -- streaming assembly + tool block truncation.
- `src/routes/responses.js` -- `/v1/responses` routing and guardrails.
- `src/handlers/responses/stream.js` -- Responses -> chat delegation + output-mode defaults.
- `src/handlers/responses/stream-adapter.js` -- typed SSE event emission.
- `src/handlers/responses/shared.js` -- Responses input coercion + output mapping.
- `src/lib/tool-call-aggregator.js` -- tool call accumulation + XML synthesis support.
- `src/lib/tools/obsidianToolsSpec.js` -- canonical XML output for Copilot tool calls.
- `docs/responses-endpoint/overview.md` -- proxy `/v1/responses` contract and output-mode notes.
- `docs/responses-endpoint/ingress-debug-obsidian-cross-chat-weather.md` -- real Copilot prompt contamination case.
