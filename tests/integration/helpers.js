import fetch from "node-fetch";
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

export async function waitForReady(port, options = {}) {
  return waitForUrlOk(`http://127.0.0.1:${port}/readyz`, options);
}

const LISTEN_REGEX = /listening on http:\/\/.*:(\d+)\/v1/;
const DEFAULT_LISTEN_TIMEOUT_MS = 5000;

const mirrorDebugOutput = (child) => {
  if (process.env.VITEST_DEBUG_STDIO !== "inherit") return;
  if (child.stdout) child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  if (child.stderr) child.stderr.on("data", (chunk) => process.stderr.write(chunk));
};

const waitForListeningPort = (child, { timeoutMs = DEFAULT_LISTEN_TIMEOUT_MS } = {}) =>
  new Promise((resolve, reject) => {
    let buffer = "";
    let resolved = false;
    let timer;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (child.stdout) child.stdout.off("data", onData);
      if (child.stderr) child.stderr.off("data", onData);
      child.off("exit", onExit);
      child.off("error", onError);
    };
    const onExit = (code, signal) => {
      if (resolved) return;
      cleanup();
      reject(new Error(`server exited before listening (code=${code}, signal=${signal})`));
    };
    const onError = (err) => {
      if (resolved) return;
      cleanup();
      reject(err);
    };
    const onData = (chunk) => {
      buffer += chunk.toString();
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        const match = line.match(LISTEN_REGEX);
        if (match) {
          resolved = true;
          cleanup();
          resolve(Number(match[1]));
          return;
        }
        newlineIndex = buffer.indexOf("\n");
      }
    };
    if (child.stdout) child.stdout.on("data", onData);
    if (child.stderr) child.stderr.on("data", onData);
    child.on("exit", onExit);
    child.on("error", onError);
    timer = setTimeout(() => {
      if (resolved) return;
      cleanup();
      reject(new Error("timed out waiting for server to report listening port"));
    }, timeoutMs);
  });

export async function spawnServer(envOverrides = {}, options = {}) {
  const desiredFlag =
    envOverrides.PROXY_USE_APP_SERVER !== undefined
      ? envOverrides.PROXY_USE_APP_SERVER
      : process.env.PROXY_USE_APP_SERVER;
  const normalizedFlag = String(desiredFlag ?? "true").toLowerCase() === "true" ? "true" : "false";
  const resolvedBin = envOverrides.CODEX_BIN || "scripts/fake-codex-jsonrpc.js";
  const resolvedSupervisor =
    envOverrides.CODEX_WORKER_SUPERVISED || (normalizedFlag === "true" ? "true" : undefined);
  const desiredPort =
    envOverrides.PORT !== undefined && envOverrides.PORT !== null ? envOverrides.PORT : 0;
  const child = spawn("node", ["server.js"], {
    env: {
      ...process.env,
      PORT: String(desiredPort),
      PROXY_API_KEY: envOverrides.PROXY_API_KEY || "test-sk-ci",
      ...(envOverrides || {}),
      PROXY_USE_APP_SERVER: normalizedFlag,
      CODEX_BIN: resolvedBin,
      ...(resolvedSupervisor ? { CODEX_WORKER_SUPERVISED: resolvedSupervisor } : {}),
      PROXY_PROTECT_MODELS: envOverrides.PROXY_PROTECT_MODELS || "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  mirrorDebugOutput(child);
  if (options.onStdout && child.stdout) child.stdout.on("data", options.onStdout);
  if (options.onStderr && child.stderr) child.stderr.on("data", options.onStderr);
  const PORT =
    Number(desiredPort) > 0 ? Number(desiredPort) : await waitForListeningPort(child, options);
  if (options.waitForHealth !== false) {
    await waitForUrlOk(`http://127.0.0.1:${PORT}/healthz`);
  }
  if (options.waitForReady && normalizedFlag === "true") {
    await waitForReady(PORT, options.readyOptions);
  }
  return { PORT, child };
}

// Start a test server and wait until /healthz (and /readyz when enabled) is OK.
export async function startServer(envOverrides = {}) {
  return spawnServer(envOverrides, { waitForHealth: true, waitForReady: true });
}

export async function stopServer(child) {
  if (child && !child.killed) {
    try {
      child.kill("SIGTERM");
    } catch {}
  }
}
