import { beforeAll, afterAll, test, expect } from "vitest";
import fetch from "node-fetch";
import { startServer, stopServer } from "./helpers.js";

let ctx;
let base;

beforeAll(async () => {
  ctx = await startServer({
    PROXY_ENABLE_RESPONSES: "true",
  });
  base = `http://127.0.0.1:${ctx.PORT}`;
}, 10_000);

afterAll(async () => {
  await stopServer(ctx?.child);
});

test("HEAD endpoints reject missing bearer token", async () => {
  for (const path of ["/v1/chat/completions", "/v1/completions", "/v1/responses"]) {
    const r = await fetch(`${base}${path}`, { method: "HEAD" });
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toMatch(/Bearer/);
  }
});

test("HEAD endpoints accept bearer token", async () => {
  for (const path of ["/v1/chat/completions", "/v1/completions", "/v1/responses"]) {
    const r = await fetch(`${base}${path}`, {
      method: "HEAD",
      headers: { Authorization: "Bearer test-sk-ci" },
    });
    expect(r.status).not.toBe(401);
    expect(r.headers.get("www-authenticate")).toBeNull();
  }
});
