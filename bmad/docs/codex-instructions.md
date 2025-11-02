# BMAD Method - Codex Instructions

## Activating Agents

BMAD agents, tasks and workflows are installed as custom prompts in
`$CODEX_HOME/prompts/bmad-*.md` files. If `CODEX_HOME` is not set, it
defaults to `$HOME/.codex/`.

### Examples

```
/bmad-bmm-agents-dev - Activate development agent
/bmad-bmm-agents-architect - Activate architect agent
/bmad-bmm-workflows-dev-story - Execute dev-story workflow
```

### Notes

Prompts are autocompleted when you type /
Agent remains active for the conversation
Start a new conversation to switch agents

## Operational Cheatsheet

- `npm run verify:all` — formatting, lint, unit, integration, and Playwright E2E.
- `npm run smoke:dev` — exercises the Traefik-backed dev stack. Export `DEV_DOMAIN` and `KEY` beforehand.
- `npm run smoke:prod` — origin + edge smoke against production. Requires `DOMAIN` and `KEY`.
- `npm run dev:stack:up` — rebuilds the dev stack (app-server mode when `.env.dev` sets `PROXY_USE_APP_SERVER=true`).
- `CONFIRM_DEPLOY=prod npm run port:deploy` — promote the current commit to production using the compose spec in this repo.

## Credential Refresh Workflow

1. Ensure the Codex CLI is authenticated (`codex auth status`).
2. Copy `~/.codex/auth.json` → `.codev/auth.json` for dev workloads.
3. Copy the same file into `.codex-api/auth.json` before redeploying production. The compose file bind-mounts it into the container.

## Backend Modes

- `PROXY_USE_APP_SERVER=true` keeps a long-lived app-server worker alive. Production uses this mode today.
- `PROXY_USE_APP_SERVER=false` falls back to proto capture and spawns a fresh process per request. Handy for local debugging.
- Worker timeouts are tunable via `WORKER_*_TIMEOUT_MS` env vars; extend them if the handshake requires more than a few seconds.
