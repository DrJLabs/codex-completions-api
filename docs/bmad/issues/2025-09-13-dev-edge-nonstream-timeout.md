---
title: Dev edge non-stream POST /v1/chat/completions times out; streaming OK (#74)
date: 2025-09-13
owner: Infra/Edge
status: open
priority: P1
source: github
gh_issue: 74
gh_url: https://github.com/DrJLabs/codex-completions-api/issues/74
labels: [edge, cloudflare, nonstream]
---

On dev edge domain, non-stream POST to `/v1/chat/completions` stalls until timeout while streaming passes. Prod works for both. See GH issue for evidence and next steps (Cloudflare/WAF checks, origin verification, timeout tuning).
