---
title: Refactor — DRY SSE chunk construction with helper/baseChunk (#51)
date: 2025-09-11
owner: Dev
status: open
priority: P3
source: github
gh_issue: 51
gh_url: https://github.com/DrJLabs/codex-completions-api/issues/51
labels: [refactor, tech-debt]
---

Extract shared SSE chunk fields (`id`, `object`, `created`, `model`) into a helper to reduce duplication across chat/completions streaming paths. No functional changes. See GH issue for context.
