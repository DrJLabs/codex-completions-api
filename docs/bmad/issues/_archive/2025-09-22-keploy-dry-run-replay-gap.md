---
title: Keploy dry-run replay job skips stored test-set (CI follow-up)
date: 2025-09-22
owner: QA/Dev
status: shelved
priority: P1
source: observation
labels: [ci, keploy, follow-up]
---

> **Note (2025-09-22):** Keploy replay coverage has been shelved. The details below are preserved for posterity.

Keploy replay coverage is currently missing in CI because the `keploy-dry-run` job exits successfully even when the CLI reports that no test-sets were found.

## Observed Behaviour

- Workflows `https://github.com/DrJLabs/codex-completions-api/actions/runs/17924486614`, `17924615572`, and `17924615984` run `keploy test --config-path config --path test-results/chat-completions/keploy --test-sets test-set-0`.
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

## Next Steps

1. Reproduce locally with `KEPLOY_ENABLED=true` and `keploy test --config-path config --path test-results/chat-completions/keploy --test-sets test-set-0` to confirm the failure.
2. Consult Story 3.6 implementation notes and Keploy docs to align the directory layout / flags with the CLI expectations.
3. Update `.github/workflows/ci.yml` to fail the job when Keploy issues errors, or add validation that the replay executed at least one test-case (e.g., check metrics output).
4. When fixed, refresh the BMAD stories/issues (3.6, 3.10, Issue #77) to close the follow-up and document the resolution.

## Links & References

- Story 3.6 — Keploy Snapshot CI Integration (`docs/bmad/stories/_archive/3.6.keploy-snapshot-ci-integration.md`)
- Story 3.10 — Release & Backup Hardening (`docs/bmad/stories/3.10.release-backup-hardening.md`)
- Issue #77 — Golden transcripts & contract checks (`docs/bmad/issues/2025-09-13-chat-golden-transcripts-contract-checks.md`)
