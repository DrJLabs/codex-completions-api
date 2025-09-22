---
title: Provide privileged environment for Keploy replay evidence
date: 2025-09-20
owner: Platform / DevOps
status: closed
priority: P1
labels: [ci, keploy, infrastructure, tooling]
---

## Why

Story 3.8 requires a successful Keploy replay run (`keploy test`) to clear the rollout gate. Initial attempts on GitHub-hosted runners aborted with `failed to set memlock rlimit: operation not permitted` because the environment lacked CAP_IPC_LOCK, preventing Keploy from initializing its eBPF hooks. Without a privileged container or self-hosted runner, we could not capture green evidence for CI or local dry runs.

## What

- Decide on an execution environment that grants the required capability (e.g., dedicated self-hosted runner, privileged Actions container, or Kubernetes job with elevated security context).
- Update the `keploy-dry-run` workflow to target the privileged environment while keeping the existing GitHub-hosted path as a fallback.
- Document the privilege requirement and the selected solution in the rollout issue (`docs/bmad/issues/2025-09-20-keploy-install-config.md`), tech stack guide, and Story 3.8 notes.
- Capture and store a successful replay log + metrics artifacts once the privileged environment is available.

## Done When

- Privileged runner/container available to CI with CAP_IPC_LOCK and other Keploy prerequisites.
- `keploy test --config-path config --path test-results/chat-completions --test-sets test-set-0` completes successfully in CI, producing updated artifacts under `docs/bmad/qa/artifacts/3.8/`.
- Documentation reflects the new execution path and how developers can reproduce the evidence locally if needed.
- Story 3.8 gate updated with PASS based on the successful replay evidence.

## Resolution — 2025-09-21

- Provisioned self-hosted runner `codex-keploy-ci-01` with CAP_IPC_LOCK and tagged it for Keploy workloads.
- Updated the CI workflow so the `keploy-dry-run` job executes exclusively on the self-hosted runner while leaving a fallback path documented for GitHub-hosted runners.
- Captured consecutive successful runs (`CI` runs #459–463) where the `keploy-dry-run` job completed without memlock errors and uploaded artefacts (`keploy.log`, `metrics.txt`, `version.txt`).
- Synced documentation (tech stack guide, Story 3.8, install/config issue) with the new runner requirements, runtime metrics, and reproduction guidance for privileged environments.

## Evidence

- Run #463 (2025-09-21T19:31Z) — `keploy-dry-run` succeeded on `codex-keploy-ci-01`, uploading artefacts and recording a zero-error replay.
- Run #462 (2025-09-21T09:51Z) — first post-migration push on `main` confirmed stable execution on the self-hosted runner.
- Run #459 (2025-09-21T07:57Z) — initial PR verification establishing the privileged workflow path.
- Self-hosted runner labels applied: `self-hosted`, `linux`, `keploy`.

## References

- Memlock failure log: `docs/bmad/qa/artifacts/3.8/local-keploy-test-memlock.log`
- CI artefacts: `docs/bmad/qa/artifacts/3.8/`
- Rollout issue: `docs/bmad/issues/2025-09-20-keploy-install-config.md`
- Tech stack guidance: `docs/bmad/architecture/tech-stack.md`
- Keploy GitHub Actions guidance: https://keploy.io/docs
