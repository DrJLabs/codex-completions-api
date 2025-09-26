# Codex OpenAI Proxy — Compatibility + Streaming Plan

_Updated: 2025-09-26_

This document summarizes improvements inspired by LiteLLM’s proxy, Codex CLI’s JSON-lines streaming, and the September 2025 stability campaign to maximize compatibility with OpenAI-style clients (IDEs, SDKs, and tools) while keeping production deterministic.

## Sources Reviewed

- LiteLLM proxy (OpenAI-compatible gateway): patterns for endpoint surfaces, streaming, and headers.
- Custom Codex CLI (codex-rs) with `--json` mode: emits JSONL events (e.g., `agent_message_delta`).

## Goals

- Robust OpenAI Chat Completions compatibility over `/v1/*`.
- First-class streaming with incremental deltas and correct `[DONE]` terminator.
- Minimal friction across IDEs: accept HEAD/OPTIONS, precise headers, and stable chunk shapes.

## Implemented Now

- `/v1/chat/completions` exposes OpenAI-compatible envelopes:
  - `HEAD` and `OPTIONS` with precise `Allow` / `Content-Type` headers.
  - Role-first SSE chunk, keepalive comments, usage chunk (when requested), and `[DONE]` terminator.
  - Dev-only parallel tool passthrough via `PROXY_ENABLE_PARALLEL_TOOL_CALLS=true`; production keeps serialized tooling.
- `/v1/completions` shim maps legacy prompt payloads to chat handlers while preserving OpenAI Completions semantics.
- `/v1/models` advertises environment-specific aliases (`codev-5*` in dev, `codex-5*` in prod) and normalizes to the effective `CODEX_MODEL` (`gpt-5`).
- Streaming concurrency guard (`PROXY_SSE_MAX_CONCURRENCY`) provides deterministic 429 backpressure with optional instrumentation when `PROXY_TEST_ENDPOINTS=true`.

## Streaming Shapes (OpenAI Chat-Compatible)

1. Role prelude per choice index:
   - `data: {"object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant"}}]}`
2. Incremental content/tool-call deltas (Codex `agent_message_delta` / tool responses):
   - `data: {"object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"…"}}]}`
   - Tool calls appear as `delta.tool_calls` arrays but are serialized sequentially for parity (dev-only parallel tooling still serializes outward).
3. Full-message fallback when Codex emits `agent_message` without deltas:
   - `data: {"object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"<full message>"}}]}`
4. Completion finalizer with finish reason:
   - `data: {"object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}.
5. Optional usage chunk when `stream_options.include_usage:true`:
   - `data: {"object":"chat.completion.chunk","choices":[],"usage":{"prompt_tokens":11,"completion_tokens":7,"total_tokens":18,"time_to_first_token":null,"throughput_after_first_token":null,"emission_trigger":"token_count"}}`
6. Terminal sentinel: `[DONE]`.

## LiteLLM-Derived Practices We Adopt

- Strict response headers:
  - `Content-Type: application/json; charset=utf-8` for JSON responses.
  - `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no` for SSE responses.
- HEAD/OPTIONS implemented across core endpoints for SDK/IDE preflight compatibility.
- Cache-friendly `/v1/models` (`Cache-Control: public, max-age=60`) with optional bearer gating (`PROXY_PROTECT_MODELS=true`).
- Model aliasing: advertise `codev-5*` (dev) or `codex-5*` (prod) while normalizing to the runtime `gpt-5` provider model.
- Usage telemetry appended to NDJSON logs with `emission_trigger` metadata to support reliability dashboards.

## Proposed Next Steps (Optional Enhancements)

- Document optional reasoning traces once the provider exposes `agent_reasoning_delta` in a stable format; decide how to surface it without breaking clients.
- Extend parity tests to validate `n>1` streaming once multi-choice support is promoted from rejected to experimental.
- Evaluate error-first streaming (set HTTP status before the stream) following LiteLLM’s first-chunk inspection pattern.
- Explore paginated `/v1/usage/raw` responses for long-lived analytics clients (current cap is 10 000 events by design).

## IDE/Client Compatibility Notes

- Cursor/VSCode/JetBrains typically depend on `chat.completions` SSE with:
  - Role-first delta, incremental content/tool chunks, optional usage chunk, `[DONE]` terminator.
  - HEAD/OPTIONS stability and precise `Content-Type`.
- Some tools probe `/v1/models` for advertised ids; dev returns `codev-5*`, prod returns `codex-5*`. Both map to `gpt-5` at runtime.
- Parallel tool calls should remain disabled in production requests; enable `PROXY_ENABLE_PARALLEL_TOOL_CALLS` only when testing in dev.

## Configuration Summary

- `CODEX_BIN`: defaults to `/usr/local/lib/codex-cli/bin/codex.js` (mounted package volume).
- `PROXY_ENABLE_PARALLEL_TOOL_CALLS`: dev-only toggle forwarding `parallel_tool_calls=true` to Codex CLI.
- `PROXY_STOP_AFTER_TOOLS`, `PROXY_STOP_AFTER_TOOLS_MODE`, `PROXY_SUPPRESS_TAIL_AFTER_TOOLS`, `PROXY_TOOL_BLOCK_MAX`, `PROXY_STOP_AFTER_TOOLS_GRACE_MS`: govern post-tool streaming behavior.
- `PROXY_SSE_MAX_CONCURRENCY`: per-process streaming guard; adjust alongside OS file descriptor limits.
- `PROXY_API_KEY`: bearer auth required for non-health routes (ForwardAuth enforces upstream in prod).
- `CODEX_MODEL`: effective internal model (default `gpt-5`); clients should request `codev-5*` (dev) or `codex-5*` (prod).

## Testing Paths

- `npm run verify:all` (format → lint → unit → integration → Playwright) before shipping parity-impacting changes.
- `npm run smoke:dev` / `npm run smoke:prod` to spot-check health, models, and streaming/non-streaming chat.
- `scripts/dev-edge-smoke.sh` captures SSE transcripts and usage chunks for dev edge regressions.
- `npx vitest run tests/integration/stream.*.int.test.js` for deterministic streaming/usage coverage.

## Rationale

- JSON-lines streaming (Codex `--json`) yields resilient incremental output without scraping ANSI or mixing logs.
- HEAD/OPTIONS and headers alignment reduce friction for generic OpenAI clients using HTTP preflight and strict content-type checks.
