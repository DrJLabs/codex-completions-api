---
title: QA Artifacts — Story 5.3 Sanitizer Telemetry
status: planned
updated: 2025-10-24
owner: QA
labels: [telemetry, documentation, rollout]
---

# Purpose

Capture evidence that metadata sanitizer telemetry is emitted and documented when `PROXY_SANITIZE_METADATA` toggles state. The artifacts here back Acceptance Criteria 3–4 for Story 5.3.

# Required Artifacts

- `toggle-event.ndjson` — Sample of the first `proxy_sanitize_metadata` log entry collected immediately after enabling the toggle in a dev stack.
- `summary-event.ndjson` — Sample sanitized summary event showing `sanitized_count`, `sanitized_keys`, and `sanitized_sources` for the same request.
- `parser-smoke.txt` — Output from downstream parser smoke verifying sanitized metadata no longer appears in assistant content.

# Collection Steps

1. Export `SANITIZER_LOG_PATH=/tmp/codex-sanitizer.qa.ndjson` before launching the proxy (dev stack).
2. Enable the toggle (`PROXY_SANITIZE_METADATA=true`) and run the `curl` smoke documented in [sanitizer-qa-smoke](../../../../private/runbooks/operational.md#sanitizer-qa-smoke) to trigger sanitized metadata.
3. Copy the first two entries from `$SANITIZER_LOG_PATH` into the files above, preserving JSON lines.
4. Run [`scripts/qa/parser-smoke.sh`](../../../../scripts/qa/parser-smoke.sh) (adds downstream parser validation) and direct output to `parser-smoke.txt`.

# Notes

- The toggle log must include `enabled:true` → `enabled:false` transitions when the feature is toggled off after validation.
- Attach the artifact bundle to the QA gate for the epic rollout and link back here from the story Completion Notes.
