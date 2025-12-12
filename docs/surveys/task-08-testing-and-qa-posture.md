# Task 8 — Testing & QA Posture (codex-completions-api)

## Objective
Establish an evidence-based view of the repo’s testing stack (unit/integration/E2E/smoke), how it is wired into CI, what is deterministic vs “live”, and where gaps/contradictions/obsolete pieces exist that should feed remediation planning.

---

## Current Test/QA Stack (Inventory)

### 1) Unit tests (Vitest)
- Location: `tests/unit/`
- Intended scope (per repo guidance): pure helpers (e.g., `src/utils.js`) and low-level adapters/schema helpers.
- Typical focus areas observed:
  - Model normalization, token heuristics, join/merge helpers
  - JSON-RPC schema validation and parsing helpers
  - “Small logic” correctness that should not require a running server

### 2) Integration tests (Vitest)
- Location: `tests/integration/`
- Pattern: spawn `node server.js` on a random port, run HTTP requests against Express, then teardown.
- Backend approach:
  - Default suite: deterministic legacy “proto” shim (`scripts/fake-codex-proto.js`) to avoid external Codex installs.
  - Some targeted suites: deterministic app-server JSON-RPC shim (`scripts/fake-codex-jsonrpc.js`) for tool-call / app-server parity scenarios.

### 3) Contract + Golden transcript suites (Vitest)
- Location: mainly `tests/integration/**contract**` + `tests/shared/transcript-utils.js`
- Mechanism:
  - Capture “golden” request/response transcripts into `test-results/**`
  - Normalize volatile fields (ids/timestamps) via helper utilities
  - Compare output shape/ordering to transcripts so regressions are visible as diffs

### 4) Parity tests (Vitest)
- Location: `tests/parity/`
- Purpose: enforce that multiple backend modes (proto vs app-server) preserve the externally visible OpenAI-compatible API envelope where expected.

### 5) E2E API/SSE tests (Playwright Test)
- Location: `tests/e2e/`
- Pattern:
  - Playwright starts the server (`webServer`) and runs HTTP/SSE validations.
  - These tests validate the “wire contract” from a client perspective (SSE chunk ordering, `[DONE]`, etc.).

### 6) Live E2E (Playwright live config + bash harness)
- Location:
  - Playwright: `tests/live.*.spec.*` (selected by `playwright.live.config.ts`)
  - Bash: `scripts/test-live.sh`
- Purpose: run against a real running proxy (local compose or remote) to catch issues shims cannot model (filesystem permissions, Codex HOME/rollouts, real auth, etc.).

### 7) Smoke harness (bash + node scripts)
- Entry points:
  - `scripts/dev-smoke.sh`, `scripts/prod-smoke.sh`, `scripts/local-smoke.sh`
  - Tool-call smoke: `scripts/smoke/stream-tool-call.js`
  - CI wrapper: `scripts/qa/tool-call-smoke-ci.sh`
- Purpose:
  - Fast “is the system alive and speaking the contract” checks.
  - Tool-call smoke script enforces invariants like:
    - No mixed frames (content and tool_calls together)
    - Role-first ordering
    - Finish reason semantics
    - `[DONE]` behavior
    - Secret leakage checks in SSE logs
  - Smoke scripts also generate artifacts (raw SSE + hashes) for incident debugging.

---

## How to Run Tests (Developer Workflow)

### “Run everything”
- `npm run verify:all`
  - Format check → lint → unit → integration → Playwright E2E

### Targeted runs
- Unit: `npm run test:unit` / `npm run test:unit:watch`
- Coverage: `npm run coverage:unit` (Vitest v8 coverage)
- Integration: `npm run test:integration`
- E2E: `npm test`
- Sequenced: `npm run test:all` (unit → integration → e2e)
- Live E2E: `npm run test:live` (and `npm run test:live:dev` for dev domain stacks)
- Smokes:
  - `npm run smoke:dev`, `npm run smoke:prod`, `npm run smoke:local`

---

## Determinism Strategy (Fixtures, Shims, Normalization)

### Deterministic “Codex” backends
- `scripts/fake-codex-proto.js`
  - Provides a stable “proto-like” contract for CI/offline tests.
- `scripts/fake-codex-jsonrpc.js`
  - Provides stable app-server JSON-RPC notifications/results needed for tool-call and app-server-specific behaviors.

### Golden transcript utilities
- `tests/shared/transcript-utils.js`
  - Loads and sanitizes transcripts (stable ids/timestamps, SSE parsing, consistent ordering)
  - Generates missing transcripts via scripts:
    - `scripts/generate-chat-transcripts.mjs`
    - `scripts/generate-responses-transcripts.mjs`

### Tool-call fixtures
- `tests/e2e/fixtures/tool-calls/*`
  - App-server-only structured/textual/disconnect tool-call scenarios
  - A manifest tracks provenance and supports repeatability in tests/smoke.

---

## CI Wiring (What Actually Gates Changes)

### GitHub Actions (`.github/workflows/ci.yml`)
- Always:
  - Format check (`npm run format:check`)
  - Lint (`npm run lint`)
- Conditional on “code changes” (paths-filter):
  - Install Playwright Chromium
  - Run `npm run test:all` (unit → integration → e2e)
  - Run tool-call smoke CI wrapper: `bash scripts/qa/tool-call-smoke-ci.sh`

### Notably absent (today)
- No coverage step executed by default in CI (coverage config exists, but is not enforced).
- No artifact upload step for Playwright reports, smoke SSE artifacts, or transcript diffs.

---

## Findings: Strengths, Risks, Gaps, Contradictions

### Strengths (good foundations)
- Multi-layer testing pyramid exists (unit → integration → E2E → smoke).
- Deterministic shims enable CI without real Codex installs/secrets.
- Contract + transcript-based tests are suitable for API compatibility work (especially SSE ordering semantics).
- Tool-call smoke harness adds “production-like” validation and guards secret leakage.

### Risks / gaps likely to matter during cleanup/remediation

1) Documentation drift around test backends
- Some documentation states Playwright runs against the legacy proto shim, while the current Playwright config is wired for the app-server JSON-RPC shim. This is a correctness issue for contributor expectations and may hide regressions when developers run the “wrong” mental model.

2) Coverage thresholds exist but are not gated in CI
- `vitest.config.ts` defines coverage thresholds, but CI executes `npm run test:all` rather than `npm run coverage:unit`.
- This makes coverage targets advisory rather than enforceable. That can be acceptable, but it should be an intentional decision with a documented rationale.

3) Golden transcript generation can mask missing-fixture failures
- Transcript utilities generate transcripts if missing. That is convenient for local workflows, but in CI it can allow a “missing golden fixture” to pass by regenerating it from the current code.
- This reduces the signal value of golden tests as regression detectors when files are accidentally deleted.

4) Artifact visibility is limited
- Playwright produces a report directory; smoke scripts write SSE/hashes; transcript diffs are meaningful review artifacts.
- None are currently uploaded as CI artifacts, which makes debugging CI-only failures slower and reduces auditability of contract changes.

5) Backends and toggles are not comprehensively matrix-tested
- The codebase has meaningful toggles (parallel tool calls, stop-after-tools modes, model protection, rate limiting, concurrency caps).
- CI uses a single primary configuration, which is often fine, but leaves toggle-specific regressions as “latent”.

---

## Recommended Remediation Backlog (feeds Task 11/12)

### P0 — increase correctness + reviewability (low lift, high value)
- Update README/testing docs so they accurately describe which backend shim Playwright and integration suites use.
- Add CI artifact uploads:
  - `playwright-report/`
  - smoke artifacts folder(s)
  - transcript diffs / normalized output (sanitized)
- Add a CI “workspace dirty” check after tests (fail if tests generated/modified golden fixtures unexpectedly).

### P1 — raise confidence via expanded gating
- Decide if coverage should gate merges:
  - Option A: add `npm run coverage:unit` in CI for code changes.
  - Option B: run it in a scheduled workflow (nightly) and monitor trend.
- Add targeted tests for high-risk toggles:
  - `PROXY_PROTECT_MODELS=true` behavior
  - rate limiting (429) and window reset
  - `PROXY_SSE_MAX_CONCURRENCY` enforcement / queueing / 503 behavior
  - worker supervisor restart semantics and handshake timeouts

### P2 — long-term hygiene
- Introduce an explicit tagging strategy:
  - “fast” default, “slow” opt-in (`@slow` / `@stress`)
- Add a scheduled “live E2E against staging” job if a staging endpoint is available.
- Create a small “contract diff” helper to summarize transcript deltas in PR comments (human-friendly).

---

## Key Files Examined (for future audit)
- `package.json` (scripts and tooling)
- `vitest.config.ts`
- `playwright.config.ts`, `playwright.live.config.ts`
- `.github/workflows/ci.yml`
- `tests/unit/**`, `tests/integration/**`, `tests/e2e/**`, `tests/parity/**`
- `tests/shared/transcript-utils.js`
- `scripts/fake-codex-proto.js`, `scripts/fake-codex-jsonrpc.js`
- `scripts/dev-smoke.sh`, `scripts/prod-smoke.sh`, `scripts/smoke/stream-tool-call.js`
- `scripts/qa/tool-call-smoke-ci.sh`

---

## Outputs from Task 8
- This document (Task 8)
- Updated progress tracker (see `00-progress-tracker.md`)
