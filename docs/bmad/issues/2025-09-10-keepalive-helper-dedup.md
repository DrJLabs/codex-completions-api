---
title: Deduplicate keepalive interval logic via helper (#49)
date: 2025-09-10
owner: Dev
status: open
priority: P3
source: github
gh_issue: 49
gh_url: https://github.com/DrJLabs/codex-completions-api/issues/49
labels: [refactor, keepalive]
---

Extract keepalive interval determination into a shared helper to eliminate duplication and unclear `*2` variable naming between handlers. See GH review-linked issue for example snippet.
