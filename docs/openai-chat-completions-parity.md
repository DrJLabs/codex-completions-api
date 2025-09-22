---
title: OpenAI Chat Completions Parity — Spec & Streaming Contract
version: 0.2
updated: 2025-09-22
source-of-truth: This repository’s server behavior and tests
---

## Non‑Stream Response (POST /v1/chat/completions, stream=false)

- object: "chat.completion"
- fields:
  - id: string (e.g., "chatcmpl_abc123")
  - object: string = "chat.completion"
  - created: number (unix seconds)
  - model: string (accepts `codex-5*` and `codev-5*` aliases)
  - choices: array[0]
    - index: 0
    - message: { role: "assistant", content: string }
    - finish_reason: "stop" | "length"
  - usage: { prompt_tokens: number, completion_tokens: number, total_tokens: number }

Verification: Covered by integration tests —
- tests/integration/chat.nonstream.shape.int.test.js (shape + stop)
- tests/integration/chat.nonstream.length.int.test.js (truncation → length)
- tests/integration/chat.model.consistency.int.test.js (model string parity stream vs non‑stream)

Example (minimal):

```json
{
  "id": "chatcmpl_abc123",
  "object": "chat.completion",
  "created": 1710000000,
  "model": "codex-5",
  "choices": [
    {
      "index": 0,
      "message": { "role": "assistant", "content": "Hello!" },
      "finish_reason": "stop"
    }
  ],
  "usage": { "prompt_tokens": 6, "completion_tokens": 2, "total_tokens": 8 }
}
```

## Streaming Contract (POST /v1/chat/completions, stream=true)

- Event envelope per data line (SSE):
  - id: stable string across all chunks (e.g., "chatcmpl_abc123")
  - object: "chat.completion.chunk"
  - created: number (unix seconds)
  - model: string
  - choices: array
    - For deltas: [{ index: 0, delta: { role?"assistant" | content?string } }]
    - Finalizer: [{ index: 0, delta: {}, finish_reason: "stop" | "length" }]
  - usage: optional object only when `stream_options.include_usage=true` and tokens are known

- Required order:
  1. Initial role delta: `choices[0].delta.role = "assistant"`; `finish_reason:null`, `usage:null`.
  2. Zero or more content delta chunks: `choices[0].delta.content`; `finish_reason:null`, `usage:null`.
  3. Finalizer chunk: empty `delta`, `choices[0].finish_reason` populated; `usage:null`.
  4. Optional final usage chunk (only when `stream_options.include_usage:true`): `{ choices: [], usage: {...} }`.
     - Story 2.6 (2025‑09‑14): adds forward‑compatible, nullable placeholders to the final usage object:
       - `time_to_first_token: null` (ms)
       - `throughput_after_first_token: null` (tokens/sec)
     - These keys appear only on the streaming final usage chunk when usage is requested; they do not appear in non‑stream responses.
     - Story 3.3 (2025‑09‑18): usage objects now include an `emission_trigger` string describing which event prompted emission (`"token_count"`, `"task_complete"`, or `"provider"`).
     - Story 3.9 (2025‑09‑22): the streaming finalizer now propagates upstream finish reasons (`"stop"`, `"length"`, future values) and still emits the optional usage chunk immediately after the finalizer when `stream_usage=true`.
  5. Terminal sentinel line: `[DONE]`.

Example usage chunk (Story 3.3):

```
data: {"id":"chatcmpl-xyz","object":"chat.completion.chunk","created":1726646400,"model":"gpt-5","choices":[],"usage":{"prompt_tokens":11,"completion_tokens":7,"total_tokens":18,"time_to_first_token":null,"throughput_after_first_token":null,"emission_trigger":"token_count"}}
```

Notes:

- Keepalive comment lines (": <ts>") may appear and should be ignored by clients.
- No custom event frames are emitted for normal output; every JSON `data:` line uses the `chat.completion.chunk` envelope and includes `id/object/created/model`.
- `stream_options.include_usage=true` adds a final usage chunk after the finish_reason chunk and before `[DONE]`.
- Providers that emit usage payloads even when `include_usage:false` are tolerated; the proxy logs the payload (`emission_trigger:"provider"`) but does not forward an extra chunk to clients.
- All chunks in a stream share the same `id` and `created` values.
- Dev logging captures the propagated finish reason (and its source event) for observability dashboards and regressions.

### Golden Transcripts & Snapshots (Story 3.5)

- Location: `test-results/chat-completions/`
  - `nonstream-minimal.json`
  - `nonstream-truncation.json`
  - `streaming-usage.json`
  - `streaming-usage-length.json`
- Keploy-compatible snapshots live alongside the JSON fixtures under `test-results/chat-completions/keploy/test-set-0/tests/*.yaml`. Generate both sets via `npm run transcripts:generate` (enable `KEPLOY_ENABLED=true` to emit the YAML fixtures while keeping JSON fallbacks in sync).
- Each transcript stores sanitized payloads where `id` and `created` are replaced with `<dynamic-id>` and `<timestamp>` so deterministic diffs highlight envelope drift instead of random identifiers.
- Refresh via `npm run transcripts:generate`, which spins up the deterministic fake Codex proto, records requests/responses through a Keploy-style capture, and saves metadata (commit SHA, `codex_bin`, capture timestamp, `include_usage` flag).
- GitHub Actions run `keploy test` through the `keploy-dry-run` job, but as of 2025-09-22 the CLI logs `ERROR No test-sets found...` despite the YAML snapshots listed above. The job exits zero, so current CI does not actually replay the captures; fixing the invocation/configuration is required to regain coverage (see Story 3.6 and Issue #77).
- Manual dry-run evidence (2025-09-20): `keploy test --config-path config --path test-results/chat-completions/keploy --test-sets test-set-0` now reads the 2.x snapshots but fails when the CLI tries to start the app (`failed to set memlock rlimit: operation not permitted`). Logs, metrics stub, and version output live under `docs/bmad/qa/artifacts/3.8/`, documenting the need for CAP_IPC_LOCK (privileged container/self-hosted runner) before replay can succeed.
- CI dry-run evidence (2025-09-21): with `KEPLOY_ENABLED=true` configured in repository environments, the `keploy-dry-run` job replays existing snapshots on a GitHub-hosted runner, installs Keploy via the helper script, and publishes artefacts (`test.log`, `metrics.txt`, `version.txt`). The job is labelled “dry run” because it replays previously recorded traffic; no new captures or external calls occur, so the step can run on every push without mutating datasets.
- Contract tests (`tests/integration/chat.contract.*.int.test.js`) and Playwright specs (`tests/e2e/chat-contract.spec.ts`) sanitize live responses and compare them to these transcripts on every CI run, ensuring ordering, usage emission, and truncation semantics remain stable.

### Client Guidance (2025-09-22)

- Streaming clients must be prepared for `finish_reason:"length"` (and future provider-supplied values) on the finalizer chunk. Always gate logic on the presence of the field rather than assuming `"stop"`.
- When `stream_options.include_usage=true`, the final usage chunk still trails the finish chunk; do not rely on usage arriving before the finalizer.
- LangChain 0.2+ emits a dedicated usage event when `streamUsage=true`. The new harness (`tests/integration/langchain.streaming.int.test.js`) demonstrates how to observe both the finish chunk and the trailing usage payload against this proxy.

### Keploy CLI Rollout & Dry-Run (Story 3.7)

- Use `./scripts/setup-keploy-cli.sh` to provision the Keploy CLI. The script validates that ports 16789 (record), 16790 (test), and 26789 (DNS) are free, enforces loopback binding via `KEPLOY_HOST_BIND=127.0.0.1`, downloads the official installer (`curl -fsSL https://keploy.io/install.sh`), and prints the installed version for audit trails.
- Local `.env` files include `KEPLOY_MODE`, `KEPLOY_APP_PORT`, `KEPLOY_RECORD_PORT`, `KEPLOY_TEST_PORT`, `KEPLOY_DNS_PORT`, and `KEPLOY_HOST_BIND` so developers can opt in to replay without exposing ports beyond localhost. Set `KEPLOY_ENABLED=true` once the CLI is installed.
- CI runs the `keploy-dry-run` workflow job whenever `KEPLOY_ENABLED=true` in repository/environment variables. The job reuses the install helper, caches the CLI layer (`~/.keploy`), executes `keploy test --config-path config --path test-results/chat-completions/keploy --test-sets test-set-0`, and uploads `keploy` logs plus replay duration metrics as artifacts.
- The dry-run job keeps the existing `npm run verify:all` duration within budget; performance guard metrics are logged so regressions trigger investigation before flipping additional Keploy stages (record/compare) on by default.

### Streaming Concurrency Guard (Test Instrumentation)

- The per-process SSE concurrency guard rejects additional streams with `429` when `PROXY_SSE_MAX_CONCURRENCY` is set. Production responses remain unchanged.
- When `PROXY_TEST_ENDPOINTS=true`, the proxy exposes deterministic instrumentation for CI and local harnesses:
  - Response headers on both accepted and rejected requests: `X-Conc-Before`, `X-Conc-After`, `X-Conc-Limit` (numeric strings). Accepted streams include `before=0`, `after=1` when the first slot is acquired; rejected requests surface the guard state without altering production headers when the flag is off.
  - Test-only endpoints:
    - `GET /__test/conc` → `{ conc: <active_count> }`
    - `POST /__test/conc/release` (optional) writes to `STREAM_RELEASE_FILE` when provided, allowing deterministic teardown of shimmed streams.
- Guard acquisition occurs before the Codex child process spawns to remove timing races; release is idempotent and wired to `close`, `finish`, and `aborted` events.
- Structured logs include `{"scope":"sse_guard","outcome":"acquired|rejected|released",...}` with `before`, `after`, and `limit` fields keyed by `req_id` for observability.

### Streaming Errors

- On unrecoverable errors mid‑stream, the server sends a single JSON error frame:

  ```
  data: {"error":{"message":"...","type":"server_error"|"timeout_error","code":"spawn_error|request_timeout"}}
  data: [DONE]
  ```

- The error frame is not a `chat.completion.chunk` envelope but maintains the standard error JSON. The stream always terminates with a separate `[DONE]` line.

## Error Envelope (non‑2xx)

```json
{
  "error": {
    "message": "...",
    "type": "invalid_request_error" | "authentication_error" | "permission_error" | "tokens_exceeded_error" | "rate_limit_error" | "timeout_error" | "server_error",
    "param": "<field>" | null,
    "code": "..."
  }
}
```

Examples:

- Missing `messages[]` → `400` with `param: "messages"`.
- `n>1` unsupported → `400` with `param: "n"`.
- Model not accepted → `404` with descriptive code.
- Tokens exceeded (context length) → `403` with `type: "tokens_exceeded_error"`.
- Unauthorized (when protection enabled) → `401` with `type: "authentication_error"`.

## Parameters (subset)

- model: string; accepts environment‑advertised ids (see README) and normalizes aliases to an effective model.
- stream: boolean.
- stream_options.include_usage: boolean; when true, emits a usage chunk before `[DONE]`.
- reasoning.effort: "low" | "medium" | "high" | "minimal"; default implied by model.
