# Story 6.1 follow‑up — Convert the new **/v1/responses** endpoint to Codex **app‑server**

**Updated:** 2025-10-28 03:49 UTC  
**Repo:** `DrJLabs/codex-completions-api`  
**Audience:** Maintainers & reviewers for Story 6.1 and the post‑story migration

> Context: Story **6.1** added a `/v1/responses` endpoint to the proxy (see `src/routes/responses.js` and the accompanying tests under `tests/integration` & `tests/e2e`). After shipping that story and rebuilding the dev stack, the existing proto‑based plumbing failed. We’re now migrating the backend to **`codex app-server`** and need to convert the just‑added Responses route to stream **app‑server** events 1:1 (and to assemble a correct non‑stream JSON when `stream:false`).

---

## 0) What’s already in the repo (from Story 6.1)

**Code**

- `src/routes/responses.js` — Express route for `/v1/responses`.
- Likely uses our shared SSE helpers and auth middleware (same as chat route).

**Tests (indicative list)**

- `tests/integration/responses.contract.streaming.int.test.js` — verifies Responses SSE contract
- `tests/integration/responses.contract.nonstream.int.test.js` — verifies non‑stream JSON contract
- `tests/integration/responses.stream.concurrency.int.test.js` — shared concurrency limits
- `tests/integration/responses.kill-on-disconnect.int.test.js` — server cancels/aborts on client disconnect
- `tests/integration/responses.stream.metadata.int.test.js` & `responses.nonstream.metadata.int.test.js` — metadata pass‑through
- `tests/integration/responses.stream.tool-delta.int.test.js` & `responses.stream.tools.int.test.js` — function/tool call deltas
- `tests/integration/responses.error.invalid-n.int.test.js` — rejects unsupported/legacy params (e.g., `n`)

**Docs**

- `docs/bmad/stories/6.1.responses-endpoint-handlers.md` (acceptance criteria & behaviors)

> The migration below **keeps** these behaviors but swaps the backend: instead of proto/HTTP, we drive **Codex app‑server (stdio JSON‑RPC)** and forward its notifications.

---

## 1) High‑level migration plan

1. Introduce a small driver for `codex app-server` (one long‑lived child, JSONL in/out).
2. Update `src/routes/responses.js` to:
   - **Streaming** (`stream:true`): forward app‑server events as SSE 1:1 (`event: <ev.type>`, `data: <payload>`), and close on `response.completed` / `response.failed`.
   - **Non‑stream** (`stream:false`): consume events until terminal, **assemble** the canonical Responses object and return JSON (200 or error status).
3. Preserve Story 6.1 validations (auth, unsupported params), concurrency limits, keep‑alives, and “kill on disconnect.”
4. Pin CLI & use your **generated TS bindings** under `docs/issues/codex-app-server/` to avoid stringly‑typed method names.

---

## 2) Driver: `src/services/codex-app-server.ts`

> Use your generated types instead of string literals (method names, event unions). The sketch below is intentionally minimal; wire types in your codebase.

```ts
import { spawn } from "node:child_process";
import readline from "node:readline";
// Example type imports (adjust path & names to your real generated output):
// import type { AppServerRequest, AppServerEvent } from "../../docs/issues/codex-app-server/types";

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
      for (const fn of this.listeners) fn(msg);
    });
    this.child.on("exit", (code, signal) => {
      const err = new Error(`codex app-server exited code=${code} signal=${signal}`);
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    });
    // Optional: send initialize/handshake here using your generated request type.
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

**Where to initialize**  
Create a module‑level singleton (e.g., `src/bootstrap/app-server.ts`) that starts the child on server boot and exposes it to routes.

---

## 3) Route migration: `src/routes/responses.js`

### 3.1 Behavioral deltas to keep from Story 6.1

- Enforce API key / auth _exactly as today_.
- Validate unsupported fields (`n`, legacy params) and return `400 + {error}` as your tests expect.
- Enforce concurrency limits per instance & kill turns on client disconnect.
- Stream keep‑alives (ping) and ensure terminal close.

### 3.2 Streaming path (`stream:true`)

**Before** (typical): route forwarded to proto/HTTP and reshaped into Responses SSE.

**Now**: forward **app‑server** events verbatim.

```ts
import express from "express";
import { appServer } from "../bootstrap/app-server.js"; // your singleton
import { sseInit, sseWrite, sseEnd } from "../services/sse.js"; // reuse your helpers

const router = express.Router();

router.post("/v1/responses", async (req, res) => {
  // 1) Auth & input validation (keep Story 6.1 logic, including rejecting `n`)
  // ...

  const stream = req.body?.stream === true;
  if (stream) {
    sseInit(res); // sets headers + heartbeat
    const stop = appServer.onEvent((ev) => {
      // Forward names + payloads 1:1
      if (ev?.type) {
        res.write(`event: ${ev.type}\n`);
        res.write(`data: ${JSON.stringify(ev)}\n\n`);
        if (ev.type === "response.completed" || ev.type === "response.failed") {
          stop();
          sseEnd(res);
        }
      }
    });

    // Kill-on-disconnect
    req.on("close", () => {
      stop();
      // If your schema provides a cancel method, call it here
      // appServer.call("responses.cancel", { response_id: <id> }).catch(()=>{});
    });

    try {
      // Construct request from req.body using your generated request type.
      // Commonly this is something like "responses.create" or "session.run" with { stream:true }.
      await appServer.start();
      await appServer.call("responses.create", { ...req.body, stream: true });
    } catch (err) {
      res.write(`event: response.failed\n`);
      res.write(
        `data: ${JSON.stringify({ type: "response.failed", error: { message: String(err) } })}\n\n`
      );
      stop();
      sseEnd(res);
    }
    return;
  }

  // 3.3 Non-stream path
  try {
    await appServer.start();
    const acc = makeAccumulator(); // see next section
    const stop = appServer.onEvent((ev) => acc.ingest(ev));
    await appServer.call("responses.create", { ...req.body, stream: false });
    // Wait until accumulator flips done (or set a timeout guard)
    const result = await acc.done;
    stop();
    res.status(result.httpStatus).json(result.body);
  } catch (err) {
    res.status(500).json({ error: { message: String(err) } });
  }
});

export default router;
```

### 3.3 Non‑stream assembler

Your non‑stream tests expect a **single JSON object** matching the Responses spec. Build it from events:

```ts
function makeAccumulator() {
  let resolve!: (v: { httpStatus: number; body: any }) => void;
  const done = new Promise<typeof arguments>((r) => (resolve = r));
  const items: any[] = [];
  const textBuffers = new Map<string, string>(); // item_id -> text
  const argBuffers = new Map<string, string>(); // item_id -> args string
  let responseMeta: any = { id: null, status: "in_progress", output: [] };
  let failed: any = null;

  const ingest = (ev: any) => {
    switch (ev.type) {
      case "response.created":
        responseMeta.id = ev.response?.id ?? responseMeta.id;
        break;

      case "response.output_item.added":
        items[ev.output_index] = ev.item;
        break;

      case "response.output_text.delta": {
        const buf = (textBuffers.get(ev.item_id) ?? "") + (ev.delta ?? "");
        textBuffers.set(ev.item_id, buf);
        break;
      }
      case "response.output_text.done": {
        const buf = textBuffers.get(ev.item_id) ?? "";
        // Attach final text into the item content (minimal shape)
        items[ev.output_index] = {
          ...(items[ev.output_index] ?? {}),
          content: [{ type: "output_text", text: ev.text ?? buf }],
        };
        break;
      }

      case "response.function_call_arguments.delta": {
        const buf = (argBuffers.get(ev.item_id) ?? "") + (ev.delta ?? "");
        argBuffers.set(ev.item_id, buf);
        break;
      }
      case "response.function_call_arguments.done": {
        const args = ev.arguments ?? argBuffers.get(ev.item_id) ?? "";
        items[ev.output_index] = { ...(items[ev.output_index] ?? {}), arguments: args };
        break;
      }

      case "response.output_item.done":
        responseMeta.output[ev.output_index] = ev.item ?? items[ev.output_index];
        break;

      case "response.completed": {
        const usage = ev.response?.usage;
        const body = { type: "response", ...ev.response, output: responseMeta.output };
        if (usage) body.usage = usage;
        resolve({ httpStatus: 200, body });
        break;
      }

      case "response.failed":
        failed = { error: ev.error ?? { message: "Unknown error" } };
        resolve({ httpStatus: 500, body: { type: "response.failed", ...failed } });
        break;
    }
  };

  return { ingest, done };
}
```

> This keeps the non‑stream contract that Story 6.1 tests check: one object with `output` items, tool call items containing final `arguments`, and `usage` on completion when available.

---

## 4) Keep Story 6.1 constraints

- **Auth**: Apply the **same middleware** and bearer checks to `/v1/responses` as to `/v1/chat/completions`.
- **Unsupported params**: Reject `n` (and any other legacy fields) with 400 and your standard `{error:{message,code}}` payload — your `responses.error.invalid-n.int.test.js` covers this.
- **Concurrency**: Use the same semaphore/queue the chat route uses; your `responses.stream.concurrency.int.test.js` should pass unchanged.
- **Kill on disconnect**: On `req.close`, unregister event listener and, if the generated API exposes a cancel method, call it with the active `response_id`. Otherwise, just stop writing to the socket (the child can complete in the background).
- **Keep‑alive**: Continue sending ping events on the streaming route (`event: ping` every 15s).

---

## 5) Tool calls

- Expect `response.output_item.added` (type:`function_call`) → `response.function_call_arguments.delta` … `done` → `response.output_item.done`.
- To **return tool results**, include an input item on the **next** request:
  ```json
  { "type": "function_call_output", "call_id": "<call item id>", "output": "<JSON string or text>" }
  ```

Your adapter does not need to reshape these events for streaming; forward them verbatim. For **non‑stream**, the accumulator should place the final function call item (with full `arguments`) into `output`.

---

## 6) Finish reasons & usage

To preserve backwards compatibility for clients that still ask “why did it stop?”:

- Derive from terminal `response.status` and `incomplete_details.reason`:
  - `completed` + last item is a message → `stop`
  - last item is a function_call and no assistant message followed → `tool_calls`
  - `incomplete` + reason=`max_output_tokens` → `length`
  - `incomplete` + reason=`content_filter` → `content_filter`
- When present, forward `usage.input_tokens`, `usage.output_tokens`, `usage.total_tokens`. If you need it in streaming, set `stream_options.include_usage:true` in the request body.

---

## 7) Ops & versioning

- **Pin** the Codex CLI version in your Docker image.
- **Check** on process start that the app‑server protocol version matches the committed `docs/issues/codex-app-server/*` types; fail fast (or warn in dev) if it doesn’t.
- **Log**: child starts/exits, per‑turn timings, and error buckets (contract vs transport vs provider).

---

## 8) Suggested patch plan (files to touch)

1. `src/services/codex-app-server.ts` — new (driver).
2. `src/bootstrap/app-server.ts` — new (singleton init at server boot).
3. `src/routes/responses.js` — replace proto/HTTP backend with driver calls as above; streaming & non‑stream branches.
4. `src/services/sse.js` — keep; ensure it can write arbitrary event names.
5. `tests/*responses*` — should pass unchanged; add a new test for `stream_options.include_usage:true` if not covered.

---

## 9) Quick local sanity

```bash
# Start dev stack
docker compose up -d api

# Verify streaming
curl -N http://localhost:3040/v1/responses \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{"model":"gpt-5-codex","input":"Say hi","stream":true,"stream_options":{"include_usage":true}}' | awk 'BEGIN{RS="\n\n"} {print $0 "\n----"}'

# Verify non-stream
curl -s http://localhost:3040/v1/responses \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{"model":"gpt-5-codex","input":"Say hi","stream":false}' | jq .
```

---

### Appendix — Known pitfalls

- Launching `codex app-server` **without** writing JSON on stdin shows `deserialize JSONRPCMessage: EOF…` — expected if you run it by hand. Always spawn it and write JSONL requests.
- If your environment uses corporate proxies, pass `HTTP_PROXY/HTTPS_PROXY/NO_PROXY` into the child’s `env`.
- Unknown events in future CLI builds: **pass through**; do not crash turns on unknown `ev.type`.

---

**This document is tailored for Story 6.1 status:** your `/v1/responses` route exists and is covered by tests; the migration only swaps the backend to Codex app‑server while keeping the contract stable for clients.
