import { beforeAll, afterAll, test, expect } from "vitest";
import fetch from "node-fetch";
import { startServer, stopServer, wait } from "./helpers.js";

let server;

const readinessUrl = () => `http://127.0.0.1:${server.PORT}/readyz`;
const livenessUrl = () => `http://127.0.0.1:${server.PORT}/livez`;

async function waitForCondition(check, { timeoutMs = 5000, intervalMs = 50 } = {}) {
  const start = Date.now();
  while (true) {
    const result = await check();
    if (result) {
      return { matchedAt: Date.now(), value: result }; // result can carry payload
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error("condition timeout");
    }
    await wait(intervalMs);
  }
}

beforeAll(async () => {
  server = await startServer({
    PROXY_USE_APP_SERVER: "true",
    CODEX_BIN: "scripts/fake-codex-jsonrpc.js",
    WORKER_BACKOFF_INITIAL_MS: "100",
    WORKER_BACKOFF_MAX_MS: "100",
    WORKER_RESTART_MAX: "5",
    FAKE_CODEX_WORKER_READY_DELAY_MS: "10",
    FAKE_CODEX_WORKER_AUTOEXIT_MS: "200",
  });
});

afterAll(async () => {
  await stopServer(server.child);
});

test("readyz falls within 5s of worker exit while livez stays healthy", async () => {
  // Wait for worker handshake so readiness is true.
  const readyOk = await waitForCondition(
    async () => {
      const res = await fetch(readinessUrl());
      if (res.status !== 200) return false;
      const body = await res.json();
      return body.health?.readiness?.ready ? body : false;
    },
    { timeoutMs: 4000, intervalMs: 40 }
  );

  // Wait for readiness to flip false after the worker auto-exits.
  const readyDrop = await waitForCondition(
    async () => {
      const res = await fetch(readinessUrl());
      if (res.status !== 503) return false;
      const body = await res.json();
      return body.health?.readiness?.ready === false ? body : false;
    },
    { timeoutMs: 5000, intervalMs: 40 }
  );

  expect(readyDrop.matchedAt - readyOk.matchedAt).toBeLessThan(5000);
  expect(readyDrop.value.health.readiness.reason).toBe("worker_exit");

  // Livez should remain healthy while the supervisor restarts the worker.
  const liveRes = await fetch(livenessUrl());
  expect(liveRes.status).toBe(200);
  const liveBody = await liveRes.json();
  expect(liveBody.health.liveness.live).toBe(true);
  expect(["worker_running", "worker_restarting"]).toContain(liveBody.health.liveness.reason);

  // Ensure readiness recovers after the restart cycle.
  const readyRecovered = await waitForCondition(
    async () => {
      const res = await fetch(readinessUrl());
      if (res.status !== 200) return false;
      const body = await res.json();
      return body.health?.readiness?.ready ? body : false;
    },
    { timeoutMs: 5000, intervalMs: 40 }
  );

  expect(readyRecovered.matchedAt - readyDrop.matchedAt).toBeLessThan(5000);
  expect(readyRecovered.value.health.readiness.ready).toBe(true);
});
