---
title: Release/backup hardening — registry snapshots, SHA tags, retention, CI + SBOM (#80)
date: 2025-09-14
owner: Infra/Platform
status: closed
priority: P2
source: github
gh_issue: 80
gh_url: https://github.com/DrJLabs/codex-completions-api/issues/80
labels: [ops, release, backups, ci]
---

Strengthen tag/release/backup strategy with immutable registry-backed snapshots, commit-aware tags, retention/prune, optional `.codex-api` data snapshot, CI publish, and supply-chain artifacts (SBOM/signatures). See GitHub issue for full scope, acceptance, and tasks.

## Resolution Notes (2025-09-22)

- Delivered via PR #94 (`feat/release-backup-hardening`) and merged to `main`.
- Release/backup scripts and docs landed as part of Story 3.10. GitHub Actions jobs now publish release bundles and run the `keploy-dry-run` replay step.
- The Keploy job now fails whenever `keploy test` emits `ERROR No test-sets found...`, with the fix documented in `docs/bmad/issues/2025-09-22-keploy-dry-run-replay-gap.md` and Story 3.6.
