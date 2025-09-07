# Obsidian Copilot Tool Parsing — How to Format Responses

This summarizes how the Obsidian Copilot plugin detects and runs tool calls, based on source code under `/home/drj/obsidian-plugins/obsidian-copilot`.

Key files reviewed

- LLM parsing/adapter rules: `src/LLMProviders/chainRunner/utils/modelAdapter.ts`
- Tool schemas/handlers: `src/tools/SearchTools.ts` (webSearch/localSearch), plus writeToFile/replaceInFile usage in tests
- Clean-up helpers: `src/utils.cleanMessageForCopy.test.ts`

Detection rules (modelAdapter)

- The client searches the assistant message for the first occurrence of `<use_tool>`:
  - Content before tools: allowed if brief (≤ 2 sentences and ≤ 200 characters) after removing `<think>…</think>` blocks.
  - Content after the last `</use_tool>`: treated as “premature” and, for some models (e.g., Claude 4 first turn), may be sanitized/trimmed; substantial content (≥ ~100 chars) after tools is discouraged.
- Guidance encoded in adapter:
  - “Brief 1-sentence explanations BEFORE tool calls are good.”
  - “After tool calls, STOP and wait for tool results.”

Implication: To ensure execution, make the first non‑whitespace content a `<use_tool>` block (optionally preceded by ≤1 short sentence). Avoid narrative after the last tool block.

Tool schemas (SearchTools.ts)

- `webSearch` (Plus-only):
  - Required tags for our XML client format: `<name>webSearch</name>`, `<query>…</query>`, `<chatHistory>[]</chatHistory>` (empty array allowed).
  - Returns JSON array with `{ type: "web_search", content, citations, instruction }`.
- `localSearch` (delegates to lexical/semantic):
  - Tags: `<name>localSearch</name>`, `<query>…</query>`, `<salientTerms>[…]</salientTerms>`, optional `<timeRange>` (startTime/endTime objects).
- File tools (tests and UI handling):
  - `writeToFile`: `<writeToFile><path>…</path><content>…</content></writeToFile>`.
  - `replaceInFile`: `<replaceInFile><path>…</path><diff>…</diff></replaceInFile>`.

Formatting tips

- Use inner-tag XML (not attribute form) for maximum compatibility:
  ```
  <use_tool>
  <name>webSearch</name>
  <query>Shopify product CSV format</query>
  <chatHistory>[]</chatHistory>
  </use_tool>
  ```
- Keep any action sentence extremely brief and put it before the first tool block; never append narrative after tools.
- Multiple tool blocks in one message are supported, but ensure the message starts with `<use_tool>` and separate blocks with a blank line.

Observed behaviors in logs

- When responses lead with narrative and then tool blocks, execution is inconsistent. Keeping tool blocks at the very start (or with a strictly brief preamble) yields consistent tool execution.

Proxy-side enforcement (current stance)

- We instruct the model via `.codev/AGENTS.md` to lead with `<use_tool>` and avoid content after tools. Reshaping at the proxy is possible but not enabled yet.
