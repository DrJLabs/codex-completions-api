---
title: Add golden transcripts + contract checks for Chat Completions parity (#77)
date: 2025-09-13
owner: QA/Dev
status: open
priority: P1
source: github
gh_issue: 77
gh_url: https://github.com/DrJLabs/codex-completions-api/issues/77
labels: [parity, contract, sse, nonstream]
---

Introduce deterministic “golden” transcripts and optional contract checks to lock in OpenAI parity for `/v1/chat/completions` in both non-stream and streaming modes. See GitHub issue for deliverables and acceptance.

## Implementation Notes (2025-09-19)

- Added `npm run transcripts:generate` to record sanitized fixtures (`nonstream-minimal`, `nonstream-truncation`, `streaming-usage`) using Keploy-style capture; files live under `test-results/chat-completions/`.
- When `KEPLOY_ENABLED=true`, the generator also materializes Keploy replay bundles under `test-results/chat-completions/keploy/test-set-0/tests/*.yaml`, keeping JSON and YAML fixtures aligned.
- New Vitest suites (`tests/integration/chat.contract.nonstream.int.test.js`, `tests/integration/chat.contract.streaming.int.test.js`) sanitize live responses and diff against the golden corpus.
- New Playwright spec (`tests/e2e/chat-contract.spec.ts`) exercises streaming/non-stream flows with traces enabled, relying on the same transcripts.
- Documentation (`docs/openai-chat-completions-parity.md`) now explains where the transcripts live, how to refresh them, and how contract tests keep parity locked.
- CI wiring exposes `KEPLOY_ENABLED`/`KEPLOY_BIN` variables so the replay step can run `keploy test --config-path config` when the CLI is installed; otherwise suites fall back to direct HTTP assertions. Use the Keploy CLI exit code and proxy logs to monitor record/test durations and surface failures in job summaries. The repository GitHub environment now sets `KEPLOY_ENABLED=true`, so the `keploy-dry-run` workflow executes automatically on pushes while continuing to use captured transcripts only.

## Validation Notes (2025-09-22)

- Recent CI runs (e.g., `https://github.com/DrJLabs/codex-completions-api/actions/runs/17924486614`) show the `keploy-dry-run` job invoking `keploy test --config-path config --path test-results/chat-completions/keploy --test-sets test-set-0`.
- The CLI prints `ERROR No test-sets found. Please record testcases using [keploy record] command` even though the repository contains `test-results/chat-completions/keploy/test-set-0/tests/*.yaml` from Story 3.5.
- Because the job still exits successfully, replay coverage is effectively skipped; this is a misconfiguration in the test invocation rather than an intentional opt-out. Fix should align the CLI path/flags with the stored snapshots (tracked alongside Story 3.6 and follow-up Issue `docs/bmad/issues/2025-09-22-keploy-dry-run-replay-gap.md`).
