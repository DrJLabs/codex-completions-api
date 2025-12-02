import { test, expect } from "vitest";
import fetch from "node-fetch";
import { startServer, stopServer, wait } from "./helpers.js";

async function waitForCondition(check, { timeoutMs = 5000, intervalMs = 50 } = {}) {
  const start = Date.now();
  while (true) {
    const result = await check();
    if (result) return { matchedAt: Date.now(), value: result };
    if (Date.now() - start > timeoutMs) {
      throw new Error("condition timeout");
    }
    await wait(intervalMs);
  }
}

const readinessUrl = (port) => `http://127.0.0.1:${port}/readyz`;
const livenessUrl = (port) => `http://127.0.0.1:${port}/livez`;
const metricsUrl = (port) => `http://127.0.0.1:${port}/metrics`;

const fetchJson = async (url) => {
  const res = await fetch(url);
  return { status: res.status, body: await res.json() };
};

const parseMetricValue = (metrics, name) => {
  const lines = metrics.split("\n").filter((line) => line.startsWith(name));
  if (!lines.length) return null;
  const fields = lines[0].trim().split(/\s+/);
  if (fields.length < 2) return null;
  return Number(fields[1]);
};

async function withServer(env, fn) {
  const server = await startServer(env);
  try {
    await fn(server);
  } finally {
    await stopServer(server.child);
  }
}

test("crash/restart surfaces restart/backoff metadata and matches /metrics", async () => {
  await withServer(
    {
      PROXY_USE_APP_SERVER: "true",
      PROXY_ENABLE_METRICS: "true",
      CODEX_BIN: "scripts/fake-codex-jsonrpc.js",
      WORKER_BACKOFF_INITIAL_MS: "100",
      WORKER_BACKOFF_MAX_MS: "300",
      WORKER_RESTART_MAX: "3",
      FAKE_CODEX_WORKER_READY_DELAY_MS: "20",
      FAKE_CODEX_WORKER_AUTOEXIT_MS: "180",
    },
    async ({ PORT }) => {
      await waitForCondition(
        async () => {
          const res = await fetch(readinessUrl(PORT));
          if (res.status !== 200) return false;
          const body = await res.json();
          return body.health?.readiness?.ready ? body : false;
        },
        { timeoutMs: 4000, intervalMs: 40 }
      );

      const readyDrop = await waitForCondition(
        async () => {
          const res = await fetch(readinessUrl(PORT));
          if (res.status !== 503) return false;
          const body = await res.json();
          const ready = body.health?.readiness;
          if (ready?.ready === false && ready?.reason === "worker_exit") {
            return body;
          }
          return false;
        },
        { timeoutMs: 5000, intervalMs: 40 }
      );

      const dropDetails = readyDrop.value.health.readiness.details;
      expect(dropDetails.restarts_total).toBeGreaterThanOrEqual(1);
      expect(dropDetails.next_restart_delay_ms).toBeGreaterThan(0);
      expect(dropDetails.last_exit).not.toBeNull();

      const liveSnapshot = await fetchJson(livenessUrl(PORT));
      expect(liveSnapshot.status).toBe(200);
      expect(liveSnapshot.body.health.liveness.live).toBe(true);

      const metricsRes = await fetch(metricsUrl(PORT));
      expect(metricsRes.status).toBe(200);
      const metricsText = await metricsRes.text();
      const metricRestarts = parseMetricValue(metricsText, "codex_worker_restarts_total");
      const metricBackoff = parseMetricValue(metricsText, "codex_worker_backoff_ms");
      expect(metricRestarts).not.toBeNull();
      expect(metricBackoff).not.toBeNull();
      expect(metricRestarts).toBeGreaterThanOrEqual(dropDetails.restarts_total ?? 0);
      expect(metricBackoff).toBeGreaterThanOrEqual(0);

      const readyRecovered = await waitForCondition(
        async () => {
          const res = await fetch(readinessUrl(PORT));
          if (res.status !== 200) return false;
          const body = await res.json();
          return body.health?.readiness?.ready ? body : false;
        },
        { timeoutMs: 5000, intervalMs: 40 }
      );

      expect(readyRecovered.matchedAt - readyDrop.matchedAt).toBeLessThan(5000);
      expect(readyRecovered.value.health.readiness.details.restarts_total).toBeGreaterThanOrEqual(
        dropDetails.restarts_total
      );
    }
  );
});

test("slow start keeps readiness false until handshake completes with metadata included", async () => {
  await withServer(
    {
      PROXY_USE_APP_SERVER: "true",
      PROXY_ENABLE_METRICS: "true",
      CODEX_BIN: "scripts/fake-codex-jsonrpc.js",
      WORKER_BACKOFF_INITIAL_MS: "100",
      WORKER_BACKOFF_MAX_MS: "300",
      WORKER_RESTART_MAX: "2",
      FAKE_CODEX_WORKER_READY_DELAY_MS: "600",
      FAKE_CODEX_WORKER_AUTOEXIT_MS: "0",
    },
    async ({ PORT }) => {
      const firstProbe = await fetch(readinessUrl(PORT));
      expect([200, 503]).toContain(firstProbe.status);

      const ready = await waitForCondition(
        async () => {
          const res = await fetch(readinessUrl(PORT));
          if (res.status !== 200) return false;
          const body = await res.json();
          return body.health?.readiness?.ready ? body : false;
        },
        { timeoutMs: 2000, intervalMs: 50 }
      );

      const details = ready.value.health.readiness.details;
      expect(details.startup_latency_ms).toBeGreaterThanOrEqual(0);
      expect(details.restarts_total).toBe(0);
      expect(details.consecutive_failures).toBe(0);
    }
  );
});
