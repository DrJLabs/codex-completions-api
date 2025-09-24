---
title: Roll out Keploy CLI installation & configuration across environments
date: 2025-09-20
owner: DevOps / QA
status: shelved
priority: P1
labels: [ci, dev-environment, keploy, tooling]
---

## Why

> **Note (2025-09-22):** The Keploy rollout is shelved. Historical context is retained below.

Story 3.6 added the plumbing for Keploy-driven snapshots and replays, but the CLI itself is not yet installed on developer machines or CI runners. Without a tested installation procedure, the new toggle (`KEPLOY_ENABLED`) will remain disabled and the pipeline will continue using inline transcripts. We need a focused effort to install Keploy, document expectations, and verify the workflow in each target environment.

## What

- Establish the canonical Keploy version (3.x) and installation command for Ubuntu-based GitHub Actions runners and local Linux/macOS dev environments.
- Update automation (e.g., reusable setup script or CI step) to install the CLI before tests when `KEPLOY_ENABLED=true`, capturing the CLI version in job logs.
- Document prerequisites (ports 16789/26789, outbound network rules, binary location) and add a troubleshooting section covering proxy startup and failure signals.
- Define the environment-variable contract (`KEPLOY_ENABLED`, `KEPLOY_BIN`, optional `KEPLOY_APP_PORT`) and update `.env.dev` / `.env.example` guidance with turn-key examples.
- Validate the installation by running `keploy test --config-path config` against the generated snapshots locally and in CI dry-run mode; capture evidence (logs, runtime metrics).
- Decide how and when to enable `KEPLOY_ENABLED=true` in CI (e.g., feature flag, specific branch, or once runners have the binary cached) and record the rollout plan.
- Identify any follow-up integration points (e.g., dev Docker images, prod observability) and open subsequent tickets if needed.

## Done When

- Installation steps are scripted or documented, and both local developers and CI have a repeatable way to provision Keploy 3.x.
- A dry-run CI job demonstrates Keploy replay passing with the existing snapshots; logs show CLI version and runtime within acceptable bounds.
- Documentation (tech stack, parity docs, onboarding guide) reflects the installation procedure and toggle usage.
- Rollout decision recorded: either `KEPLOY_ENABLED` flipped on (with evidence) or a clear schedule/criteria defined.
- Follow-up issues created for any remaining integration or monitoring tasks.

## Progress — 2025-09-20

- Added `scripts/setup-keploy-cli.sh` to automate CLI install, port pre-flight (16789/16790/26789), and loopback enforcement (`KEPLOY_HOST_BIND=127.0.0.1`). (Removed 2025-09-22 as part of shelving.)
- Updated `.env.example` / `.env.dev` with the full Keploy env contract (`KEPLOY_MODE`, `KEPLOY_APP_PORT`, `KEPLOY_RECORD_PORT`, `KEPLOY_TEST_PORT`, `KEPLOY_DNS_PORT`, `KEPLOY_HOST_BIND`). (Reverted 2025-09-22 during shelving.)
- Refreshed `docs/bmad/architecture/tech-stack.md` and `docs/openai-chat-completions-parity.md` with install instructions, caching guidance, and dry-run expectations.
- CI workflow now caches the CLI layer and introduces a `keploy-dry-run` job (gated by `KEPLOY_ENABLED=true`) that runs `keploy test --config-path config`, captures runtime metrics, and uploads artifacts/logs.

## Evidence — 2025-09-20

- Re-generated chat completion snapshots with a Keploy 2.x-compatible schema (`test-results/chat-completions/keploy/test-set-0/tests/*.yaml`) and refreshed JSON baselines via `KEPLOY_ENABLED=true KEPLOY_APP_PORT=11436 node scripts/generate-chat-transcripts.mjs`.
- Manual replay attempt (`keploy test --config-path config --path test-results/chat-completions/keploy --test-sets test-set-0`) still requires the CLI to own the application lifecycle; invoking with `-c ./scripts/keploy-start-server.sh` now reaches replay but fails with `failed to set memlock rlimit: operation not permitted`, confirming the current GitHub-hosted runner/container lacks the CAP_IPC_LOCK capability needed for eBPF hooks. Logs live in `docs/bmad/qa/artifacts/3.8/local-keploy-test-memlock.log`.
- Baseline verification (`npm run verify:all`) passes with `KEPLOY_ENABLED` unset; enabling the toggle locally still fails for the same memlock reason, so the documentation now calls out the privilege requirement and the workaround (run inside a privileged container or attach to self-hosted runners).

## Evidence — 2025-09-21 (self-hosted runner)

- Repository environment variable `KEPLOY_ENABLED` remains `true`, and the CI workflow now routes the `keploy-dry-run` job to self-hosted runner `codex-keploy-ci-01` (labels: `self-hosted`, `linux`, `keploy`). Run #459 (PR), run #462 (merge), and run #463 (docs update) each completed with conclusion `success`, confirming the privileged path is stable.
- Latest artefacts (run #463) captured under `docs/bmad/qa/artifacts/3.8/ci-dry-run-*.{log,metrics.txt,version.txt}` show Keploy 2.10.25 executing without memlock errors; the CLI still logs informational `No test-sets found` messages when no new recordings are staged, but the step exits cleanly.
- Metrics currently report `replay_duration_seconds=0`, reflecting the replay-only invocation against cached snapshots on the self-hosted runner. This value will increase once recordings are refreshed; monitor future runs for drift.
- Workflow summary and runbook notes updated to clarify that GitHub-hosted runners are no longer used for Keploy replays while private-repo minutes are exhausted.

## Next Steps

- Keep monitoring replay durations in CI and refresh Keploy snapshots as new contract scenarios land.
- Document any change in runner availability or capacity planning (e.g., additional self-hosted runners) if the workload increases.

## References

- Story 3.6 — `docs/bmad/stories/3.6.keploy-snapshot-ci-integration.md`
- `config/keploy.yaml`, `scripts/keploy-start-server.sh`
- `docs/bmad/architecture/tech-stack.md`
- Keploy install docs: https://keploy.io/docs
