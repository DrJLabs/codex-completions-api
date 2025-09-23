---
title: Integrate Keploy snapshot capture into CI (Story 3.5 follow-up)
date: 2025-09-19
owner: DevOps / QA
status: shelved
priority: P1
labels: [ci, snapshots, keploy, tooling]
---

## Why

> **Note (2025-09-22):** Keploy integration work is shelved; the backlog remains here for context.

Story 3.5 introduced deterministic golden transcripts and contract checks. We currently rely on a custom recorder script; integrating Keploy 3.x will provide first-class HTTP snapshot capture, mock generation, and deterministic replay inside `npm run verify:all` and future provider tests.

## What

- Install Keploy 3.0 CLI/daemon in CI images (GitHub Actions runners + dev Docker) and document local setup in `docs/bmad/architecture/tech-stack.md`.
- Update `scripts/generate-chat-transcripts.mjs` (or follow-up module) to call Keploy record/test workflows instead of the inline recorder when `KEPLOY_ENABLED=1`.
- Capture baseline Keploy snapshots for non-stream minimal, non-stream truncation, and streaming usage scenarios; ensure sanitized outputs persist under `test-results/chat-completions/`.
- Wire Keploy replay into `npm run verify:all` so integration suites run against recorded mocks when available, falling back to live shim captures otherwise.
- Add monitoring/alerting guidance for Keploy step duration and failures.

## Done When

- CI runners install Keploy binaries and expose configuration variables (documented in repo).
- Transcript generation supports both inline recorder and Keploy record/test modes with clear README instructions.
- Integration/Playwright contract tests can consume Keploy mocks deterministically; pipeline green with Keploy steps enabled.
- Documentation updated (tech stack + story notes) and Story 3.5 issue #77 references this follow-up.

## References

- `scripts/generate-chat-transcripts.mjs`
- `tests/shared/transcript-utils.js`
- `docs/openai-chat-completions-parity.md`
- Keploy docs: https://keploy.io/docs/2.0.0/concepts/what-is-keploy/
