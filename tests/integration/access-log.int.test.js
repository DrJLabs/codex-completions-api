import { beforeAll, afterAll, test, expect } from "vitest";
import fetch from "node-fetch";
import { spawnServer } from "./helpers.js";

let PORT;
let child;
let lines = [];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  const server = await spawnServer({ PROXY_PROTECT_MODELS: "false" });
  PORT = server.PORT;
  child = server.child;
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (d) => {
    const s = d.toString();
    for (const ln of s.split(/\n+/)) {
      if (!ln) continue;
      lines.push(ln);
    }
  });
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
  // Poll up to 2s for the log entry that matches this request id
  let entry = null;
  const start = Date.now();
  while (Date.now() - start < 2000) {
    const logLine = lines
      .slice()
      .reverse()
      .find((ln) => {
        if (!ln || !ln.startsWith("{")) return false;
        try {
          const obj = JSON.parse(ln);
          return (
            obj && obj.kind === "access" && obj.route === "/healthz" && obj.req_id === reqIdHeader
          );
        } catch {
          return false;
        }
      });
    if (logLine) {
      try {
        entry = JSON.parse(logLine);
      } catch {}
      break;
    }
    await wait(50);
  }
  expect(entry).toBeTruthy();
  expect(typeof entry.req_id).toBe("string");
  expect(entry.status).toBe(200);
  expect(typeof entry.dur_ms).toBe("number");
  // Header should match req_id for correlation
  expect(reqIdHeader).toBe(entry.req_id);
});
