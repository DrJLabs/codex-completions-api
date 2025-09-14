---
title: Add streaming finish_reason chunk to Chat Completions SSE for OpenAI parity (#61)
date: 2025-09-12
owner: Dev
status: open
priority: P1
source: github
gh_issue: 61
gh_url: https://github.com/DrJLabs/codex-completions-api/issues/61
labels: [parity, streaming]
---

Emit a final streaming chunk with `choices[0].finish_reason` (then optional usage, then `[DONE]`) to match OpenAI streaming contract. See GH issue for acceptance and tests.
