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

  test("PROXY_USAGE_ALLOW_UNAUTH only bypasses /v1/usage", async () => {
    const ctx = await startServer({
      PROXY_TEST_ENDPOINTS: "false",
      PROXY_USAGE_ALLOW_UNAUTH: "true",
    });
    const base = `http://127.0.0.1:${ctx.PORT}`;
    try {
      const chatUnauth = await fetch(`${base}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "codex-5",
          stream: false,
          messages: [{ role: "user", content: "hi" }],
        }),
      });
      expect(chatUnauth.status).toBe(401);

      const usageUnauth = await fetch(`${base}/v1/usage`);
      expect(usageUnauth.status).toBe(200);
    } finally {
      await stopServer(ctx.child);
    }
  });

  test("__test endpoints enforce bearer when enabled", async () => {
    const ctx = await startServer({
      PROXY_TEST_ENDPOINTS: "1",
      PROXY_TEST_ALLOW_REMOTE: "true",
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
