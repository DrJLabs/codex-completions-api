---
title: Dev edge non-stream POST /v1/chat/completions times out; streaming OK (#74)
date: 2025-09-13
owner: Infra/Edge
status: closed
priority: P1
source: github
gh_issue: 74
gh_url: https://github.com/DrJLabs/codex-completions-api/issues/74
labels: [edge, cloudflare, nonstream]
---

On dev edge domain, non-stream POST to `/v1/chat/completions` stalled until timeout while streaming passed. Prod worked for both. See GH issue for evidence and next steps (Cloudflare/WAF checks, origin verification, timeout tuning).

## Resolution — 2025-09-23

- Reduced the dev-only truncate guard to 9 seconds via `PROXY_DEV_TRUNCATE_AFTER_MS=9000` in `.env.dev`, ensuring the handler finalises responses before Cloudflare’s default 10 s timeout.
- Restarted the dev stack (`npm run dev:stack:up`) and verified `npm run smoke:dev` succeeds for both non-stream and streaming paths (run ID: 2025-09-23T20:07Z).
- Closed GitHub issue [#74](https://github.com/DrJLabs/codex-completions-api/issues/74) with the smoke output and configuration change summary.
