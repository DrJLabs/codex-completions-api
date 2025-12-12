# Documentation Overview

This file is the canonical index for public documentation. Keep it updated whenever new docs are added or scoped.

## Primary references

- `README.md` — quick start, auth/config defaults (sandbox defaults to `read-only`, test endpoints bearer + loopback), and operational reminders.
- `docs/bmad/prd.md` — product requirements, endpoint surface, and testing expectations.
- `docs/bmad/architecture.md` — current architecture stack (Node 22, Express 4.21.2), config expectations, and operational invariants.
- `docs/reference/config-matrix.md` — env/volume manifest by deployment mode plus ForwardAuth canonicalization and infra artifact notes.
- `docs/openai-endpoint-golden-parity.md` — canonical envelope definitions for `/v1/chat/completions` and `/v1/responses` (typed SSE + non-stream).
- `docs/responses-endpoint/overview.md` — rollout/operational notes for `/v1/responses`.
- `docs/app-server-migration/codex-completions-api-migration.md` — app-server migration/runbook context and health probes.
- `docs/codex-longhorizon/INDEX_TASK_DOCS.md` — survey/task index (source for remediation backlog).

## Doc hygiene

- Run `npm run lint:runbooks` before committing doc changes (prettier check for `docs/app-server-migration/**`).
- Place private-only guides under `docs/private/` (ignored by git). Suggested layout:

  ```text
  docs/
  ├── README.md
  └── private/
      ├── architecture/…
      ├── runbooks/…
      └── …
  ```

- When adding new public docs, update both `README.md` and this index with links and scope notes.
