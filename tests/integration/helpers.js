import fetch from "node-fetch";
import getPort from "get-port";
import { spawn } from "node:child_process";

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Poll a URL until it returns an OK response or timeout.
export async function waitForUrlOk(url, { timeoutMs = 5000, intervalMs = 100 } = {}) {
  const start = Date.now();
  while (true) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      if (res.status === 503 && url.endsWith("/readyz")) {
        try {
          const payload = await res.json();
          const reason = payload?.health?.readiness?.reason;
          if (reason === "handshake_failed") {
            return;
          }
        } catch {}
      }
    } catch {
      // Ignore connection errors while server is starting; continue polling.
    }
    if (Date.now() - start > timeoutMs) throw new Error(`health timeout: ${url}`);
    await wait(intervalMs);
  }
}

// Start a test server on a random port and wait until /healthz is OK
export async function startServer(envOverrides = {}) {
  const PORT = await getPort();
  const child = spawn("node", ["server.js"], {
    env: {
      ...process.env,
      PORT: String(PORT),
      PROXY_API_KEY: envOverrides.PROXY_API_KEY || "test-sk-ci",
      CODEX_BIN: envOverrides.CODEX_BIN || "scripts/fake-codex-proto.js",
      PROXY_PROTECT_MODELS: envOverrides.PROXY_PROTECT_MODELS || "false",
      ...(envOverrides || {}),
    },
    stdio: "ignore",
  });
  await waitForUrlOk(`http://127.0.0.1:${PORT}/healthz`);
  return { PORT, child };
}

export async function stopServer(child) {
  if (child && !child.killed) {
    try {
      child.kill("SIGTERM");
    } catch {}
  }
}
