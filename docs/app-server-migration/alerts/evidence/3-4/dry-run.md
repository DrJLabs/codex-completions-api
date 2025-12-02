# Story 3.4 Dry-Run Evidence Log

## Drill 2025-11-21 (dev npm shim)
- Timestamps: 01:23–01:26Z
- Setup: `PORT=18000 PROXY_ENABLE_METRICS=true PROXY_METRICS_ALLOW_LOOPBACK=true PROXY_MAINTENANCE_MODE=true CODEX_HOME=.codev CODEX_BIN=scripts/fake-codex-proto.js node server.js`
- Trigger: Killed worker 4x (PIDs 1676642 → 1681656 → 1685485 → 1686557 → 1687689), then issued POST /v1/chat/completions during restart to induce 503.
- Alerts targeted: restart storm (>3 in 10m), error-rate (single 5xx), maintenance-state.
- Evidence:
  - Metrics excerpt: see `docs/app-server-migration/alerts/evidence/3-4/dev-fire-drain.log` (restart gauge=5, 5xx count=1).
  - Server log: `/tmp/devserver.log` (worker_spawned entries with restarts_total).
  - 503 response payload: `/tmp/resp2.json`.
- Outcome: Restart gauge exceeded threshold; 5xx recorded; maintenance mode remained enabled. Tool buffer anomaly not triggered in this drill (requires textual `<use_tool>` stream); can run separate stream smoke if needed.

Next: capture Grafana screenshot once dashboard wired to Prom source; optional tool_buffer anomaly drill using textual tool-call stream.

## Drill 2025-11-21b (tool_buffer anomaly via metrics module)
- Trigger: `recordToolBufferEvent('abort', {output_mode: 'obsidian-xml', reason: 'drill-anomaly'})` after a dummy POST context.
- Evidence: `docs/app-server-migration/alerts/evidence/3-4/tool-buffer-drill.log` (anomaly gauge=1, abort counter incremented).
- Outcome: tool_buffer anomaly signal verified (gauge flips to 1, abort counter increments). Auto-resets after 2m per metric code.
