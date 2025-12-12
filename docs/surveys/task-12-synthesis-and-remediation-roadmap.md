# Task 12 — Synthesis & Remediation Roadmap
_Date: 2025-12-08_  
_Repo: `DrJLabs/codex-completions-api`_  

## 0) What this is
This document consolidates findings from Tasks 1–11 into a **prioritized remediation backlog** and an **execution plan** that can be implemented as a sequence of small, reviewable PRs with clear verification gates.

It is designed to answer:
- “What should we fix first, and why?”
- “How do we de-risk changes while preserving OpenAI-compatibility?”
- “How do we turn the survey into a steady execution pipeline?”

---

## 1) Executive summary (top issues)
Across the codebase, the dominant risks fall into five categories:

1) **Security & exposure foot-guns**  
   Certain endpoints and toggles are safe only when deployed behind Traefik ForwardAuth. If the app is exposed directly or misconfigured, sensitive telemetry and/or test surfaces can become reachable.

2) **Contract drift / dual truths**  
   There are multiple competing artifacts claiming to be the “source of truth” for protocol contracts, deployment instructions, and defaults (schema tooling, docs, legacy installer path).

3) **Streaming correctness complexity**  
   The proxy is doing non-trivial translation: backend event streams → OpenAI-compatible SSE. This creates subtle correctness constraints that need stronger invariants and tests.

4) **Ops visibility gaps**  
   Logging/metrics exist, but the repo is not yet “SLO complete” for streaming workloads, worker supervision, and upstream dependency behavior.

5) **Duplication + obsolete paths**  
   Legacy deployment mechanisms and duplicate auth entrypoints create drift risk and maintenance burden.

---

## 2) Operating principles for cleanup (how we avoid regressions)
These rules should guide every remediation PR:

1. **Defense in depth by default**  
   Do not assume the edge proxy is always present. If an endpoint is sensitive, it should be protected in-app unless there is a compelling reason not to.

2. **One source of truth per domain**  
   - Protocol/schema: one canonical workflow.
   - Deployment: one canonical path.
   - Documentation: one canonical index + generated references.

3. **Small PRs; each PR must have a verification gate**  
   Every PR should add/adjust tests or smoke coverage so changes are “locked in.”

4. **Preserve external API compatibility**  
   Treat OpenAI-compatible behavior as a contract: response shapes, error envelopes, SSE framing/order, finish reasons.

5. **Make unsafe states unrepresentable (or at least hard)**  
   Production should fail-fast on default secrets, accidental test toggles, or unprotected endpoints.

---

## 3) Prioritized backlog (P0/P1/P2)
This backlog is written as implementable items with success criteria.

### P0 — Security correctness & “foot-gun” elimination
**P0-1: Protect `/v1/usage*` in-app**
- Add bearer enforcement or an explicit “edge-only” guard that must be intentionally disabled for local dev.
- Success:
  - Without bearer: `401` for `/v1/usage` and `/v1/usage/raw`.
  - With bearer: behavior unchanged.
  - Documented in `docs/reference/api.md`.

**P0-2: Lock down `PROXY_TEST_ENDPOINTS`**
- Require bearer on all `__test/*` routes, and restrict to loopback by default.
- Success:
  - `__test/*` returns `401` without bearer even if flag is enabled.
  - In CI, tests explicitly pass bearer or explicitly configure an allowlist.

**P0-3: Close in-app rate-limit bypass**
- Apply the rate-limit middleware to `/v1/responses` (and any other write endpoints).
- Success:
  - When enabled, `/v1/chat/completions`, `/v1/completions`, and `/v1/responses` are uniformly limited.

**P0-4: Fail-fast on insecure production defaults**
- If `PROXY_ENV` indicates non-dev (or `NODE_ENV=production`), abort startup if:
  - API key is unset or equals a known default,
  - test endpoints enabled,
  - metrics endpoint enabled without auth (if you adopt that policy).
- Success:
  - Container fails fast with explicit operator guidance.

**P0-5: Bind address clarity**
- Add `HOST` (or similar) and bind explicitly; log the actual bind address.
- Success:
  - Local defaults to loopback; container can bind to `0.0.0.0` by explicit config.

---

### P1 — Contract stability + regression prevention
**P1-1: Choose one canonical JSON-RPC schema workflow**
Pick and enforce one:
- Local TS schema is authoritative; or
- Upstream-export-driven schema is authoritative.

Then add CI checks:
- `npm run jsonrpc:schema` must be idempotent (`git diff --exit-code`).
- Schema bundle regeneration must be idempotent.

Success:
- No one can accidentally regenerate a mismatched schema and commit drift.

**P1-2: Make docs match reality (stop drift)**
- Resolve the known doc↔code contradictions (sandbox defaults, auth for test routes, usage route protection, stream mode semantics).
- Introduce a canonical doc index and stable entrypoints (`docs/index.md`, `docs/prd.md`, `docs/architecture.md`).

Success:
- New contributors can find the right doc quickly; internal links work; docs reflect actual behavior.

**P1-3: CI artifacts and “no silent fixture regen”**
- Upload Playwright report and smoke artifacts.
- Add a CI guard: fail if tests generate or modify golden transcripts unexpectedly.

Success:
- PR reviewers can see exactly what changed and why; golden tests remain meaningful.

---

### P2 — Streaming reliability + operability maturity
**P2-1: Streaming-specific metrics**
Add:
- time-to-first-byte/token histograms
- stream duration histogram
- abnormal termination counters (client abort, upstream abort, worker crash)
- worker readiness and restart counters

Success:
- A “golden signals dashboard” can be built without adding new instrumentation.

**P2-2: Optional OpenTelemetry**
- Add opt-in OTel traces for HTTP inbound and upstream calls, with log correlation.

Success:
- Tracing can be enabled without breaking local dev; trace IDs appear in logs.

**P2-3: Remove/relocate legacy deployment path**
- Decide whether the one-shot systemd installer is supported.
- If not: archive or delete; keep compose as canonical.

Success:
- Only one supported deployment path remains and is documented.

---

## 4) Recommended execution plan (PR sequence)
This sequence front-loads safety and minimizes regression risk.

### PR 1 — Auth hardening (usage + test routes)
- Add shared auth middleware (single function) and apply to:
  - `/v1/usage*`
  - `__test/*`
- Add tests proving 401 behavior.

### PR 2 — Rate limit consistency
- Apply rate-limit middleware to `/v1/responses`.
- Add integration tests verifying 429 behavior across all write endpoints when enabled.

### PR 3 — Fail-fast startup checks + bind address
- Add `PROXY_ENV` semantics and fail-fast rules.
- Add explicit bind host config; fix logging.

### PR 4 — Protocol/schema guardrails
- Choose source-of-truth workflow.
- Add CI idempotency checks for schema generation + bundle.
- Update docs that describe schema generation.

### PR 5 — Docs IA minimal reset
- Add `docs/index.md`, `docs/prd.md`, `docs/architecture.md` as stable entrypoints.
- Update broken links and remove contradictory claims.

### PR 6 — CI artifacts + fixture regeneration guard
- Upload artifacts for Playwright/smoke.
- Add “workspace dirty” check after tests.

### PR 7+ — Metrics/tracing maturity (optional, incremental)
- Add streaming/worker metrics first (high value).
- Add OTel instrumentation behind flags.

### PR N — Dead/obsolete cleanup
- Remove `PROXY_STREAM_MODE` from compose/Dockerfile (if truly unused).
- Remove duplicate auth entrypoint (keep `server.mjs` only).
- Archive/remove legacy installer if not supported.

---

## 5) Verification gates (definition of done per PR)
Every PR should satisfy:

### Test gates
- `npm run test:unit`
- `npm run test:integration`
- `npm test` (Playwright E2E)
- Tool-call smoke (where relevant)

### Contract gates
- For any changes affecting SSE/response envelopes:
  - transcript diffs reviewed and committed intentionally
  - no “silent regen” in CI

### Ops gates
- `/healthz` and `/readyz` remain stable and reflect worker state.
- `/metrics` remains accessible only under the intended policy.

### Docs gates
- Any config/auth behavior change must update:
  - `README.md` (operator-facing)
  - `docs/reference/api.md` (contract)
  - `docs/reference/configuration.md` (defaults)

---

## 6) “Next steps” to put this into actionable work
This is the minimal workflow to convert analysis into execution.

### Step A — Create a single canonical backlog
Create GitHub issues from P0/P1/P2 above and tag each with:
- `P0|P1|P2`
- `area:security|protocol|streaming|ops|docs|infra`
- `risk:low|med|high`

### Step B — Establish a PR template that enforces gates
Template sections:
- Summary
- Risk/rollback plan
- Tests run + what changed
- Docs updated (checkboxes)
- Telemetry impact (metrics/log fields)

### Step C — Implement PR 1–3 (safety baseline)
These deliver immediate value and reduce the risk of future refactors.

### Step D — Freeze contract drift (protocol + docs)
After PR 1–3, do PR 4–6 to “lock” the contract and the developer experience.

### Step E — Only then do deeper refactors
Once safety and guardrails exist, proceed with:
- streaming correctness tightening
- performance and scalability work
- removal of legacy/duplicate paths

---

## 7) Appendix: Deliverables produced during this program
This repository survey produced a set of markdown deliverables for Tasks 1–12. The Task 12 “roadmap” is intended to be the document you keep open while executing.

If you want, the next logical artifact is a **PR-by-PR checklist** document that enumerates:
- files to touch
- tests to add
- acceptance criteria
- rollout plan

