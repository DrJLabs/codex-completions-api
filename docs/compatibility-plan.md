# Codex OpenAI Proxy — Compatibility + Streaming Plan

This document summarizes improvements inspired by LiteLLM’s proxy and Codex CLI’s JSON-lines streaming to maximize compatibility with OpenAI-style clients (IDEs, SDKs, and tools).

## Sources Reviewed

- LiteLLM proxy (OpenAI-compatible gateway): patterns for endpoint surfaces, streaming, and headers.
- Custom Codex CLI (codex-rs) with `--json` mode: emits JSONL events (e.g., `agent_message_delta`).

## Goals

- Robust OpenAI Chat Completions compatibility over `/v1/*`.
- First-class streaming with incremental deltas and correct `[DONE]` terminator.
- Minimal friction across IDEs: accept HEAD/OPTIONS, precise headers, and stable chunk shapes.

## Implemented Now

- `/v1/chat/completions` now supports:
  - `HEAD` and `OPTIONS` with correct `Allow` and `Content-Type`.
  - Streaming mode selection via `PROXY_STREAM_MODE`:
    - `json|jsonlines|jsonl`: run Codex with `--json`, parse JSONL events, stream OpenAI chunks.
    - `incremental` (default): fallback final-chunk streaming (role-first + single content chunk).
  - Role-first SSE chunk, `text/event-stream` headers, and `[DONE]` terminator.
- `/v1/models` continues to expose only `codex-5` and normalizes to effective `gpt-5`.

## Streaming Shapes (OpenAI Chat-Compatible)

- Role prelude:
  - `data: {"object":"chat.completion.chunk", "choices":[{"delta":{"role":"assistant"}}]}`
- Incremental content (from `agent_message_delta`):
  - `data: {"object":"chat.completion.chunk", "choices":[{"delta":{"content":"..."}}]}`
- Full-message fallback (when Codex emits `agent_message` without deltas):
  - `data: {"object":"chat.completion.chunk", "choices":[{"delta":{"content":"<full message>"}}]}`
- Completion terminator: `data: [DONE]`

## LiteLLM-Derived Practices We Adopt

- Strict response headers:
  - `Content-Type: application/json; charset=utf-8` for JSON
  - `Content-Type: text/event-stream` for SSE; `Cache-Control: no-cache`; `X-Accel-Buffering: no`
- HEAD/OPTIONS on primary endpoints for preflight checks by SDKs/IDEs.
- Cache-friendly `/v1/models` with `Cache-Control: public, max-age=60`.
- Model aliasing: advertise `codex-5` while normalizing to the effective provider model (`gpt-5`).

## Proposed Next Steps (Optional Enhancements)

- Add `/v1/completions` shim: map `prompt` → Chat input and return OpenAI Completions-compatible payloads (and streaming shape with `choices[].text`).
- CORS toggles: optional `Access-Control-Allow-Origin` for web-based IDEs.
- Streaming error shaping: detect first JSON event representing an error and set HTTP status early (LiteLLM’s first-chunk inspection pattern).
- Usage tokens: surface `usage` in non-streaming responses when Codex exposes them reliably.
- Reasoning deltas: optionally map Codex `agent_reasoning_delta` to an OpenAI-compatible extension (e.g., include in `delta.content` or a gated `delta.reasoning`). Default remains hidden to avoid client incompatibilities.

## IDE/Client Compatibility Notes

- Cursor/VSCode/JetBrains typically depend on `chat.completions` and SSE with:
  - Role-first delta, incremental content chunks, `[DONE]` terminator.
  - HEAD/OPTIONS stability and precise `Content-Type`.
- Some tools probe `/v1/models` for advertised ids; this proxy returns `codex-5` only.

## Configuration Summary

- `PROXY_STREAM_MODE`: `incremental` (default) or `json|jsonlines|jsonl`.
- `CODEX_BIN`: path to Codex binary.
- `PROXY_API_KEY`: bearer auth required for non-health routes.
- `CODEX_MODEL`: effective internal model (default `gpt-5`). Clients should request `codex-5`.

## Testing Paths

- `bash scripts/smoke.sh` to spot-check health, models, and both streaming/non-streaming chat.
- `bash scripts/acceptance.sh` validates SSE structure and `[DONE]`.

## Rationale

- JSON-lines streaming (Codex `--json`) yields resilient incremental output without scraping ANSI or mixing logs.
- HEAD/OPTIONS and headers alignment reduce friction for generic OpenAI clients using HTTP preflight and strict content-type checks.
