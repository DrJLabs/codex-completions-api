# Validation Note — Story 3.5 scope adjustment (2025-11-21T01:26Z)

- Request: Defer customer communications/status-page work for Story 3.5; focus only on maintenance toggle behavior.
- Guidance for next SM/Dev:
  - Implement guarded maintenance endpoint and `PROXY_MAINTENANCE_MODE` handling (503 with `Retry-After`, `retryable:true`).
  - Ensure visibility via `/readyz` and `codex_maintenance_mode` metric; alert hook optional.
  - Runbook should include toggle/rollback steps and health verification only; no customer comms cadence/templates unless re-enabled later.
- No changes to sprint-status yet (Story 3.5 remains backlog).
