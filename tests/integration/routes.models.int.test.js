import { beforeAll, afterAll, test, expect, describe } from "vitest";
import getPort from "get-port";
import { spawn } from "node:child_process";
import fetch from "node-fetch";
import { waitForUrlOk } from "./helpers.js";

async function startServer({ protect = false } = {}) {
  const PORT = await getPort();
  const child = spawn("node", ["server.js"], {
    env: {
      ...process.env,
      PORT: String(PORT),
      PROXY_API_KEY: "test-sk-ci",
      CODEX_BIN: "scripts/fake-codex-jsonrpc.js",
      PROXY_PROTECT_MODELS: protect ? "true" : "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  await waitForUrlOk(`http://127.0.0.1:${PORT}/healthz`);
  return { PORT, child };
}

describe("/v1/models without gating", () => {
  let ctx;
  beforeAll(async () => {
    ctx = await startServer({ protect: false });
  });
  afterAll(async () => {
    if (ctx?.child && !ctx.child.killed) {
      try {
        ctx.child.kill("SIGTERM");
      } catch {}
    }
  });

  test("GET returns list with headers", async () => {
    const { PORT } = ctx;
    const r = await fetch(`http://127.0.0.1:${PORT}/v1/models`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/application\/json/);
    expect(r.headers.get("cache-control")).toBe("public, max-age=60");
    const j = await r.json();
    expect(j?.object).toBe("list");
    expect(Array.isArray(j?.data)).toBe(true);
  });

  test("HEAD returns 200 with content-type and empty body", async () => {
    const { PORT } = ctx;
    const r = await fetch(`http://127.0.0.1:${PORT}/v1/models`, { method: "HEAD" });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/application\/json/);
    const txt = await r.text();
    expect(txt).toBe("");
  });

  test("OPTIONS short-circuits preflight with 204", async () => {
    const { PORT } = ctx;
    const r = await fetch(`http://127.0.0.1:${PORT}/v1/models`, { method: "OPTIONS" });
    expect(r.status).toBe(204);
    // Global CORS preflight path sets Access-Control-Allow-Methods
    expect(r.headers.get("access-control-allow-methods")).toContain("GET");
  });
  // Note: node-fetch may not propagate Origin like a browser; skip strict echo check here.
});

describe("/v1/models with PROXY_PROTECT_MODELS=true", () => {
  let ctx;
  beforeAll(async () => {
    ctx = await startServer({ protect: true });
  });
  afterAll(async () => {
    if (ctx?.child && !ctx.child.killed) {
      try {
        ctx.child.kill("SIGTERM");
      } catch {}
    }
  });

  test("GET without bearer returns 401 with WWW-Authenticate", async () => {
    const { PORT } = ctx;
    const r = await fetch(`http://127.0.0.1:${PORT}/v1/models`);
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toMatch(/Bearer/);
  });

  test("HEAD without bearer returns 401", async () => {
    const { PORT } = ctx;
    const r = await fetch(`http://127.0.0.1:${PORT}/v1/models`, { method: "HEAD" });
    expect(r.status).toBe(401);
  });

  test("GET with bearer returns 200", async () => {
    const { PORT } = ctx;
    const r = await fetch(`http://127.0.0.1:${PORT}/v1/models`, {
      headers: { Authorization: "Bearer test-sk-ci" },
    });
    expect(r.status).toBe(200);
  });
});
