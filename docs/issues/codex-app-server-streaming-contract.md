# Migrating `codex-completions-api` to the **Codex app‑server** (Responses API)

**Status:** ready to implement  
**Scope:** replace the legacy proto runner / Chat Completions streaming handlers with a compatibility layer that consumes **Codex app‑server** and the **OpenAI Responses API** streaming events.  
**Why:** Codex’s app‑server speaks the OpenAI **Responses API** over HTTP + **SSE** (server‑sent events). Your proxy should target that contract directly rather than the older proto event schema.

> TL;DR — During streaming you’ll receive **SSE** events with `event: <type>` and `data: { ... }`. The important event types you’ll see are:
>
> - `response.created` — stream starts
> - `response.output_item.added` → a new item starts (assistant message, function/tool call, reasoning, etc.)
> - `response.content_part.added` → a part (e.g. `output_text`) begins within that item
> - `response.output_text.delta` / `...done` → text chunks for assistant message
> - `response.function_call_arguments.delta` / `...done` → streamed JSON arguments for a tool/function call
> - `response.output_item.done` → that item finished
> - `response.completed` → the whole response finished (includes `usage` if requested)
> - `response.failed` (or non‑200) → error path

---

## 1) Endpoint & transport

- **HTTP endpoint:** `POST /v1/responses`
- **Streaming:** set `stream: true` in the JSON body. The server replies with `Content-Type: text/event-stream` and emits an SSE stream until completion.
- **Envelope:** each record is two lines (`event:` and `data:`) separated by a blank line. `data:` is a single JSON object. The stream terminates with an SSE `event: done` and `data: [DONE]`.

### Minimal example (SSE transcript)

```http
POST /v1/responses  HTTP/1.1
Content-Type: application/json

{"model":"gpt-5-codex","input":"Say hi","stream":true}
```

```text
event: response.created
data: {"type":"response.created","response":{"id":"resp_123","status":"in_progress","model":"gpt-5-codex"}}

event: response.output_item.added
data: {"type":"response.output_item.added","response_id":"resp_123","output_index":0,
       "item":{"id":"msg_1","type":"message","role":"assistant","status":"in_progress","content":[]}}

event: response.content_part.added
data: {"type":"response.content_part.added","response_id":"resp_123","item_id":"msg_1",
       "output_index":0,"content_index":0,"part":{"type":"output_text"}}

event: response.output_text.delta
data: {"type":"response.output_text.delta","response_id":"resp_123","item_id":"msg_1",
       "output_index":0,"content_index":0,"delta":"He"}

event: response.output_text.delta
data: {"type":"response.output_text.delta","response_id":"resp_123","item_id":"msg_1",
       "output_index":0,"content_index":0,"delta":"llo!"}

event: response.output_text.done
data: {"type":"response.output_text.done","response_id":"resp_123","item_id":"msg_1",
       "output_index":0,"content_index":0,"text":"Hello!"}

event: response.output_item.done
data: {"type":"response.output_item.done","response_id":"resp_123","output_index":0,
       "item":{"id":"msg_1","type":"message","role":"assistant","status":"completed"}}

event: response.completed
data: {"type":"response.completed","response":{"id":"resp_123","status":"completed",
       "usage":{"input_tokens":147,"output_tokens":19,"total_tokens":166}}}

event: done
data: [DONE]
```

---

## 2) Tool/function calls (what your handlers need)

When the model decides to call a tool, the stream will first add a **function call item**, then **stream its arguments** as JSON in deltas:

```
event: response.output_item.added
data: {"type":"response.output_item.added","response_id":"resp_123","output_index":1,
       "item":{"id":"call_7","type":"function_call","name":"get_user",
               "arguments":"","status":"in_progress"}}

event: response.function_call_arguments.delta
data: {"type":"response.function_call_arguments.delta","response_id":"resp_123",
       "item_id":"call_7","output_index":1,"delta":"{\"id\":\""}

event: response.function_call_arguments.delta
data: {"type":"response.function_call_arguments.delta","response_id":"resp_123",
       "item_id":"call_7","output_index":1,"delta":"42\"}"}

event: response.function_call_arguments.done
data: {"type":"response.function_call_arguments.done","response_id":"resp_123",
       "item_id":"call_7","output_index":1,"arguments":"{\"id\":\"42\"}"}

event: response.output_item.done
data: {"type":"response.output_item.done","response_id":"resp_123","output_index":1,
       "item":{"id":"call_7","type":"function_call","name":"get_user","status":"completed"}}
```

Your app executes the tool and **sends the result back on the next request** by appending a **`function_call_output`** item into the `input` of that follow‑up `/v1/responses` call:

```jsonc
{
  "type": "function_call_output",
  "call_id": "call_7",
  "output": "{\"name\":\"Ada\",\"email\":\"ada@example.com\"}",
}
```

On that next turn, the model will typically produce an assistant message again, streamed as `output_text.delta` chunks.

---

## 3) Finish reason / status mapping

The Responses API uses **item status** and **response status** instead of the old “finish_reason”. For your proxy to preserve legacy semantics:

- **`stop`** → when you observe `response.completed` and the last assistant **message** item is `status:"completed"`.
- **`tool_calls`** → when the last completed item in the turn is a **`function_call`** and the stream finishes without an assistant message.
- **`length`** → when the terminal response has `status:"incomplete"` or `incomplete_details.reason` is `"max_output_tokens"` (or similar), map to `"length"`.
- **`content_filter`** → if `incomplete_details.reason` is `"content_filter"`.

Token usage (if requested via `stream_options.include_usage` or returned on `response.completed`) is available under `response.usage`, commonly including `input_tokens`, `output_tokens`, `total_tokens`, with optional `input_tokens_details.cached_tokens` and `output_tokens_details.reasoning_tokens` for models that track them.

---

## 4) Compatibility shim for the existing handlers

Your current code aggregates _proto_ events like `agent_message_delta` and relies on item/finish metadata. Implement a thin adapter that converts Responses SSE into the legacy shapes your proxy already understands.

### Event mapping (old → new)

| **Legacy (proto)**             | **Responses SSE**                                                                                             | **Notes**                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `agent_message_delta`          | `response.output_text.delta` (for the active assistant message item)                                          | Accumulate per `item_id` / `content_index`.                |
| `raw_response_item` (message)  | `response.output_item.added/done` with `item.type:"message"`                                                  | Use `role:"assistant"`.                                    |
| `raw_response_item` (toolcall) | `response.output_item.added/done` with `item.type:"function_call"` + `response.function_call_arguments.*`     | Concatenate `...arguments.delta` into a final JSON string. |
| `tool_result`                  | No direct event; you **send it** on the next request as an `input` item `{"type":"function_call_output",...}` | Tie to `call_id`.                                          |
| `finish_reason`                | Derived from `response.completed` / `response.status` / `incomplete_details` / last item type                 | See mapping above.                                         |
| token counts                   | `response.completed.response.usage`                                                                           | Use if present.                                            |

### TypeScript skeleton

```ts
type LegacyDelta = { type: "agent_message_delta"; id: string; text: string };
type LegacyItem = { type: "raw_response_item"; item: any };
type LegacyDone = {
  type: "turn_done";
  finish_reason: "stop" | "tool_calls" | "length" | "content_filter" | "error";
  usage?: any;
};

export function* responsesToLegacy(stream: AsyncIterable<{ type: string; [k: string]: any }>) {
  const buffers = new Map<string, { text: string; args: string }>();

  for await (const ev of stream) {
    switch (ev.type) {
      case "response.output_item.added":
        yield <LegacyItem>{ type: "raw_response_item", item: ev.item };
        break;

      case "response.content_part.added":
        if (ev.part?.type === "output_text") {
          buffers.set(ev.item_id, { text: "", args: buffers.get(ev.item_id)?.args ?? "" });
        }
        break;

      case "response.output_text.delta": {
        const b = buffers.get(ev.item_id) ?? { text: "", args: "" };
        b.text += ev.delta ?? "";
        buffers.set(ev.item_id, b);
        yield <LegacyDelta>{ type: "agent_message_delta", id: ev.item_id, text: ev.delta ?? "" };
        break;
      }

      case "response.function_call_arguments.delta": {
        const b = buffers.get(ev.item_id) ?? { text: "", args: "" };
        b.args += ev.delta ?? "";
        buffers.set(ev.item_id, b);
        break;
      }

      case "response.function_call_arguments.done":
        // emit a synthetic full tool_call snapshot if needed by old code
        yield <LegacyItem>{
          type: "raw_response_item",
          item: { id: ev.item_id, type: "function_call", arguments: ev.arguments },
        };
        break;

      case "response.output_item.done":
        // pass through final item — upstream may sanitize/inspect
        yield <LegacyItem>{ type: "raw_response_item", item: ev.item };
        break;

      case "response.completed": {
        const output = Array.isArray(ev.response?.output) ? ev.response.output : [];
        const lastMeaningful = [...output].reverse().find((item) => {
          if (!item) return false;
          if (item.type !== "message") return true;
          const content = Array.isArray(item.content) ? item.content : [];
          return content.some((part) => {
            if (!part) return false;
            if (typeof part === "string") return part.trim().length > 0;
            if (typeof part.text === "string") return part.text.trim().length > 0;
            if (typeof part.delta === "string") return part.delta.trim().length > 0;
            return true;
          });
        });
        const status = ev.response?.status;
        const inc = ev.response?.incomplete_details?.reason;
        const finish: LegacyDone["finish_reason"] =
          status === "incomplete"
            ? inc === "content_filter"
              ? "content_filter"
              : "length"
            : lastMeaningful?.type === "function_call"
              ? "tool_calls"
              : "stop";
        const usage = ev.response?.usage;
        yield <LegacyDone>{ type: "turn_done", finish_reason: finish, usage };
        return; // end of turn
      }

      case "response.failed":
        yield <LegacyDone>{ type: "turn_done", finish_reason: "error" };
        return;
    }
  }
}
```

> Implementation note: the stream you iterate above should already parse the **SSE** envelope and yield JSON **events** (each with a `type` string) — see the client snippet below.

---

## 5) Client: consuming SSE from the app‑server

Use any SSE parser; here’s a minimal Node/TS helper using the official OpenAI SDK’s stream manager to avoid hand‑parsing:

```ts
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: process.env.CODEX_APP_SERVER_BASE_URL,
  apiKey: process.env.OPENAI_API_KEY,
});

export async function* streamTurn(input: any) {
  const stream = await client.responses.stream({
    model: "gpt-5-codex",
    input,
    stream: true,
    stream_options: { include_usage: true }, // ensures `usage` arrives on the terminal event
  });

  for await (const event of stream) {
    // Each `event` has a `type`, e.g. "response.output_text.delta"
    yield event;
  }
}
```

If you prefer `fetch`, read `text/event-stream`, split on blank lines, peel `event:` and `data:` lines, and `JSON.parse(data)`.

---

## 6) Verifying the shapes locally

1. **Start** the app‑server: `codex app-server` (it prints the bound `http://127.0.0.1:<port>`).
2. **Send a streaming request** and print raw events:

```bash
PORT=<port-from-codex>
curl -N -s "http://127.0.0.1:$PORT/v1/responses" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-5-codex","input":"say hello","stream":true,"stream_options":{"include_usage":true}}' |
awk 'BEGIN{RS="\n\n"} {print $0 "\n----"}'
```

3. For a **tool-call** run, include a simple tool in the request and watch for `response.function_call_arguments.*` and a final `function_call` item. Then **prove the second‑turn** by sending a follow‑up request that includes a `{"type":"function_call_output","call_id":"...","output":"..."}"` input item.

---

## 7) What changes in `codex-completions-api`

1. **Wire protocol switch**: keep your HTTP routing, but send requests to **`/v1/responses`** not `/v1/chat/completions`.
2. **Stream parser**: replace the proto event codec with an SSE → event JSON iterator.
3. **Compatibility adapter**: drop in the mapping function above to preserve downstream expectations (`agent_message_delta`, finish reasons, token usage, etc.).
4. **Tool bridge**: surface function calls to your tool runner and inject `function_call_output` items on the next turn.
5. **Finish/usage**: derive finish reasons as in §3 and pass through `usage` for your metrics.
6. **Metadata**: Responses objects include `metadata` — keep your existing sanitization (allowlist keys, strip large blobs).

---

## 8) Notes & options

- Models like **GPT‑5‑Codex** are **Responses‑only** — attempts to hit `/v1/chat/completions` will fail. Ensure your `baseURL`/proxy points at a provider that supports `/v1/responses`.
- If you need a “one‑message only” mode (legacy Chat behavior), accumulate deltas and emit a single assistant message on `response.output_item.done` before forwarding `turn_done`.

---

## 9) References

- Codex CLI includes `codex app-server` for local development/testing.
- OpenAI **Responses API** streaming event families: `response.output_item.added/done`, `response.output_text.delta/done`, `response.function_call_arguments.delta/done`, `response.completed/failed`.
- Tool results on the next turn use an `input` item of type `function_call_output` (with `call_id` and `output`).
- Usage is carried on the terminal event and/or available when `stream_options.include_usage` is true.
