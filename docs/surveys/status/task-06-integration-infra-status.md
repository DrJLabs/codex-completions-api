# Task 06 – Codex Integration & Infrastructure Surfaces
# Source: docs/surveys/task-06-codex-integration-infra.md

## Work done
- Deprecated the standalone installer (`scripts/install.sh` now exits; archived to `docs/_archive/install.sh`), reinforcing Compose as the canonical deployment; compose files now set `PROXY_HOST` for Traefik reachability.
- Startup now performs `assertSecureConfig` to fail fast in prod-like environments lacking API keys or with unsafe test/metrics toggles; host binding is explicit (`PROXY_HOST` default 127.0.0.1).
- Worker metrics improved (restart delta/backoff/ready gauges) and exposed via `/metrics`; long-horizon docs/backlog added under `docs/codex-longhorizon/`.

## Gaps
- `PROXY_USE_APP_SERVER` still has a “magic” fallback default in `src/config/index.js`, but dev/prod compose and `.env*` templates now pin it to `true`. Remaining work is to decide whether to keep the fallback for shim/dev convenience or replace it with an explicit log/assert when env is absent.
- Deployment matrix and ForwardAuth canonicalization are now documented in `docs/reference/config-matrix.md`, and supported manifests reference `auth/server.mjs`. Remaining work is keeping the matrix current and adding doc/link lint if desired.
- CORS/rate‑limit layering between edge and app remains duplicated; policy for “edge‑only vs defense‑in‑depth” is not consolidated in a single runbook section.
- CODEX_HOME/WORKDIR ownership/rotation guidance and worker restart/backoff alerting are only lightly covered; a fuller ops runbook/checklist is still needed.

## Plan / Acceptance Criteria & Tests
- AC1: Decide on the long‑term stance for the `PROXY_USE_APP_SERVER` fallback default and add a startup log/assert when env is absent. Test: integration asserting default mode for compose (env pinned) and shim mode when `CODEX_BIN` ends with a proto shim and env is intentionally unset.
- AC2: Maintain the deployment matrix + ForwardAuth canonicalization, and add doc/link lint if drift becomes an issue. Test: doc lint plus CI check that non‑canonical files are not referenced in manifests.
- AC3: Expand ops guidance for CODEX_HOME/WORKDIR (perms, rotation) and worker restart/backoff alerting. Test: runbook lint + metrics alert examples; optional integration verifying worker metrics populate after synthetic restart.
