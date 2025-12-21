# Copilot Chat Capture Runbook

Goal: capture real Obsidian Copilot `/v1/chat/completions` requests + streams and promote them to fixtures or diagnostics.

## Enable capture
Set env vars (dev stack or local run):
- `PROXY_CAPTURE_CHAT_TRANSCRIPTS=1`
- `PROXY_CAPTURE_CHAT_DIR=/app/test-results/chat-copilot/raw` (or local path)

## Capture scenarios
Send requests via Copilot that:
- Stream without tools (baseline).
- Stream with tool calls (XML `<use_tool>` blocks in text).
- Nonstream response (stream=false).

Optional: set a human-readable capture id header:
- `x-proxy-capture-id: copilot-chat-stream-tool`

## Where captures land
- Raw captures: `test-results/chat-copilot/raw/*.json`
- Each file includes:
  - `metadata` (route, mode, output_mode_effective, trace ids)
  - `request` (sanitized headers + body)
  - `stream` or `response` (sanitized)

## Quick verification
- Confirm output mode and XML presence:
  - `jq -r '.metadata.output_mode_effective' <capture>`
  - `jq -r '.stream[]?.data' <capture> | rg -n "<use_tool>"`

## Clean up
- Remove raw captures when done:
  - `rm -rf test-results/chat-copilot/raw/*`

## Notes
- Captures are sanitized (no auth headers, tool args redacted).
- Use this runbook with the Responses capture runbook to compare `/v1/chat/completions` vs `/v1/responses`.
