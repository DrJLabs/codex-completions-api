# Codex CLI Integration Audit & Hardening Plan
Repo: `DrJLabs/codex-completions-api`  
Revision basis: file links in this report reference commit `ec323c39e2f52106ee773d63a8fe425e91d7431e` (as surfaced by the GitHub connector).  
Date: 2025-12-13

## Objective

Audit and reinforce the integration between the Node proxy and the Codex CLI (Rust `codex` binary invoked via the Node package `@openai/codex`). Ensure Codex is invoked securely and predictably:

- Sandbox defaults to **read-only** (no unintended OS/shell/network tool execution) unless explicitly overridden.
- No user input can influence CLI argument construction (no injection).
- Worker process lifecycle is robust (no deadlocks, bounded timeouts, clean restarts, no zombie children).
- Proxy itself does not perform outbound internet fetches in response to API calls; network access remains within Codex’s control.

This report focuses on the runtime integration surfaces that spawn and supervise Codex and the JSON-RPC transport path used in `app-server` mode.

---

## Files reviewed (primary)

Runtime:
- `src/services/codex-runner.js`
- `src/services/worker/supervisor.js`
- `src/config/index.js`
- `server.js`
- `src/routes/health.js`
- `src/services/transport/index.js`
- `src/handlers/chat/shared.js`
- `src/handlers/chat/{stream.js,nonstream.js}`
- `src/lib/json-rpc/schema.ts`

Deployment:
- `Dockerfile`
- `docker-compose.yml`
- `docs/reference/config-matrix.md`

Tests:
- `tests/unit/worker-supervisor.test.js`
- `tests/unit/security-check.spec.js`
- `tests/unit/services/json-rpc-transport.spec.js`

---

## Executive summary (what is already correct)

### Sandbox default is read-only and wired through the stack

- Config defaults `PROXY_SANDBOX_MODE` to `read-only` (`src/config/index.js`), and lowercases it.
- The supervised worker launch path passes `sandbox_mode="<value>"` into `codex app-server` via `-c sandbox_mode=...` in `buildSupervisorArgs()` (`src/services/worker/supervisor.js`).
- `/healthz` includes `sandbox_mode`, providing an external verification surface (`src/routes/health.js`).
- The Docker deployment pins `PROXY_SANDBOX_MODE` to `read-only` by default (`docker-compose.yml`).

### Process lifecycle is already reasonably robust

- Supervisor restarts the worker on exit with bounded backoff/restart limits.
- Supervisor supports graceful shutdown and escalates to `SIGKILL` on grace timeout.
- JSON-RPC transport enforces handshake timeout (`WORKER_HANDSHAKE_TIMEOUT_MS`) and per-request timeout (`WORKER_REQUEST_TIMEOUT_MS`), reducing deadlock risk when Codex becomes unresponsive.

### The containerized runtime is non-root

- `Dockerfile` explicitly switches to `USER node` for the runtime image.

---

## Findings and gaps (actionable)

### A) Missing “sandbox weakened” warning for operators

Your requirements call for a **warning** when `PROXY_SANDBOX_MODE` is configured to a weaker setting (e.g., `danger-full-access` / `"full"` equivalence). Today, the runtime does not appear to emit a warning at startup or on worker spawn when sandbox is weakened.

**Why it matters:** this is a configuration foot-gun. It does not break correctness, but it increases the chance of an unsafe deployment being run unintentionally.

### B) CLI argument quoting is incomplete (low-risk hardening)

`buildSupervisorArgs()` quotes values by escaping `"` only. This prevents the most obvious injection breakouts but does not handle backslashes or control characters. While the risk is low (values are config-driven, not request-driven), improving TOML/CLI safety is easy and aligns with your requirements.

### C) `spawnCodex` inherits *all* proxy environment variables (including `PROXY_API_KEY`)

`spawnCodex()` builds `childEnv` as `{ ...process.env, CODEX_HOME: codexHome, ...(envOpt||{}) }`.

**Risk:** least-privilege violation. While sandbox read-only should prevent many exfil paths, environment leaks are avoidable. Codex does not need your proxy bearer key to run, and keeping it out of the child env reduces blast radius if a sandbox boundary is ever weakened or bypassed.

### D) `spawnCodex` allows `spawnOptions` to override security-sensitive spawn settings

`spawnCodex()` spreads `...spawnOptions` after the default options. A future caller could accidentally set `{ shell: true }` or `{ detached: true }` and weaken security/process cleanup. There is no current evidence that happens in the repo, but it is worth locking down defensively because `spawnCodex()` is the central choke point.

### E) Supervisor passes `...process.env` again during worker spawn

Supervisor calls `spawnCodex(launchArgs, { env: { ...process.env, CODEX_WORKER_SUPERVISED: "true" } })`.
This re-introduces any env values even if `spawnCodex()` later becomes stricter about env stripping. It’s also redundant because `spawnCodex()` already merges `process.env`.

### F) Documentation contradiction: PRD claims sandbox defaults to danger-full-access

In `docs/bmad/prd.md`, NFR5 states “Sandbox defaults to `danger-full-access`,” but elsewhere the repo states the default is `read-only`.

**Impact:** documentation drift, not a runtime bug. It should be corrected in docs, not code.

### G) Worker “ready timeout” doesn’t trigger restart

Supervisor’s `readyWatcher` logs `worker_ready_timeout` but does not kill/restart the child. If Codex becomes stuck before emitting a readiness event, it may remain alive but unusable until an operator restarts it.

**Impact:** availability/robustness risk (not a direct security flaw). Consider a controlled, minimal auto-restart when readiness timeouts occur.

---

## Recommended changes (minimal, safety-first)

### 1) Add startup warnings for unsafe sandbox modes and root execution

Where: `server.js` (after `assertSecureConfig` and before starting the supervisor).

- If `PROXY_SANDBOX_MODE !== "read-only"`, log a warning.
- If `PROXY_SANDBOX_MODE === "danger-full-access"`, log an explicit “sandbox disabled” warning.
- If running on POSIX and `process.getuid() === 0`, log a warning that running as root is not recommended (Codex inherits privileges).

This satisfies the “warn when sandbox is off” requirement without removing functionality.

### 2) Clamp sandbox mode values to a known allowlist

Where: ideally central in `src/config/index.js` (or in both `buildSupervisorArgs()` and `buildBackendArgs()` as defense-in-depth).

Allowlist: `read-only`, `workspace-write`, `danger-full-access`.
- If env is invalid → warn and fall back to `read-only`.

This prevents accidental typos from producing undefined Codex behavior (or, worse, unexpectedly permissive defaults inside Codex).

### 3) Harden quoting/escaping for `-c key=value` configs

Where: `src/services/worker/supervisor.js` (`quote()` helper).

Implement TOML-safe string literal encoding:
- escape `\`, `"`
- encode `\n`, `\r`, `\t`
- strip `\0`

### 4) Lock down `spawnCodex` spawn options and reduce env leakage

Where: `src/services/codex-runner.js`.

- Force `shell: false`, `detached: false`, and `windowsHide: true` regardless of caller options.
- Remove `PROXY_API_KEY` from `childEnv` by default.
- (Optional) remove other unrelated secrets if you add them later; keep this conservative and non-breaking.

### 5) Remove redundant `process.env` spread in supervisor spawn

Where: `src/services/worker/supervisor.js` in `#launch()`.

Pass only `CODEX_WORKER_SUPERVISED: "true"` and let `spawnCodex()` merge inherited env.

### 6) Optional: auto-restart on repeated readiness timeouts

Where: `src/services/worker/supervisor.js`.

On `worker_ready_timeout`, consider:
- sending `SIGTERM` then `SIGKILL` after a short grace window, letting the existing restart flow respawn it.

Gate this behind an env flag if you want to avoid changing behavior for slow hosts:
- `WORKER_KILL_ON_READY_TIMEOUT=true|false` (default `false`), or reuse existing timeouts but only kill after N consecutive timeouts.

---

## Concrete patch sketches

These are intentionally minimal and localized. Adjust logging style to match your structured logger conventions if desired.

### A) `server.js`: add sandbox/root warnings

```diff
diff --git a/server.js b/server.js
--- a/server.js
+++ b/server.js
@@
 import { assertSecureConfig } from "./src/services/security-check.js";
@@
 assertSecureConfig(CFG, process.env);
+
+// Operator safety warnings (do not fail startup; just make risk explicit).
+try {
+  const sandbox = String(CFG.PROXY_SANDBOX_MODE || "read-only").trim().toLowerCase();
+  if (sandbox !== "read-only") {
+    console.warn(`[security] PROXY_SANDBOX_MODE=${sandbox} (default read-only). Review risk before running in prod.`);
+  }
+  if (sandbox === "danger-full-access") {
+    console.warn(`[security] Codex sandbox disabled (danger-full-access). Run only in a hardened container/VM.`);
+  }
+  if (typeof process.getuid === "function" && process.getuid() === 0) {
+    console.warn(`[security] Proxy is running as root (uid=0). Not recommended; Codex inherits privileges.`);
+  }
+} catch {}
+
 selectBackendMode();
```

### B) `src/services/worker/supervisor.js`: stronger quoting + avoid env duplication

```diff
diff --git a/src/services/worker/supervisor.js b/src/services/worker/supervisor.js
--- a/src/services/worker/supervisor.js
+++ b/src/services/worker/supervisor.js
@@
-const quote = (value) => `"${String(value).replaceAll('"', '\"')}"`;
+const quote = (value) =>
+  `"${String(value ?? "")
+    .replaceAll("\\", "\\\\")
+    .replaceAll('"', '\"')
+    .replaceAll("\n", "\\n")
+    .replaceAll("\r", "\\r")
+    .replaceAll("\t", "\\t")
+    .replaceAll("\0", "")}"`;
@@
   #launch() {
@@
-    const child = spawnCodex(launchArgs, {
-      env: {
-        ...process.env,
-        CODEX_WORKER_SUPERVISED: "true",
-      },
-    });
+    const child = spawnCodex(launchArgs, {
+      env: { CODEX_WORKER_SUPERVISED: "true" },
+    });
```

### C) `src/services/codex-runner.js`: lock down spawn options and strip bearer key

```diff
diff --git a/src/services/codex-runner.js b/src/services/codex-runner.js
--- a/src/services/codex-runner.js
+++ b/src/services/codex-runner.js
@@
 export function spawnCodex(args = [], options = {}) {
@@
-  const childEnv = { ...process.env, CODEX_HOME: codexHome, ...(envOpt || {}) };
+  const childEnv = { ...process.env, CODEX_HOME: codexHome, ...(envOpt || {}) };
+  // Least privilege: do not leak proxy bearer credential into the Codex process.
+  delete childEnv.PROXY_API_KEY;
@@
-  const child = spawn(resolvedCodexBin, args, {
+  const child = spawn(resolvedCodexBin, args, {
     stdio: ["pipe", "pipe", "pipe"],
     env: childEnv,
     cwd: childCwd,
-    ...spawnOptions,
+    // Security hardening: never spawn via shell; never detach.
+    shell: false,
+    detached: false,
+    windowsHide: true,
+    ...spawnOptions,
   });
```

If you want to *guarantee* callers cannot override these, move `...spawnOptions` **before** the fixed keys and/or explicitly delete `shell/detached/stdio` from `spawnOptions`.

### D) Optional: clamp sandbox mode values centrally

Add a helper in `src/config/index.js` to enforce allowlist and fall back to read-only when invalid.

---

## Verification plan (meets your “Verification” section)

### 1) Confirm sandbox in logs and health output

- `/healthz` includes the configured sandbox mode (`sandbox_mode`) and overall backend state; use it to verify the effective mode in a running environment.
- Supervisor logs `worker_launch` include the CLI args string; ensure it includes `-c sandbox_mode="read-only"` by default.
- If you implement the `server.js` warnings, validate logs show warnings when sandbox is weakened.

### 2) Tool/web/network disallow tests (read-only)

Run prompts known to request shell/network actions (e.g., “run uname -a”, “curl example.com”, “install package”, “web search …”).

Expected:
- Codex refuses or errors due to sandbox policy.
- Proxy remains stable (no crash), errors are mapped and delivered in stream/non-stream response bodies.

### 3) Crash/kill test for worker restart

- Kill the worker process and verify:
  - Supervisor respawns it (restart counters increment; liveness remains true; readiness flips false then recovers).
  - `/readyz` reflects readiness transitions (integration coverage exists for probe behavior).

### 4) Unresponsive startup test (handshake timeout)

- Simulate a worker that never responds to `initialize` (tests exist covering handshake timeout behavior).
- Ensure `WORKER_HANDSHAKE_TIMEOUT_MS` triggers a timeout and subsequent calls return retryable errors.
- If you add auto-restart-on-ready-timeout, verify the supervisor kills and respawns the stuck worker.

---

## Documentation updates (recommended)

1) Fix PRD contradiction about sandbox defaults.
   - Update `docs/bmad/prd.md` NFR5 to say default is `read-only` (consistent with config and config-matrix).

2) Add/strengthen a short “Security defaults” section in README:
   - Default sandbox `read-only`.
   - Risks of `workspace-write` / `danger-full-access`.
   - Recommendation: do not run as root; use Docker image or unprivileged service user.
   - Mention `/healthz` exposes `sandbox_mode` for audit.

3) Ensure `docs/reference/config-matrix.md` remains the canonical deployment knob reference (it already calls out sandbox defaults).

---

## Proposed PR summary

Title:
- **Audit Codex CLI integration: confirm read-only default, add sandbox/root warnings, harden spawn options**

Changes (expected):
- Add startup warnings when sandbox is weakened or process runs as root.
- Harden supervisor quoting and remove redundant env spreading.
- Lock down `spawnCodex` to prevent `shell:true` and reduce secret exposure.
- Doc fix: PRD sandbox default contradiction.

---

## Notes and rationale

- The current implementation already defaults sandbox mode correctly and enforces multiple layers of timeouts/restarts.
- The primary hardening opportunities are *operator safety signals* (warnings) and *defense-in-depth* in the spawn boundary (env stripping + spawn option lockdown + better quoting).
- All recommended changes are minimal and should not affect normal operation.

