# Debug Note — Cross-chat “weather” contamination via `<recent_conversations>` (Obsidian Copilot)

This note documents a real-world case where a **new** Obsidian Copilot chat asking for **Las Vegas** weather also triggered a **Cincinnati** weather search from a different prior chat.

## Request of interest

- `req_id="7fyycujVk4rFWHz-Kf-6Y"`
- Route: `POST /v1/responses` (streaming)
- UA: `obsidian/1.9.7 … Electron/37.2.4 …`

## What we saw (proxy logs)

### Raw ingress shape (`event:"responses_ingress_raw"`)

At ingress, the request carried only message items (no explicit session identifiers):

- `input_item_count: 2`
- `input_message_roles: ["assistant","user"]`
- `has_metadata: false`
- `candidate_id_fields_present: []`
- `has_candidate_headers: false`

This suggests the proxy was **not** “mixing sessions” server-side — there were no obvious session/thread IDs to key off of.

### Tool usage (dev trace / SSE)

- The request completed with `finish_reasons:["tool_calls"]` (Responses SSE summary).
- Dev trace recorded `phase:"tool_call_arguments_done"` with `tool_name:"webSearch"` for the same `req_id`.

## Why Cincinnati happened

The **content** sent by the client (visible in dev prompt logging) included an Obsidian Copilot memory block:

- A `<recent_conversations>` section containing an entry titled:
  - `Tomorrow Weather Note for Cincinnati`

The prompt content also contained `<use_tool>` transcripts for both:

- `<query>tomorrow weather Las Vegas</query>`
- `<query>tomorrow weather Cincinnati Ohio</query>`

So the most likely root cause is **client-sent context contamination**:

- Obsidian Copilot embeds recent conversation summaries when starting a new chat.
- The model saw an immediately-relevant “weather” summary for Cincinnati and treated it as actionable context in the new Las Vegas chat.

## Improvements made to make this diagnosable faster next time

To avoid relying on huge prompt dumps, the proxy now logs (shape-only):

- `responses_ingress_raw` includes:
  - `has_recent_conversations_tag`
  - `has_use_tool_tag`
  - `has_tool_result_marker`
- Responses streaming logs a per-tool-call event:
  - `event:"tool_call_arguments_done"` (hashes/lengths only; no args content)
- Dev prompt stdout logs now include `req_id` so the prompt line can be tied back to `responses_ingress_raw` and `access_log`.

## Optional mitigation ideas (proxy-side)

If we want to prevent this class of bleed-through without changing the client:

1. Strip or down-rank `<recent_conversations>` blocks for “new chat” requests (heuristic-based).
2. Add a system-level guardrail message instructing the model to *never* execute actions based solely on `<recent_conversations>` summaries.
3. Detect tool transcripts (`<use_tool>` / `Tool '…' result:`) inside history and drop them unless explicitly requested by the user.
