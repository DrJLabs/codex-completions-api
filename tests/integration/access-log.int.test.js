import { beforeAll, afterAll, test, expect } from "vitest";
import getPort from "get-port";
import { spawn } from "node:child_process";
import fetch from "node-fetch";

let PORT;
let child;
let lines = [];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHealth(timeoutMs = 5000) {
  const start = Date.now();
  while (true) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/healthz`);
      if (res.ok) return;
    } catch {}
    if (Date.now() - start > timeoutMs) throw new Error("health timeout");
    await wait(100);
  }
}

beforeAll(async () => {
  PORT = await getPort();
  child = spawn("node", ["server.js"], {
    env: {
      ...process.env,
      PORT: String(PORT),
      PROXY_PROTECT_MODELS: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (d) => {
    const s = d.toString();
    for (const ln of s.split(/\n+/)) {
      if (!ln) continue;
      lines.push(ln);
    }
  });
  await waitForHealth();
});

afterAll(async () => {
  if (child && !child.killed) {
    try {
      child.kill("SIGTERM");
    } catch {}
  }
});

test("structured access log emits req_id, route, status, dur_ms and header is set", async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/healthz`);
  expect(r.status).toBe(200);
  const reqIdHeader = r.headers.get("x-request-id");
  expect(typeof reqIdHeader).toBe("string");
  await wait(150); // allow log flush
  // Find the last JSON log entry with kind: 'access' and route '/healthz'
  let entry = null;
  // Iterate without index access to satisfy security lint rules
  const tmp = lines.slice();
  while (tmp.length) {
    const ln = tmp.pop();
    if (!ln || !ln.startsWith("{")) continue;
    try {
      const obj = JSON.parse(ln);
      if (obj && obj.kind === "access" && obj.route === "/healthz") {
        entry = obj;
        break;
      }
    } catch {}
  }
  expect(entry).toBeTruthy();
  expect(typeof entry.req_id).toBe("string");
  expect(entry.status).toBe(200);
  expect(typeof entry.dur_ms).toBe("number");
  // Header should match req_id for correlation
  expect(reqIdHeader).toBe(entry.req_id);
});
