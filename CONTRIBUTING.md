# Contributing to Codex App-Server Proxy

Thanks for helping improve the Codex App-Server Proxy. This repo aims to stay conservative and OpenAI-compatible, so small, well-validated changes are preferred.

## Prerequisites

- Node.js **>= 22**
- npm
- Optional: Docker + Docker Compose v2 (for stack workflows)

## Setup

```bash
npm install
cp .env.example .env
```

Set `PROXY_API_KEY` in `.env` (or export it in your shell).

## Run locally

- Dev (live reload, port 18000 by default):

  ```bash
  npm run dev
  ```

- Dev shim (no Codex install required; uses `scripts/fake-codex-jsonrpc.js`):

  ```bash
  npm run dev:shim
  ```

- Minimal start (defaults to port 11435):

  ```bash
  node server.js
  ```

Verify:

```bash
curl -s http://127.0.0.1:18000/healthz | jq .
curl -s http://127.0.0.1:18000/v1/models | jq .
```

## Development workflow notes

- Docs index: `docs/README.md`
- Configuration reference: `docs/configuration.md` (env vars and defaults)
- Golden contract: `docs/openai-endpoint-golden-parity.md`

## Tests and quality gates

Run the full suite before opening a PR:

```bash
npm run verify:all
```

### Test selection policy (fast path)

- `src/utils.js` only → `npm run test:unit`
- Routes/handlers/streaming (e.g., `server.js`, `src/routes/**`, `src/handlers/**`) → `npm run test:integration` then `npm test`
- Docker/Traefik/compose changes → rebuild + `npm run smoke:prod` (on the origin host) and E2E

### Formatting and docs

```bash
npm run format:check
npm run lint:runbooks
```

## Secrets and security

- Do not commit credentials or Codex runtime state (`.env`, `.codev/auth.json`, `.codex-api/**`, etc.).
- Run secret scanning before pushing:

```bash
npm run secret-scan
```

## Branches, commits, and PRs

- Create a branch before editing files: `feat/<kebab>`, `fix/<kebab>`, `chore/<kebab>`.
- Use Conventional Commits (subject ≤ 72 chars), e.g. `docs: update configuration reference`.
- Don’t rewrite history during review; follow-ups should be new commits.
- Use `.github/PULL_REQUEST_TEMPLATE.md` and include the commands you ran under “Verification”.
