# Obsidian Copilot — Minified React Error: Root Cause and Fix

Captured: 2025-09-10

## Summary

- Users saw intermittent "Minified React error" in the Obsidian Copilot UI during streamed responses.
- The proxy emitted a non-spec SSE frame `{ "event": "usage", ... }` when `stream_options.include_usage=true`.
- Some clients expect only OpenAI-shape `chat.completion.chunk` frames; the custom frame triggered rendering/parsing errors.
- SSE keepalive comments (`: keepalive ...`) can also confuse a few Electron-based parsers.

## Root Cause

- Our chat streaming path sent a custom usage event rather than a standard chunk. UI code assuming `choices[0].delta.content` or `choices.length` invariants encountered undefined or unexpected shapes, leading to React production errors.
- Electron/Obsidian environments may use bespoke SSE readers that do not ignore comment lines.

## Fix (Implemented)

1. Usage chunk matches OpenAI spec
   - When `include_usage=true`, the stream now includes a final `chat.completion.chunk` with:
     - `choices: []` (empty)
     - `usage: { prompt_tokens, completion_tokens, total_tokens }`
   - We no longer emit `{ event: "usage" }` frames.

2. Keepalive opt-out (defensive)
   - Keepalives can be disabled per request if needed:
     - Header: `X-No-Keepalive: 1`
     - Query: `?no_keepalive=1`
     - Auto-off when UA contains `Obsidian` or `Electron` (safety valve).
   - Default remains enabled to preserve connection health for standard clients.

## Operational Notes

- No changes required for clients that already conformed to OpenAI streaming.
- If Obsidian reports issues again, disable keepalives for a quick A/B:
  - Set header `X-No-Keepalive: 1` or append `?no_keepalive=1` to the request URL.

## Verification

- Integration and E2E tests pass locally:
  - `npm run test:integration` → 9 tests passed
  - `npm test` → SSE tests pass; models/health OK

## File Changes (reference)

- `server.js`
  - Chat streaming: replace custom usage frame with spec chunk (final usage chunk).
  - Streaming setup: keepalive opt-out via UA/header/query.

## Future Hardening (optional)

- Add a dedicated test asserting the exact shape of the final usage chunk.
- Consider a server flag to globally disable keepalives if a client population consistently mishandles SSE comments.
