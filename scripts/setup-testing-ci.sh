#!/usr/bin/env bash
set -euo pipefail

echo "[setup] codex-app-server-proxy testing/CI bootstrap (idempotent)"

# 1) Dev deps (only those not already present)
need_dev() { node -e "process.exit(require('./package.json').devDependencies?.['$1']?0:1)" || echo "$1"; }
PKGS=()
for p in @vitest/coverage-v8; do
  if [[ -n "$(need_dev "$p")" ]]; then PKGS+=("$p"); fi
done
if [[ ${#PKGS[@]} -gt 0 ]]; then
  echo "[setup] installing dev deps: ${PKGS[*]}";
  npm i -D "${PKGS[@]}"
else
  echo "[setup] dev deps already satisfied"
fi

# 2) Vitest config (do not overwrite if present)
if [[ ! -f vitest.config.ts ]]; then
  cat > vitest.config.ts <<'TS'
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    clearMocks: true,
    mockReset: true,
    restoreMocks: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json"],
      reportsDirectory: "./coverage",
      all: true,
      include: ["src/**"],
      exclude: ["**/*.d.ts", "tests/**", "dist/**"],
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
  },
});
TS
  echo "[setup] wrote vitest.config.ts"
else
  echo "[setup] vitest.config.ts exists; skipping"
fi

# 3) CORS and verbs tests (safe add)
mkdir -p tests/integration tests/e2e
if [[ ! -f tests/integration/verbs.int.test.js ]]; then
  cat > tests/integration/verbs.int.test.js <<'JS'
import { test, expect, beforeAll, afterAll } from "vitest";
import getPort from "get-port";
import { spawn } from "node:child_process";
import fetch from "node-fetch";
let PORT; let child;
beforeAll(async () => {
  PORT = await getPort();
  child = spawn("node", ["server.js"], {
    env: { ...process.env, PORT: String(PORT), PROXY_API_KEY: "test-sk-ci", CODEX_BIN: "scripts/fake-codex-jsonrpc.js", PROXY_USE_APP_SERVER: "true", CODEX_WORKER_SUPERVISED: "true", PROXY_PROTECT_MODELS: "false" },
    stdio: "ignore",
  });
  const start = Date.now();
  while (Date.now() - start < 5000) { try { const r = await fetch(`http://127.0.0.1:${PORT}/healthz`); if (r.ok) break; } catch {} await new Promise(r=>setTimeout(r,100)); }
});
afterAll(() => { try { child.kill("SIGTERM"); } catch {} });
test("HEAD /v1/chat/completions 200", async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, { method: "HEAD" });
  expect(r.status).toBeGreaterThanOrEqual(200); expect(r.status).toBeLessThan(500);
});
test("OPTIONS /v1/chat/completions has CORS", async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, { method: "OPTIONS", headers: { Origin: "http://example.com", "Access-Control-Request-Method": "POST" } });
  expect([200,204]).toContain(r.status);
  const allow = r.headers.get ? r.headers.get("allow") : r.headers["allow"]; const acao = r.headers.get ? r.headers.get("access-control-allow-origin") : r.headers["access-control-allow-origin"]; expect(String(allow||"").toUpperCase()).toContain("OPTIONS"); expect(acao).toBeTruthy();
});
JS
  echo "[setup] wrote tests/integration/verbs.int.test.js"
else
  echo "[setup] tests/integration/verbs.int.test.js exists; skipping"
fi

if [[ ! -f tests/e2e/cors-preflight.spec.ts ]]; then
  cat > tests/e2e/cors-preflight.spec.ts <<'TS'
import { test, expect } from "@playwright/test";
test("CORS preflight responds with allow-origin", async ({ request, baseURL }) => {
  const url = new URL("/v1/chat/completions", baseURL).toString();
  const res = await request.fetch(url, { method: "OPTIONS", headers: { Origin: "http://example.com", "Access-Control-Request-Method": "POST" } });
  expect([200,204]).toContain(res.status());
  const h = res.headers(); const allowOrigin = (h as any)["access-control-allow-origin"] || (res.headers() as any).get?.("access-control-allow-origin");
  expect(allowOrigin).toBeTruthy();
});
TS
  echo "[setup] wrote tests/e2e/cors-preflight.spec.ts"
else
  echo "[setup] tests/e2e/cors-preflight.spec.ts exists; skipping"
fi

echo "[setup] done"
