# Task 01 – Repository Topology & Runtime Surfaces
# Source: docs/surveys/2025-12-task-01-topology.md

## Work done
- README and `docs/README.md` now act as canonical public indexes, documenting `/v1/responses`, observability knobs, host binding defaults, and auth expectations.
- Canonical deployment clarified by deprecating `scripts/install.sh` (archived to `docs/_archive/install.sh`) and adding `PROXY_HOST` to `docker-compose.yml`/`compose.dev.stack.yml`.
- Config surface expanded and documented (`PROXY_ENABLE_RESPONSES`, `PROXY_TEST_ALLOW_REMOTE`, `PROXY_USAGE_ALLOW_UNAUTH`, `PROXY_HOST`), plus long-horizon docs index/backlog under `docs/codex-longhorizon/`.
- ForwardAuth canonicalized to `auth/server.mjs`; legacy `auth/server.js` removed after confirming no manifest references (2025-12-18).
- Added `docs/reference/config-matrix.md` with env/volume manifest per mode (local, dev stack, prod), ForwardAuth notes, and documentation for infra artifacts (`rht*.json`, `web-bundles/`, `external/`); linked from `docs/README.md` and README.

## Gaps
- Optional: add a CI/doc lint to prevent reintroducing legacy ForwardAuth entrypoints in manifests.
- Keep the new config matrix and infra artifact notes in sync with future deployment changes (compose/systemd) to prevent drift.

## Plan / Acceptance Criteria & Tests
- AC1: Select and mark the canonical ForwardAuth entrypoint; remove or clearly deprecate legacy alternatives. Test layer: docs + static check. Implementation: annotate chosen file (`auth/server.mjs`), update `docker-compose.yml`/`systemd/*.service` and README to reference only the canonical path; add a CI grep or comment to block legacy entrypoints.
- AC2: Publish a config/env manifest by modality (local, dev stack, prod) covering required vars and mounts (`CODEX_HOME`, workdir, auth). Test layer: doc lint/link check; optional JSON schema validation in CI. Implementation: add `docs/reference/config-matrix.md` generated or hand-maintained; add CI link check.
- AC3: Document infra artifacts (`rht*.json`, `web-bundles/`, `external/`) and the primary deployment matrix in README/docs. Test layer: doc lint/link check. Implementation: add sections to README + docs/README; ensure links resolve; optional CI check that these paths are mentioned.
