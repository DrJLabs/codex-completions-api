# Task 06 – Codex Integration & Infrastructure Surfaces
# Source: docs/surveys/task-06-codex-integration-infra.md

## Work done
- Deprecated the standalone installer (`scripts/install.sh` now exits; archived to `docs/_archive/install.sh`), reinforcing Compose as the canonical deployment; compose files now set `PROXY_HOST` for Traefik reachability.
- Startup now performs `assertSecureConfig` to fail fast in prod-like environments lacking API keys or with unsafe test/metrics toggles; host binding is explicit (`PROXY_HOST` default 127.0.0.1).
- Worker metrics improved (restart delta/backoff/ready gauges) and exposed via `/metrics`; long-horizon docs/backlog added under `docs/codex-longhorizon/`.

## Gaps
- `PROXY_USE_APP_SERVER` default remains “magic” and is not pinned in manifests; backend-mode expectations are not documented per environment.
- ForwardAuth duplication is unresolved and deployment matrix (Compose vs systemd/edge controls) is still implicit; CORS/rate-limit layering between edge and app remains duplicated.
- CODEX_HOME/WORKDIR ownership/rotation guidance and restart/backoff alerting are not documented.

## Plan / Acceptance Criteria & Tests
- AC1: Pin backend mode per manifest (dev/prod) and document fallback logic; add a startup log/assert for unexpected defaults. Test: integration asserting default mode for compose and shim mode when CODEX_BIN ends with proto shim.
- AC2: Publish a deployment matrix (edge auth, rate limits, CORS, metrics auth) and mark non-canonical paths as legacy; resolve ForwardAuth canonical file. Test: doc lint plus CI check that non-canonical files are not referenced in manifests.
- AC3: Add ops guidance for CODEX_HOME/WORKDIR (perms, rotation) and worker restart/backoff alerting. Test: runbook lint + metrics alert examples; optional integration verifying worker metrics populate after synthetic restart.
