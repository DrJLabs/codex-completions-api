# Plan: Public Project Polish (naming, GHCR, docs hygiene)

## Goal
- Make the repo read/operate as a polished public project by:
  - consistent naming (`codex-app-server-proxy`),
  - publishing/pulling container images from GHCR,
  - reorganizing docs so public readers see only public materials.

## Assumptions / constraints
- Canonical public name: `codex-app-server-proxy`.
- Standard GHCR conventions: `ghcr.io/<owner>/<repo>:<tag>` with `latest` on main.
- Internal docs must be git‑tracked locally, but should not be pushed to the public remote.
- Keep runtime behavior intact; this is presentation/packaging + docs hygiene.

## Research (current state)
- Name still appears across runtime/config/docs:
  - `package.json` name/description
  - Compose files (`docker-compose.yml`, `infra/compose/*.yml`)
  - Scripts (`scripts/*`, `scripts/stack-snapshot.sh`, `release.yml`)
  - Telemetry/client identity (`src/services/tracing.js`, `src/services/transport/index.js`, `src/lib/json-rpc/schema.ts`)
  - `.env.example` (`PROXY_OTEL_SERVICE_NAME`)
- Release workflow creates tarball names using `codex-app-server-proxy`.
- Docs include deep internal materials (now under `docs/internal/`, sourced from `docs/bmad`, `docs/surveys`, `docs/codex-longhorizon`, `docs/stories`, `docs/review`, `docs/PRD.md`, `docs/epics.md`, `docs/test-design-epic-2.md`).
- `docs/README.md` is the public index and currently links to internal/ops artifacts.

## Analysis
### Options for internal docs handling
1) Keep internal docs in repo and rely on local pre-push hook to block pushing to `origin`.
2) Move internal docs into a private repo (submodule or separate) and keep only a pointer in public repo.
3) Keep internal docs in a local‑only branch that is never pushed.

### Decision
- Use option 1 to satisfy “tracked but not pushed” within a single repo:
  - Add `docs/internal/` and move internal materials there.
  - Add a pre‑push guard that aborts pushes to `origin` if `docs/internal/` is present.
  - Exclude `docs/internal/` from release snapshots.
- If stricter isolation is required later, migrate to option 2.

### Risks / edge cases
- Pre‑push hooks can be bypassed; users must opt into hooks.
- Renaming tarball/image names could break external automation that expects old names.

### Open questions
- Is the hook‑based block on pushing `docs/internal/` acceptable long‑term, or should we migrate to a private submodule?

## Implementation plan
1) Rename/branding sweep:
   - Update repo/package name, image tags, service names, telemetry defaults, JSON‑RPC client info.
2) GHCR publish + compose/readme updates:
   - Add GHCR publish workflow; update compose examples + README to prefer GHCR images.
3) Docs hygiene:
   - Create `docs/internal/`.
   - Move internal docs (bmad/surveys/longhorizon/stories/review/PRD/epics/test‑design) under it.
   - Update `docs/README.md` to only link public docs.
4) Guardrails:
   - Block pushes to `origin` when `docs/internal/` is present.
   - Exclude `docs/internal/` from release snapshots.

## Tests to run
- `npm run format:check`
- `npm run lint:runbooks`
