---
title: "Task 01 – Repository Topology & Runtime Surfaces"
status: "draft"
version: "1.0.0"
created: 2025-12-07
tags:
  - review
  - qa
  - codex-completions-api
  - topology
---

# Task 01 – Repository Topology & Runtime Surfaces

## 1. Scope

- **Task ID:** Task 01
- **Short name:** Repository Topology & Runtime Surfaces
- **Date:** 2025-12-07
- **Reviewer / Agent:** ChatGPT (5.1) via GitHub connector
- **Branch / Ref:** default branch at latest indexed commit (as of 2025-12-07)

**In-scope**

- Root-level files and configs:
  - `server.js`
  - `Dockerfile`
  - `docker-compose.yml`
  - `compose.dev.stack.yml`
  - `docker-compose.local.example.yml`
  - `package.json`, `package-lock.json`
  - `vitest.config.ts`, `playwright.config.ts`, `playwright.live.config.ts`
  - `tsconfig.schema.json`
  - `infra/cloudflare/rht.json`, `infra/cloudflare/rht_update.json`
  - `.env.dev.example`, `.env.example`
  - `.nvmrc`, `.prettierrc.json`, `eslint.config.mjs`, `.secretlintrc.json`
- Top-level directories:
  - `.codev/`
  - `.codex-api/`
  - `.github/`
  - `.husky/`
  - `auth/`
  - `config/`
  - `docs/`
  - `external/`
  - `releases/`
  - `scripts/`
  - `src/`
  - `systemd/`
  - `tests/`
  - `docs/_archive/v4-backup/`
  - `web-bundles/`
  - `workers/`

**Out-of-scope for this slice**

- Detailed internal logic within `src/**` (handlers, services, adapters).
- Detailed test implementations in `tests/**`.
- Detailed BMAD story/QA semantics in `docs/**` (only structural placement is considered).

Focus: **map the repository surface area and runtime-related entrypoints** without deep behavior analysis.

---

## 2. Component Inventory

### 2.1 Top-level directories

| Component              | Path          | Type           | Role / Responsibility                                                                                  | Status         | Risks / Smells                                                                                      | Notes |
|------------------------|---------------|----------------|--------------------------------------------------------------------------------------------------------|----------------|-----------------------------------------------------------------------------------------------------|-------|
| Dev Codex HOME         | `.codev/`     | config area    | Developer Codex HOME seed: editor config, dev AGENTS.md, non-secret dev-only configs.                 | current        | If not clearly separated from `.codex-api`, dev-only config might be mistaken for prod baseline.   |       |
| Prod Codex HOME mount  | `.codex-api/` | config mount   | Empty mount directory for production Codex HOME (secrets, config at runtime, not in git).             | current        | Misuse as committed config would leak secrets; needs clear ignore patterns and docs.               |       |
| GitHub workflows       | `.github/`    | ci/config      | CI/CD workflows, issue templates, etc.                                                                | current        | CI config drift vs docs if not reviewed in later CI-focused slice.                                 |       |
| Git hooks              | `.husky/`     | dev tooling    | Local git hooks (linting/formatting on commit).                                                       | current        | Hooks must stay in sync with lint/format rules; otherwise confusing failures.                      |       |
| ForwardAuth service    | `auth/`       | microservice   | Traefik ForwardAuth implementation (`server.mjs`).                                                   | canonical now  | Legacy CJS entrypoint removed 2025-12-18 after confirming no manifest references.                 |       |
| Provider configs       | `config/`     | config         | Example upstream provider configs (e.g., `roo-openai-compatible.json`).                               | current        | If treated as canonical without validation, may drift from actual deploy config.                   |       |
| Documentation          | `docs/`       | docs           | Project docs, BMAD artifacts, architecture maps, migration runbooks, QA checklists, stories.          | current+archive| Contains both current and `_archive` content; ambiguity around which docs are canonical.           |       |
| Vendored submodule     | `external/`   | dependency     | Git submodule (e.g., upstream Codex client/SDK or related resources).                                 | current        | Submodule versions can drift separately from `package.json` deps; need explicit update policy.     |       |
| Release metadata       | `releases/`   | release meta   | Stack image lock JSON and other release state artifacts.                                              | current        | If not regenerated consistently, may become misleading vs actual prod deployment.                  |       |
| Helper scripts         | `scripts/`    | tooling        | Dev/CI/ops helpers (config sync, QA scripts, stack snapshots, etc.).                                  | current        | Wide surface; some scripts may be legacy or env-specific; needs tagging/ownership.                |       |
| Application code       | `src/`        | app code       | Express app, routers, services, adapters, JSON-RPC transport, business logic.                         | current        | Entry-point is `server.js`; deep behaviors to be reviewed in later tasks.                          |       |
| Systemd unit files     | `systemd/`    | ops            | Host-based systemd units to run the proxy outside of Docker.                                          | current        | Additional deployment modality increases configuration drift risk vs Docker/Compose.               |       |
| Test suite             | `tests/`      | tests          | Unit/integration/e2e tests (Vitest, Playwright).                                                      | current        | Need coverage review later; multiple configs imply multiple test “modes”.                          |       |
| Legacy snapshot        | `docs/_archive/v4-backup/`  | legacy archive | Archived v4-era configuration, BMAD templates, older project structure.                               | legacy         | Keeping in-tree is fine, but must be clearly marked non-authoritative to avoid confusion.          |       |
| Web bundles            | `web-bundles/`| artifact       | Optional web/agent bundles (likely built artifacts or packaged configs).                              | optional       | Exact contents not indexed; risk of stale artifacts if not regenerated regularly.                  |       |
| Cloudflare workers     | `workers/`    | infra          | Cloudflare Worker projects (e.g., CORS preflight logger, routing helpers).                            | current        | Adds another operational surface; requires synchronized config with Traefik and header rules.      |       |

### 2.2 Top-level files

| Component                    | Path                               | Type           | Role / Responsibility                                                                        | Status  | Risks / Smells                                                                                        | Notes |
| ---------------------------- | ---------------------------------- | -------------- | -------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------- | ----- |
| Entry bootstrap              | `server.js`                        | entrypoint     | Main process bootstrap; selects backend mode, starts worker/supervisor, mounts Express app.  | current | Any additional entrypoints would create ambiguity; this appears to be the canonical one.              |       |
| Container build              | `Dockerfile`                       | build          | Builds the proxy + dependencies into an image for Docker/Compose deployment.                 | current | Must align with Node version (`.nvmrc`) and runtime expectations; to be validated later.              |       |
| Prod Compose                 | `docker-compose.yml`               | runtime        | Main Compose stack for production-like deployments (Traefik labels, service wiring).         | current | One of several compose files; must be treated as authoritative for prod.                              |       |
| Dev stack Compose            | `compose.dev.stack.yml`            | runtime        | Dev-oriented stack composition (additional services, mount points).                          | current | If not clearly documented, dev vs prod behavior may diverge.                                          |       |
| Local example Compose        | `docker-compose.local.example.yml` | runtime        | Template for local developer setup.                                                          | helper  | Needs periodic sync with actual service list and env var names.                                       |       |
| Package manifest             | `package.json`                     | deps           | Declares dependencies, scripts, and build/test commands.                                     | current | Must stay aligned with tooling configs and submodule expectations.                                    |       |
| Lockfile                     | `package-lock.json`                | deps           | Frozen dependency graph for reproducible installs.                                           | current | If not kept fresh with `package.json`, may hide outdated dependencies.                                |       |
| Node version pin             | `.nvmrc`                           | tooling        | Pins Node version used by devs/CI.                                                           | current | Divergence from Docker image Node version would cause inconsistent behavior.                          |       |
| Env templates                | `.env.dev.example`                 | config         | Example dev environment configuration.                                                       | current | Needs validation against actual required env vars.                                                    |       |
| Env templates                | `.env.example`                     | config         | Generic env template for non-dev environments.                                               | current | Risk of drift between this and docs/CI.                                                               |       |
| Lint config                  | `eslint.config.mjs`                | tooling        | Central ESLint configuration (including ignore patterns for `external/**`, Codex HOME dirs). | current | Ignores `.codev/**`, `.codex-api/**`, `external/**`, `web-bundles/**` which is intentional but broad. |       |
| Formatter config             | `.prettierrc.json`                 | tooling        | Prettier configuration.                                                                      | current | No issues at topology layer.                                                                          |       |
| Secretlint config            | `.secretlintrc.json`               | tooling        | Secret scanning configuration.                                                               | current | Needs later check to confirm it covers Git-tracked Codex config shells.                               |       |
| Secretlint ignore            | `.secretlintignore`                | tooling        | Paths excluded from secret scanning.                                                         | current | Must ensure we are not excluding critical config paths by mistake.                                    |       |
| Project README               | `README.md`                        | docs           | High-level project docs, run instructions, and structure overview.                           | current | Needs comparison with actual structure (this review) to detect drift.                                 |       |
| Agent / contributor guide    | `AGENTS.md`                        | docs           | Agent- and contributor-facing guidance on how to interact with this repo.                    | current | Should be updated as we refine slice reviews and remediation plan.                                    |       |
| Vitest config                | `vitest.config.ts`                 | tests          | Unit/integration test harness configuration.                                                 | current | Needs alignment check with folder structure under `tests/`.                                           |       |
| Playwright config            | `playwright.config.ts`             | tests/e2e      | Standard Playwright test configuration.                                                      | current | Co-exists with a live config; potential duplication.                                                  |       |
| Live Playwright config       | `playwright.live.config.ts`        | tests/e2e      | Alternate Playwright config for live/external testing scenarios.                             | current | Two configs implies multiple live/test modes; must be clearly documented.                             |       |
| TS schema config             | `tsconfig.schema.json`             | tooling        | TS configuration for schema-related tooling (JSON schema generation, etc.).                  | current | Indicates some TS-based tooling even though core app is JS.                                           |       |
| Cloudflare header rules      | `infra/cloudflare/rht.json`         | infra artifact | Captured Cloudflare response-transform rule set (current state).                             | current | JSON is infra state; changes may be manual—risk of config drift vs code/docs.                         |       |
| Cloudflare update payload    | `infra/cloudflare/rht_update.json`  | infra artifact | Update payload for Cloudflare header transform rules (CORS behavior, etc.).                  | current | Keep aligned with edge changes to avoid config drift.                                                  |       |
| Cloud/cloud bootstrap script | `scripts/setup-codex-cloud.sh`     | ops script     | Shell script to bootstrap cloud environment for Codex stack.                                 | current | Must be checked for idempotency, secret handling, and parity with docs.                               |       |

---

## 3. Top Issues (Slice-Level)

1. **[ISSUE-01-01] Duplicate ForwardAuth entrypoints under `auth/`**  
   - Both `auth/server.mjs` and `auth/server.js` appeared to implement the same Traefik ForwardAuth behavior with different module systems/build paths. Without a clear deprecation marker, this invited divergence between the “active” and “legacy” implementations and made it harder to know which one was in use.
   - Update (2025-12-18): `auth/server.mjs` is the canonical entrypoint; legacy `auth/server.js` removed after confirming no manifest references.

2. **[ISSUE-01-02] Mixed “current vs archive” documentation under `docs/`**  
   - `docs/` contains both actively used documents and `_archive` content (including a very useful `source-tree` map). This blurs what is canonical, and future contributors or agents may ignore up-to-date but archived-labeled docs or, conversely, trust outdated ones.

3. **[ISSUE-01-03] Multiple deployment modalities with no single declared source-of-truth**  
   - The repository supports several ways to run the service: Docker/Compose, systemd units, Cloudflare Worker for CORS, and Traefik ForwardAuth. At topology level there is no clear declaration of “primary/official” deployment path, which increases configuration drift risk.

4. **[ISSUE-01-04] Submodule dependency (`external/`) as a second dependency channel**  
   - The `external/` submodule introduces a parallel dependency surface beyond `package.json`. Without explicit versioning and update policy, this can drift from the NPM dependencies and documentation.

5. **[ISSUE-01-05] Opaque infra artifacts (`infra/cloudflare/rht*.json`, `web-bundles/`) without high-level explanation**  
   - Cloudflare header transform artifacts and `web-bundles/` are present but not clearly described in root-level docs. This makes it harder to understand the infra topology and whether those artifacts are expected to be edited by hand or generated.

6. **[ISSUE-01-06] Potential drift between `.env.*`, `README.md`, and actual runtime expectations**  
   - There are multiple env templates (`.env.dev.example`, `.env.example`) and several deployment modes, but no single, validated set of required environment variables at the topology level.

---

## 4. Suggested Changes (Slice-Level)

- **SC-01-001 – Canonicalize ForwardAuth implementation in `auth/`**  
  - Related issues: ISSUE-01-01, ISSUE-01-03  
  - Impact: Medium  
  - Effort: S/M  
  - Description:  
    - Decide which entrypoint (`server.mjs` vs `server.js`) is the canonical, supported implementation.  
    - Mark the non-canonical one as clearly deprecated or remove it after confirming no deployment path uses it.  
    - Add a brief note in `auth/README.md` or in root `README.md` explaining how ForwardAuth is deployed today.

- **SC-01-002 – Separate canonical vs archive docs under `docs/`**  
  - Related issues: ISSUE-01-02  
  - Impact: High (for maintainability)  
  - Effort: S  
  - Description:  
    - Introduce a simple convention: e.g., `docs/canonical/` and `docs/archive/`, or tag docs in frontmatter with `status: canonical/archived`.  
    - Move clearly outdated structural docs to a dedicated archive area while reviving and updating the current “source tree” document as canonical.  
    - Cross-link `README.md` and `AGENTS.md` to the canonical architecture doc.

- **SC-01-003 – Declare a primary deployment modality and reference others as variants**  
  - Related issues: ISSUE-01-03, ISSUE-01-05, ISSUE-01-06  
  - Impact: High  
  - Effort: M  
  - Description:  
    - In `README.md` (or a new `docs/deployment-matrix.md`), explicitly state the “primary/official” deployment path (e.g., Docker/Compose behind Traefik) and list systemd + Cloudflare Worker as supported variants.  
    - Add a small matrix summarizing which config files and env vars apply to each modality.  
    - This gives future cleanup/automation efforts a clear anchor.

- **SC-01-004 – Document submodule usage and update policy (`external/`)**  
  - Related issues: ISSUE-01-04  
  - Impact: Medium  
  - Effort: S  
  - Description:  
    - Add a short section to `AGENTS.md` or `README.md` explaining what `external/` is, how often it is updated, and the process for doing so.  
    - Optionally inline the current commit SHA and rationale in the doc so that any change is intentional and reviewed.

- **SC-01-005 – Add a topology-level env/config manifest**  
  - Related issues: ISSUE-01-03, ISSUE-01-06  
  - Impact: High  
  - Effort: M  
  - Description:  
    - Introduce a single manifest (e.g., `docs/config/required-env.md` or a JSON/YAML file) listing all environment variables, their purpose, and which deployment modes use them.  
    - This will later be used by deeper slices (translation, Codex integration) to validate that all required config is represented.

- **SC-01-006 – Briefly explain Cloudflare header artifacts and `web-bundles/` in README**  
  - Related issues: ISSUE-01-03, ISSUE-01-05  
  - Impact: Medium  
  - Effort: S  
  - Description:  
    - Add short bullets to the “Project Structure” section of `README.md` for `infra/cloudflare/rht*.json` and `web-bundles/`, clarifying whether they are generated, hand-edited, or optional.  
    - This improves discoverability and reduces confusion for agents and contributors.

---

## 5. Open Questions / Dependencies

- **OQ-01-01 – Which ForwardAuth entrypoint is currently used in production?**  
  - Detail:  
    - Resolved 2025-12-18: manifests reference `auth/server.mjs` only; legacy `auth/server.js` removed after confirming no consumers.  
  - Dependency on:  
    - Deployment repo or ops runbooks for future entrypoint changes.

- **OQ-01-02 – Which docs in `docs/` are treated as canonical today?**  
  - Detail:  
    - Some architecture docs live under `_archive`, yet appear accurate. Clarifying which docs authors consider authoritative will inform how we reorganize `docs/**`.  
  - Dependency on:  
    - Maintainer input and review of the current doc set.

- **OQ-01-03 – What is the “official” deployment path: Docker/Compose behind Traefik, systemd-only, or hybrid?**  
  - Detail:  
    - The repo supports multiple execution modalities; the remediation plan needs a declared primary mode to prioritize testing and config validation.  
  - Dependency on:  
    - Current production deployment details and future plans (e.g., running mostly in Docker vs native).

---

## 6. Notes for Global Synthesis

- Theme: **Multi-modal deployments without a single declared source-of-truth.**  
  Future slices (Codex integration, observability, QA) should explicitly align with whichever deployment path is chosen as primary.

- Theme: **Docs are rich but not clearly stratified by freshness.**  
  A small investment in documentation structure will pay off heavily when we start linking slice reviews and remediation epics.

- Theme: **Config and infra artifacts live inside the app repo.**  
  Later tasks should decide whether to keep this as a mono-repo style (app + infra + workers) or split infra to a separate space, but for now this review simply catalogs what exists.
