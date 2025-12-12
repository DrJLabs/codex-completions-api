# Chat Request Normalization Invariants

Scope: `/v1/chat/completions` when targeting the app-server JSON-RPC transport.

- **Roles supported:** `system`, `developer`, `user`, `assistant`, `tool`, and legacy `function` roles are accepted. System/developer content is concatenated into `turn.baseInstructions`. All non-system messages are flattened into a single text prompt for the user turn; role tags like `[assistant] ...` / `[tool:name] ...` are included when history is present.
- **Tools contract:** `tools` (or legacy `functions`) must be an array of function tools. `tool_choice` (or legacy `function_call`) accepts `auto`, `none`, `required`, or `{ type: "function", function: { name } }` that references a declared tool. `parallel_tool_calls` (or `parallelToolCalls`) must be boolean when provided.
- **Response format:** `response_format` must be an object. Supported `type` values: `text`, `json_object`, `json_schema`. `json_schema` requires `json_schema.schema` to be a JSON object; its schema is exposed to app-server as `finalOutputJsonSchema`.
- **Reasoning:** `reasoning.effort` is validated against `minimal | low | medium | high` and applied consistently to `turn.effort` and `message.reasoning.effort`.
- **Duplication invariants:** `turn.items` and `message.items` share the same normalized content; `tools` and `finalOutputJsonSchema` are identical across turn/message payloads; non-protocol fields like `choiceCount` are no longer forwarded to JSON-RPC.
