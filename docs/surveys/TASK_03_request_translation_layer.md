# TASK 03 — Request Translation Layer (OpenAI Chat Completions → JSON‑RPC)

Repo: `DrJLabs/codex-completions-api`  
Revision reference: commit `c8628fa5613c5d1dd86bfb0dbfec80e23e965b17` (as referenced by file URLs)  
Date: 2025-12-08

## Scope

This task focuses on the **request translation layer** that converts an OpenAI-compatible **Chat Completions** HTTP request into the internal **JSON‑RPC** payloads used by the Codex/app-server transport.

Primary artifacts reviewed:

- `src/handlers/chat/request.js` (normalization + mapping)
- `src/services/transport/child-adapter.js` (validation boundary + JSON‑RPC call surface)

Related artifacts (referenced, not exhaustively reviewed here due to tooling constraints):

- `src/lib/json-rpc/schema.ts` (validators + item constructors)
- `docs/app-server-migration/app-server-protocol.schema.json` (protocol schema)
- `docs/_archive/stories/2-2-implement-request-translation-layer.md` (intended behavior/design notes)

---

## 1) What the translation layer actually does

At a high level, `normalizeChatJsonRpcRequest(...)` builds **two** payloads from an OpenAI-style request:

- `turn`: configuration + “conversation turn” envelope
- `message`: message payload containing `items` plus optional generation controls

Both are then validated (schema enforcement) and passed over JSON-RPC:

- `start_turn(turn, context)`
- `send_message(message, context)`

The normalization function is opinionated: it does not attempt full OpenAI parity; it is a *selective* compatibility shim targeted at the Codex/app-server protocol.

---

## 2) Inputs: expected request shape (as implemented)

`normalizeChatJsonRpcRequest` accepts a bundle of inputs, some coming from HTTP body, some injected by handlers/middleware:

- `body` (OpenAI-ish request body)
- `messages` (override for `body.messages`)
- `prompt` (fallback for `body.prompt`)
- `reqId` (used when constructing message items)
- `requestedModel` (accepted but **not used** in the current mapping)
- `effectiveModel` (**used**)
- `choiceCount` (likely derived from OpenAI `n`)
- `stream` (used to set `turn.stream`)
- `reasoningEffort` (used to set `turn.effort` and `message.reasoning`)
- `sandboxMode`, `codexWorkdir`, `approvalMode` (Codex-specific execution controls)

---

## 3) Output: JSON‑RPC payload shape (as implemented)

### 3.1 `turn`

Generated `turn` fields:

- `model`: `effectiveModel`
- `items`: array of user “message items”
- `cwd`: `codexWorkdir || null`
- `approvalPolicy`: `approvalMode || null`
- `sandboxPolicy`: `sandboxMode || null`
- `effort`: `reasoningEffort || null`
- `summary`: hard-coded `"auto"`
- `stream`: boolean `!!stream`
- `choiceCount`: passthrough argument
- `includeApplyPatchTool`: hard-coded `true`
- `baseInstructions`: derived from system messages (see below)
- `tools`: derived tool payload (see below)
- `finalOutputJsonSchema`: extracted from `response_format` (json_schema only)

### 3.2 `message`

Generated `message` fields:

- `items`: same array used in `turn.items`
- `includeUsage`: hard-coded `true`
- Optional additions when present and valid:
  - `temperature`
  - `topP`
  - `maxOutputTokens` (mapped from `max_tokens`)
  - `tools` (same tools payload as `turn.tools`)
  - `responseFormat` (raw passthrough of `body.response_format`)
  - `reasoning` (from `reasoningEffort` or `body.reasoning`)
  - `finalOutputJsonSchema` (extracted schema)
  - `instructions` (base instructions derived from system messages)

**Notable pattern:** several fields are duplicated between `turn` and `message` (tools, instructions/baseInstructions, items, finalOutputJsonSchema). That can be correct if the downstream protocol expects duplication, but it creates a consistency risk (see §6).

---

## 4) Message extraction rules (critical behavior)

### 4.1 System messages → `baseInstructions`

System messages are:

1. filtered by `role === "system"`
2. flattened into strings (see §5)
3. concatenated using `\n\n`
4. assigned as `baseInstructions` (and `message.instructions`)

**Implication:** system message ordering relative to user/assistant messages is lost. Multiple system messages become one block.

### 4.2 User messages → `items`

User messages are:

1. filtered by `role === "user"`
2. flattened into strings
3. wrapped via `createUserMessageItem(reqId, text)`

If no user messages exist, there is a fallback:

- if `prompt` (argument) or `body.prompt` is a non-empty string, it becomes a single user item.

If there are still no items → request is rejected: `"No user messages provided"`.

### 4.3 Assistant / tool / other roles are ignored

The mapping only considers `system` and `user` roles.

That means typical OpenAI chat histories like:

- `assistant` messages (prior model output)
- `tool` messages (tool results)
- `function` role (legacy)
- `developer` role (some newer OpenAI clients)

…are excluded from the payload.

**This is a major compatibility limitation** for anyone expecting “continue the conversation” semantics, unless conversation state is managed elsewhere (e.g., the backend keeps state keyed by `reqId` or some session identifier—no evidence of that here).

---

## 5) Content flattening behavior

`flattenMessageContent(content)` accepts:

- a plain string → returns as-is
- an array of parts → attempts to extract a best-effort text representation

Supported/handled part shapes (best effort):

- `{ text: string }`
- `{ image_url: { url: string } }` → becomes placeholder text: `[image:<url>]`
- `{ refusal: string }`
- `{ input_text: string }`
- `{ input_audio: ... }` → placeholder text `[audio]`
- `{ output_text: string }`
- `{ content: ... }` → stringified
- fallback: `JSON.stringify(part)`

**Implications:**
- Multimodal inputs are **not** represented as native attachments/binary; they are “stringified” or replaced with placeholders.
- The backend must interpret placeholders for this to be meaningful; otherwise, vision/audio are effectively unsupported.

---

## 6) Parameter normalization + validation (what is enforced)

### 6.1 Numerics

- `temperature`: parsed as finite number and must be `0 <= temperature <= 2`
- `top_p`: parsed as finite number and must be `0 < top_p <= 1`
- `max_tokens`: must be a positive integer

Other OpenAI controls are not processed (penalties, stop, seed, logprobs, etc.).

### 6.2 Tools

`tools` is validated minimally:

- must be an array (or undefined/null)
- each tool must be an object with `type === "function"`
- `tool.function.name` must be a non-empty string

`tool_choice` is normalized but **not validated** against allowed values/shapes. Strings are trimmed; objects are passed through.

`parallel_tool_calls` is normalized from boolean or `"true"/"false"` strings.

The produced “tools payload” resembles:

```json
{
  "definitions": [...],          // tools
  "choice": "auto|none|...",     // tool_choice
  "parallelToolCalls": true|false
}
```

### 6.3 Response format

Only `response_format.type === "json_schema"` is treated specially:

- attempts to extract `response_format.json_schema.schema` as an object
- stores extracted schema as `finalOutputJsonSchema`
- also passes through the raw `response_format` as `responseFormat`

`response_format.type === "json_object"` (classic JSON mode) is not handled as a first-class special case; it will be passed through but without extracted schema.

### 6.4 Reasoning

`reasoning` is set as:

- `reasoningEffort` (argument) OR
- `body.reasoning` OR
- `null`

Additionally, `turn.effort` is set only from `reasoningEffort` (argument), not from `body.reasoning`.

**Potential inconsistency:** if a client sends `body.reasoning` (object) but caller does not set `reasoningEffort`, `message.reasoning` may be an object while `turn.effort` is null.

---

## 7) Field mapping matrix (OpenAI → internal)

Legend:
- ✅ Supported
- 🟡 Partially supported / passthrough / lossy
- ❌ Ignored / unsupported

| OpenAI Chat Completions field | Current behavior | Internal destination |
|---|---|---|
| `model` | 🟡 accepted upstream; uses `effectiveModel` instead | `turn.model` |
| `messages` | ✅ but only `system` + `user` | `turn.items`, `turn.baseInstructions` |
| `prompt` | 🟡 fallback only if no user messages | `turn.items` |
| `temperature` | ✅ validated 0–2 | `message.temperature` |
| `top_p` | ✅ validated (0,1] | `message.topP` |
| `max_tokens` | ✅ positive integer | `message.maxOutputTokens` |
| `n` | 🟡 assumed mapped by caller | `turn.choiceCount` |
| `stream` | ✅ boolean | `turn.stream` |
| `tools` | ✅ minimal validation | `turn.tools`, `message.tools` |
| `tool_choice` | 🟡 normalized but not validated | `turn.tools.choice`, `message.tools.choice` |
| `parallel_tool_calls` | 🟡 normalized | `turn.tools.parallelToolCalls` |
| `response_format` | 🟡 passthrough; json_schema extracted | `message.responseFormat`, `finalOutputJsonSchema` |
| `reasoning` | 🟡 passthrough unless overridden | `message.reasoning` |
| `stop` | ❌ ignored | — |
| `presence_penalty` / `frequency_penalty` | ❌ ignored | — |
| `logprobs` / `top_logprobs` | ❌ ignored | — |
| `logit_bias` | ❌ ignored | — |
| `seed` | ❌ ignored | — |
| `user` | ❌ ignored | — |
| `metadata` | ❌ ignored | — |
| `stream_options` | ❌ ignored | — |
| assistant/tool history messages | ❌ ignored | — |
| image/audio message parts | 🟡 placeholders | flattened string content |

---

## 8) Code quality / architecture notes

### 8.1 Coupling: protocol mapping mixed with validation and business logic

`normalizeChatJsonRpcRequest` currently combines:
- OpenAI API compatibility concerns
- field validation
- Codex/app-server protocol mapping
- feature flags / execution policy injection (sandbox/workdir/approval)

This makes it harder to:
- reuse the mapper for `/responses` vs `/chat/completions`
- version the protocol mapping safely
- test translation independently of runtime policies

### 8.2 Duplication between `turn` and `message`

The mapper duplicates several concepts in both payloads:
- items
- tools
- instructions/baseInstructions
- finalOutputJsonSchema

If downstream only requires one copy, this duplication is a potential source of drift and subtle bugs (e.g., message tools updated while turn tools not).

### 8.3 Loss of message ordering and roles

Concatenating system messages and ignoring assistant/tool messages is a correctness issue for general chat parity, and it is also a maintainability risk: callers may assume “OpenAI-compatible” includes conversational continuity.

### 8.4 Overly permissive passthrough

Some fields are passed through with minimal validation (e.g., `tool_choice`, `response_format`), which can lead to backend schema errors that present as opaque JSON-RPC failures rather than clean HTTP 400s.

---

## 9) Gaps, contradictions, and “dirty code” candidates

### High-risk gaps (functional parity)

1. **Conversation continuity is broken** for typical OpenAI message histories (assistant/tool roles ignored).
2. **Tool-call round trips** are likely incomplete unless tools are handled entirely within a single request (no tool-result messages forwarded).
3. **Multimodal** support is placeholder-based and likely nonfunctional unless the backend interprets placeholders.
4. **Stop sequences** unsupported (common in clients).
5. **Penalties / logit bias / seed** unsupported (less common, but still part of many SDK defaults).

### Medium-risk inconsistencies

1. `requestedModel` is accepted but unused; may confuse handler authors.
2. `reasoningEffort` vs `body.reasoning` inconsistency between turn/message.
3. `includeApplyPatchTool: true` is hard-coded—may be undesirable in restricted deployments.
4. `includeUsage` always true—adds compute and response size even if client doesn’t need it.

### “Dirty code” candidates (cleanup/refactor targets)

- `flattenMessageContent` handles a broad set of part shapes (input_audio, output_text, etc.) that do not align cleanly with Chat Completions; this may be legacy from other endpoint formats and should be separated or documented explicitly.
- `normalizeParallelToolCalls` accepting `"true"/"false"` strings is likely unnecessary and may hide client bugs.
- Passthrough objects without schema validation (`tool_choice`, `response_format`) should either be validated or explicitly documented as “best effort”.

---

## 10) Recommendations (actionable)

### 10.1 Quick wins (low effort, high value)

1. Add explicit warnings (logger debug) when non-supported roles are present (`assistant`, `tool`, etc.) so integrators understand behavior.
2. Validate `tool_choice` against:
   - `"auto" | "none"`
   - `{ type: "function", function: { name: string } }`
3. Support `response_format: { type: "json_object" }` explicitly (even if only as a flag).
4. Gate `includeApplyPatchTool` behind config, not hard-coded.
5. Add a “strict mode” option: reject unsupported fields rather than silently ignoring them.

### 10.2 Medium scope refactors

1. Split mapping into phases:
   - **Phase A:** OpenAI request validation + canonicalization → internal “canonical request”
   - **Phase B:** canonical request → JSON‑RPC `turn`/`message` mapping
2. Preserve message order (including assistant/tool messages) by mapping roles into protocol-native “items” (requires schema support in `schema.ts`).
3. Normalize `reasoning` consistently between turn and message.

### 10.3 Long-term robustness

1. Create a **formal mapping spec** (`docs/translation/chat-completions-to-jsonrpc.md`) with a stable contract.
2. Add a golden test suite that asserts:
   - input OpenAI request → exact `turn`/`message` JSON snapshots
   - invalid inputs → exact HTTP error payloads
3. Add fuzz/property tests for `flattenMessageContent` to ensure it never throws on odd part shapes.

---

## 11) Suggested tests for this layer

Minimum unit test set for `normalizeChatJsonRpcRequest`:

- Valid request with:
  - system + user messages
  - temperature/top_p/max_tokens
  - tools + tool_choice + parallel_tool_calls
  - response_format json_schema (valid + invalid schema object)
- Requests rejected:
  - no user messages + no prompt
  - invalid temperature, top_p, max_tokens
  - tools not array, tool without function name, wrong tool type
- “Lossy” cases (should not throw):
  - message content parts with image_url, input_audio, unknown object parts

---

## 12) Output artifacts from this task

- This document is the primary artifact.
- Next task should focus on **streaming adapters** (SSE framing, delta semantics, finish_reason mapping), which is where OpenAI parity typically breaks most visibly.
