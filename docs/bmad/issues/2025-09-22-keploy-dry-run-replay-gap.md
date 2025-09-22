---
title: Keploy dry-run replay job skips stored test-set (CI follow-up)
date: 2025-09-22
owner: QA/Dev
status: resolved
priority: P1
source: observation
labels: [ci, keploy, follow-up]
---

Keploy replay coverage is currently missing in CI because the `keploy-dry-run` job exits successfully even when the CLI reports that no test-sets were found.

## Observed Behaviour

- Workflows `https://github.com/DrJLabs/codex-completions-api/actions/runs/17924486614`, `17924615572`, and `17924615984` run `keploy test --config-path config --path test-results/chat-completions --test-sets test-set-0`.
- Logs show `ERROR No test-sets found. Please record testcases using [keploy record] command`, yet the step completes with exit code 0.
- The repository already contains snapshots under `test-results/chat-completions/keploy/test-set-0/tests/*.yaml` from Story 3.5.

## Expected Behaviour

- CI should fail fast when Keploy cannot locate the configured test-set, or update the invocation so the CLI executes the stored snapshots.
- Replay coverage should validate the non-stream, truncation, and streaming chat scenarios captured in Story 3.5/Story 3.6.

## Impact

- We currently ship without automated replay coverage, relying solely on transcript-based integration tests.
- The warning hides potential regressions because the job reports success while skipping assertions.

## Hypothesis / Root Cause Ideas

- The CLI may be looking for a `tests.yaml` file rather than a directory or the path is incorrect relative to the runner checkout.
- Additional flags (`--useLocalMock`, `--mocking`, `--in-ci`) might be required to force replay mode instead of a no-op.
- The snapshots might need to be packaged into Keploy's expected `.yaml` structure (e.g., `test.yaml` + `mock.yaml`) rather than the current multi-file layout.

## Resolution (2025-09-22)

- Snapshots now live under `test-results/chat-completions/keploy/test-set-0/tests`, matching the name Keploy derives from the repository root. The generator (`scripts/generate-chat-transcripts.mjs`) and transcript utilities were updated to write/read the new layout so `keploy test` discovers the bundled fixtures without additional flags.
- The CI job invokes `keploy test --config-path config --path test-results/chat-completions --test-sets test-set-0 --disable-ansi` and captures logs to `artifacts/keploy/test.log`. A post-run guard fails the job when the CLI exits non-zero, prints `No test-sets found`, or emits any `ERROR` lines, closing the silent-success gap. Metrics and version files are still uploaded for debugging.
- Until the self-hosted runner gains `CAP_IPC_LOCK`, the replay will stop at the known memlock error, causing the job to fail loudly instead of passing silently. Track the privilege work under `docs/bmad/issues/2025-09-20-keploy-memlock-privilege.md`.

## Follow-up

- Provision the privileged Keploy runner (`docs/bmad/issues/2025-09-20-keploy-memlock-privilege.md`), then re-run `keploy-dry-run` to validate that the stored test-set executes end-to-end.
- Update Stories 3.6, 3.10, and Issue #77 with the new asset path and CI enforcement evidence.

## Links & References

- Story 3.6 — Keploy Snapshot CI Integration (`docs/bmad/stories/3.6.keploy-snapshot-ci-integration.md`)
- Story 3.10 — Release & Backup Hardening (`docs/bmad/stories/3.10.release-backup-hardening.md`)
- Issue #77 — Golden transcripts & contract checks (`docs/bmad/issues/2025-09-13-chat-golden-transcripts-contract-checks.md`)
