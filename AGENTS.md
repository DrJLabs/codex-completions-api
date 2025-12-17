# Agent instructions (scope: this directory and subdirectories)

## Scope and layout

- **This AGENTS.md applies to:** `./` and below.
- **Key directories:**
  - `src/` core proxy logic (app wiring, routes, handlers, services) used by `server.js`.
  - `auth/` Traefik ForwardAuth microservice.
  - `scripts/` dev/ops helpers (dev.sh, smoke, stack snapshot/rollback, port sync).
  - `tests/` unit, integration, parity, and Playwright suites plus fixtures.
  - `docs/` schema exports and runbooks (read only when relevant to the task).
  - `external/` vendored references (e.g., `external/codex/` has its own AGENTS.md).
  - `.codev/` (dev Codex HOME) and `.codex-api/` (prod Codex HOME) are gitignored; never commit secrets inside.

## Modules / subprojects

| Module            | Type         | Path              | What it owns                              | How to run                                                             | Tests                                                                    | Docs                          | AGENTS                     |
| ----------------- | ------------ | ----------------- | ----------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------- | -------------------------- |
| Proxy API         | node/express | `.`               | OpenAI-compatible proxy, workers, scripts | `npm run dev` (live reload + app-server supervisor) or `npm run start` | `npm run test:unit`, `npm run test:integration`, `npm test` (Playwright) | README.md                     | `src/AGENTS.md`            |
| ForwardAuth       | node/http    | `auth/`           | Traefik bearer auth gate                  | `PROXY_API_KEY=... node auth/server.mjs`                               | curl `/verify`                                                           | README.md (ForwardAuth notes) | `auth/AGENTS.md`           |
| Docs              | docs         | `docs/`           | Schema exports, runbooks                  | n/a (static)                                                           | `npm run lint:runbooks` if editing                                       | docs/                         | (none)                     |
| External codex-rs | rust         | `external/codex/` | Upstream codex-rs reference               | see per-dir instructions                                               | see per-dir instructions                                                 | upstream docs                 | `external/codex/AGENTS.md` |

## Cross-domain workflows

- Proxy depends on Codex CLI app-server: dev uses `.codev/` as `CODEX_HOME` (mounted in dev stack), prod uses `.codex-api/`; keep bearer/auth.json in sync across both.
- ForwardAuth shares the same `PROXY_API_KEY` as the proxy; Traefik calls `/verify` on loopback (`127.0.0.1`) before routing to the app.
- Dev stack (`npm run dev:stack:up`) brings up Traefik + auth + proxy on the deterministic JSON-RPC shim unless you point `CODEX_BIN` at a real Codex CLI.
- CI/e2e rely on the deterministic shim (`scripts/fake-codex-jsonrpc.js`); changing stream shape or schema requires updating fixtures under `tests/`.

## Architecture style (why layered here)

- Default style is **layered**: HTTP surface + middleware → handlers → services → lib/utils. It matches the current code and keeps transport/runtime concerns isolated from routing.
- Hex/clean would require adapters/ports and domain layers that don’t exist today; adding them would add ceremony without new guarantees.
- Use module-scoped AGENTS for the specific boundaries (see `src/` and `auth/` for details).

## Verification (preferred commands)

- Default order: `npm run format:check`, `npm run lint`, `npm run test:unit`, `npm run test:integration`, `npm test` (Playwright e2e on shim).
- Full gate: `npm run verify:all` (format, lint, schema verify, unit, integration, Playwright).
- Edge/Traefik changes: run `npm run smoke:dev` (dev stack) or `npm run smoke:prod` on the host before/after deploy.
- Re-run narrow failures with verbose flags only when debugging; keep first run quiet.

## Docs usage

- Do not open `docs/` unless requested or the task requires it; keep detailed changes in `docs/` rather than this file.
- Infra note: Traefik/ForwardAuth dev runbook lives in `docs/traefik-dev.md` (file provider, ports, health checks, common edge failures).

## Global conventions

- Node.js ≥ 22; use `npm` (pnpm/yarn/bun are not used here).
- `@openai/codex` is intentionally pinned; coordinate schema/regression updates before bumping.
- Keep PROXY bearer secrets out of Git; `.codev/` and `.codex-api/` must remain gitignored and writable at runtime.
- Preserve OpenAI-compatible response/stream formats (role-first SSE deltas ending with `[DONE]`); update tests/fixtures when behavior changes.

## Do not

- Do not commit contents of `.codev/` or `.codex-api/` (secrets, rollouts, CLI state).
- Do not change Traefik/ForwardAuth paths or ports without updating compose files and running smoke tests.
- Do not rely on the legacy proto shim for production; it exists only for CI/tests.

## Verifiable config

```codex-guidelines
{
  "version": 1,
  "format": {
    "autofix": true,
    "commands": ["npx prettier -c {files}"],
    "windows": [],
    "posix": []
  },
  "lint": {
    "commands": [
      "npx eslint --ext .js,.mjs,.ts --no-error-on-unmatched-pattern {files}"
    ],
    "windows": [],
    "posix": []
  },
  "test": {
    "commands": [],
    "optional": true,
    "windows": [],
    "posix": []
  },
  "rules": {
    "forbid_globs": [],
    "forbid_regex": []
  }
}
```

## Links to module instructions

- `src/AGENTS.md`
- `auth/AGENTS.md`
- `external/codex/AGENTS.md`
