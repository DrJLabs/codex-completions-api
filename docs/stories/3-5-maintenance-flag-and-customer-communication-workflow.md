# Story 3.5: Maintenance flag and comms workflow

Status: drafted  
Story Key: 3-5-maintenance-flag-and-customer-communication-workflow  
Epic: 3 (Observability & Ops Hardening)

## Story

As an incident commander,  
I want a controlled maintenance mode with retry hints and comms,  
so that we can degrade safely without proto fallback. [Source: docs/epics.md#story-35-maintenance-flag-and-comms-workflow]

## Acceptance Criteria

1) Maintenance flag exposed via `PROXY_MAINTENANCE_MODE` and guarded toggle endpoint returns HTTP 503 with `Retry-After` and `retryable:true`, is auth-protected, and leaves Traefik routing unchanged. [Source: docs/epics.md#story-35-maintenance-flag-and-comms-workflow] [Source: docs/sprint-artifacts/tech-spec-epic-3.md#apis-and-interfaces] [Source: docs/architecture.md#deployment]  
2) Status-page templates and comms cadence documented; maintenance on/off observability wired to logs/metrics/health so operators can confirm state. [Source: docs/epics.md#story-35-maintenance-flag-and-comms-workflow] [Source: docs/sprint-artifacts/tech-spec-epic-3.md#data-models-and-contracts] [Source: docs/PRD.md#functional-requirements]  
3) Runbook covers enable/disable steps, rollback/exit criteria, evidence capture, and incident follow-ups tied to maintenance events. [Source: docs/epics.md#story-35-maintenance-flag-and-comms-workflow] [Source: docs/sprint-artifacts/tech-spec-epic-3.md#acceptance-criteria-authoritative]

## Tasks / Subtasks

- [ ] AC1: Implement maintenance middleware and guarded toggle endpoint emitting 503 envelope with `Retry-After` and `retryable:true`; keep Traefik routers/labels intact. [AC1]  
  - [ ] Integration coverage for toggle on/off states (auth required) and health/readyz reflections. [AC1]  
- [ ] AC2: Add logs/metrics/health signals for maintenance state (gauge + log event); document status-page template and comms cadence. [AC2]  
  - [ ] Hook observability to existing metrics schema to avoid cardinality creep; validate `/metrics` output. [AC2]  
- [ ] AC3: Update incident runbook with enable/disable steps, rollback/exit criteria, evidence paths, and follow-up capture; align with existing runbook structure. [AC3]  
  - [ ] Smoke step: toggle maintenance in dev stack and confirm API returns expected envelope; record evidence. [AC3]  
- [ ] Regression check: run `npm run test:integration` (or targeted new tests) after changes. [Testing]

## Dev Notes

- Maintenance mode must preserve existing routing/labels (codex-api, codex-preflight, codex-models, codex-health) and keep `traefik.docker.network=traefik`. [Source: docs/architecture.md#decision-summary]  
- Follow tech spec guidance: `/internal/maintenance` toggle is bearer-protected; 503 envelope must include `Retry-After` + `retryable:true`; expose metrics/logs/health snapshots reflecting state. [Source: docs/sprint-artifacts/tech-spec-epic-3.md#apis-and-interfaces]  
- Keep logs/metrics schema consistent (no request_id on metrics; use route/method/status_family/model only). [Source: docs/sprint-artifacts/tech-spec-epic-3.md#data-models-and-contracts]  
- Ensure `.codex-api/` remains writable for any maintenance state artifacts; sandbox defaults should stay read-only outside that tree. [Source: docs/architecture.md#security]  
- Validate NFR targets: no latency regressions; readiness must gate traffic when maintenance flag is on and during backoff. [Source: docs/PRD.md#non-functional-requirements]

### Learnings from Previous Story (3-4)

- Reuse existing alert/runbook structure and evidence paths under `docs/app-server-migration/alerts` and `docs/app-server-migration/incident-runbook.md`; avoid duplicating label schemas. Key artifacts to reference: `docs/app-server-migration/alerts/metrics-alerts.yaml`, `docs/app-server-migration/incident-runbook.md`, `docs/app-server-migration/dashboards/observability-dashboard.json`, evidence in `docs/app-server-migration/alerts/evidence/3-4/`. [Source: docs/stories/3-4-incident-alerting-and-runbook-updates.md#dev-notes]  
- The metrics stack already exports restart/backoff/tool_buffer signals with bounded labels—align maintenance gauges/logs with that schema to prevent new high-cardinality series. [Source: docs/stories/3-4-incident-alerting-and-runbook-updates.md#completion-notes-list]  
- Prior fire/drain drills and trace stitching guidance exist; reference them instead of inventing new procedures, and capture new evidence alongside prior drill logs. [Source: docs/stories/3-4-incident-alerting-and-runbook-updates.md#dev-agent-record]  
- Advisory: screenshot/dashboard evidence is optional but useful; keep evidence in `docs/app-server-migration/alerts/evidence/` when recording maintenance drills. [Source: docs/stories/3-4-incident-alerting-and-runbook-updates.md#senior-developer-review-ai]

### Project Structure Notes

- Place maintenance toggle middleware under existing `src/middleware`/`src/services` patterns; docs and runbook updates go to `docs/app-server-migration/`. [Source: docs/architecture.md#project-structure]  
- Story file lives in `docs/stories/3-5-maintenance-flag-and-customer-communication-workflow.md`; context XML should be generated by the story-context workflow when ready. [Source: docs/sprint-status.yaml]

### References

- docs/epics.md#story-35-maintenance-flag-and-comms-workflow  
- docs/sprint-artifacts/tech-spec-epic-3.md  
- docs/PRD.md  
- docs/architecture.md  
- docs/stories/3-4-incident-alerting-and-runbook-updates.md

## Dev Agent Record

### Context Reference

<!-- Path to story context XML will be added by story-context workflow -->

### Agent Model Used

codex-5 (planned)

### Debug Log References

### Completion Notes List

### File List

- docs/stories/3-5-maintenance-flag-and-customer-communication-workflow.md

## Change Log

- 2025-11-21: Drafted story from epics/PRD/tech spec; status set to drafted.
