# Task 11 — Documentation IA & Doc↔Code Drift Analysis
_Date: 2025-12-08_  
_Repo: DrJLabs/codex-completions-api (analysis based on mainline contents as indexed in this workspace)_

## Purpose
1. Map the **current documentation landscape** (what exists, where it lives, and what appears canonical).
2. Identify **documentation drift**: contradictions, broken references, and mismatches vs. implemented behavior.
3. Propose a **documentation information architecture (IA)** that reduces duplication and prevents future drift.

## Method (what I did)
- Located primary entrypoints and doc “roots”: `README.md`, `docs/README.md`, `AGENTS.md`, and major doc clusters (`docs/`, `docs/bmad/`, `docs/_archive/`, `docs/app-server-migration/`).
- Cross-checked key requirements and claims against:
  - runtime config source of truth (`src/config/index.js`)
  - route wiring (`src/app.js`) and specific routers (notably `src/routes/usage.js` and test routes)
  - deployment artifacts (`docker-compose.yml`, `scripts/install.sh`)

---

## 1) Current documentation landscape (observed)

### 1.1 Primary entrypoints
- **Root README**: operational “how to run / deploy” + env var reference + streaming behavior notes.
- **AGENTS.md**: internal contributor rules + sandbox/auth conventions + “source of truth” declarations.
- **docs/README.md**: claims the repo ships minimal public docs and that internal docs live in `docs/private/` (uncommitted).

### 1.2 Major doc clusters
- **`docs/` (root)**: app-server migration PRD + epics/specs, plus some older artifacts.
  - Examples: `docs/PRD.md`, `docs/epics.md`, `docs/tech-spec-epic-2.md`, `docs/test-design-epic-2.md`
- **`docs/bmad/`**: a second full “product/architecture/stories/QA” doc stream.
  - Examples: `docs/bmad/prd.md`, `docs/bmad/architecture.md`, `docs/bmad/stories/**`, `docs/bmad/qa/**`
- **`docs/app-server-migration/`**: migration guides, parity harness notes, schema exports; also contains a useful “doc map” style file.
- **`docs/_archive/`**: older architecture document(s) used by some story/QA artifacts.

### 1.3 Key observation: parallel “documentation universes”
There are at least two concurrently maintained documentation “systems”:
1. **App-server migration stream** centered on `docs/PRD.md` + `docs/epics.md`.
2. **BMAD stream** centered on `docs/bmad/prd.md` + `docs/bmad/architecture.md` + story/QA artifacts.

This is not inherently wrong (different scopes), but it becomes high-risk when:
- both contain “canonical” assertions about defaults/auth
- both are called “PRD/Architecture”
- internal link paths diverge (`docs/architecture.md` vs `docs/_archive/architecture.md` vs `docs/bmad/architecture.md`)

---

## 2) Doc↔Code drift findings (contradictions & mismatches)

Severity levels used:
- **High**: can lead to security exposure, unsafe ops, or incorrect client behavior.
- **Medium**: likely operator/dev confusion, broken links, incorrect assumptions.
- **Low**: cosmetic, naming, or legacy cleanup.

### Drift matrix

| ID | Severity | What docs say | What code does | Risk | Recommendation |
|---|---:|---|---|---|---|
| DRIFT-01 | High | `docs/bmad/prd.md` says sandbox defaults to `danger-full-access`. | Config default is **`read-only`**; README + AGENTS also instruct read-only default. | Unsafe operational guidance if followed; misaligned expectations for tool/write behavior. | Update `docs/bmad/prd.md` to match `src/config/index.js` default, and explicitly document when/why to override to `danger-full-access`. |
| DRIFT-02 | High | `docs/bmad/prd.md` claims `__test` endpoints require bearer + `PROXY_TEST_ENDPOINTS=true`. | `src/app.js` mounts `__test` endpoints when `PROXY_TEST_ENDPOINTS` is true **without any auth middleware**, and integration tests call `/__test/conc` with **no Authorization header**. | If enabled outside CI/dev and port is reachable, it is effectively unauthenticated surface area. | Either (a) fix docs to state “no auth; CI-only; never enable on public ingress”, or (b) add auth defense-in-depth in-app and update tests accordingly. |
| DRIFT-03 | High | Multiple docs imply “all non-health routes require bearer” (including usage routes). | `src/routes/usage.js` exposes `/v1/usage` and `/v1/usage/raw` without auth middleware. | Telemetry endpoints could leak usage metadata if the Node port is reachable without edge auth. | Decide policy: enforce bearer in-app for usage routes (recommended) or clearly document “edge-only protection” and warn against exposing the port. |
| DRIFT-04 | Medium | README lists `PROXY_STREAM_MODE (deprecated/no effect)` but later documents `PROXY_STREAM_MODE=jsonl` behavior. Compose/install scripts still set `PROXY_STREAM_MODE`. | No clear evidence in application code that `PROXY_STREAM_MODE` is still read/used. | Operators may think toggling it changes behavior when it does not; or vice versa. | Clarify semantics: either remove it everywhere (compose/install/docs) or document precisely what it still affects (e.g., legacy shim only). Prefer `PROXY_OUTPUT_MODE` + `x-proxy-output-mode` as the supported mechanism. |
| DRIFT-05 | Medium | Some docs reference runbooks as `docs/runbooks/**` and `docs/dev-to-prod-playbook.md`. Others (README/docs/README and various BMAD artifacts) say runbooks are in `docs/private/` and uncommitted. | Repo appears to intentionally **exclude** `docs/private/**`; references are inconsistent across files. | Broken links + unclear operator onboarding; contributors can’t find referenced procedures. | Pick one convention. If runbooks stay private: all committed docs must link to `docs/private/**` **and** provide a public stub/summary. If runbooks become public: commit `docs/runbooks/**` and update README/docs/README accordingly. |
| DRIFT-06 | Medium | Story/QA artifacts reference `docs/architecture.md` and anchors that do not exist. Actual “Decision Architecture” lives under `docs/_archive/architecture.md`; canonical architecture appears to be `docs/bmad/architecture.md`. | File path mismatch creates systematic link rot. | Validation tooling reports missing anchors; maintainers lose trust in citations. | Create a canonical `docs/architecture.md` wrapper that forwards to the chosen architecture doc, or update all references to the actual canonical path and run a link check in CI. |
| DRIFT-07 | Low→Medium | “PRD” naming is overloaded: `docs/PRD.md` (app-server migration) and `docs/bmad/prd.md` (BMAD scope). | N/A | Cognitive load; automation/workflows may choose the wrong PRD. | Rename for disambiguation (e.g., `docs/prd-app-server-migration.md` and `docs/prd-openai-surface.md`), then create `docs/prd.md` as a stable entrypoint pointing to the current canonical(s). |

---

## 3) Specific evidence pointers (high-signal)
(These are the main “load-bearing” artifacts to review when fixing the drift.)

- Sandbox default mismatch:
  - `docs/bmad/prd.md` (NFR) asserts default `danger-full-access`.
  - `src/config/index.js`, `README.md`, and `AGENTS.md` instruct default `read-only`.
- Auth mismatch for `__test`:
  - `docs/bmad/prd.md` endpoint table claims bearer required.
  - `src/app.js` mounts `__test` routes with only an enable flag.
  - Integration helpers call `/__test/conc` without bearer.
- Usage routes unprotected in-app:
  - `src/routes/usage.js` exposes endpoints without auth.
  - Docs/AGENTS imply bearer protection for all non-health routes.
- Stream mode confusion:
  - README calls `PROXY_STREAM_MODE` “deprecated/no effect” yet documents `jsonl` behavior.
  - `docker-compose.yml` and `scripts/install.sh` still set it.

---

## 4) Proposed Documentation IA (recommended target state)

### 4.1 Principles
- **One canonical index**: a single “docs home” that answers “where do I go for X?”
- **Stable canonical filenames**: ensure automation/tools can find `docs/prd.md`, `docs/architecture.md`, `docs/operations.md` even if they redirect.
- **Archive is explicit**: archived docs must not be linked as canonical; add “ARCHIVED” header + move under `docs/_archive/` with a reason.
- **Generate what you can**: env var references and endpoint summaries should be auto-derived from code/config to prevent drift.

### 4.2 Suggested structure
```text
docs/
  index.md                       # START HERE (canonical doc map)
  prd.md                         # canonical entrypoint (links to scoped PRDs)
  architecture.md                # canonical entrypoint (links to current architecture)
  reference/
    configuration.md             # generated from src/config (env vars + defaults)
    api.md                       # endpoint inventory + auth expectations + examples
    headers.md                   # x-proxy-* headers, output mode, streaming controls
  development/
    local-dev.md
    testing.md
    contributing.md
  operations/
    deployment.md                # how to deploy (public-safe)
    troubleshooting.md           # public-safe runbook subset
    security-model.md            # ForwardAuth vs in-app bearer model
  migration/
    app-server/                  # current migration guides + parity harness
  bmad/
    ...                          # keep if desired, but link from index and clarify scope
  _archive/
    ...                          # explicitly archived material
```

### 4.3 Canonicalization plan (minimal-disruption)
1. Add `docs/index.md`, `docs/prd.md`, `docs/architecture.md` as lightweight entrypoints that link to:
   - `docs/PRD.md` (migration PRD)
   - `docs/bmad/prd.md` (if still authoritative for OpenAI surface)
   - `docs/bmad/architecture.md` (current canonical architecture)
   - `docs/_archive/architecture.md` (explicitly labeled archived)
2. Update all references to `docs/architecture.md` anchors to point to the canonical entrypoint (or to the real file once created).
3. Decide “public vs private runbooks” and normalize links accordingly.

---

## 5) Governance & automation (to prevent drift reappearing)

### 5.1 Add doc linting in CI
- Link checker for markdown (catches the current broken-path/anchor issues).
- Spellcheck optional; prioritize structural validity.

### 5.2 Auto-generate configuration reference
- Generate `docs/reference/configuration.md` from `src/config/index.js`:
  - env var names
  - defaults
  - allowed values
  - security-sensitive flags called out

### 5.3 “Doc update triggers” (lightweight rule set)
When these files change, require doc updates:
- `src/config/**` → regenerate config reference + validate README env section.
- `src/app.js` / routing changes → update `docs/reference/api.md`.
- `docker-compose.yml` / Traefik labels → update `docs/operations/deployment.md` and security model.

---

## 6) Output for Task 12 (handoff)
For the final synthesis/remediation plan (Task 12), the high-priority doc-related decisions to integrate are:
1. **Auth policy** for `/v1/usage*` and `__test` endpoints (edge-only vs defense-in-depth).
2. **Single-source-of-truth naming** for PRD/architecture docs to stop duplication.
3. **Runbook publication stance** (private with public stubs vs committed runbooks).

