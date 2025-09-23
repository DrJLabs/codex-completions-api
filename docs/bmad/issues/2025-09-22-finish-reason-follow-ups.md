---
title: Follow-up — finish_reason telemetry & LangChain CI coverage
date: 2025-09-22
owner: Dev / QA / Observability
status: open
priority: P2
labels: [streaming, telemetry, ci, follow-up]
---

## Why

Story 3.9 shipped streaming `finish_reason` propagation plus refreshed contracts, but a few complementary tasks remain outside the story’s scope. We need to wire the new telemetry into dashboards/alerts, exercise the LangChain harness in automated CI (by adding the optional dependency), and capture post-change Keploy evidence on the self-hosted runner.

## What

- Add `finish_reason` distribution panels/alerts using the new fields written by `appendUsage` (e.g., Grafana/Looker). Document thresholds for detecting unexpected `length` spikes.
- Install `@langchain/openai` (or vendor it) in an integration test job so `tests/integration/langchain.streaming.int.test.js` runs instead of skipping. Verify the harness assertions against both `stop` and `length` flows.
- _(Shelved 2025-09-22)_ Previously planned: run `keploy test --config-path config --path test-results/chat-completions/keploy --test-sets test-set-0` on `codex-keploy-ci-*` after deploying Story 3.9. No action required until a new replay strategy is selected.

## Done When

- Dashboards/alerts referencing `finish_reason` are live and linked from the observability runbook.
- CI emits LangChain harness results (pass/fail) and protects against regressions in richer `finish_reason` behavior.
- Keploy dry-run evidence covering the updated transcripts is archived under `docs/bmad/qa/artifacts/` for reference; no new runs are expected while the initiative remains paused.

## References

- Story 3.9 — `docs/bmad/stories/3.9.streaming-finalizer-finish-reason.md`
- Telemetry logging — `src/dev-logging.js`
- LangChain harness — `tests/integration/langchain.streaming.int.test.js`
- Keploy workflow — `docs/bmad/qa/artifacts/3.8/`
