# Story 6.1 Follow‑up — **Conversation‑mode adapter** for Codex app‑server

**Updated:** 2025‑10‑28 (2025-10-28 04:08 UTC)  
**Repo:** DrJLabs/codex-completions-api  
**Audience:** The engineer wiring `/v1/responses` to `codex app-server`

> **Why this doc?** Your generated bindings under `docs/issues/codex-app-server/` (CLI **0.50.0**) only expose **conversation‑style** methods (`newConversation`, `sendUserMessage`, `sendUserTurn`, …) and the child emits **`codex/event/*`** events (e.g., `codex/event/agent_message_delta`, `raw_response_item`, …). It does **not** stream `response.*` events.  
> Therefore, do **Plan A** below: **use conversation methods now** and **translate** their events into the official **Responses SSE** contract for `/v1/responses`. Assume this adapter remains the default integration unless the protocol changes significantly.

---

## Plan overview

- Keep `/v1/responses` (Story 6.1) exactly as the public surface.
- Drive Codex via **app‑server (stdio JSON‑RPC)** but using **conversation** APIs.
- Add a small **adapter** that converts **`codex/event/*`** → **`response.*`** events on the fly (streaming), and a **non‑stream assembler** to build the final `response` object when `stream:false`.
- Optionally expose a configuration toggle (for debugging) to choose between `auto` detection and forcing conversation mode. Because the CLI does not emit `response.*`, default to `conversation` for now.

---

## 1) Driver reality check (0.50.0)

Your generated TS in `docs/issues/codex-app-server/ClientRequest.ts` only includes **conversation** requests. Keep using:

- `newConversation` (or equivalent) to start a turn.
- `sendUserTurn` / `sendUserMessage` to push user input and tools.
- `addConversationListener` or an equivalent subscription method (you’ll emulate this by listening to stdout events) to receive `codex/event/*`.

**Do not** call `responses.create` unless your generated types actually expose it. When that appears in a later CLI, you can drop the adapter and forward `response.*` verbatim.

---

## 2) Event mapping — conversation → Responses SSE

Use this table to convert stream events. (Names vary slightly across CLI series; keep the mapping in a switch with a few aliases.)

| **Conversation event**                                                    | **Responses SSE**                                                | **Notes**                                                                                                                                                                                                |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `codex/event/conversation_started` _(or first observed event for a turn)_ | `response.created`                                               | Synthesize `{response:{id,status:"in_progress",model}}`. Use the conversation/turn id as `response.id`.                                                                                                  |
| `codex/event/agent_message_started` _(optional)_                          | `response.output_item.added`                                     | Emit one message item: `{ item: { id, type:"message", role:"assistant", status:"in_progress", content:[] } }`. Then immediately emit `response.content_part.added` with `{ part:{type:"output_text"} }`. |
| `codex/event/agent_message_delta`                                         | `response.output_text.delta`                                     | `{ delta: <string> }` appended under current message item.                                                                                                                                               |
| `codex/event/agent_message_completed`                                     | `response.output_text.done` **then** `response.output_item.done` | Finalize the text for the item; include `{ text }` on the `...done` event.                                                                                                                               |
| `codex/event/tool_call_started` _(or raw function item add)_              | `response.output_item.added` (function_call)                     | Construct `{ item:{ id, type:"function_call", name, arguments:"", status:"in_progress" } }`.                                                                                                             |
| `codex/event/tool_call_arguments_delta`                                   | `response.function_call_arguments.delta`                         | Concatenate deltas into a string.                                                                                                                                                                        |
| `codex/event/tool_call_arguments_completed`                               | `response.function_call_arguments.done`                          | Provide full `arguments` string.                                                                                                                                                                         |
| `codex/event/tool_call_completed`                                         | `response.output_item.done`                                      | Complete the function_call item.                                                                                                                                                                         |
| `codex/event/turn_completed`                                              | `response.completed`                                             | Map usage tokens if the event carries them.                                                                                                                                                              |
| `codex/event/error` or `codex/event/turn_failed`                          | `response.failed`                                                | `{ error:{ code?, message } }`.                                                                                                                                                                          |

> Tip: When your first `agent_message_delta` arrives and you **haven’t** sent the “message added” / “content part added” yet, synthesize those before the first `output_text.delta` so downstream clients see a valid sequence.

**Finish‑reason derivation** (to support your legacy metrics):

- If terminal is OK and last completed item is a **message** → `stop`.
- If last item is a **function_call** and no assistant message followed → `tool_calls`.
- If terminal status is incomplete with reason `max_output_tokens` → `length`.
- If reason `content_filter` → `content_filter`.

**Usage**: If the turn event includes token usage, emit it on `response.completed` (and for streaming: ensure you opted into usage per your CLI version; else keep it server‑side).

---

## 3) Route changes — `/v1/responses`

Only the **backend** changes. Public contract stays the same.

### 3.1 Streaming (`stream:true`)

- Initialize SSE (`Content-Type: text/event-stream`), keep‑alive pings, and kill‑on‑disconnect (same as Story 6.1).
- For each **conversation** event, pass it through the **adapter** to zero or more **Responses** events and write:
  ```text
  event: <mapped.type>\n
  data: <mapped.payload>\n
  \n
  ```
- On terminal (`response.completed` or `response.failed`), end the stream. If your tests expect a sentinel, optionally emit `event: done\ndata: [DONE]\n\n` right before closing.

### 3.2 Non‑stream (`stream:false`)

- Create an **accumulator**:
  - Tracks active **message** and **function_call** items.
  - Concatenates `output_text.delta` and `function_call_arguments.delta` strings.
  - On item `...done`, store the final item inside `response.output[output_index]`.
- When you receive the **terminal** event, return a **single JSON**:
  ```json
  {
    "type": "response",
    "id": "resp_xxx",
    "status": "completed",
    "model": "<model>",
    "output": [
      /* message and/or function_call items you assembled */
    ],
    "usage": { "input_tokens": 123, "output_tokens": 456, "total_tokens": 579 }
  }
  ```

---

## 4) Driver skeleton (conversation mode)

> Wire with your generated request types and event unions (do not hard-code strings outside your adapter).

```ts
// src/services/codex-app-server.ts (conversation-mode)
import { spawn } from "node:child_process";
import readline from "node:readline";
// import types from docs/issues/codex-app-server/

export class CodexAppServer {
  private child!: import("node:child_process").ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  private listeners = new Set<(e: any) => void>();

  constructor(
    private cmd = "codex",
    private args = ["app-server"],
    private env = process.env
  ) {}

  async start() {
    if (this.child) return;
    this.child = spawn(this.cmd, this.args, { stdio: ["pipe", "pipe", "inherit"], env: this.env });
    const rl = readline.createInterface({ input: this.child.stdout });
    rl.on("line", (line) => {
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (typeof msg?.id !== "undefined") {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        return msg.error ? p.reject(msg.error) : p.resolve(msg.result);
      }
      for (const fn of this.listeners) fn(msg); // conversation events (codex/event/*)
    });
    this.child.on("exit", (code, signal) => {
      const err = new Error(`app-server exited code=${code} signal=${signal}`);
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    });
    // Optionally send initialize/handshake here.
  }

  call(method: string, params: any) {
    const id = this.nextId++;
    this.child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  onEvent(fn: (e: any) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
```

**Using the driver in `/v1/responses`** (pseudocode):

```ts
// Start a new conversation per HTTP request
await appServer.start();
const conv = await appServer.call("newConversation", { model: body.model /* other params */ });

const stop = appServer.onEvent((ev) => {
  if (!isThisConversationsEvent(ev, conv.id)) return; // drop others
  for (const mapped of mapConversationEventToResponses(ev)) {
    writeSSE(res, mapped.type, mapped);
    if (mapped.type === "response.completed" || mapped.type === "response.failed") {
      stop();
      res.end();
    }
  }
});

// Kick off the user turn with your body.input/messages/tools
await appServer.call("sendUserTurn", { conversation_id: conv.id, input: body.input, stream: true });
```

> The helper `isThisConversationsEvent` should inspect the event’s conversation/turn id; names vary by CLI, but your generated event unions expose the id field to filter on.

---

## 5) Feature detection & flags

- **Auto mode** (`CODEX_APP_SERVER_MODE=auto`): On the first _non‑id_ message from the child, inspect `ev.type`:
  - starts with `response.` → set **mode=responses** (pass‑through)
  - starts with `codex/event/` → set **mode=conversation** (use adapter)
- **Explicit modes**: allow `conversation` or `responses` to override detection.
- Log the chosen mode and include it in your health endpoint for debugging.

---

## 6) Tests to keep green (Story 6.1)

The adapter was designed to satisfy the existing suite under `tests/integration` & `tests/e2e`:

- `responses.contract.streaming.int.test.js` and `responses.contract.nonstream.int.test.js` must pass with synthetic `response.*` from the adapter.
- `responses.stream.tool-delta.int.test.js`: validate that deltas for function call args are concatenated and the final `...arguments.done` is emitted.
- `responses.stream.metadata.int.test.js`: ensure you forward allow‑listed metadata keys.
- `responses.kill-on-disconnect.int.test.js`: make sure you remove listeners and, if available, send a cancel into the child.
- `responses.error.invalid-n.int.test.js`: keep rejecting unsupported `n` and friends with 400.

---

## 7) Operational notes

- Continue pinning the Codex CLI version in your image. Re‑run `codex generate-ts` on upgrade and commit the regenerated types.
- Expose the current **mode**, CLI version, and app‑server health in `/healthz`.
- If you need **usage totals** in stream, include your CLI’s knob for that (some builds require setting a flag to include usage on terminal events).

---

## 8) Deliverables (PR checklist)

- [ ] `src/services/codex-app-server.ts` (driver)
- [ ] `src/services/adapter.responses.ts` (conversation→Responses mapping)
- [ ] `src/routes/responses.js` updated to use driver + adapter (stream + non‑stream)
- [ ] Feature flag + health reporting for `mode`
- [ ] Updated tests if any names differ between your CLI’s conversation events and this table (only minimal aliasing should be needed)

---

### Appendix A — Minimal mapping function (sketch)

```ts
export function* mapConversationEventToResponses(ev: any) {
  switch (ev.type) {
    case "codex/event/conversation_started":
      yield {
        type: "response.created",
        response: { id: ev.conversation_id, status: "in_progress", model: ev.model },
      };
      return;

    case "codex/event/agent_message_delta":
      // ensure message added & content part added have been emitted for this item_id (cache by item_id)
      yield {
        type: "response.output_text.delta",
        item_id: ev.item_id,
        output_index: ev.output_index ?? 0,
        content_index: 0,
        delta: ev.delta ?? ev.text ?? "",
      };
      return;

    case "codex/event/agent_message_completed":
      yield {
        type: "response.output_text.done",
        item_id: ev.item_id,
        output_index: ev.output_index ?? 0,
        content_index: 0,
        text: ev.text ?? ev.aggregate ?? "",
      };
      yield {
        type: "response.output_item.done",
        output_index: ev.output_index ?? 0,
        item: { id: ev.item_id, type: "message", role: "assistant", status: "completed" },
      };
      return;

    case "codex/event/tool_call_started":
      yield {
        type: "response.output_item.added",
        output_index: ev.output_index ?? 0,
        item: {
          id: ev.call_id,
          type: "function_call",
          name: ev.name,
          arguments: "",
          status: "in_progress",
        },
      };
      return;

    case "codex/event/tool_call_arguments_delta":
      yield {
        type: "response.function_call_arguments.delta",
        item_id: ev.call_id,
        output_index: ev.output_index ?? 0,
        delta: ev.delta ?? "",
      };
      return;

    case "codex/event/tool_call_arguments_completed":
      yield {
        type: "response.function_call_arguments.done",
        item_id: ev.call_id,
        output_index: ev.output_index ?? 0,
        arguments: ev.arguments ?? "",
      };
      return;

    case "codex/event/tool_call_completed":
      yield {
        type: "response.output_item.done",
        output_index: ev.output_index ?? 0,
        item: { id: ev.call_id, type: "function_call", name: ev.name, status: "completed" },
      };
      return;

    case "codex/event/turn_completed":
      yield {
        type: "response.completed",
        response: { id: ev.conversation_id, status: "completed", usage: ev.usage },
      };
      return;

    case "codex/event/error":
    case "codex/event/turn_failed":
      yield { type: "response.failed", error: { message: ev.message ?? "Unknown error" } };
      return;
  }
}
```

---

**Bottom line:** For CLI **0.50.0**, choose **Option 1** — keep the conversation methods and translate `codex/event/*` → `response.*` in your `/v1/responses` route. Add feature detection and a flag so you can switch to direct `response.*` pass‑through the moment a newer CLI exposes it.
