# Dev → Prod Playbook (Public Stub)

This repository historically kept a detailed dev→prod playbook under `docs/private/` (gitignored). This file is a public-safe stub that points to the committed runbooks and scripts.

## Recommended flow

1. Validate locally (or in the dev stack):
   - `npm run verify:all` (or at least `npm run test:integration` + `npm test` when touching handlers/streaming)
2. Use the dev stack when changing compose/runtime behavior:
   - `npm run dev:stack:up`
   - `npm run smoke:dev`
3. Sync non-secret Codex config:
   - `npm run port:sync-config` (copies `.codev/{config.toml,AGENTS.md}` → `.codex-api/`, does not copy `auth.json`)
4. Deploy on the production host:
   - `docker compose up -d --build --force-recreate`
5. Verify:
   - `DOMAIN=<domain> KEY=<key> npm run smoke:prod`
   - Ensure `PROXY_METRICS_TOKEN` is set (or pass `METRICS_TOKEN=...`) when metrics are enabled, otherwise the smoke check will 403 on `/metrics`.
   - Tool-call smoke targets `/v1/responses` with textual `<use_tool>` by default; override with `TOOL_SMOKE_ENDPOINT=chat TOOL_SMOKE_MODES=structured` when validating structured tool_calls.

## References

- Production deployment: `deployment/production.md`
- Ops runbooks: `ops/runbooks.md`
- Observability: `observability.md`
