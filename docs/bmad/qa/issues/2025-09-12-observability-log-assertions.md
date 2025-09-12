---
title: QA-OBS-LOG-ASSERT — Add assertions for structured access-log fields
date: 2025-09-12
status: open
owner: qa
related:
  gate: docs/bmad/qa/gates/1.5-phase-4-codex-runner-and-sse-utils.yml
  story: docs/bmad/stories/1.5.phase-4-codex-runner-and-sse-utils.md
---

## Context

Story 1.5 passed with a minor concern: observability assertions for structured access-log fields are not explicitly covered by tests. Current logging middleware remains unchanged but lacks explicit test assertions.

## Goal

Add a simple integration test to assert presence of structured JSON access-log fields: `req_id`, `route`, `status`, `dur_ms`.

## Acceptance Criteria

1. Integration test captures a log line for a sample request.
2. Asserts presence and basic validity of fields: `req_id` (non-empty), `route` matches endpoint, `status` equals response code, `dur_ms` is a number.
3. Test is stable in CI (no flaky timing dependencies).
4. Linked in gate actions as resolved when merged.

## Tasks

- [ ] Add or adjust logger to route logs to a test-capturable sink under test env if needed.
- [ ] Write integration test to exercise `/v1/models` or `/healthz` and parse the last JSON log object.
- [ ] Document result and update gate actions status.

## Notes

Keep the test lightweight and avoid coupling to log format beyond required fields.
