---
title: QA-GRACEFUL-SHUTDOWN — Add SIGTERM graceful shutdown test
date: 2025-09-12
status: open
owner: qa
source: qa
priority: P2
related:
  story: docs/bmad/stories/1.6.phase-5-cleanup-and-logging.md
  gate: docs/bmad/qa/gates/1.6-phase-5-cleanup-and-logging.yml
---

## Context

Phase 5 introduced a thin server bootstrap with SIGINT/SIGTERM handlers. Add an integration test to validate graceful shutdown behavior.

## Goal

Verify that sending SIGTERM leads to a clean server close and process exit without hanging connections.

## Acceptance Criteria

1. Start server on a random port; perform a simple request to ensure readiness.
2. Send SIGTERM to the process and await exit within a short timeout (≤ 2s).
3. No unhandled rejections or errors printed to stderr.
4. Subsequent request attempts fail (connection refused), indicating the server stopped.

## Tasks

- [ ] Add tests/integration/graceful-shutdown.int.test.js
- [ ] Ensure test uses a short timeout and robust polling
- [ ] Link evidence to Story 1.6 gate as resolved follow-up

## Notes

Keep the test self-contained and avoid race conditions; use polling with backoff.
