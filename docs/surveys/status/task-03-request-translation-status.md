# Task 03 – Request Translation Layer
# Source: docs/surveys/TASK_03_request_translation_layer.md

## Work done
- Added `normalizeInputItems` across schema builders, transport, and child adapter to accept string/typed items and fall back to prompt text, preventing empty payloads.
- Canonicalized JSON-RPC schema workflow (`jsonrpc:schema` stub + `jsonrpc:verify` in CI) and refreshed the exported schema.
- Expanded JSON-RPC unit coverage (schema bindings against the fake worker) to guard transport compatibility.
- Hardened chat→JSON-RPC normalization: history roles (`assistant`, `tool`, `developer`, legacy `function`) are accepted and flattened into the user turn; tools/tool_choice/response_format/reasoning controls are validated with unit coverage.
- AC1 implemented: multi‑turn clients can send full message history; the normalizer emits a single text turn containing prior roles with `[role]` tags when needed.

## Gaps
- Role/history support is **lossy**: assistant/tool turns are serialized into a single text transcript, and tool call metadata is not re‑encoded for the app‑server protocol. This is sufficient for Obsidian Copilot loops but may diverge from true chat‑state semantics.
- Some parameters passed by handlers are ignored by the normalizer (`reqId`, `requestedModel`, `choiceCount`), and turn/message payloads still duplicate fields (tools, schema). This is safe but under‑documented and a drift risk.

## Plan / Acceptance Criteria & Tests
- AC1: Support assistant/tool/developer history via flattened transcript (complete). Test layer: unit + integration. Implementation: allow roles and render `[role]` tags when history is present; add tests for multi‑turn inputs and tool‑result continuation.
- AC2: Tighten validation for tools/response_format/reasoning_effort and reject unsupported shapes. Test layer: unit. Implementation: add explicit validators in `src/handlers/chat/request.js` and tests for invalid tool_choice, json_schema, reasoning controls; ensure error codes are stable.
- AC3: Reconcile turn/message duplication and unused fields; document mapping invariants. Test layer: unit snapshot + transport integration. Implementation: document invariants in `docs/app-server-migration/` and add tests asserting duplicated fields remain consistent; remove or log-ignore unused fields (`requestedModel`, `choiceCount` if unused).
