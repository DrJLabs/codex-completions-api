# Codebase Hygiene Task Plan (Codex App-Server) — “Green + Low-Drift”

This document is an implementation-ready backlog derived from the audit in [`docs/review/codebase_audit_codex_appserver.md`](codebase_audit_codex_appserver.md). It is written as an execution checklist for Codex to follow end-to-end (code + tests + docs + manifests) without guessing.

## Executive summary

- **What becomes green:** the currently failing integration tests (`chat-jsonrpc.int.test.js`, `responses.readiness.int.test.js`) pass again, and the baseline gates are restored (`npm run format:check`, `npm run lint`, `npm run test:unit`, `npm run test:integration`).
- **What becomes low-drift:** config inventory matches runtime behavior (no dead `CFG.*` references), readiness semantics match docs/runbooks, and infra manifests stop setting deprecated/no-op flags.
- **Risky changes (handle carefully):**
  - Worker readiness semantics: aligning “ready” to **handshake completion** can change when the proxy returns `503` vs proceeds for early requests; keep tests + runbook aligned.
  - Non-stream idle timers: wiring `PROXY_IDLE_TIMEOUT_MS` into app-server mode affects timeouts; add an integration test to lock behavior.
- **Planned removals/cleanups:**
  - Remove `PROXY_STREAM_MODE` from infra manifests (it is documented as deprecated/no effect and is not read by `src/`).
  - Optional refactors: deduplicate choice-index extraction; optionally retire legacy `auth/server.js` after confirming no consumers.

## Scope + repo state (recorded from working tree)

- Repo root: `/home/drj/projects/codex-completions-api`
- Current branch: `main` (from `git rev-parse --abbrev-ref HEAD`)
- HEAD SHA: `e0263198eaf11d96093dacf1eec8052685ff853b` (from `git rev-parse HEAD`)
- Working tree: **dirty (untracked files)** (from `git status --porcelain`)
  - Untracked: `.codev/docs/`, `.codev/log/`, `auth/AGENTS.md`, `src/AGENTS.md`, `docs/review/codebase_audit_codex_appserver.md`, `docs/_archive/review/fix-codex-execution-checklist-v3-commit-review.md`

### Audit drift check (does the audit still match the repo?)

- The audit doc itself reports the same branch + SHA as current, and the key findings remain true in the working tree:
  - `CFG.PROXY_RESPONSES_DEFAULT_MAX_TOKENS` is referenced in handlers but missing from config (`rg "PROXY_RESPONSES_DEFAULT_MAX_TOKENS"` shows only handler references + audit).
  - `PROXY_IGNORE_CLIENT_SYSTEM_PROMPT` default is still `"true"` in code and is documented as such in the README.
  - Readiness is documented as handshake-based (README + migration runbook), but middleware/test expectations drifted.
- **Conclusion:** no substantive drift detected vs audit findings; proceed with the backlog as written.

## Dependency / sequence overview (recommended order)

1. **P0-02** Fix `chat-jsonrpc` integration drift (system prompt forwarding default).
2. **P0-03** Make worker readiness contract handshake-based end-to-end (middleware + supervisor status + tests).
3. **P0-01** Fix `/v1/responses` default max-tokens config drift and add regression tests.
4. **P1-01** Wire `PROXY_IDLE_TIMEOUT_MS` into app-server non-stream idle behavior (with an integration test).
5. **P1-02** Centralize remaining `process.env.PROXY_*` reads into `src/config/index.js` (with tests).
6. **P2-01** Remove deprecated `PROXY_STREAM_MODE` from infra manifests and docs.
7. **P2-02** Deduplicate choice-index extraction helpers (optional refactor with unit coverage).
8. **P2-03** Confirm and retire additional safe-deletion candidates (only with repo evidence).

## Backlog table

| Task ID | Priority | Area | Short Title | Owner | Status |
| --- | --- | --- | --- | --- | --- |
| P0-01 | P0 | Config + Responses | Define `PROXY_RESPONSES_DEFAULT_MAX_TOKENS` (no-op drift) | Codex | TODO |
| P0-02 | P0 | Integration drift | Reconcile `PROXY_IGNORE_CLIENT_SYSTEM_PROMPT` default vs `chat-jsonrpc` test | Codex | TODO |
| P0-03 | P0 | Readiness | Handshake-based readiness contract (middleware + status + tests) | Codex | TODO |
| P1-01 | P1 | Timeouts | Wire `PROXY_IDLE_TIMEOUT_MS` into app-server non-stream idle behavior | Codex | TODO |
| P1-02 | P1 | Config hygiene | Centralize remaining `process.env` reads into `src/config/index.js` | Codex | TODO |
| P1-03 | P1 | Streaming robustness | Add SSE backpressure handling (if traffic warrants) | Codex | TODO |
| P2-01 | P2 | Infra drift | Remove deprecated `PROXY_STREAM_MODE` from manifests + docs | Codex | TODO |
| P2-02 | P2 | Dedup/refactor | Deduplicate choice-index extraction helper(s) | Codex | TODO |
| P2-03 | P2 | Safe deletion | Prove + remove additional unused/legacy surfaces | Codex | TODO |

---

# Detailed task specs

## P0-01 — Define `PROXY_RESPONSES_DEFAULT_MAX_TOKENS` in config (fix dead fallback)

**Why it matters**
- `CFG.PROXY_RESPONSES_DEFAULT_MAX_TOKENS` is read in `/v1/responses` handlers, but is **not defined** in `src/config/index.js`, so the fallback path can never activate.
- This is silent drift: operators may set an env var expecting it to work; today it cannot.
- Fixing it improves config inventory and reduces “mystery behavior” in `/v1/responses`.

**Traceability**
- Audit: “P0 — Fix `CFG.PROXY_RESPONSES_DEFAULT_MAX_TOKENS` drift” in [`docs/review/codebase_audit_codex_appserver.md`](codebase_audit_codex_appserver.md)

**Files to touch**
- [`src/config/index.js`](../../src/config/index.js)
- [`src/handlers/responses/stream.js`](../../src/handlers/responses/stream.js)
- [`src/handlers/responses/nonstream.js`](../../src/handlers/responses/nonstream.js)
- [`README.md`](../../README.md)
- [`.env.example`](../../.env.example)
- New: [`tests/unit/handlers/responses/default-max-tokens.spec.js`](../../tests/unit/handlers/responses/default-max-tokens.spec.js) (to be created)
- Optional: update/add a config test under [`tests/unit/config/`](../../tests/unit/config) (if the repo expects explicit config coverage for new keys)

**Code references (anchors from working tree)**
- `src/handlers/responses/stream.js`
  - `postResponsesStream` fallback injection: lines 7–21 (notably `const fallbackMax = CFG.PROXY_RESPONSES_DEFAULT_MAX_TOKENS || 0;`)
- `src/handlers/responses/nonstream.js`
  - `postResponsesNonStream` fallback injection: lines 32–45 (same logic, `fallbackMax`)
- `src/config/index.js`
  - Config object definition near lines 43–112; `PROXY_RESPONSES_OUTPUT_MODE` at line 68; missing `PROXY_RESPONSES_DEFAULT_MAX_TOKENS`
- `README.md`
  - Environment variables list includes `PROXY_RESPONSES_OUTPUT_MODE` around lines 456–468 but not the default max tokens knob

**Dependencies / sequencing notes**
- Independent, but should land after P0-02/P0-03 if the goal is “get green ASAP” (this drift doesn’t currently fail tests).

**Decision (choose one; recommended is A)**
- **A (recommended):** define `PROXY_RESPONSES_DEFAULT_MAX_TOKENS` in `src/config/index.js` with a default of `0` (disabled), document it, and add tests.
- B: remove the fallback logic from both responses handlers entirely (smaller config surface, but removes a potentially useful knob and requires clarifying docs/expectations).

**Acceptance Criteria**
- [ ] `src/config/index.js` exposes `config.PROXY_RESPONSES_DEFAULT_MAX_TOKENS` as a number (default `0`).
- [ ] When `PROXY_RESPONSES_DEFAULT_MAX_TOKENS > 0` and the request provides no max tokens (`max_tokens`, `max_completion_tokens`, `maxOutputTokens`), `/v1/responses` forwards a chat request with `max_tokens` set to the fallback.
- [ ] When any max tokens field is present on the incoming request, the fallback does **not** override it.
- [ ] README + `.env.example` document the knob and default.
- [ ] A unit test fails if the config key is removed or the fallback injection regresses.

**Verification plan (AC → tests)**
- AC1 → `npm run test:unit -- tests/unit/config` (add/update a config test if needed)
- AC2/AC3 → add `tests/unit/handlers/responses/default-max-tokens.spec.js`:
  - Mock `postChatStream` / `postChatNonStream` to capture `req.body` as observed by chat handlers.
  - Set `process.env.PROXY_RESPONSES_DEFAULT_MAX_TOKENS` in-test, `vi.resetModules()`, then dynamic-import the responses handler module.
  - Assert `max_tokens` injection occurs only when expected.
- Full gate → `npm run format:check && npm run lint && npm run test:unit && npm run test:integration`

**Done when**
- [ ] All ACs checked off.
- [ ] `npm run format:check` passes.
- [ ] `npm run lint` passes.
- [ ] `npm run test:unit` passes (including new test).
- [ ] `npm run test:integration` passes.

---

## P0-02 — Reconcile `PROXY_IGNORE_CLIENT_SYSTEM_PROMPT` default vs `chat-jsonrpc` integration test

**Why it matters**
- `tests/integration/chat-jsonrpc.int.test.js` currently expects `baseInstructions` to include the client `system` prompt.
- The proxy’s documented + unit-tested default is `PROXY_IGNORE_CLIENT_SYSTEM_PROMPT=true`, which omits `baseInstructions` by default for safety.
- This mismatch is a current **integration test failure** and a drift signal.

**Traceability**
- Audit: “P0 — Reconcile `PROXY_IGNORE_CLIENT_SYSTEM_PROMPT` default vs integration tests” in [`docs/review/codebase_audit_codex_appserver.md`](codebase_audit_codex_appserver.md)
- README documents the default behavior (system prompts are not forwarded unless explicitly enabled).

**Files to touch**
- [`tests/integration/chat-jsonrpc.int.test.js`](../../tests/integration/chat-jsonrpc.int.test.js)
- Optional (recommended): add a focused unit test to cover the override case:
  - New: [`tests/unit/chat-request.system-prompt.spec.js`](../../tests/unit/chat-request.system-prompt.spec.js) (to be created, or extend an existing unit test file carefully)
- Optional: clarify README only if a doc mismatch is found during implementation (currently README matches code).

**Code references (anchors from working tree)**
- `src/handlers/chat/request.js`
  - Default env parsing: `IGNORE_CLIENT_SYSTEM_PROMPT` lines 24–26
  - `baseInstructions` computation + assignment: lines 461–474 and 508–510
- `tests/unit/chat-request.normalization.spec.js`
  - Default behavior asserted: “baseInstructions undefined” in first test at lines 25–41
- `README.md`
  - Default + override guidance: lines 117–120
- `tests/integration/chat-jsonrpc.int.test.js`
  - Failing assertion today: `expect(newConversationParams.baseInstructions)...` at lines 171–173

**Dependencies / sequencing notes**
- Should be first or second in P0 sequence because it directly blocks `npm run test:integration`.

**Decision (selected)**
- **Keep default** `PROXY_IGNORE_CLIENT_SYSTEM_PROMPT=true` (consistent with README and existing unit tests).
- Update the integration test to explicitly set `PROXY_IGNORE_CLIENT_SYSTEM_PROMPT=false` in the spawned server env **only for the test case that asserts `baseInstructions` is present**.

**Acceptance Criteria**
- [ ] `npm run test:integration -- tests/integration/chat-jsonrpc.int.test.js` passes.
- [ ] The integration test explicitly sets `PROXY_IGNORE_CLIENT_SYSTEM_PROMPT=false` when it expects `baseInstructions` to be present.
- [ ] There is automated coverage for the override path (`false` => baseInstructions forwarded), not just the default-path coverage.

**Verification plan (AC → tests)**
- AC1/AC2 → `npm run test:integration -- tests/integration/chat-jsonrpc.int.test.js`
- AC3 (recommended) → new unit test `tests/unit/chat-request.system-prompt.spec.js`:
  - Set `process.env.PROXY_IGNORE_CLIENT_SYSTEM_PROMPT="false"`, `vi.resetModules()`, dynamic-import `src/handlers/chat/request.js`.
  - Assert `normalizeChatJsonRpcRequest(...).turn.baseInstructions` matches the system/developer message content.
- Full gate → `npm run format:check && npm run lint && npm run test:unit && npm run test:integration`

**Done when**
- [ ] All ACs checked off.
- [ ] `npm run test:integration` is green again (no failures).

---

## P0-03 — Clarify worker readiness semantics (handshake-based) and align middleware + tests

**Why it matters**
- Docs/runbooks state readiness stays false until the JSON-RPC `initialize` handshake succeeds, but request gating is not consistently aligned.
- Current behavior can mark the worker “ready” in ways that bypass handshake-only readiness, and the error payload field `worker_status.ready` can be misleading.
- This mismatch is a current **integration test failure** (`responses.readiness.int.test.js`) and a real operational drift risk (traffic may route before handshake readiness).

**Traceability**
- Audit: “P0 — Clarify worker readiness semantics (ready event vs handshake)” in [`docs/review/codebase_audit_codex_appserver.md`](codebase_audit_codex_appserver.md)
- Runbook enforces handshake-based readiness:
  - [`docs/app-server-migration/codex-completions-api-migration.md`](../app-server-migration/codex-completions-api-migration.md) (see `readyz` section: “readiness false until handshake completes”)
- README also states readiness is handshake-based:
  - `README.md` “How it works” section: “Health endpoints stay unhealthy until this handshake succeeds.”

**Files to touch**
- [`src/services/worker/supervisor.js`](../../src/services/worker/supervisor.js)
- [`src/middleware/worker-ready.js`](../../src/middleware/worker-ready.js)
- [`src/services/metrics/index.js`](../../src/services/metrics/index.js) (verify readiness gauge maps to handshake readiness after changes)
- [`server.js`](../../server.js) (verify startup handshake behavior; likely no change needed)
- [`tests/integration/responses.readiness.int.test.js`](../../tests/integration/responses.readiness.int.test.js)
- Optional (recommended):
  - Update [`tests/unit/worker-supervisor.test.js`](../../tests/unit/worker-supervisor.test.js) to assert `getWorkerStatus().ready` matches `health.readiness.ready` after the contract change.
  - Add [`tests/unit/middleware/worker-ready.spec.js`](../../tests/unit/middleware/worker-ready.spec.js) to lock middleware behavior (similar pattern to `tests/unit/health.route.spec.js`).

**Code references (anchors from working tree)**
- `server.js`
  - Background handshake during startup: lines 15–22 (`transport.ensureHandshake().catch(...)`)
- `src/services/transport/index.js`
  - `ensureHandshake()` and supervisor callbacks: lines 260–340 (pending + success/failure recording)
- `src/services/worker/supervisor.js`
  - `recordHandshakePending`: lines 178–186
  - `recordHandshakeSuccess`: lines 188–206
  - Ready-event parsing that can occur before handshake: lines 488–537
  - `isWorkerSupervisorReady` export: lines 663–666
- `src/routes/health.js`
  - `/readyz` uses handshake readiness: lines 98–116 (statusCode based on `health.readiness.ready`)
- `src/middleware/worker-ready.js`
  - Request gating: lines 9–29 (currently uses `isWorkerSupervisorReady()`)
- `src/services/metrics/index.js`
  - `setWorkerMetrics` maps `status.ready` into `codex_worker_ready`: lines 248–255
- `tests/integration/responses.readiness.int.test.js`
  - Failing test case: lines 74–94 (currently uses `FAKE_CODEX_SKIP_READY`)

**Decision (selected readiness contract)**
- **“Ready” means handshake complete** (`initialize` succeeded; `health.readiness.ready === true`).
- Worker “ready” log events are treated as startup/liveness signals and should not make request gating pass ahead of handshake readiness.

**Implementation notes (what to change)**
- In `src/services/worker/supervisor.js`:
  - Make `CodexWorkerSupervisor.isReady()` reflect handshake readiness (`this.state.health.readiness.ready`), not the internal startup boolean.
  - Ensure `status().ready` aligns with handshake readiness so:
    - `/v1/*` error payload `worker_status.ready` is meaningful, and
    - metrics gauge `codex_worker_ready` reflects the actual readiness contract.
  - Preserve existing internal startup behavior for `waitForReady()` (if needed) but do not expose it as “ready” for API gating.
- In `src/middleware/worker-ready.js`:
  - Gate on the handshake-based readiness (via updated `isWorkerSupervisorReady()` or directly from `getWorkerStatus().health.readiness.ready`).
- In `tests/integration/responses.readiness.int.test.js`:
  - Replace `FAKE_CODEX_SKIP_READY=true` with a scenario that truly prevents handshake readiness, e.g. `FAKE_CODEX_HANDSHAKE_MODE=timeout` (supported by `scripts/fake-codex-jsonrpc.js`).
  - Keep asserting that `/v1/responses` returns `503` with `error.code=worker_not_ready` and that `worker_status.ready` is `false` until handshake completes.

**Acceptance Criteria**
- [ ] When app-server handshake does not complete, `/readyz` returns `503` (and payload `health.readiness.ready=false`).
- [ ] When handshake does not complete, protected routes that require readiness (e.g. `/v1/responses`) return `503` with:
  - `error.type=backend_unavailable`
  - `error.code=worker_not_ready`
  - `worker_status.ready=false` (aligned with handshake readiness)
- [ ] When handshake completes, `/readyz` returns `200` and `/v1/responses` succeeds.
- [ ] `npm run test:integration -- tests/integration/responses.readiness.int.test.js` passes.
- [ ] A unit test exists (or is updated) to prevent regressions in the readiness contract.

**Verification plan (AC → tests)**
- AC1/AC2/AC3/AC4 → `npm run test:integration -- tests/integration/responses.readiness.int.test.js`
- AC5 → `npm run test:unit -- tests/unit/worker-supervisor.test.js` (update to assert status.ready alignment), plus new `tests/unit/middleware/worker-ready.spec.js` (recommended)
- Docs/runbook consistency check → `npm run lint:readyz-doc`
- Full gate → `npm run format:check && npm run lint && npm run test:unit && npm run test:integration`

**Done when**
- [ ] All ACs checked off.
- [ ] `npm run test:integration` is fully green again.
- [ ] `npm run lint:readyz-doc` passes (no runbook drift).

---

## P1-01 — Wire `PROXY_IDLE_TIMEOUT_MS` into app-server non-stream idle behavior (or deprecate it)

**Why it matters**
- `PROXY_IDLE_TIMEOUT_MS` is documented and set in compose, but **not referenced** in `src/` code today (drift).
- Non-stream idle behavior currently uses `PROXY_PROTO_IDLE_MS` even outside “legacy proto mode,” which contradicts README intent.
- This drift can mislead operators tuning timeouts and complicates incident response.

**Traceability**
- Audit: “P1 — Remove or wire up unused `PROXY_IDLE_TIMEOUT_MS`” in [`docs/review/codebase_audit_codex_appserver.md`](codebase_audit_codex_appserver.md)

**Files to touch**
- [`src/handlers/chat/nonstream.js`](../../src/handlers/chat/nonstream.js)
- [`src/config/index.js`](../../src/config/index.js) (already defines `PROXY_IDLE_TIMEOUT_MS`; verify defaults and usage)
- [`README.md`](../../README.md) (verify doc matches the chosen behavior; update if needed)
- New: [`tests/integration/timeout.nonstream.app-server.int.test.js`](../../tests/integration/timeout.nonstream.app-server.int.test.js) (recommended; to be created; mirror existing timeout tests but for app-server)
- Optional: update any existing timeout docs if found (search: `PROXY_IDLE_TIMEOUT_MS` references)

**Code references (anchors from working tree)**
- `src/config/index.js`
  - `PROXY_IDLE_TIMEOUT_MS` defined at line 71; `PROXY_PROTO_IDLE_MS` at line 73
- `src/handlers/chat/nonstream.js`
  - Nonstream constants: `const PROTO_IDLE_MS = CFG.PROXY_PROTO_IDLE_MS;` at line 196
  - Idle timeout trigger uses `PROTO_IDLE_MS` at lines 1136–1165 (timer set at line 1156)
- `README.md`
  - Documents `PROXY_IDLE_TIMEOUT_MS` as non-stream idle timeout: line 475
  - Documents `PROXY_PROTO_IDLE_MS` as proto-only idle guard: line 477

**Dependencies / sequencing notes**
- Do after P0 green-restoration tasks, because this is behavior change + new test.

**Decision (selected)**
- **Wire it up** (recommended): use `PROXY_IDLE_TIMEOUT_MS` as the non-stream idle timeout for app-server mode, and keep `PROXY_PROTO_IDLE_MS` as the non-stream idle guard for legacy proto mode/shims.

**Implementation notes (what to change)**
- In `src/handlers/chat/nonstream.js`, choose the idle timeout based on backend mode:
  - `BACKEND_APP_SERVER` → use `CFG.PROXY_IDLE_TIMEOUT_MS`
  - else (proto) → use `CFG.PROXY_PROTO_IDLE_MS`
- Add an integration test that proves app-server non-stream idle behavior uses `PROXY_IDLE_TIMEOUT_MS`:
  - Spawn `server.js` with `PROXY_USE_APP_SERVER=true`, `CODEX_BIN=scripts/fake-codex-jsonrpc.js`.
  - Set `FAKE_CODEX_JSONRPC_HANG=message` and `PROXY_IDLE_TIMEOUT_MS=100` and a generous `PROXY_TIMEOUT_MS`.
  - Expect `504` with `error.code=idle_timeout` for `/v1/chat/completions` and/or `/v1/responses` non-stream.

**Acceptance Criteria**
- [ ] In app-server mode, non-stream idle timeout uses `PROXY_IDLE_TIMEOUT_MS` (observable via integration test).
- [ ] In proto mode, non-stream idle timeout continues to use `PROXY_PROTO_IDLE_MS` (existing tests remain valid).
- [ ] README remains accurate for both knobs.
- [ ] `npm run test:integration` remains green.

**Verification plan (AC → tests)**
- AC1 → `npm run test:integration -- tests/integration/timeout.nonstream.app-server.int.test.js`
- AC2 → existing tests:
  - `npm run test:integration -- tests/integration/timeout.nonstream.int.test.js`
  - `npm run test:integration -- tests/integration/responses.timeout.nonstream.int.test.js`
- Full gate → `npm run format:check && npm run lint && npm run test:unit && npm run test:integration`

**Done when**
- [ ] All ACs checked off.
- [ ] New integration test is in place and green.

---

## P1-02 — Centralize remaining `process.env` reads into `src/config/index.js` (protect with tests)

**Why it matters**
- Direct `process.env` reads outside config make it easy for behavior to drift without showing up in config inventory.
- The audit identified several drift-prone env reads for core behaviors (stop-after-tools grace, approval policy, system prompt forwarding, title intercept).
- Centralizing makes configuration auditable and testable.

**Traceability**
- Audit: “P1 — Centralize remaining direct env reads into `src/config/index.js`” in [`docs/review/codebase_audit_codex_appserver.md`](codebase_audit_codex_appserver.md)

**Files to touch (minimum set from audit)**
- [`src/config/index.js`](../../src/config/index.js)
- [`src/handlers/chat/stream.js`](../../src/handlers/chat/stream.js)
- [`src/handlers/chat/nonstream.js`](../../src/handlers/chat/nonstream.js)
- [`src/handlers/chat/request.js`](../../src/handlers/chat/request.js)
- [`src/lib/title-intercept.js`](../../src/lib/title-intercept.js)
- Update affected tests:
  - [`tests/unit/lib/title-intercept.spec.js`](../../tests/unit/lib/title-intercept.spec.js)
  - Any tests that rely on module-load env defaults for these knobs (use `vi.resetModules()` patterns)
- Optional (if you expand scope): other `process.env.PROXY_*` reads surfaced by `rg "process\\.env\\.PROXY_" src`

**Code references (anchors from working tree)**
- `src/handlers/chat/stream.js`
  - `STOP_AFTER_TOOLS_GRACE_MS` direct env read: line 82
  - `APPROVAL_POLICY` direct env read: lines 98–102
- `src/handlers/chat/nonstream.js`
  - `APPROVAL_POLICY` direct env read: lines 207–211
- `src/handlers/chat/request.js`
  - `IGNORE_CLIENT_SYSTEM_PROMPT` direct env read: lines 24–26
- `src/lib/title-intercept.js`
  - `TITLE_INTERCEPT_ENABLED` direct env read: lines 3–5
- `src/config/index.js`
  - Current config definitions around lines 43–112 (add new keys here with defaults + normalization)

**Dependencies / sequencing notes**
- Do after P0 tasks: it touches many files and will require updating unit tests.

**Decision (selected scope)**
- Centralize the audit-listed env reads into config first:
  - `PROXY_STOP_AFTER_TOOLS_GRACE_MS` (number)
  - `PROXY_APPROVAL_POLICY` (string with fallback to `CODEX_APPROVAL_POLICY`)
  - `PROXY_IGNORE_CLIENT_SYSTEM_PROMPT` (bool)
  - `PROXY_TITLE_GEN_INTERCEPT` (bool)

**Acceptance Criteria**
- [ ] All audit-listed env reads above are only read in `src/config/index.js` (no remaining `process.env.PROXY_*` reads for them elsewhere in `src/`).
- [ ] Unit + integration tests cover the behavior of each knob (default + override at least once).
- [ ] Baseline gates remain green.

**Verification plan (AC → tests)**
- AC1 → repo evidence check during implementation:
  - `rg "process\\.env\\.PROXY_STOP_AFTER_TOOLS_GRACE_MS" -S src`
  - `rg "process\\.env\\.PROXY_APPROVAL_POLICY" -S src`
  - `rg "process\\.env\\.PROXY_IGNORE_CLIENT_SYSTEM_PROMPT" -S src`
  - `rg "process\\.env\\.PROXY_TITLE_GEN_INTERCEPT" -S src`
  - Expect: only `src/config/index.js` matches (or none if you renamed).
- AC2 → update/add tests:
  - `tests/unit/lib/title-intercept.spec.js` should still pass with config-driven behavior.
  - Add/update a unit test around approval policy normalization (e.g. in `tests/unit/config/` or handler tests).
  - Ensure system prompt behavior is covered (see P0-02 AC3).
- Full gate → `npm run format:check && npm run lint && npm run test:unit && npm run test:integration`

**Done when**
- [ ] All ACs checked off.
- [ ] `rg` evidence shows env reads centralized as intended.

---

## P1-03 — Add explicit backpressure handling for SSE streams (optional, traffic-dependent)

**Why it matters**
- `res.write(...)` is used without flow control; slow clients can cause buffering growth.
- Under load, this can increase memory and latency or destabilize long-running streams.

**Traceability**
- Audit: “P1 — Add explicit backpressure handling for SSE streams (if traffic warrants)” in [`docs/review/codebase_audit_codex_appserver.md`](codebase_audit_codex_appserver.md)

**Files to touch**
- [`src/services/sse.js`](../../src/services/sse.js)
- [`src/handlers/chat/stream.js`](../../src/handlers/chat/stream.js)
- [`src/handlers/responses/stream-adapter.js`](../../src/handlers/responses/stream-adapter.js)
- New: a focused unit test or harness under `tests/unit/services/` or `tests/unit/handlers/chat/` (only if there’s an existing pattern for stream backpressure testing)

**Code references (anchors from working tree)**
- `src/services/sse.js`
  - `sendSSE` writes without checking return: lines 47–53
  - `finishSSE` writes and ends: lines 62–68

**Dependencies / sequencing notes**
- Recommended after drift/green tasks; it’s a behavior/robustness improvement that can be more intrusive.

**Acceptance Criteria**
- [ ] When `res.write(...)` returns `false`, the proxy pauses reading/processing backend stream chunks until `drain` fires (or uses bounded buffering).
- [ ] Streaming ordering and `[DONE]` termination semantics remain correct.
- [ ] Existing streaming integration/E2E tests remain green.

**Verification plan**
- AC1/AC2 → add a unit test (or small harness) that simulates backpressure (`res.write()` returns `false`) and asserts the proxy waits for `drain` before continuing.
- AC3 → run existing suites:
  - `npm run test:unit`
  - `npm run test:integration`
  - `npm test` (Playwright streaming/E2E)

**Done when**
- [ ] All ACs checked off.
- [ ] Playwright streaming suite is green (`npm test`).

---

## P2-01 — Remove deprecated `PROXY_STREAM_MODE` from infra manifests and docs

**Why it matters**
- README states `PROXY_STREAM_MODE` is deprecated/no effect, and `src/` contains no reads of it.
- Infra manifests still set it, which misleads operators and increases config surface drift.

**Traceability**
- Audit: “P2 — Align infra manifests with deprecated flags (`PROXY_STREAM_MODE`)” in [`docs/review/codebase_audit_codex_appserver.md`](codebase_audit_codex_appserver.md)
- Repo evidence: `rg "PROXY_STREAM_MODE" -S src` returns no matches (flag unused in runtime code).

**Files to touch**
- [`Dockerfile`](../../Dockerfile)
- [`docker-compose.yml`](../../docker-compose.yml)
- [`compose.dev.stack.yml`](../../compose.dev.stack.yml)
- [`systemd/codex-openai-proxy.service`](../../systemd/codex-openai-proxy.service)
- [`README.md`](../../README.md) (ensure wording remains accurate after removal)
- Optional: archived install script(s) that still mention `PROXY_STREAM_MODE` (if they are still used in any workflow)

**Code references (anchors from working tree)**
- `Dockerfile`: sets `PROXY_STREAM_MODE` at line 6
- `docker-compose.yml`: sets `PROXY_STREAM_MODE` at line 23
- `compose.dev.stack.yml`: sets `PROXY_STREAM_MODE` at line 29
- `systemd/codex-openai-proxy.service`: sets `PROXY_STREAM_MODE` at line 9
- `README.md`: explicitly calls it deprecated at line 133 and lists it at line 461

**Dependencies / sequencing notes**
- Safe after P0/P1 because it’s infra-only drift cleanup; still run `npm run smoke:dev` / `npm run smoke:prod` if deploying.

**Acceptance Criteria**
- [ ] No infra manifest in this repo sets `PROXY_STREAM_MODE` anymore.
- [ ] README/doc references remain consistent (either keep a short “deprecated” mention without manifest examples, or remove it entirely).
- [ ] Streaming behavior is unchanged (validated via tests/smoke).

**Verification plan**
- AC1 → repo evidence: `rg "PROXY_STREAM_MODE" -S .` should match only intentional documentation (or none if removed entirely).
- AC2 → doc check: ensure any remaining mentions are explicitly “deprecated/no effect” and do not imply behavior.
- AC3 → runtime confidence:
  - Local checks: `npm run format:check && npm run lint && npm run test:unit && npm run test:integration`
  - Optional smoke: `npm run smoke:dev` and/or `npm run smoke:prod` (host) if deployment is in scope.

**Done when**
- [ ] All ACs checked off.
- [ ] Streaming-related tests remain green.

---

## P2-02 — Deduplicate choice-index extraction helpers (reduce divergence risk)

**Why it matters**
- Choice-index extraction logic is duplicated across stream/nonstream handlers; bugs can diverge across codepaths.
- Dedup reduces maintenance cost and makes correctness fixes apply uniformly.

**Traceability**
- Audit: “P2 — Deduplicate choice parsing/extraction helpers” in [`docs/review/codebase_audit_codex_appserver.md`](codebase_audit_codex_appserver.md)

**Files to touch**
- [`src/handlers/chat/stream.js`](../../src/handlers/chat/stream.js)
- [`src/handlers/chat/nonstream.js`](../../src/handlers/chat/nonstream.js)
- Optional: [`src/handlers/responses/nonstream.js`](../../src/handlers/responses/nonstream.js) (it has its own choice count normalization; dedup only if it’s materially beneficial)
- New shared helper module (recommended location):
  - [`src/handlers/chat/choice-index.js`](../../src/handlers/chat/choice-index.js) (or `src/lib/choice-index.js`) — pick the location that matches existing layering
- New/updated unit tests under `tests/unit/handlers/chat/` to cover the shared helper

**Code references (anchors from working tree)**
- `src/handlers/chat/stream.js`
  - `extractChoiceIndex` / `resolveChoiceIndexFromPayload`: lines 301–338
- `src/handlers/chat/nonstream.js`
  - `extractChoiceIndex` / `resolveChoiceIndexFromPayload`: lines 360–397

**Dependencies / sequencing notes**
- Do after green/drift tasks; this is a refactor. Keep diff small and preserve runtime behavior.

**Acceptance Criteria**
- [ ] The choice-index extraction logic lives in one shared helper module.
- [ ] Both stream and nonstream handlers call the shared helper.
- [ ] Unit tests cover edge cases (nested payloads, `choice_index` vs `choiceIndex`, cycles).
- [ ] No behavior regressions in integration tests (especially tool-call aggregation and multi-choice flows).

**Verification plan**
- AC1/AC2 → targeted unit tests for the shared helper + call sites: `npm run test:unit -- tests/unit/handlers` (or a specific file you add)
- AC3 → same unit run should include edge cases coverage; ensure the helper’s test file is included.
- AC4 → full gate: `npm run format:check && npm run lint && npm run test:unit && npm run test:integration`

**Done when**
- [ ] All ACs checked off.
- [ ] Integration suite stays green.

---

## P2-03 — Additional safe deletion candidates (only with repo evidence)

**Why it matters**
- Removing truly-unused surfaces reduces the long-term drift/maintenance burden.
- This must be evidence-driven; do not delete “maybe unused” code without proving no consumers.

**Candidates (with current repo evidence)**

1) **Legacy ForwardAuth entrypoint: `auth/server.js`**
- Evidence (repo): no compose/systemd refs found (`rg "auth/server\\.js" docker-compose.yml compose.dev.stack.yml systemd -S` yields no matches).
- The file itself states it is deprecated and exits unless `ALLOW_LEGACY_AUTH=true`.

**Files to touch (if deleting)**
- [`auth/server.js`](../../auth/server.js)
- [`auth/server.mjs`](../../auth/server.mjs) (verify canonical entrypoint remains the only one referenced)
- [`README.md`](../../README.md) and [`docs/reference/config-matrix.md`](../reference/config-matrix.md) (update deprecation notes if needed)
- Any other docs that mention the legacy file (search before deleting)

**Code references (anchors from working tree)**
- `auth/server.js`
  - Legacy guard + exit-by-default: lines 14–21 (requires `ALLOW_LEGACY_AUTH=true`)
- `auth/server.mjs`
  - Canonical entrypoint banner: lines 1–2
- `docs/reference/config-matrix.md`
  - ForwardAuth canonicalization + legacy note: lines 13–17

**Dependencies / sequencing notes**
- Do after P2-01 (infra drift) so you can confirm manifests/docs are already clean and you’re not deleting a still-referenced entrypoint.

**Acceptance Criteria**
- [ ] Repo evidence shows no runtime manifest references to `auth/server.js`.
- [ ] If the file is removed, docs are updated to reflect the canonical entrypoint only (`auth/server.mjs`).
- [ ] ForwardAuth still works in dev/prod smoke flows.

**Verification plan**
- AC1 → repo evidence: `rg "auth/server\\.js" -S docker-compose.yml compose.dev.stack.yml systemd docs` should not match runtime manifests; expand search only as needed.
- AC2 → docs validation:
  - `rg "auth/server\\.js" -S README.md docs/reference/config-matrix.md docs` should be updated to reflect the chosen outcome.
- AC3 → smoke (if in scope): `npm run smoke:dev` and/or a minimal ForwardAuth curl against `/verify`.

**Done when**
- [ ] Candidate is either removed with evidence, or explicitly kept with a documented rationale and a guard (e.g., CI lint) to prevent new references.

---

# Definition of Done (DoD)

The codebase is considered “green + low-drift” when:

- [ ] `npm run format:check` passes.
- [ ] `npm run lint` passes.
- [ ] `npm run test:unit` passes.
- [ ] `npm run test:integration` passes.
- [ ] The two drift drivers from the audit are resolved with tests:
  - [ ] `PROXY_IGNORE_CLIENT_SYSTEM_PROMPT` default vs integration expectations
  - [ ] Worker readiness semantics (handshake) are consistent across middleware, `/readyz`, and error payloads
- [ ] Infra manifests do not set deprecated/no-op flags (at minimum `PROXY_STREAM_MODE`), or the docs clearly justify why they remain.

# How to run verification (copy/paste)

```bash
# Baseline gates (required)
npm run format:check
npm run lint
npm run test:unit
npm run test:integration

# Targeted repros for current P0 failures (before/after fixes)
npm run test:integration -- tests/integration/chat-jsonrpc.int.test.js
npm run test:integration -- tests/integration/responses.readiness.int.test.js

# Runbook/doc check for readiness probes (recommended when touching readiness)
npm run lint:readyz-doc

# Full project verification chain (includes Playwright)
npm run verify:all
```
