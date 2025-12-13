Project-local Codex config for development.

This folder is intended to be used as a project-local `CODEX_HOME` for dev workflows.

## About `.codev/AGENTS.md`

The `AGENTS.md` in this folder is intentionally **not** repository contributor guidance. It contains the Obsidian Copilot prompt/instructions that the Codex app-server backend reads from `CODEX_HOME` when emitting tool-call XML (`<use_tool>…</use_tool>`).

Repository contributor/agent guidance lives at the repo root: `AGENTS.md`.

## Usage (Node dev on port 18000)

```bash
PROXY_API_KEY=<your-dev-key> \
  PORT=18000 \
  PROXY_ENV=dev \
  CODEX_HOME="$(pwd)/.codev" \
  npm run start
```

Or use the convenience scripts:

```bash
PROXY_API_KEY=<your-dev-key> npm run dev
PROXY_API_KEY=<your-dev-key> npm run start:codev
```

## Shim mode (no Codex install required)

The shim uses `scripts/fake-codex-jsonrpc.js` (app-server JSON-RPC) for deterministic local runs:

```bash
PROXY_API_KEY=<your-dev-key> npm run dev:shim
PROXY_API_KEY=<your-dev-key> npm run start:codev:shim
```

## Secrets and runtime state

Do not commit secrets in this folder. Tracked files are `README.md`, `AGENTS.md`, and `config.toml`.
Local credentials such as `.codev/auth.json` are intentionally ignored by git.
