# Task 5 — JSON-RPC Protocol, Schema, and Worker Transport (Contract Survey)

Repo: `DrJLabs/codex-completions-api`  
Commit: `c8628fa5613c5d1dd86bfb0dbfec80e23e965b17`  
Date: 2025-12-08

## Objective

Deeply map and validate the JSON-RPC contract between this proxy and the Codex “app-server” backend, including:

- The request/response/notification shapes the proxy expects and emits
- The schema artifacts intended to keep those shapes stable over time
- The transport/worker pipeline that ingests backend events and turns them into Chat Completions streaming semantics
- Gaps, contradictions, obsolete components, and high-risk footguns in the schema/tooling/documentation

---

## In-Scope Components (Primary)

### Runtime contract + builders
- `src/lib/json-rpc/schema.ts`  
  Current TypeScript contract types, builder helpers (e.g., `buildSendUserMessageParams`), and type guards.

### Transport and event ingestion
- `src/services/transport/index.js`  
  Implements the JSON-RPC request/response path and notification ingestion, context routing, and lifecycle cleanup.
- `src/services/transport/child-adapter.js`  
  Bridges JSON-RPC transport into a “legacy child process” streaming interface (stdout JSON lines).

### Worker lifecycle
- `src/services/worker/supervisor.js`  
  Spawns the Codex app-server, parses lifecycle events from stdout, exposes readiness signals.
- `src/services/codex-runner.js`  
  Spawns `codex app-server` with env/workdir setup and logs.

### Schema tooling + validation
- `docs/app-server-migration/app-server-protocol.schema.json`  
  JSON Schema bundle committed to the repo.
- `scripts/jsonrpc/export-json-schema.mjs`  
  Regenerates the JSON Schema bundle from TS types via `typescript-json-schema`.
- `tests/integration/json-rpc-schema-validation.int.test.js`  
  Uses Ajv to validate representative payloads against the JSON Schema bundle.
- `tests/unit/json-rpc-schema.test.ts`  
  Unit coverage for the builder helpers and their normalization behavior.

### Test harness / simulator
- `scripts/fake-codex-jsonrpc.js`  
  A fake JSON-RPC backend that emits notifications and synthetic results for testing.

---

## Contract Baseline: What “JSON-RPC” Means Here

### Envelope

Requests (with `id`):
```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}
```

Responses:
```json
{"jsonrpc":"2.0","id":1,"result":{...}}
```

Notifications (no `id`):
```json
{"jsonrpc":"2.0","method":"codex/event/agent_message_delta","params":{...}}
```

### Method set (current schema.ts)

The runtime schema includes these request methods:

- `initialize`
- `newConversation`
- `addConversationListener`
- `removeConversationListener`
- `sendUserTurn`
- `sendUserMessage`

This is a strong indicator that the app-server contract is now explicitly conversation-scoped with an opt-in listener/subscription model (not just a “send a prompt” model).

---

## Observed Runtime Call Sequence (Proxy → App-Server)

This is the highest-confidence happy path based on `JsonRpcTransport` and the child adapter:

1. Worker spawn & readiness  
   `CodexWorkerSupervisor` spawns `codex app-server` and waits for a JSON line indicating readiness (e.g., `{"event":"ready"}`).

2. Handshake (one-time)  
   `JsonRpcTransport.ensureHandshake()` calls `initialize`. The handshake result is cached.

3. Conversation acquisition  
   `JsonRpcTransport.ensureConversation(context, explicitConversationId)`:
   - If no conversationId is provided, call `newConversation`
   - Then call `addConversationListener` with the conversationId (creating a subscriptionId)

4. Turn configuration  
   `createChatRequest({ requestId, turnParams })` triggers a `sendUserTurn` call (the “turn-level” config stage).

5. User message  
   `sendUserMessage(context, messagePayload)` sends the actual user content as `items`.

6. Notifications → Chat delta assembly  
   Notifications (often under `codex/event/*`) are normalized into delta/message/usage events.  
   `child-adapter.js` can re-emit these via stdout JSON lines for legacy stream handlers.

7. Cleanup  
   When the context completes, the transport attempts `removeConversationListener(subscriptionId)` to prevent leaks.

---

## Payload Shapes That Matter

### Input item shape (current)

The “user message item” produced by `createUserMessageItem(text)` is a text item:

```json
{"type":"text","data":{"text":"Hello"}}
```

The schema also supports `image` (`base64`) and `localImage` (`path`) items.

### Turn-stage params (sendUserTurn)

Representative fields:

- `conversationId` (string)
- `items` (InputItem[])
- `cwd`
- `approvalPolicy` / `sandboxPolicy`
- `model` / `effort` / `summary`
- `tools` (structured config)

### Message-stage params (sendUserMessage)

Representative fields (in addition to `conversationId` + `items`):

- `includeUsage` (and a snake_case mirror field is often emitted by builders)
- sampling knobs: `temperature`, `topP`
- `maxOutputTokens`
- `finalOutputJsonSchema` (and a snake_case mirror)
- `model` / `effort` / `summary` (where supported)

---

## Schema Tooling and “Source of Truth” Reality Check

### What appears to be canonical today

- `src/lib/json-rpc/schema.ts` is treated as the canonical local contract (types + builders)
- The JSON Schema bundle is generated from this file (not from the upstream Codex repo directly)

### Where drift and contradictions are visible

1) `schema.ts` vs `schema-template.ts`  
`scripts/jsonrpc/schema-template.ts` defines a different protocol surface (notably missing newer methods like `newConversation` and conversation listeners, and using older input item shapes).  
`scripts/jsonrpc/render-schema.mjs` still exists and is wired as `npm run jsonrpc:schema`, which writes to `src/lib/json-rpc/schema.ts`.

Risk: a contributor can run `npm run jsonrpc:schema` and overwrite the current `schema.ts` with a mismatched, older contract.

2) Docs do not match the current contract  
`docs/app-server-migration/codex-app-server-rpc.md` describes older request shapes (e.g., `items` with `type:"userMessage"` and “conversationId can be null”).  
The current schema + transport implement a `newConversation` + `addConversationListener` workflow, and `items` use `type:"text"` etc.

3) Version pinning is inconsistent across artifacts  
- `schema.ts` hardcodes `CODEX_CLI_VERSION` (currently `0.56.0`)
- `package.json` depends on `@openai/codex` at a newer version (currently `0.58.0`)
- Migration docs reference yet another version pin (example: `0.53.0`)

Net effect: it is unclear which “version” is authoritative for protocol evolution.

4) Notification types are stricter than runtime behavior  
The transport handles more notification methods (e.g., `taskComplete` / `task_complete`, plus both camel and snake variants of other methods) than the local type guards encode.

5) Normalized request fields that do not appear to be forwarded  
The request normalizer builds fields like `choiceCount`, `stream`, and `includeApplyPatchTool`.  
The current `schema.ts` builders and `JsonRpcTransport` do not clearly forward these into app-server params.  
This can mean “implemented in proxy only”, “ignored”, or “obsolete”—needs confirmation.

---

## Findings (Actionable)

### High-risk footguns / contradictions
- Schema regeneration path is dangerous: `npm run jsonrpc:schema` can plausibly overwrite the live schema with the legacy template output
- Docs & runbooks are stale relative to the current schema + transport behavior
- Version drift is visible in multiple places and is not enforced

### “Dirty code” indicators
- Coexisting schema generation mechanisms (export-from-upstream + template renderer) without a single authoritative workflow
- Backward-compatibility mirrors (camelCase + snake_case) exist in builders, while docs simultaneously recommend “camelCase only”
- Extra fields passed at callsites but not represented by builders (sign of contract evolution without cleanup)

---

## Recommended Remediation Plan (Concrete)

### 1) Choose a single source-of-truth workflow for protocol/schema

Pick one:

- Option A (recommended): upstream-export driven
  - Replace `render-schema.mjs` + `schema-template.ts` with a generator that imports/exports the upstream schema and then applies a deterministic trim step
  - Make `npm run jsonrpc:schema` generate a schema.ts identical to the committed one (or fail CI)

- Option B: local-authoritative TS schema
  - Delete `render-schema.mjs` + `schema-template.ts` and keep `schema.ts` fully authoritative
  - Keep `export-json-schema.mjs` and schema validation tests

### 2) Add CI guardrails
- CI check: `npm run jsonrpc:schema && git diff --exit-code src/lib/json-rpc/schema.ts`
- CI check: `npm run jsonrpc:bundle && git diff --exit-code docs/app-server-migration/app-server-protocol.schema.json`

### 3) Align documentation with the current contract
Update docs to reflect:
- `newConversation` + `addConversationListener` stage
- `items` types: `text`, `image`, `localImage`
- where `finalOutputJsonSchema` is actually applied (message-stage, not turn-stage)
- notification method naming / `codex/event/*` prefixing

### 4) Tighten type coverage (or explicitly loosen it)
Either:
- Expand `ChatNotification` types to include everything runtime supports (including `taskComplete`), or
- Make the type guard intentionally permissive and document normalization as the source of truth

### 5) Reconcile “dead/ignored” request knobs
For each normalized field that does not reach app-server (`choiceCount`, `stream`, etc.):
- Confirm whether it is implemented at the proxy level, ignored, or deprecated
- If ignored/deprecated, remove it from normalization and update docs/tests
- If implemented in proxy, document where and add tests

---

## Next Task Suggestion (Task 6)

Focus on the streaming assembly layer:

- How raw backend notifications become OpenAI Chat Completions SSE chunks and/or non-stream responses
- Multi-choice behavior (`n` / `choiceCount`) and tool-call aggregation semantics
- Finish-reason reconciliation (usage-driven) and error lexicon mapping

Deliverable: a deep, end-to-end “event → chunk” mapping plus an issue list for correctness gaps.
