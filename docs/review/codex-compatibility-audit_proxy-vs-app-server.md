# Codex Compatibility Audit: Proxy vs App-Server

## 1. Executive Summary

Top 10 compatibility improvements (ranked):
1. Emit `call_id` in `response.output_item.done` items for tool calls (Responses SSE) when using openai-json output; current items omit `call_id`, which makes strict Responses parsers (e.g., Codex exec) drop tool calls (Copilot's obsidian-xml flow still works).
2. Rebuild Responses non-stream output so tool calls are separate `ResponseItem::FunctionCall` items, not `tool_use` content inside a message.
3. Preserve Responses input items (especially `function_call_output` and non-text multimodal content) instead of flattening to text.
4. Guard Obsidian Copilot tool call formats by output mode: preserve XML `<use_tool>` blocks and `tool_calls`/`function_call` deltas on `/v1/responses` (Copilot primary) while keeping `/v1/chat/completions` backward compatible.
5. Add `/v1/responses/compact` handler to support exec remote compaction.
6. Map Responses `text.format` (JSON schema) into chat `response_format` / app-server `final_output_json_schema` so schema-aware outputs work.
7. Align JSON-RPC envelopes to app-server contract (omit `jsonrpc`, accept messages without it).
8. Map app-server JSON-RPC error codes (`-32600`, `-32603`) to HTTP status/shape parity to surface invalid-request causes.
9. Adopt `mcpServerStatus/list` to fetch MCP tool schemas and surface them consistently in Responses/Chat tool lists.
10. Preserve tool-call argument string semantics end-to-end and add parse-failure telemetry for JSON-RPC and Responses SSE.

Biggest must-fix parity gaps:
- Responses SSE tool-call items are missing `call_id`, which breaks exec parsing of `ResponseItem::FunctionCall`.
- Responses non-stream output shape does not emit `ResponseItem::FunctionCall` items, which makes tool calls invisible to exec.
- Responses input coercion drops `function_call_output` and non-text items, breaking tool-call round trips and multimodal parity.

Top 3 changes most likely to reduce "mysterious" exec/app-server failures:
1. Fix `call_id` emission for `response.output_item.done` (plus align non-stream outputs to `ResponseItem::FunctionCall`).
2. Add `/v1/responses/compact` to prevent remote compaction errors from surfacing as opaque context failures.
3. Relax JSON-RPC envelope handling (accept missing `jsonrpc`, map `-32600`/`-32603` to HTTP errors).

Specific questions answered:
- Incorrect response shapes: tool-call items missing `call_id` and non-stream Responses output lacking `ResponseItem::FunctionCall` are confirmed mismatches (see Section 4).
- Underused endpoints: `thread/*`, `turn/*`, `mcpServerStatus/list`, and config/account endpoints are unused and would improve parity (see Section 5).
- Config divergence: `PROXY_IGNORE_CLIENT_SYSTEM_PROMPT`, `PROXY_ENABLE_PARALLEL_TOOL_CALLS`, and app-server tool toggles diverge from Codex expectations (see Sections 4 and 5).
- Copilot tool calls: Obsidian Copilot uses `/v1/responses` for GPT-5 and expects XML `<use_tool>` blocks plus OpenAI-style `tool_calls`/`function_call` deltas; changes must be gated by output mode to avoid regressions (see Section 4).

## 2. Baseline: Codex Schema Reference (What We're Using)

Reference doc: `docs/reference/codex-app-server-and-exec-schema-reference.md`

Contract Items (derived from the reference doc):
- JSON-RPC envelope omits `jsonrpc` on the wire; requests/notifications/responses are `JSONRPCRequest`, `JSONRPCNotification`, `JSONRPCResponse`, `JSONRPCError`. Ref: [Schema sources](../reference/codex-app-server-and-exec-schema-reference.md#schema-sources). Submodule: `external/codex/codex-rs/app-server-protocol/src/jsonrpc_lite.rs` (`JSONRPCRequest`, `JSONRPCNotification`, `JSONRPCResponse`, `JSONRPCError`). Strictness: required on wire; extra/invalid fields are not part of the contract.
- Validation pipeline: request JSON is re-deserialized into `ClientRequest` and invalid requests return `-32600`. Ref: [Validation pipeline](../reference/codex-app-server-and-exec-schema-reference.md#validation-pipeline). Submodule: `external/codex/codex-rs/app-server/src/message_processor.rs` (`ClientRequest` deserialization), `external/codex/codex-rs/app-server/src/error_code.rs` (`-32600`). Strictness: hard error.
- App-server notification types are method-tagged enums generated in `server_notification_definitions!`. Ref: [Response representation](../reference/codex-app-server-and-exec-schema-reference.md#response-representation-including-streaming-if-present). Submodule: `external/codex/codex-rs/app-server-protocol/src/protocol/common.rs` (`server_notification_definitions!`). Strictness: required for JSON-RPC event handling.
- Tool config toggles are limited to `Tools`/`ToolsV2` with `web_search`/`view_image`. Ref: [Tool/function representation](../reference/codex-app-server-and-exec-schema-reference.md#toolfunction-representation). Submodule: `external/codex/codex-rs/app-server-protocol/src/protocol/v1.rs` (`Tools`), `external/codex/codex-rs/app-server-protocol/src/protocol/v2.rs` (`ToolsV2`). Strictness: optional toggles.
- Full tool definitions are surfaced via MCP (`McpTool`, `ToolInputSchema`, `ToolOutputSchema`). Ref: [Tool/function representation](../reference/codex-app-server-and-exec-schema-reference.md#toolfunction-representation). Submodule: `external/codex/codex-rs/mcp-types/src/lib.rs` (`McpTool`). Strictness: required when listing MCP tools.
- Thread items represent tool calls as `ThreadItem::McpToolCall` (`server`, `tool`, `arguments`, `result`, `error`). Ref: [Tool/function representation](../reference/codex-app-server-and-exec-schema-reference.md#toolfunction-representation). Submodule: `external/codex/codex-rs/app-server-protocol/src/protocol/v2.rs` (`ThreadItem::McpToolCall`). Strictness: required for v2 thread history.
- Responses API request shape includes `{ model, instructions, input, tools, tool_choice:"auto", parallel_tool_calls, stream:true }` and optional `text.format` with strict JSON schema. Ref: [Request construction](../reference/codex-app-server-and-exec-schema-reference.md#request-construction). Submodule: `external/codex/codex-rs/codex-api/src/common.rs` (`ResponsesApiRequest`), `external/codex/codex-rs/codex-api/src/requests/responses.rs` (request builder). Strictness: required when exec builds requests.
- Responses SSE requires `response.completed` before stream end; tool calls arrive as `response.output_item.done` (`ResponseItem`). Ref: [Response parsing](../reference/codex-app-server-and-exec-schema-reference.md#response-parsing). Submodule: `external/codex/codex-rs/codex-api/src/sse/responses.rs` (`process_sse` and `ResponseItem` parsing). Strictness: hard error if missing `response.completed`.
- Chat SSE tool calls are reconstructed from `choices[].delta.tool_calls` with `function.arguments` as a JSON string. Ref: [Response parsing](../reference/codex-app-server-and-exec-schema-reference.md#response-parsing). Submodule: `external/codex/codex-rs/codex-api/src/sse/chat.rs` (tool call reconstruction), `external/codex/codex-rs/protocol/src/models.rs` (`FunctionCall.arguments`). Strictness: strict string semantics.
- Tool call handling requires `ResponseItem::FunctionCall.arguments` as a JSON string and `FunctionCallOutputPayload` string-vs-object semantics. Ref: [Tool-call handling](../reference/codex-app-server-and-exec-schema-reference.md#tool-call-handling). Submodule: `external/codex/codex-rs/protocol/src/models.rs` (`FunctionCall`, `FunctionCallOutputPayload`). Strictness: required.
- Exec adds headers `conversation_id`, `session_id`, `x-openai-subagent` when available. Ref: [Request construction](../reference/codex-app-server-and-exec-schema-reference.md#request-construction). Submodule: `external/codex/codex-rs/codex-api/src/requests/headers.rs` (header attachment). Strictness: optional but important for session continuity.
- Remote compaction uses `POST /v1/responses/compact` returning `{ output: ResponseItem[] }`. Ref: [Request construction](../reference/codex-app-server-and-exec-schema-reference.md#request-construction). Submodule: `external/codex/codex-rs/codex-api/src/endpoint/compact.rs` (request/response). Strictness: required when compaction is enabled.
- JSON-RPC error shape `{ code, message, data? }` with app-server codes `-32600`, `-32603`. Ref: [Error representation](../reference/codex-app-server-and-exec-schema-reference.md#error-representation). Submodule: `external/codex/codex-rs/app-server-protocol/src/jsonrpc_lite.rs` (`JSONRPCError`), `external/codex/codex-rs/app-server/src/error_code.rs` (codes). Strictness: required for error parity.

## 3. Systems Under Review

Proxy: key components + entrypoints (with paths)
- HTTP routing: `src/routes/responses.js` (`responsesRouter`), `src/routes/chat.js` (chat routes).
- Responses adapters: `src/handlers/responses/stream.js` (`postResponsesStream`), `src/handlers/responses/nonstream.js` (`postResponsesNonStream`), `src/handlers/responses/shared.js` (`coerceInputToChatMessages`, `convertChatResponseToResponses`), `src/handlers/responses/stream-adapter.js` (`createResponsesStreamAdapter`).
- Chat streaming/non-streaming: `src/handlers/chat/stream.js` (`postChatStream`), `src/handlers/chat/nonstream.js` (`postChatNonStream`), `src/handlers/chat/request.js` (`normalizeChatJsonRpcRequest`).
- Tool call aggregation: `src/lib/tool-call-aggregator.js` (`createToolCallAggregator`).
- JSON-RPC transport: `src/services/transport/index.js` (`JsonRpcTransport`, `createChatRequest`, `sendUserMessage`), `src/services/transport/child-adapter.js` (`JsonRpcChildAdapter`), `src/lib/json-rpc/schema.ts` (JSON-RPC types/builders).
- Config flags: `src/config/index.js` (PROXY/CODEX flags affecting parity).
- Runtime backend selection: `src/services/backend-mode.js` (app-server vs proto), `src/services/worker/supervisor.js` (spawns `codex app-server`), `src/handlers/chat/shared.js` (`buildAppServerArgs`, `buildProtoArgs`). No `codex exec` subcommand usage in runtime.

Codex submodule: app-server + exec key components (with paths)
- App-server runtime: `external/codex/codex-rs/app-server/src/lib.rs` (JSON-RPC stdio), `external/codex/codex-rs/app-server/src/main.rs`.
- App-server protocol: `external/codex/codex-rs/app-server-protocol/src/jsonrpc_lite.rs`, `external/codex/codex-rs/app-server-protocol/src/protocol/common.rs`, `external/codex/codex-rs/app-server-protocol/src/protocol/v1.rs`, `external/codex/codex-rs/app-server-protocol/src/protocol/v2.rs`.
- Exec/Responses parsing: `external/codex/codex-rs/codex-api/src/requests/responses.rs`, `external/codex/codex-rs/codex-api/src/sse/responses.rs`, `external/codex/codex-rs/codex-api/src/sse/chat.rs`.
- ResponseItem/tool models: `external/codex/codex-rs/protocol/src/models.rs`.
- MCP schemas: `external/codex/codex-rs/mcp-types/src/lib.rs`.
- Note: Exec and app-server are parallel interfaces; exec is not invoked by the proxy. Exec is referenced only as a strict Responses contract implementation.

Obsidian Copilot submodule: tool-call expectations (with paths)
- Tool call instructions and XML `<use_tool>` examples: `external/obsidian-copilot/docs/TOOLS.md`.
- XML tool call parsing: `external/obsidian-copilot/src/LLMProviders/chainRunner/utils/xmlParsing.ts` (`parseXMLToolCalls`).
- Tool calling modes (legacy vs XML autonomous agent): `external/obsidian-copilot/src/LLMProviders/chainRunner/README.md`.
- Streaming delta handling for `tool_calls`/`function_call`: `external/obsidian-copilot/src/LLMProviders/ChatOpenRouter.ts` (`buildMessageChunk`).
- Responses API selection for GPT-5: `external/obsidian-copilot/src/LLMProviders/chatModelManager.ts` (`useResponsesApi`).

## 4. Audit Findings: Proxy vs Contract (Reference-Driven)

### Must-fix incompatibilities (blocking) - confirmed by code
Note: "must-fix" here means blocking for Codex exec and strict Responses clients using openai-json output. Obsidian Copilot tool calls can still work in obsidian-xml mode.

**Finding: Responses SSE tool-call items omit `call_id`**
- Contract expects: Responses SSE `response.output_item.done` must deserialize into `ResponseItem::FunctionCall` with `call_id`. Ref: [Response parsing](../reference/codex-app-server-and-exec-schema-reference.md#response-parsing), [Tool-call handling](../reference/codex-app-server-and-exec-schema-reference.md#tool-call-handling). Submodule: `external/codex/codex-rs/codex-api/src/sse/responses.rs` (`ResponseItem` parsing), `external/codex/codex-rs/protocol/src/models.rs` (`ResponseItem::FunctionCall`).
- Proxy currently does: Emits `item: { id, type, name, arguments, status }` without `call_id`. Proxy: `src/handlers/responses/stream-adapter.js` (`finalizeToolCalls`).
- Impact: Strict Responses parsers (including Codex exec) fail to parse tool-call items; tool calls are dropped in streaming, causing missing tool invocations and downstream failures. Copilot flows that rely on XML `<use_tool>` + `tool_calls` deltas remain functional in obsidian-xml mode.
- Recommended fix: In `src/handlers/responses/stream-adapter.js`, emit `call_id` (set to the tool call id) and align fields to `ResponseItem::FunctionCall`. Update `response.output_item.added` and `response.output_item.done` to include `call_id`. Preserve Copilot output mode behavior on `/v1/responses` (do not remove XML `<use_tool>` blocks or `tool_calls` deltas when `obsidian-xml` is requested).

**Finding: Responses non-stream output shape lacks `ResponseItem::FunctionCall`**
- Contract expects: Responses output is a list of `ResponseItem` items, including `FunctionCall` and `FunctionCallOutput` when tool calls occur. Ref: [Tool-call handling](../reference/codex-app-server-and-exec-schema-reference.md#tool-call-handling), [Response parsing](../reference/codex-app-server-and-exec-schema-reference.md#response-parsing). Submodule: `external/codex/codex-rs/protocol/src/models.rs` (`ResponseItem::FunctionCall`).
- Proxy currently does: Converts Chat Completions payloads into a single `message` output with `tool_use` content entries. Proxy: `src/handlers/responses/shared.js` (`convertChatResponseToResponses`, `mapChoiceToOutput`).
- Impact: Non-stream Responses tool calls are invisible to exec/parsers expecting `ResponseItem::FunctionCall` items, breaking tool workflows.
- Recommended fix: Modify `convertChatResponseToResponses` to emit `ResponseItem::FunctionCall` items (with `call_id`, `name`, `arguments` string) in the `output` array, and keep message outputs separate. Gate the new ResponseItem layout by output mode so Copilot's `/v1/responses` traffic can continue to consume XML/tool call deltas as needed.

**Finding: Responses input coercion drops `function_call_output` and non-text items**
- Contract expects: Responses input supports `ResponseItem` history, including `function_call_output` items and multimodal inputs. Ref: [Request construction](../reference/codex-app-server-and-exec-schema-reference.md#request-construction), [Tool-call handling](../reference/codex-app-server-and-exec-schema-reference.md#tool-call-handling). Submodule: `external/codex/codex-rs/protocol/src/models.rs` (`FunctionCallOutput`), `external/codex/codex-rs/codex-api/src/common.rs` (`ResponsesApiRequest.input`).
- Proxy currently does: Flattens Responses `input` into text via `coerceInputToChatMessages`, discarding non-text content and tool outputs. Proxy: `src/handlers/responses/shared.js` (`coerceInputToChatMessages`, `extractTextFromInputItems`).
- Impact: Tool-call round trips are broken for Responses clients (tool outputs are not fed back), and multimodal inputs degrade to text.
- Recommended fix: Add a ResponseItem-to-chat mapping layer that preserves `function_call_output` as `role:"tool"` messages, and forwards non-text content (image_url/local_image) when supported. Keep `obsidian-xml` output mode intact for Copilot requests to `/v1/responses`.

**Finding: `/v1/responses/compact` is missing**
- Contract expects: `POST /v1/responses/compact` returns `{ output: ResponseItem[] }` for remote compaction. Ref: [Request construction](../reference/codex-app-server-and-exec-schema-reference.md#request-construction), [Minimal Compatibility Contract](../reference/codex-app-server-and-exec-schema-reference.md#minimal-compatibility-contract). Submodule: `external/codex/codex-rs/codex-api/src/endpoint/compact.rs`.
- Proxy currently does: No route/handler for `/v1/responses/compact`. Proxy: `src/routes/responses.js` (only `/v1/responses`).
- Impact: Exec remote compaction fails (context trimming errors surface as unexpected failures).
- Recommended fix: Add `src/routes/responses/compact.js` + handler or extend `src/routes/responses.js` to support `/v1/responses/compact`, mapping to chat/app-server as required.

### Must-fix incompatibilities (blocking) - inferred/likely

**Finding: Responses `response.completed` payload omits structured tool items**
- Contract expects: `response.completed.response.output` should include all `ResponseItem` entries accumulated from `response.output_item.done`. Ref: [Response parsing](../reference/codex-app-server-and-exec-schema-reference.md#response-parsing). Submodule: `external/codex/codex-rs/codex-api/src/sse/responses.rs` (`ResponseCompleted`).
- Proxy currently does: Builds `response.completed.response` from chat-to-responses conversion, which does not include `FunctionCall` items. Proxy: `src/handlers/responses/stream-adapter.js` (`convertChatResponseToResponses`).
- Impact: Consumers relying on `response.completed.response` snapshots may miss tool-call items even after fixing streaming items.
- Recommended fix: Rebuild `response.completed.response.output` from the same tool-call snapshot used for `response.output_item.done` to ensure parity.

### Should-fix inconsistencies (high value) - confirmed by code

**Finding: JSON-RPC envelope requires `jsonrpc` while app-server omits it**
- Contract expects: No `jsonrpc` field on the wire; JSON-RPC-lite envelope. Ref: [Schema sources](../reference/codex-app-server-and-exec-schema-reference.md#schema-sources). Submodule: `external/codex/codex-rs/app-server-protocol/src/jsonrpc_lite.rs` (comment in file header).
- Proxy currently does: Requires and emits `jsonrpc:"2.0"` in schema/builders. Proxy: `src/lib/json-rpc/schema.ts` (`JsonRpcBaseEnvelope`), `src/services/transport/index.js` (`#write` calls).
- Impact: Contract divergence; future app-server strictness could reject or ignore messages, and proxy type guards will not validate server notifications.
- Recommended fix: Make `jsonrpc` optional in proxy schema, and omit it in outbound JSON-RPC unless explicitly required by upstream.

**Finding: JSON-RPC error codes are not mapped to HTTP parity**
- Contract expects: `-32600` invalid request, `-32603` internal error. Ref: [Error representation](../reference/codex-app-server-and-exec-schema-reference.md#error-representation). Submodule: `external/codex/codex-rs/app-server/src/error_code.rs`.
- Proxy currently does: Treats JSON-RPC errors as `TransportError` and maps them to generic 500/503. Proxy: `src/services/transport/index.js` (`#handleRpcResponse`, `mapTransportError`).
- Impact: Invalid request errors surface as server errors, masking actionable client fixes.
- Recommended fix: Add explicit mappings for `-32600` and `-32603` to HTTP 400/500 in `mapTransportError` and error serializers.

**Finding: Responses `text.format` (JSON schema) is not mapped**
- Contract expects: JSON schema output uses `text.format` with strict schema semantics. Ref: [Request construction](../reference/codex-app-server-and-exec-schema-reference.md#request-construction). Submodule: `external/codex/codex-rs/codex-api/src/common.rs` (`text.format` usage).
- Proxy currently does: Passes Responses body to chat handlers without mapping `text.format` into `response_format`/`final_output_json_schema`. Proxy: `src/handlers/responses/stream.js`, `src/handlers/responses/nonstream.js`, `src/handlers/chat/request.js` (`normalizeResponseFormat`).
- Impact: Schema-constrained outputs are silently ignored in Responses mode.
- Recommended fix: Map `body.text.format` into `response_format` (JSON schema) before handing off to chat/app-server.

**Finding: MCP tool schemas are not sourced from app-server**
- Contract expects: Tool definitions for MCP come from `ListMcpServerStatusResponse` and `McpTool`. Ref: [Tool/function representation](../reference/codex-app-server-and-exec-schema-reference.md#toolfunction-representation). Submodule: `external/codex/codex-rs/app-server-protocol/src/protocol/v2.rs` (`ListMcpServerStatusResponse`), `external/codex/codex-rs/mcp-types/src/lib.rs` (`McpTool`).
- Proxy currently does: No `mcpServerStatus/list` usage; tool schemas are only what clients send. Proxy: `rg "mcpServerStatus" src` (no matches), tool routing in `src/handlers/chat/request.js`.
- Impact: App-server tools are underutilized; tool list diverges from Codex exec behavior, and MCP tool calls cannot be surfaced with full schema fidelity.
- Recommended fix: Add an app-server capability sync step (fetch MCP tool list and inject into Responses/Chat tool definitions when app-server mode is active).

**Finding: Tool-call argument string semantics are at risk in Responses output mapping**
- Contract expects: `FunctionCall.arguments` is a JSON string (not an object). Ref: [Tool-call handling](../reference/codex-app-server-and-exec-schema-reference.md#tool-call-handling). Submodule: `external/codex/codex-rs/protocol/src/models.rs` (`FunctionCall.arguments`).
- Proxy currently does: `mapToolCallToContent` attempts to parse arguments into objects for `tool_use` content. Proxy: `src/handlers/responses/shared.js` (`mapToolCallToContent`).
- Impact: Argument strings can be lost or reserialized, producing mismatched payloads.
- Recommended fix: Preserve raw argument strings in Responses output items; only parse when explicitly rendering for UI.

**Finding: Config flags diverge from exec request semantics**
- Contract expects: Exec preserves `instructions` and passes `parallel_tool_calls` from Responses requests. Ref: [Request construction](../reference/codex-app-server-and-exec-schema-reference.md#request-construction). Submodule: `external/codex/codex-rs/codex-api/src/common.rs` (`ResponsesApiRequest`).
- Proxy currently does: `PROXY_IGNORE_CLIENT_SYSTEM_PROMPT` defaults to true (dropping system/developer messages) and `PROXY_ENABLE_PARALLEL_TOOL_CALLS` is dev-gated. Proxy: `src/config/index.js` (`PROXY_IGNORE_CLIENT_SYSTEM_PROMPT`, `PROXY_ENABLE_PARALLEL_TOOL_CALLS`), `src/handlers/chat/request.js` (`IGNORE_CLIENT_SYSTEM_PROMPT`), `src/handlers/chat/shared.js` (`buildAppServerArgs`, `buildProtoArgs`).
- Impact: Client-supplied instructions and parallel tool call behavior diverge from exec expectations, leading to hard-to-debug differences between environments.
- Recommended fix: Honor system/developer messages by default in Responses mode and enable parallel tool calls when explicitly requested, with a clear feature-flag override.

**Finding: Observability gaps around JSON-RPC and Responses parsing**
- Contract expects: strict parsing of SSE events and JSON-RPC messages. Ref: [Response parsing](../reference/codex-app-server-and-exec-schema-reference.md#response-parsing), [Validation pipeline](../reference/codex-app-server-and-exec-schema-reference.md#validation-pipeline).
- Proxy currently does: Logs are present but do not consistently record JSON-RPC error codes, missing `response.completed`, or failed `ResponseItem` deserialization. Proxy: `src/services/transport/index.js` (limited error mapping), `src/handlers/responses/stream-adapter.js` (summary logs but no parse failure counters).
- Impact: Compatibility failures appear as generic server errors without root-cause breadcrumbs.
- Recommended fix: Add structured logs + counters keyed by `rpc_method`, `rpc_error_code`, `response_event_type`, and `response_item_parse_error`.

### Should-fix inconsistencies (high value) - inferred/likely

**Finding: Responses tool outputs may not preserve `FunctionCallOutputPayload` semantics**
- Contract expects: success output is a string; failure output is an object with `content` + `success:false`. Ref: [Tool-call handling](../reference/codex-app-server-and-exec-schema-reference.md#tool-call-handling). Submodule: `external/codex/codex-rs/protocol/src/models.rs` (`FunctionCallOutputPayload`).
- Proxy currently does: Tool output shaping is not explicitly mapped for Responses input/output; any object-to-string conversion is ad hoc. Proxy: `src/handlers/responses/shared.js` (`extractTextFromInputItems`).
- Impact: Tool output payloads may be malformed or flattened; exec tool handling can misbehave.
- Recommended fix: Normalize tool output payloads according to `FunctionCallOutputPayload` in Responses request handling and tests.

### Copilot tool-call constraints (do-not-break) - confirmed by code

**Finding: Obsidian Copilot now routes GPT-5 via Responses API**
- Contract expects: Responses API is enabled for GPT-5 in Copilot and is the primary path when `useResponsesApi` is set. Submodule: `external/obsidian-copilot/src/LLMProviders/chatModelManager.ts` (`useResponsesApi`).
- Proxy currently does: Treats `/v1/responses` as a compatibility layer for exec but does not explicitly document Copilot as a primary client. Proxy: `src/routes/responses.js` (`responsesRouter`), `src/handlers/responses/stream.js`.
- Impact: Responses-specific format changes can directly break Copilot tool calling if not output-mode guarded.
- Recommended fix: Treat `/v1/responses` as a first-class client surface and preserve Copilot XML/tool-call behavior under `obsidian-xml` output mode.

**Finding: Obsidian Copilot autonomous agent depends on XML `<use_tool>` blocks**
- Contract expects: XML tool call blocks are present in assistant text and parseable into `name` + args. Submodule: `external/obsidian-copilot/docs/TOOLS.md` (XML examples), `external/obsidian-copilot/src/LLMProviders/chainRunner/utils/xmlParsing.ts` (`parseXMLToolCalls`), `external/obsidian-copilot/src/LLMProviders/chainRunner/README.md` (XML-based autonomous agent).
- Proxy currently does: Extracts `<use_tool>` blocks via text pattern matching and emits OpenAI-style tool call deltas; `obsidian-xml` output mode keeps XML in the text stream. Proxy: `src/lib/tool-call-aggregator.js` (`extractUseToolBlocks`), `src/handlers/chat/stream.js` and `src/handlers/responses/stream.js` (output mode gating), `src/config/index.js` (`PROXY_OUTPUT_MODE`, `PROXY_RESPONSES_OUTPUT_MODE`).
- Impact: Removing XML blocks or forcing OpenAI-only tool calls in Responses output would break autonomous agent tool execution.
- Recommended fix: Keep `obsidian-xml` output mode and `<use_tool>` parsing intact for `/v1/responses`; gate ResponseItem-only layouts to `openai-json` mode.

**Finding: Copilot streaming accepts `tool_calls` and `function_call` deltas**
- Contract expects: Streaming deltas may carry `tool_calls` or `function_call`; both are consumed. Submodule: `external/obsidian-copilot/src/LLMProviders/ChatOpenRouter.ts` (`buildMessageChunk`). Repo doc: `docs/Integrating Codex Proxy with Obsidian Copilot for Tool Calls.md` (OpenAI function_call delta expectations).
- Proxy currently does: Emits `tool_calls` deltas for tool call events and keeps `function_call` compatibility in non-stream output. Proxy: `src/handlers/chat/stream.js` (`sendChoiceDelta`), `src/handlers/chat/nonstream.js` (`buildAssistantMessage`), `src/handlers/responses/stream.js` (delegates to chat stream).
- Impact: Switching Responses output to ResponseItem-only payloads (or removing `tool_calls`/`function_call`) would break Copilot streaming.
- Recommended fix: Preserve `tool_calls`/`function_call` emission for `/v1/responses` when `obsidian-xml` is requested; keep `/v1/chat/completions` backward compatible.

### Nice-to-have improvements (low risk / future proofing) - confirmed by code

**Finding: Proxy uses legacy v1 JSON-RPC methods only**
- Contract expects: v2 thread/turn APIs are available (`thread/start`, `turn/start`, `review/start`, etc.). Ref: [Submodule inventory](../reference/codex-app-server-and-exec-schema-reference.md#2-submodule-inventory-paths-key-packages-key-entrypoints). Submodule: `external/codex/codex-rs/app-server-protocol/src/protocol/common.rs` (`ClientRequest` with v2 endpoints).
- Proxy currently does: Uses `initialize`, `newConversation`, `sendUserTurn`, `sendUserMessage`, `addConversationListener` only. Proxy: `src/services/transport/index.js` (`#callWorkerRpc` calls).
- Impact: Misses richer thread/turn state and tool call events, limiting parity and observability.
- Recommended fix: Add v2 method support behind a feature flag and gradually migrate.

### Nice-to-have improvements (low risk / future proofing) - inferred/likely

**Finding: Tools toggles (`web_search`, `view_image`) are not wired to app-server config**
- Contract expects: `Tools`/`ToolsV2` flags gate web search and image view. Ref: [Tool/function representation](../reference/codex-app-server-and-exec-schema-reference.md#toolfunction-representation). Submodule: `external/codex/codex-rs/app-server-protocol/src/protocol/v2.rs` (`ToolsV2`).
- Proxy currently does: Hard-codes `tools.web_search=false` in proto args; app-server config is not explicitly set. Proxy: `src/handlers/chat/shared.js` (`buildProtoArgs`, `buildAppServerArgs`).
- Impact: Tool availability may diverge from Codex defaults and UI expectations.
- Recommended fix: Read tools toggles from config and pass to app-server config explicitly.

## 5. Underused App-Server Endpoints & Features (Adoption Opportunities)

Inventory (non-exhaustive) from `ClientRequest` (v2 + legacy) and why they matter:
- `thread/start`, `thread/resume`, `thread/list`, `thread/archive`: enable structured thread lifecycle and history (parity with Codex UI).
- `turn/start`, `turn/interrupt`: explicit turn lifecycle control, better cancellation semantics.
- `review/start`: inline or detached review flows to align with Codex review mode.
- `model/list`: discover available models from app-server instead of static config.
- `mcpServerStatus/list`, `mcpServer/oauth/login`: discover MCP tool schemas and auth status.
- `config/read`, `config/value/write`, `config/batchWrite`: sync config state and tool toggles.
- `account/login/start`, `account/login/cancel`, `account/read`, `account/logout`, `account/rateLimits/read`: align with auth and rate-limit signaling.
- `feedback/upload`: enable upstream feedback reporting.
- `command/exec`: app-server sandbox exec for parity with Codex tool calls.
- `fuzzyFileSearch`: search integration for repo context features.

Top adoption recommendations (priority order):
1. `mcpServerStatus/list` for MCP tool schemas, enabling tool list parity and better tool-call routing. Proxy files: `src/services/transport/index.js`, `src/lib/json-rpc/schema.ts`, `src/handlers/chat/request.js`.
2. `thread/start` + `turn/start` (v2) to unlock thread/turn notifications and richer tool call events. Proxy files: `src/services/transport/index.js`, `src/lib/json-rpc/schema.ts`.
3. `config/read` + `config/value/write` to sync app-server config (tools toggles, reasoning defaults). Proxy files: `src/services/transport/index.js`.
4. `model/list` to align model availability with app-server and avoid config drift. Proxy files: `src/handlers/models` (if present), `src/services/transport/index.js`.

## 6. Compatibility Improvement Plan

### Goal
- Deliver parity for Responses tool calls, Responses compaction, and app-server JSON-RPC envelopes with minimal risk.

### Assumptions / constraints
- No submodule changes; only proxy edits.
- Responses endpoint is the main parity target for exec compatibility.
- App-server runs with default JSON-RPC-lite envelopes (no `jsonrpc` field).

### Research (current state)
- Relevant files/entrypoints:
  - `src/handlers/responses/stream-adapter.js`
  - `src/handlers/responses/shared.js`
  - `src/handlers/responses/stream.js`
  - `src/handlers/responses/nonstream.js`
  - `src/services/transport/index.js`
  - `src/lib/json-rpc/schema.ts`
- Existing patterns to follow:
  - Responses SSE event emission in `src/handlers/responses/stream-adapter.js`
  - JSON-RPC request builders in `src/lib/json-rpc/schema.ts`

### Analysis
#### Options
1) Patch Responses output items in place (minimal change, fastest parity).
2) Rebuild a dedicated Responses transformer that constructs true `ResponseItem` arrays (more invasive, higher confidence).
3) Maintain current shapes and add compatibility shim in exec (not allowed; submodule changes prohibited).

#### Decision
- Chosen: (1) now, (2) after Phase 0 once tests are in place.
- Why: allows rapid parity fix with limited code churn, then a clean refactor.

#### Risks / edge cases
- Tool call ids may be missing upstream; fallback id generation must align with exec expectations.
- Responses tool outputs may arrive in unusual sequences (parallel tool calls).
- JSON-RPC envelope change could break legacy workers that expect `jsonrpc:"2.0"`.
- Obsidian Copilot relies on XML `<use_tool>` blocks and `tool_calls`/`function_call` deltas; changes must be gated by endpoint/output mode.

#### Open questions
- None blocking for Phase 0. Any environment-specific compaction settings should be confirmed by ops.

### Q&A (answer before implementation)
- No open questions.

### Implementation plan
Phase 0 (parity blockers)
1) Emit `call_id` on `response.output_item.done` and `response.output_item.added` items.
2) Rebuild Responses non-stream outputs to emit `ResponseItem::FunctionCall` items.
3) Preserve `function_call_output` and multimodal inputs in Responses request mapping.
4) Add `/v1/responses/compact` handler.
5) Add output-mode guardrails so Copilot XML/tool call flows remain unchanged for `/v1/responses` when `obsidian-xml` is requested.

Phase 1 (contract alignment)
1) Map `text.format` (Responses JSON schema) to `response_format` / `final_output_json_schema`.
2) Relax JSON-RPC envelope parsing and omit `jsonrpc` on outbound requests.
3) Map JSON-RPC error codes (`-32600`, `-32603`) to HTTP 400/500 with explicit error types.

Phase 2 (feature parity and observability)
1) Add `mcpServerStatus/list` sync and surface MCP tool schemas.
2) Add v2 thread/turn API support behind a feature flag.
3) Add JSON-RPC and Responses SSE parse error metrics + structured logs.

### Acceptance criteria per phase (with suggested tests)
- Phase 0 AC1: Responses streaming tool calls parse as `ResponseItem::FunctionCall` in exec.
  - Tests: add/update `tests/integration/responses.contract.streaming.int.test.js` with tool-call transcript containing `call_id`.
- Phase 0 AC2: Responses non-stream tool calls appear as `ResponseItem::FunctionCall` in output list.
  - Tests: update `tests/integration/responses.contract.nonstream.int.test.js`, add unit coverage in `tests/unit/responses.shared.spec.js`.
- Phase 0 AC3: Responses input preserves `function_call_output` items and non-text inputs.
  - Tests: new unit test around `coerceInputToChatMessages` replacement mapping.
- Phase 0 AC4: `/v1/responses/compact` responds with `{ output: ResponseItem[] }`.
  - Tests: add integration test under `tests/integration/responses.compact.int.test.js`.
- Phase 0 AC5: Obsidian Copilot tool-call parsing still works in `obsidian-xml` mode on `/v1/responses` (XML `<use_tool>` blocks + `tool_calls`/`function_call` deltas).
  - Tests: add integration test under `tests/integration/responses.obsidian-tool-calls.int.test.js` and validate against `external/obsidian-copilot/src/LLMProviders/chainRunner/utils/xmlParsing.ts`.

- Phase 1 AC1: Requests with `text.format` enforce JSON schema in app-server mode.
  - Tests: extend `tests/integration/responses.contract.nonstream.int.test.js` to include schema output.
- Phase 1 AC2: JSON-RPC messages without `jsonrpc` are accepted and processed.
  - Tests: update `tests/unit/services/json-rpc-transport.spec.js`.
- Phase 1 AC3: JSON-RPC `-32600` maps to HTTP 400 with `invalid_request_error`.
  - Tests: add unit mapping tests for `mapTransportError`.

- Phase 2 AC1: MCP tool schemas are visible in Responses/Chat tool lists.
  - Tests: add integration test around tool list hydration when app-server mode is enabled.
- Phase 2 AC2: v2 thread/turn APIs are exercised without regression.
  - Tests: add integration test for `thread/start` + `turn/start` under app-server mode.
- Phase 2 AC3: Observability logs/metrics include JSON-RPC error codes and ResponseItem parse failures.
  - Tests: extend metrics tests in `tests/integration/metrics.int.test.js`.

### Tests to run
- `npm run test:unit -- responses.shared.spec.js`
- `npm run test:integration -- responses.contract.streaming.int.test.js`
- `npm run test:integration -- responses.contract.nonstream.int.test.js`
- `npm run test:integration -- responses.compact.int.test.js` (new)
- `npm run test:integration -- responses.obsidian-tool-calls.int.test.js` (new)

## 7. Appendix

Mapping tables (endpoint-by-endpoint, field-by-field)

Endpoint mapping:
| Contract surface | Submodule source | Proxy implementation | Notes |
| --- | --- | --- | --- |
| `POST /v1/responses` | `external/codex/codex-rs/codex-api/src/requests/responses.rs` (`ResponsesApiRequest`) | `src/routes/responses.js` (`responsesRouter`), `src/handlers/responses/stream.js`, `src/handlers/responses/nonstream.js` | Responses -> Chat mapping with stream adapter |
| `POST /v1/chat/completions` | `external/codex/codex-rs/codex-api/src/requests/chat.rs` | `src/handlers/chat/stream.js`, `src/handlers/chat/nonstream.js` | Used as backend for Responses |
| `POST /v1/responses/compact` | `external/codex/codex-rs/codex-api/src/endpoint/compact.rs` | (missing) | Must add route/handler |
| JSON-RPC `initialize` | `external/codex/codex-rs/app-server-protocol/src/protocol/common.rs` (`ClientRequest::Initialize`) | `src/services/transport/index.js` (`ensureHandshake`) | Sends `jsonrpc` today |
| JSON-RPC `newConversation` | `external/codex/codex-rs/app-server-protocol/src/protocol/common.rs` (`ClientRequest::NewConversation`) | `src/services/transport/index.js` (`#ensureConversation`) | Legacy v1 only |
| JSON-RPC `sendUserTurn` | `external/codex/codex-rs/app-server-protocol/src/protocol/common.rs` (`ClientRequest::SendUserTurn`) | `src/services/transport/index.js` (`#sendUserTurn`) | Additional fields are sent but ignored |
| JSON-RPC `sendUserMessage` | `external/codex/codex-rs/app-server-protocol/src/protocol/common.rs` (`ClientRequest::SendUserMessage`) | `src/services/transport/index.js` (`sendUserMessage`) | Additional fields are sent but ignored |

Field mapping:
| Contract field | Submodule source | Proxy field | Notes |
| --- | --- | --- | --- |
| `ResponseItem::FunctionCall.call_id` | `external/codex/codex-rs/protocol/src/models.rs` (`FunctionCall.call_id`) | `item.id` in `response.output_item.done` | Missing `call_id` today |
| `ResponseItem::FunctionCall.arguments` (string) | `external/codex/codex-rs/protocol/src/models.rs` | `tool_calls[].function.arguments` | Must preserve raw string |
| `function_call_output` payload | `external/codex/codex-rs/protocol/src/models.rs` (`FunctionCallOutputPayload`) | Flattened via `extractTextFromInputItems` | Needs explicit mapping |
| `response.completed` required | `external/codex/codex-rs/codex-api/src/sse/responses.rs` | `src/handlers/responses/stream-adapter.js` | Emitted on success; missing on failure |
| JSON-RPC `-32600` errors | `external/codex/codex-rs/app-server/src/error_code.rs` | `TransportError` mapping | Maps to 500/503 currently |

Copilot compatibility mapping:
| Copilot expectation | Submodule source | Proxy implementation | Notes |
| --- | --- | --- | --- |
| XML `<use_tool>` blocks in assistant text | `external/obsidian-copilot/src/LLMProviders/chainRunner/utils/xmlParsing.ts` (`parseXMLToolCalls`) | `src/lib/tool-call-aggregator.js`, `src/handlers/chat/stream.js`, `src/handlers/responses/stream.js` | Preserve `obsidian-xml` output mode |
| Streaming `tool_calls` / `function_call` deltas | `external/obsidian-copilot/src/LLMProviders/ChatOpenRouter.ts` (`buildMessageChunk`) | `src/handlers/chat/stream.js`, `src/handlers/chat/nonstream.js` | Preserve for `/v1/responses` in `obsidian-xml` mode |
| Responses API for GPT-5 | `external/obsidian-copilot/src/LLMProviders/chatModelManager.ts` (`useResponsesApi`) | `src/routes/responses.js`, `src/handlers/responses/stream.js` | Responses is primary for Copilot GPT-5 |

File index (paths + what they do)
- `src/routes/responses.js` - Responses routing and stream/non-stream selection.
- `src/handlers/responses/stream-adapter.js` - Emits typed Responses SSE events.
- `src/handlers/responses/shared.js` - Chat-to-Responses transformation and input coercion.
- `src/handlers/chat/stream.js` - Chat streaming pipeline and tool-call aggregation.
- `src/handlers/chat/nonstream.js` - Chat non-stream pipeline and tool-call aggregation.
- `src/handlers/chat/request.js` - Normalizes HTTP requests into JSON-RPC payloads.
- `src/services/transport/index.js` - JSON-RPC transport to app-server.
- `src/lib/json-rpc/schema.ts` - JSON-RPC type bindings and parameter builders.
- `external/codex/codex-rs/app-server-protocol/src/jsonrpc_lite.rs` - JSON-RPC-lite envelope (no `jsonrpc`).
- `external/codex/codex-rs/app-server-protocol/src/protocol/common.rs` - `ClientRequest` enum and server notification definitions.
- `external/codex/codex-rs/protocol/src/models.rs` - `ResponseItem` and tool-call serialization semantics.
- `external/codex/codex-rs/codex-api/src/sse/responses.rs` - Responses SSE parser (requires `response.completed`).
