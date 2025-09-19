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
- New Vitest suites (`tests/integration/chat.contract.nonstream.int.test.js`, `tests/integration/chat.contract.streaming.int.test.js`) sanitize live responses and diff against the golden corpus.
- New Playwright spec (`tests/e2e/chat-contract.spec.ts`) exercises streaming/non-stream flows with traces enabled, relying on the same transcripts.
- Documentation (`docs/openai-chat-completions-parity.md`) now explains where the transcripts live, how to refresh them, and how contract tests keep parity locked.
