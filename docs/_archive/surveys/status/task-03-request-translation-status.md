# Task 03 – Request Translation Layer
# Source: docs/surveys/TASK_03_request_translation_layer.md

## Work done
- Added `normalizeInputItems` across schema builders, transport, and child adapter to accept string/typed items and fall back to prompt text, preventing empty payloads.
- Canonicalized JSON-RPC schema workflow (`jsonrpc:schema` stub + `jsonrpc:verify` in CI) and refreshed the exported schema.
- Expanded JSON-RPC unit coverage (schema bindings against the fake worker) to guard transport compatibility.
- Hardened chat→JSON-RPC normalization: history roles (`assistant`, `tool`, `developer`, legacy `function`) are accepted and flattened into the user turn; tools/tool_choice/response_format/reasoning controls are validated with unit coverage.
- AC1 implemented: multi‑turn clients can send full message history; the normalizer emits a single text turn containing prior roles with `[role]` tags when needed.
- AC2 implemented: strict validators for tools/tool_choice/parallel_tool_calls/response_format/reasoning; legacy OpenAI aliases (`functions`, `function_call`, `parallelToolCalls`) normalize into the canonical tool contract; app-server optional param gate now allows `json_object`.
- AC3 implemented: chat handlers no longer pass unused fields into the normalizer; invariants are documented and unit tests assert duplicated turn/message fields stay aligned.

## Gaps
- Role/history support is **lossy**: assistant/tool turns are serialized into a single text transcript, and tool call metadata is not re‑encoded for the app‑server protocol. This is sufficient for Obsidian Copilot loops but may diverge from true chat‑state semantics.
- Turn/message payloads still duplicate fields (tools, schema). Tests ensure they remain consistent, but future protocol changes should update both together.

## Plan / Acceptance Criteria & Tests
- AC1: Support assistant/tool/developer history via flattened transcript (complete). Test layer: unit + integration.
- AC2: Tighten validation for tools/response_format/reasoning_effort and reject unsupported shapes (complete). Test layer: unit.
- AC3: Reconcile turn/message duplication and unused fields; document mapping invariants (complete). Test layer: unit snapshot + transport integration.
