import { describe, expect, test } from "vitest";
import fetch from "node-fetch";
import { startServer, stopServer } from "./helpers.js";

describe("security hardening", () => {
  test("usage endpoints require bearer auth", async () => {
    const ctx = await startServer({
      PROXY_TEST_ENDPOINTS: "false",
    });
    const base = `http://127.0.0.1:${ctx.PORT}`;
    try {
      const unauth = await fetch(`${base}/v1/usage`);
      expect(unauth.status).toBe(401);
      const auth = await fetch(`${base}/v1/usage`, {
        headers: { Authorization: "Bearer test-sk-ci" },
      });
      expect(auth.ok).toBe(true);
    } finally {
      await stopServer(ctx.child);
    }
  });

  test("__test endpoints enforce bearer when enabled", async () => {
    const ctx = await startServer({
      PROXY_TEST_ENDPOINTS: "true",
    });
    const base = `http://127.0.0.1:${ctx.PORT}`;
    try {
      const unauth = await fetch(`${base}/__test/conc`);
      expect(unauth.status).toBe(401);
      const authed = await fetch(`${base}/__test/conc`, {
        headers: { Authorization: "Bearer test-sk-ci" },
      });
      expect(authed.ok).toBe(true);
    } finally {
      await stopServer(ctx.child);
    }
  });
});
