# Codex **app‑server** JSON‑RPC: exact methods, parameters, and a tiny Node harness

**Scope:** This doc distills what you need to get past the `-32600 Invalid Request` error when calling the Codex **app‑server** directly. It pulls from your attached `codex` mirror (key file paths listed below) plus upstream docs/PRs. It contains:

- A minimal, authoritative method/parameter map for the _happy‑path_ (`initialize → sendUserTurn → message stream`).
- A verified JSON example for each call (property names in **camelCase** exactly as the server expects).
- A small Node script that speaks JSON‑RPC 2.0 over **stdio** to `codex app-server` and prints assistant messages.
- How to **dump the official JSON Schema** for the app‑server protocol from the repo (so your proxy can be code‑gen’d from specs and not guesswork).

> **Why -32600 happens:** JSON‑RPC “Invalid Request” is thrown when the payload is structurally wrong (e.g., wrong method name, missing `jsonrpc: "2.0"`, wrong param names, or a non‑object/array for `params`). Using proven method names and exact **camelCase** parameter names fixes this.

---

## 0) Where the truth lives (your repo + upstream)

**Your mirror repo (paths to read):**

- `codex-rs/app-server-protocol/src/protocol/v1.rs` — **canonical request/response types & JSON names** (serde `rename_all = "camelCase"`).
- `codex-rs/app-server-protocol/src/protocol/common.rs` — shared enums (e.g., `ReasoningEffort`, approval/sandbox policies).
- `codex-rs/app-server-protocol/src/export.rs` — **schema export** (JSON Schema bundle generator).
- `codex-rs/app-server/tests/suite/codex_message_processor_flow.rs` — end‑to‑end tests for **sendUserTurn** (great for real payloads).

**Upstream signals that match your repo:**

- “Generate **JSON schema** for app‑server protocol” is in the CLI changelog and PR history, which is why `export.rs` exists and why schema dumping works (see §4).
- PR: “Exposes `final_output_json_schema` through the app‑server protocol” — shows **`SendUserTurnParams`** adds `finalOutputJsonSchema` (camelCase) and confirms field names and casing.

---

## 1) Transport + framing

- **Process:** `codex app-server` (local, development use). It speaks **JSON‑RPC 2.0** over **stdio** as newline‑delimited JSON (JSONL).
- **Framing:** One JSON object per line. Each request object **must** include:
  ```json
  {"jsonrpc":"2.0", "id": <number|string>, "method": "<name>", "params": { ... }}
  ```
- **Responses:** Success → `{"jsonrpc":"2.0","id":<id>,"result":{...}}`; Error → `{"jsonrpc":"2.0","id":<id>,"error":{"code":-32600|...,"message":"..."}}`.
- **Server events:** During a turn, the server emits **notifications** (objects with a `method` and `params` but **no `id`**) for streaming assistant output. Your harness should treat any **notification** as an event and print it.

> Practical note: If you see `-32600`, first verify **`jsonrpc`**, **method name**, and **camelCase params**. Then ensure the top‑level `params` is an **object** (not raw string).

---

## 2) Methods you need for the happy path

### 2.1 `initialize`

**Method:** `initialize`  
**Params object:**

| Name              | Type                                       | Required | Notes                                                                     |
| ----------------- | ------------------------------------------ | -------- | ------------------------------------------------------------------------- |
| `clientInfo`      | object `{ name: string, version: string }` | ✅       | Identifies your client.                                                   |
| `protocolVersion` | string                                     | optional | Omit to use the server default; include when you want strict negotiation. |
| `capabilities`    | object                                     | optional | Feature hints; safe to send `{}`.                                         |

**Minimal good request (works in practice):**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "clientInfo": { "name": "drj-harness", "version": "0.0.1" },
    "capabilities": {}
  }
}
```

**Typical success result (shape may add fields):**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "serverInfo": { "name": "codex-app-server", "version": "x.y.z" },
    "capabilities": { "logging": {}, "tools": {} }
  }
}
```

---

### 2.2 `sendUserTurn`

**Method:** `sendUserTurn`  
**Params object (v1):**

| Name                    | Type                         | Required | Notes                                                                     |
| ----------------------- | ---------------------------- | -------- | ------------------------------------------------------------------------- | -------- | --------------------- |
| `conversationId`        | string \| null               | optional | `null` or omit to start a new conversation; pass existing ID to continue. |
| `items`                 | array of **InputItems**      | ✅       | The user’s inputs for this turn (see items below).                        |
| `cwd`                   | string (path)                | optional | Working directory context for tools/plans.                                |
| `model`                 | string                       | optional | Override configured model (e.g., `"gpt-5-codex"`).                        |
| `approvalPolicy`        | string enum                  | optional | Mirrors CLI config when omitted.                                          |
| `sandboxPolicy`         | string enum                  | optional | Mirrors CLI config when omitted.                                          |
| `effort`                | enum `ReasoningEffort`       | optional | e.g., `"low"                                                              | "medium" | "high"`; tuning only. |
| `summary`               | string                       | optional | Short natural‑language goal; helps planning.                              |
| `finalOutputJsonSchema` | object (JSON Schema) \| null | optional | If provided, Codex validates/targets this shape. _Added in recent PR._    |

> **Exact casing:** All field names are **camelCase** on the wire (`finalOutputJsonSchema`, _not_ `final_output_json_schema`).

**Input items (min set for happy path):** The most portable minimal user item is a free‑form text message:

```json
{ "type": "userMessage", "text": "Create a hello.js that prints Hello World" }
```

Other item variants exist (e.g., attachments), but the above suffices to validate the pipeline. Consult your repo’s `protocol/v1.rs` for the full tagged union if you need more types.

**Minimal good request:**

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "sendUserTurn",
  "params": {
    "conversationId": null,
    "items": [{ "type": "userMessage", "text": "Create a hello.js that prints Hello World" }],
    "cwd": ".",
    "summary": "Generate a hello.js file",
    "effort": "medium",
    "finalOutputJsonSchema": null
  }
}
```

**What you should see:**

- A normal JSON‑RPC **result** for `id: 2` (often includes a resolved `conversationId` and turn metadata).
- A stream of **notifications** carrying assistant tokens/messages (print them as they come). When the assistant finishes, a final notification indicates completion (or your stream simply stops).

---

## 3) Tiny **Node** harness (stdio JSON‑RPC)

Save as `codex-app-server-harness.js` and run with `node codex-app-server-harness.js`. It will:

1. spawn `codex app-server`
2. send `initialize`
3. send a minimal `sendUserTurn` with one `userMessage`
4. print all notifications and exit when the first turn completes.

```js
#!/usr/bin/env node
// Minimal JSON-RPC over stdio harness for `codex app-server`
const { spawn } = require("child_process");

function ndjsonWrite(proc, obj) {
  const line = JSON.stringify(obj);
  proc.stdin.write(line + "\n");
}

function boot() {
  const child = spawn("codex", ["app-server"], {
    stdio: ["pipe", "pipe", "inherit"],
    env: process.env,
  });

  let buf = "";
  let initDone = false;
  let turnDone = false;

  child.on("exit", (code) => {
    if (!initDone) console.error("app-server exited before initialize");
    process.exit(code ?? 0);
  });

  child.stdout.on("data", (chunk) => {
    buf += chunk.toString("utf8");
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch (e) {
        console.error("Non-JSON line from server:", line);
        continue;
      }
      // Handle JSON-RPC response or notification
      if (msg.method && !("id" in msg)) {
        // Notification (event)
        console.log("[event]", JSON.stringify(msg));
        // Heuristic: mark done when we see a completion-ish event name
        if (
          typeof msg.method === "string" &&
          /completed|final|done|turnFinished/i.test(msg.method)
        ) {
          turnDone = true;
          console.log("Turn appears complete — shutting down.");
          child.kill();
        }
      } else if ("result" in msg || "error" in msg) {
        if (msg.id === 1 && "result" in msg) {
          initDone = true;
          console.log("[ok] initialize");
          sendTurn(child);
        } else if (msg.id === 2) {
          if ("error" in msg) {
            console.error("[sendUserTurn error]", msg.error);
            child.kill();
          } else {
            console.log("[ok] sendUserTurn result ack");
            // result ack received; wait for notifications
          }
        }
      } else {
        console.log("[other]", line);
      }
    }
  });

  // 1) initialize
  ndjsonWrite(child, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      clientInfo: { name: "drj-harness", version: "0.0.1" },
      capabilities: {},
    },
  });
}

function sendTurn(child) {
  // 2) sendUserTurn (minimal, happy-path)
  ndjsonWrite(child, {
    jsonrpc: "2.0",
    id: 2,
    method: "sendUserTurn",
    params: {
      conversationId: null,
      items: [{ type: "userMessage", text: "Create a hello.js that prints Hello World" }],
      cwd: ".",
      summary: "Generate a hello.js file",
      effort: "medium",
      finalOutputJsonSchema: null,
    },
  });
}

boot();
```

> If you still hit `-32600`, print the **exact** request the script is sending and compare the key names with §2 and with your repo’s `protocol/v1.rs` (camelCase on the wire).

---

## 4) Get the **authoritative JSON Schema** (no guessing)

There are two reliable ways to put a concrete, versioned schema in front of your proxy/coding agent:

### Option A — Use the generator in your repo

The repository includes an exporter (`codex-rs/app-server-protocol/src/export.rs`) added after “Generate JSON schema for app‑server protocol”. Build a tiny Rust entrypoint that calls the export routine and prints the **bundle** to stdout (or wire it into cargo as a bin/`examples/`). Because the types derive `schemars::JsonSchema`, you’ll get a full schema for requests, responses, and event notifications. Example sketch:

> **Implemented shortcut** — run `npm run jsonrpc:bundle` to regenerate
> `docs/app-server-migration/app-server-protocol.schema.json`. The script
> uses the generated TypeScript bindings (`src/lib/json-rpc/schema.ts`) to
> emit a draft-2020-12 bundle keyed by type name. A Vitest check (`json-rpc-schema-bundle.test.js`)
> fails if the on-disk schema drifts from the regenerated bundle.

```rust
// examples/print_schema.rs
use app_server_protocol::export; // crate path per your workspace
fn main() {
    let bundle = export::bundle();         // returns serde_json::Value
    println!("{}", serde_json::to_string_pretty(&bundle).unwrap());
}
```

Then:

```bash
cargo run -p app-server-protocol --example print_schema > app-server-protocol.schema.json
```

### Option B — If your CLI exposes a flag

Recent builds wire the exporter into the CLI. If your `codex app-server --help` lists a schema flag, you can do:

```bash
codex app-server --print-schema > app-server-protocol.schema.json
# or
codex app-server --export-schema > app-server-protocol.schema.json
```

(Flag name varies by build. If absent, use **Option A**.)

**What you’ll get:** a single JSON document describing all methods (`initialize`, `sendUserTurn`, …), their params (camelCase), and the event notification shapes. Use it to:

- validate requests before sending (eliminate `-32600`),
- generate typed clients (TS/Rust/Python),
- drive your proxy marshaling layer without guesswork.

---

## 5) Sanity checklist for the proxy

- ✅ `jsonrpc: "2.0"` present on **every** request & response you synthesize.
- ✅ **Method names**: `initialize`, `sendUserTurn` (exact casing).
- ✅ **Param casing**: camelCase JSON keys; match §2 exactly (e.g., `finalOutputJsonSchema`).
- ✅ `params` is an **object** (not a string); **no** extra envelope wrappers.
- ✅ **Input items**: at least one `{ "type":"userMessage", "text":"..." }` in `items`.
- ✅ **Transport**: newline‑delimited JSON objects over stdio; **no** content-length headers for stdio mode.
- ✅ Print all **notifications**; do not wait only for `id: 2` result — the assistant streams via notifications.
- ✅ Prefer schema‑driven validation (from §4) in your proxy before forwarding to the CLI.

---

## 6) Pointers (read while coding)

- Your mirror repo: see the 4 files listed in §0 for ground‑truth types, export, and end‑to‑end tests.
- Upstream docs & PRs mention the JSON Schema exporter and `sendUserTurn`’s `finalOutputJsonSchema` — align your payloads with **camelCase** JSON from there.
- CLI docs: the `codex app-server` command is explicitly intended for **local development** and is the correct target for this stdio JSON‑RPC harness.

---

## 7) Next steps for the coding agent

1. Use **Option A** (preferred) to dump `app-server-protocol.schema.json` from the attached repo.
2. Replace the `items` union in the Node harness with the exact types from the schema (`oneOf` on the item’s `"type"` tag) and add a small, schema‑driven validator.
3. Run the harness to confirm `initialize → sendUserTurn` happy path streams assistant messages.
4. Swap the harness into your proxy integration test to prevent regressions.

---

## Appendix: Example `sendUserTurn` with a final-output schema

```json
{
  "jsonrpc": "2.0",
  "id": 42,
  "method": "sendUserTurn",
  "params": {
    "conversationId": null,
    "items": [
      {
        "type": "userMessage",
        "text": "Summarize the repo in one sentence and return { summary: string }"
      }
    ],
    "finalOutputJsonSchema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "required": ["summary"],
      "properties": { "summary": { "type": "string" } }
    }
  }
}
```
