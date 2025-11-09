# ToolCallAggregator Developer Guide

The `ToolCallAggregator` module (`src/lib/tool-call-aggregator.js`) centralizes the logic for
collecting Codex app-server tool/function call signals and exposing them in the OpenAI-compatible
shape used across streaming and non-streaming handlers. It keeps all parsing, buffering, and
textual fallback concerns in one place so downstream handlers only need to observe emitted
`tool_calls` deltas or final snapshots.

## Public API

### Factory

```
import { createToolCallAggregator } from "../lib/tool-call-aggregator.js";
const aggregator = createToolCallAggregator({ idFactory });
```

* `idFactory` (optional): `(ctx) => string` hook for generating deterministic IDs. When omitted,
  IDs follow `tool_<choiceIndex>_<ordinal>`.

### Instance methods

| Method | Purpose |
| --- | --- |
| `ingestDelta(payload, { choiceIndex })` | Accept Codex/OpenAI delta payloads. Returns `{ updated, deltas }` where `deltas` are SSE-ready chunks. |
| `ingestMessage(payload, { choiceIndex, emitIfMissing })` | Process final/non-stream messages. When `emitIfMissing` is `true`, the aggregator will synthesize deltas from textual `<use_tool>` blocks if no structured state exists. |
| `snapshot({ choiceIndex })` | Immutable snapshot of `ToolCallRecord[]` for a choice (default `0`). |
| `hasCalls({ choiceIndex })` | Boolean helper for telemetry gates. |
| `supportsParallelCalls()` | Reflects the backend `parallel_tool_calls` flag (defaults to `true` until a payload disables it). |
| `resetTurn(choiceIndex?)` | Clears buffered state for a choice. When omitted, clears all choices. |

Snapshots are deep-cloned; mutating the returned objects never affects internal state. Deltas contain
cumulative `function.arguments` values so consumers can safely render or replace the current chunk.

### Textual fallback helpers

* `extractUseToolBlocks(text, startAt)` – default `<use_tool>…</use_tool>` parser used by both the
  aggregator and guard rails (tail suppression).
* `registerTextPattern(name, matcher)` – plug-in parser registration. Matchers return the same
  structure as `extractUseToolBlocks` (`{ blocks, nextPos }`). `register…` returns an unsubscribe
  function so tests can clean up temporary patterns.

The default parser understands:

* `<use_tool>` tags with nested `<name>`, `<query>`, `<path>`, etc.
* `name="…"` attributes on the opening tag.
* Raw JSON bodies (e.g., `<use_tool>{"name":"…","path":"…"}</use_tool>`).

### Obsidian XML utilities

`src/lib/tools/obsidianToolsSpec.ts` exposes the canonical parameter list for the tools referenced
by Obsidian Copilot and helper utilities:

* `buildCanonicalJsonFromFields(toolName, fields)` – used by textual fallback to turn parsed
  `<query>` or `<path>` tags into a best-effort JSON payload.
* `toObsidianXml(record, { indent })` – renders `<use_tool>` blocks from `ToolCallRecord`s so
  downstream stories can populate the Obsidian-specific response mode without copy/pasting the
  ordering logic.

Current parameter canon:

| Tool | Parameters (order) |
| --- | --- |
| `localSearch` | `query`, `salientTerms`, `timeRange?` |
| `webSearch` | `query`, `chatHistory` |
| `getCurrentTime` | `timezoneOffset?` |
| `convertTimeBetweenTimezones` | `time`, `fromOffset`, `toOffset` |
| `getTimeRangeMs` | `timeExpression` |
| `getTimeInfoByEpoch` | `epoch` |
| `readNote` | `notePath`, `chunkIndex?` |
| `getFileTree` | _(none)_ |
| `getTagList` | `includeInline?`, `maxEntries?` |
| `writeToFile` | `path`, `content` |
| `replaceInFile` | `path`, `diff` |
| `updateMemory` | `statement` |
| `youtubeTranscription` | _(none)_ |

The helper always preserves canonical ordering, drops unknown keys, escapes XML scalars, and emits
JSON strings for objects/arrays so the resulting XML aligns with the Copilot prompt contract.

## Common usage patterns

### Streaming handler sketch

```
const toolCallAggregator = createToolCallAggregator();

// During each agent_message_delta event
const { updated, deltas } = toolCallAggregator.ingestDelta(eventPayload);
if (updated) {
  deltas.forEach((delta) => sendChunk({ choices: [{ index: 0, delta: { tool_calls: [delta] } }] }));
}

// When the stream completes
const snapshot = toolCallAggregator.snapshot();
if (snapshot.length) {
  emitFinishChunk({ finish_reason: "tool_calls" });
}
```

### Non-stream handler sketch

```
const toolCallAggregator = createToolCallAggregator();
// feed tool_calls arrays or Codex notifications as they arrive
const { updated } = toolCallAggregator.ingestMessage(finalMessage, { emitIfMissing: true });
const toolCalls = toolCallAggregator.snapshot();
if (toolCalls.length) {
  response.choices[0].message.tool_calls = toolCalls;
  response.choices[0].finish_reason = "tool_calls";
}
```

## Testing

`tests/unit/tool-call-aggregator.test.ts` covers:

* name-first emission, cumulative argument buffering, and idempotency.
* multi-call ordering, choice isolation, reset semantics, and snapshot immutability.
* textual fallback synthesis (both default `<use_tool>` blocks and custom pattern registration).
* `parallel_tool_calls` flag propagation from payloads.

Run `npm run test:unit` to execute the suite. Integration/e2e tests continue to rely on the
aggregator implicitly via the streaming/non-streaming handlers.
