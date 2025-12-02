# Tool-Call Fixtures (Story 2.10)

Author: dev agent (2025-11-20)

Purpose: deterministic fixtures for structured and textual tool-call flows (app-server only) used by integration, Playwright, and smoke tests.

## Matrix (app-server only)

- Backend: app-server only (proto deprecated for Story 2.10 scope)
- Modes: streaming, non-stream
- Output modes: obsidian-xml (default), openai-json override
- Stop-after-tools: on/off; STOP_AFTER_TOOLS_MODE burst|first
- Payloads: structured tool_calls, textual `<use_tool>` fallback, large-args (>=8KB UTF-8), multi-choice
- Error paths: pre-tool-call error, mid-stream error after first tool delta
- Disconnect: client close after first `delta.tool_calls`
- Proto fixtures were removed in favor of the app-server JSON-RPC shim to align with Stories 2.11/2.12 and Epic 3.

## Usage

1. Capture baseline transcripts per scenario (app-server) with metadata (cli version, model, seed, stop-after-tools flags).
2. Normalize dynamic fields (ids, timestamps) using existing parity harness patterns.
3. Store raw + normalized in this directory; keep manifest.json in sync.
4. Consume fixtures in integration/Playwright/smoke tests.
5. Upload failure artifacts (raw SSE, normalized JSON, logs) in CI with redaction filters.

## Current fixtures (app-server)

- nonstream-tool-calls.app.json
- streaming-tool-calls.app.json
- streaming-tool-calls-sequential.app.json
- streaming-tool-calls-stop-after-tools.app.json
- streaming-tool-calls-textual.app.json
- streaming-tool-calls-disconnect.app.json
- manifest.json

## Smoke helper flags (stream-tool-call.js)

- `--expect-xml` — fail if textual `<use_tool>` block missing or unterminated.
- `--disconnect-after-first-tool` — simulate client close right after first `delta.tool_calls`.
- `--allow-single` — skip multi-tool enforcement (use only when rolling back to single-call behavior).
- `--include-usage` — request usage in stream options.
- `--expect-xml` also asserts no trailing assistant content after the `<use_tool>` block (tail stripping).
