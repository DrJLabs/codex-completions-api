# Documentation Index

This folder is the canonical index for repository documentation. Update this file whenever docs are added, removed, or renamed.

## Start here

- `../README.md` — overview + quickstart
- `getting-started.md` — first-run walkthrough
- `configuration.md` — environment variables and defaults (authoritative)
- `prd.md` — PRD entry point (canonical links)
- `architecture.md` — architecture entry point (canonical links)

## Development

- `local-development.md` — Node vs shim vs Docker workflows
- `api/overview.md` — endpoint overview + runnable curl examples
- `troubleshooting.md` — common errors and fixes

## Deployment and ops

- `deployment/dev-stack.md` — dev stack (`compose.dev.stack.yml`)
- `deployment/production.md` — production compose (`docker-compose.yml`)
- `ops/runbooks.md` — snapshot/rollback/backup/smoke workflows

## Observability

- `observability.md` — logs, request IDs, metrics, tracing
- `bmad/architecture/end-to-end-tracing-app-server.md` — trace by `req_id`
- `reference/config-matrix.md` — environment/mount matrix + ForwardAuth notes

## API contracts (canonical)

- `openai-endpoint-golden-parity.md` — golden transcript contract for `/v1/chat/completions` and `/v1/responses`
- `responses-endpoint/overview.md` — `/v1/responses` implementation notes

## Deep dives and backlogs

- `bmad/prd.md` — requirements (BMAD PRD)
- `bmad/architecture.md` — architecture (BMAD)
- `app-server-migration/` — JSON-RPC schema exports and migration notes
- `logging-gaps/README.md` — observability gap tracker
- `codex-longhorizon/INDEX_TASK_DOCS.md` — internal survey/task index

## Doc hygiene

- Run `npm run format:check` and `npm run lint:runbooks` before committing doc changes.
- Use `docs/private/` for local-only notes; it is listed in `.gitignore` so new files won’t be committed.
