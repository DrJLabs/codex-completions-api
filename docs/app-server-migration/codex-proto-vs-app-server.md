# Migrating from `codex proto` to `codex app-server`

> **Status:** The proxy no longer supports `codex proto`; this document is retained for historical context.
> **Purpose:** A developer guide to replace deprecated **`codex proto`** integrations with the supported **`codex app-server`**. Focus: input/output protocol, launch semantics, session management, and migration implications for proxies that translate Codex output into OpenAI‑compatible responses.

---

## TL;DR

- **`codex proto` is removed** in newer Codex CLI builds. **`codex app-server`** is the supported entry point.
- **Protocol shift:** ad‑hoc JSON events (`type`/`op`) → **JSON‑RPC 2.0** over stdio with `method`, `params`, `id`, `result`/`error`.
- **Lifecycle shift:** per‑request subprocess → **single persistent process** that handles many conversations.
- **Input shift:** `user_turn` + `user_input` ops → **`initialize` → `sendUserTurn` → `sendUserMessage`** (JSON‑RPC calls).
- **Output shift:** `assistant_message`/`agent_message_*` events → **notifications** like `agentMessage` / `agentMessageDelta` + a final RPC `result` (and other lifecycle/tool notifications).
- **Naming updates:** _assistant_ → **agent**; _session_ → **thread** in parts of the surface.
- **Auth & config:** unchanged concepts (ChatGPT OAuth or API key; `config.toml`, profiles, `-c key=value`, `CODEX_HOME`).

---

## 1) Launching the Codex process

### `codex proto` (legacy)

- Runs a **one‑shot protocol stream** over STDIN/STDOUT.
- Typical usage: spawn a child process per request (`codex proto …`), write a JSON payload for user input, read a stream of JSON events until completion, kill the child.

### `codex app-server` (current)

- Runs a **local application server** over STDIN/STDOUT using **JSON‑RPC 2.0** as the transport/shape.
- Expected to be **long‑lived**: spawn once, reuse for many requests.
- Global config/flags still apply (e.g., `--model`, `--profile`, `-c key=value`).

**Example launch (Node/posix pseudo):**

```bash
codex app-server   --model gpt-5-codex   --config preferred_auth_method="chatgpt"   --config sandbox_mode="workspace-write"
```

---

## 2) Input differences (client → Codex)

### 2.1 Initialization handshake

- **Proto:** no formal handshake; you could immediately send an op.
- **App-server:** first send an **`initialize`** request:
  ```json
  {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": { "client_info": { "name": "YourProxy", "version": "1.0.0" } }
  }
  ```
- The server replies with a JSON‑RPC **response** (same `id`) confirming initialization and returning info like a user‑agent string. Until this is sent, other calls may fail.

### 2.2 Starting a user turn and sending a prompt

- **Proto:** send a `user_turn` op followed by `user_input` with items array:
  ```json
  {"id":"…","op":{"type":"user_turn"}}
  {"id":"…","op":{"type":"user_input","items":[{"type":"text","text":"<prompt>"}]}}
  ```
- **App-server:** send **`sendUserTurn`** then **`sendUserMessage`** (method names reflect JSON‑RPC). Minimal sketch:

  ```json
  {"jsonrpc":"2.0","id":2,"method":"sendUserTurn","params":{"conversation_id":null}}
  {"jsonrpc":"2.0","id":3,"method":"sendUserMessage","params":{"text":"<prompt>"}}
  ```

  - Some integrations combine turn/message when a conversation is already active; keeping the two-step mirrors proto semantics closely.
  - Each request needs a unique `id` for correlation.

### 2.3 Conversations (threads)

- **Proto:** effectively a single implicit session unless you re‑spawned Codex.
- **App-server:** explicit **conversations/threads** via methods like `newConversation`, `resumeConversation`. For stateless proxies, create/use a fresh conversation per API call (or let the server auto‑create it on first turn) and avoid cross‑request memory.

### 2.4 Per‑request model selection

- App‑server **inherits the model** selected at process launch (`--model` or profile). Changing models **per request** is not part of the stable surface; recommended approach is **one app‑server per model/profile** and route requests accordingly.

---

## 3) Output differences (Codex → client)

### 3.1 Responses vs. notifications

- **Proto:** stream of JSON events with `type`/`op` (e.g., `agent_message_delta`, `assistant_message`, `token_count`, `task_complete`). No request/response envelope.
- **App-server:** two kinds of output lines on stdout:
  - **JSON‑RPC responses**: have `id` + `result` or `error`. These answer a prior request.
  - **JSON‑RPC notifications**: have `method` + `params` (no `id`). These are **pushed events** (streaming deltas, tool activity, lifecycle events).

### 3.2 Common notification patterns

- **Initial session/thread configured** (naming varies: `sessionConfigured` / `threadStarted`) with model/thread IDs.
- **Streaming content** via notifications like **`agentMessageDelta`** (or `agentMessage` with partials), each carrying a chunk of assistant text.
- **Final agent message** via **`agentMessage`** (complete text), or reflected in the **RPC result** to `sendUserMessage`.
- **Token/usage** notifications (e.g., prompt/completion token counts).
- **Tool execution** notifications (tool started/output/finished) if the agent runs external tools.

### 3.3 Naming updates

- **assistant → agent** (e.g., `assistant_message` → `agentMessage`).
- **session → thread** language in some events/responses.
- In code, treat event names **semantically**; don’t hardcode old `assistant_*` names.

### 3.4 Example flow (streaming)

1. Client sends `initialize`, `sendUserTurn`, `sendUserMessage`.
2. Server emits `sessionConfigured`/`threadStarted` (notification).
3. Server emits zero or more `agentMessageDelta` notifications; your proxy forwards these as SSE `delta` chunks.
4. Server emits `agentMessage` (final) or the RPC **response** to `sendUserMessage` indicates completion.
5. Optional: a `tokenCount` notification. Your proxy maps to OpenAI `usage`.
6. Proxy ends SSE with `[DONE]`.

---

## 4) Other important considerations

### 4.1 Feature/provider support

- App‑server focuses first on **OpenAI provider** paths. If you previously wired non‑OpenAI providers under proto, verify parity; some routes (e.g., OSS backends) may require updates.

### 4.2 Process management

- Keep **one app‑server** child alive. Re‑spawn on crash. Add health checks (e.g., send `initialize` or lightweight ping).

### 4.3 Timeouts & cancellation

- Maintain your **request timeout** at the proxy level. If app‑server lacks a per‑request cancel RPC, consider:
  - Returning a timeout to the client.
  - Optionally restarting the app‑server process if it becomes unresponsive.

### 4.4 Backpressure & concurrency

- Route notifications to the **correct HTTP stream** using conversation/request IDs.
- Limit concurrent in‑flight requests to what the server reliably supports; keep your existing concurrency cap.

### 4.5 Auth & configuration

- **ChatGPT OAuth** (`codex login`) or **API key**. Persist credentials under **`CODEX_HOME`** (e.g., mount `~/.codex` into a container).
- Use `config.toml` / profiles for model/sandbox/approvals; override with `--model` / `-c key=value` at launch.

---

## 5) Migration steps (for any proto‑based integration)

1. **Replace** `codex proto …` → `codex app-server …` in your spawn logic.
2. **Make the child persistent**; remove per‑request spawn/kill.
3. **Add JSON‑RPC** request writer & response/notification parser.
4. **Implement** the `initialize` call **before** any conversation methods.
5. **Map** notifications to your existing output pipeline (e.g., SSE deltas).
6. **Keep API stable** for callers (don’t change `/v1/chat/completions` output).
7. **Update Docker/deploy** to mount `CODEX_HOME`; ensure `codex login` or API key is available.
8. **Harden** for timeouts/crash‑restarts and future schema tweaks.

---

## 6) Reference checklist

- [ ] Launch: `codex app-server` with desired model/profile.
- [ ] Auth present under `CODEX_HOME` (ChatGPT OAuth or API key).
- [ ] JSON‑RPC client in place: `initialize` → `sendUserTurn` → `sendUserMessage`.
- [ ] Notification router maps conversation/request IDs to correct HTTP responses.
- [ ] SSE streaming wired to `agentMessageDelta` / `agentMessage` notifications.
- [ ] Non‑streaming path assembles full message & usage from result/notifications.
- [ ] Health checks, restart policy, and request timeout handling implemented.
- [ ] Tests use an **app‑server mock** (JSON‑RPC) rather than a proto shim.

---

## 7) Known gaps / caveats

- **Per‑request model switching:** run multiple app‑server instances or route to profiles.
- **Cancellation:** no guaranteed per‑turn cancel RPC; handle via proxy timeout and, if necessary, process restart.
- **Schema churn:** app‑server is evolving; write a tolerant parser (ignore unknown fields, feature‑flag new methods).
- **Parallelism:** ensure notifications include or can be correlated to conversation IDs; otherwise serialize.
