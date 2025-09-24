---
title: Research — OpenAI Chat Completions Streaming Reference
date: 2025-09-24
epic: Chat Completions Canonical Parity
owner: Product (PM)
status: Draft
---

## Purpose

Summarize canonical `/v1/chat/completions` streaming behavior from OpenAI-aligned references so we can implement true parity (except for model ids) during Epic — Chat Completions Canonical Parity.

## Lifecycle of a Stream

1. **Connection setup:** Client requests `stream:true` and receives Server-Sent Events (`text/event-stream`) with stable `id`, `object:"chat.completion.chunk"`, `created`, and `model` values shared across chunks.citeturn5search1
2. **Initial role chunk:** First payload provides `{ delta: { role: "assistant" }, finish_reason: null }`, indicating who will speak without emitting content tokens.citeturn3search0
3. **Content deltas:** Subsequent chunks stream incremental `delta.content` pieces while `finish_reason` stays `null`. Each chunk is indexed via `choices[{ index: 0, ... }]` (or higher indices when `n>1`).citeturn3search0turn8search0
4. **Tool/function call deltas:** When the assistant invokes tools, chunks carry `delta.tool_calls[{id, type:"function", function:{name, arguments_fragment}}]` until the call is fully streamed. A final chunk consolidates the full arguments.citeturn3search6
5. **Finish-reason chunk:** Once generation ends, a chunk with empty `delta` sets `finish_reason` (`stop`, `length`, `tool_calls`, or `content_filter`; `function_call` persists for legacy clients).citeturn3search0turn5search1
6. **Usage chunk (optional):** If `stream_options.include_usage:true`, the penultimate event includes `{ choices: [], usage:{ prompt_tokens, completion_tokens, total_tokens } }` after generation completes. Without the option, usage metrics are omitted.citeturn5search0
7. **Stream terminator:** The server emits `data: [DONE]` on a separate line to end the SSE stream; clients must stop reading at this sentinel.citeturn5search5

## Field Notes

- `choices[index].delta`: Contains only the incremental fields for that chunk—role once, content/tool call fragments thereafter.citeturn3search0turn3search6
- `choices[index].finish_reason`: `null` for intermediate chunks; populated on the dedicated finalizer event. Values map to OpenAI’s moderation and tool workflows.citeturn3search0turn5search1
- `usage`: Only present on the optional usage chunk and non-stream responses; intermediate chunks expose `usage:null`.citeturn5search0turn3search0
- Multiple choices (`n>1`) are streamed interleaved but indexed independently (`choices[{ index: n }]`), so clients must group by index.citeturn8search0

## Implementation Checklist

- Emit stable metadata (`id`, `object`, `created`, `model`, optional `system_fingerprint`) on every chunk.
- Maintain chunk order: role → content/tool deltas → finish-reason → optional usage → `[DONE]`.
- Support full finish-reason set and ensure non-stream + stream paths align.
- Stream tool/function calls with incremental arguments to mirror OpenAI chunk structure.
- Honor `stream_options.include_usage` toggle for token accounting.
- Validate parity with SDK collectors (Python/JS) and update golden transcripts accordingly.

## References

- OpenAI Community: Streaming chunk order and finish reason behavior.citeturn3search0
- OpenAI Community: Tool call streaming delta examples.citeturn3search6
- OpenAI Community: Usage chunk triggered by `stream_options.include_usage`.citeturn5search0
- Unofficial mirror of OpenAI streaming spec for metadata and finish reasons.citeturn5search1
- Arvae Streaming tutorial showing `[DONE]` sentinel.citeturn5search5
- FastAPI AI streaming guide highlighting multi-choice indices.citeturn8search0
