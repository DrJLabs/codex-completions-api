# getFileTree Debugging Notes (Copilot vs Proxy)

## Scope
This document captures how Obsidian Copilot expects `getFileTree` tool calls, how the proxy currently emits them, and why the "Tool executed but returned no result" error can occur. It includes file-level sources for follow-on debugging.

## Copilot: Source of Truth

### Tool definition and schema
- `getFileTree` is defined with a `z.void()` schema (expects **no parameters**).
- The handler always returns a string (prompt + JSON tree) unless it throws.

Sources:
- `external/obsidian-copilot/src/tools/FileTreeTools.ts`
- `external/obsidian-copilot/src/tools/SimpleTool.ts`

### Tool registration
- `getFileTree` is registered in `registerFileTreeTool(...)` and marked always enabled when the vault is available.

Source:
- `external/obsidian-copilot/src/tools/builtinTools.ts`

### Tool call parsing (XML only)
- Copilot parses tool calls from **XML blocks** in assistant text via `parseXMLToolCalls`.
- It does **not** consume structured OpenAI `tool_calls` or `tool_use` items for execution.

Sources:
- `external/obsidian-copilot/src/LLMProviders/chainRunner/utils/xmlParsing.ts`
- `external/obsidian-copilot/src/LLMProviders/chainRunner/AutonomousAgentChainRunner.ts`

### Tool execution error behavior
- If a tool returns `null`/`undefined`, Copilot returns the message:
  `{"message":"Tool executed but returned no result","status":"empty"}`
- This happens when the tool fails validation or throws, because `ToolManager` returns `null` on error.

Sources:
- `external/obsidian-copilot/src/LLMProviders/chainRunner/utils/toolExecution.ts`
- `external/obsidian-copilot/src/tools/toolManager.ts`

## Proxy: What We Emit

### XML generation for Obsidian mode
- Non-stream: `buildCanonicalXml(...)` emits XML using `toObsidianXml` when `function.arguments` parses as JSON.
- Stream: `buildObsidianXmlRecord(...)` emits XML from tool snapshot records.

Sources:
- `src/handlers/chat/nonstream.js`
- `src/handlers/chat/stream.js`
- `src/lib/tools/obsidianToolsSpec.js`

### Potential mismatch for void tools (like getFileTree)
- `toObsidianXml` emits `<args>...</args>` when `function.arguments` is a JSON string, even if the tool expects no parameters.
- If `arguments` equals `"{}"`, the XML will include `<args>{}</args>`.
- Copilot parses this as `args: { args: {} }` which fails `z.void()` validation and yields the empty-result message.

Source:
- `src/lib/tools/obsidianToolsSpec.js`

### Structured tool_use items are ignored by Copilot
- The responses adapter adds structured `tool_use` items to `response.completed` output.
- Copilot ignores these; it only consumes XML in `content`.

Sources:
- `src/handlers/responses/shared.js`
- `external/obsidian-copilot/src/LLMProviders/chainRunner/utils/xmlParsing.ts`

## Evidence from Raw Capture (Local)

From `test-results/responses-copilot/raw-unredacted/responses-2025-12-21t04-51-03-201z-47ef69cb-0bb9-4a1d-ab1d-0a6c47cfd5ab-stream.json`:

### Stream delta shows proper XML with no args
- `response.output_text.delta` contains:
  `<use_tool>\n<name>getFileTree</name>\n</use_tool>`
- `response.function_call_arguments.done` contains `arguments: ""`

### Final response output is malformed / duplicated
- `response.completed` output text contains:
  `</use_tool<use_tool>` (missing `>`), indicating a corrupted concatenation.

These two facts suggest:
- The upstream tool call may be valid, but the **final assembled response can be malformed**, which can break Copilot XML parsing.

## Likely Failure Modes

1) **Void schema mismatch**
   - If we emit `<args>{}</args>` for `getFileTree`, Copilot validation fails.
   - Result: tool returns null -> `{"message":"Tool executed but returned no result","status":"empty"}`.
   - Proxy source: `src/lib/tools/obsidianToolsSpec.js` (XML builder).

2) **Malformed XML in final assembled response**
   - Corrupted block (`</use_tool<use_tool>`) can disrupt parsing.
   - Proxy source: `src/handlers/chat/stream.js` and `src/handlers/chat/nonstream.js` (content assembly).

3) **Copilot tool execution throws** (non-proxy)
   - `buildFileTree` may throw (e.g., unexpected vault state), resulting in null return.
   - Copilot source: `external/obsidian-copilot/src/tools/FileTreeTools.ts`.

## Recommended Next Debug Steps

1) **Validate XML emission for void tools**
   - Confirm whether `function.arguments` ever equals `"{}"` for `getFileTree` in raw captures.
   - If yes, consider suppressing `<args>` for tools with zero parameters.
   - Proxy code: `src/lib/tools/obsidianToolsSpec.js`.

2) **Find the malformed XML concatenation path**
   - Compare streamed text vs final assembled output when tool calls are present.
   - Inspect tool-call buffer logic in:
     - `src/handlers/chat/stream.js`
     - `src/handlers/chat/nonstream.js`

3) **Confirm Copilot parse inputs**
   - Ensure only XML blocks are intended for tool execution.
   - Copilot parser: `external/obsidian-copilot/src/LLMProviders/chainRunner/utils/xmlParsing.ts`.

4) **Reproduce with controlled tool output**
   - Trigger a request that reliably calls `getFileTree`.
   - Collect raw captures (`test-results/responses-copilot/raw-unredacted/...`).
   - Verify that Copilot sees exactly one well-formed `<use_tool>` block with no args.

## Open Questions

- Are `function.arguments` for `getFileTree` ever `"{}"` upstream, or always empty?
- Where does the duplicated XML concatenation originate (stream buffer, aggregator, or final reassembly)?
- Is `buildFileTree(...)` throwing in the Copilot runtime (e.g., vault read timing)?

