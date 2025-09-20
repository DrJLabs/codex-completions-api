---
title: Roll out Keploy CLI installation & configuration across environments
date: 2025-09-20
owner: DevOps / QA
status: open
priority: P1
labels: [ci, dev-environment, keploy, tooling]
---

## Why

Story 3.6 added the plumbing for Keploy-driven snapshots and replays, but the CLI itself is not yet installed on developer machines or CI runners. Without a tested installation procedure, the new toggle (`KEPLOY_ENABLED`) will remain disabled and the pipeline will continue using inline transcripts. We need a focused effort to install Keploy, document expectations, and verify the workflow in each target environment.

## What

- Establish the canonical Keploy version (3.x) and installation command for Ubuntu-based GitHub Actions runners and local Linux/macOS dev environments.
- Update automation (e.g., reusable setup script or CI step) to install the CLI before tests when `KEPLOY_ENABLED=true`, capturing the CLI version in job logs.
- Document prerequisites (ports 16789/26789, outbound network rules, binary location) and add a troubleshooting section covering proxy startup and failure signals.
- Define the environment-variable contract (`KEPLOY_ENABLED`, `KEPLOY_BIN`, optional `KEPLOY_APP_PORT`) and update `.env.dev` / `.env.example` guidance with turn-key examples.
- Validate the installation by running `keploy test --config-path config/keploy.yml` against the generated snapshots locally and in CI dry-run mode; capture evidence (logs, runtime metrics).
- Decide how and when to enable `KEPLOY_ENABLED=true` in CI (e.g., feature flag, specific branch, or once runners have the binary cached) and record the rollout plan.
- Identify any follow-up integration points (e.g., dev Docker images, prod observability) and open subsequent tickets if needed.

## Done When

- Installation steps are scripted or documented, and both local developers and CI have a repeatable way to provision Keploy 3.x.
- A dry-run CI job demonstrates Keploy replay passing with the existing snapshots; logs show CLI version and runtime within acceptable bounds.
- Documentation (tech stack, parity docs, onboarding guide) reflects the installation procedure and toggle usage.
- Rollout decision recorded: either `KEPLOY_ENABLED` flipped on (with evidence) or a clear schedule/criteria defined.
- Follow-up issues created for any remaining integration or monitoring tasks.

## References

- Story 3.6 — `docs/bmad/stories/3.6.keploy-snapshot-ci-integration.md`
- `config/keploy.yml`, `scripts/keploy-start-server.sh`
- `docs/bmad/architecture/tech-stack.md`
- Keploy install docs: https://keploy.io/docs
