import { describe, beforeAll, afterAll, test, expect } from "vitest";
import fetch from "node-fetch";
import { startServer, stopServer } from "./helpers.js";

describe("CORS preflight across chat and responses", () => {
  let server;

  beforeAll(async () => {
    server = await startServer();
  });

  afterAll(async () => {
    if (server?.child) await stopServer(server.child);
  });

  const expectCorsHeaders = (res, origin, requestedHeader) => {
    const acao = res.headers.get("access-control-allow-origin");
    const acah = res.headers.get("access-control-allow-headers") || "";
    const acam = res.headers.get("access-control-allow-methods") || "";
    expect([200, 204]).toContain(res.status);
    expect(acao === origin || acao === "*").toBe(true);
    expect(acah.toLowerCase()).toContain(requestedHeader.toLowerCase());
    expect(acam.toLowerCase()).toContain("post");
  };

  test("OPTIONS /v1/chat/completions returns CORS headers", async () => {
    expect.assertions(4);
    const origin = "http://example.com";
    const requestedHeader = "X-Test-Header";
    const res = await fetch(`http://127.0.0.1:${server.PORT}/v1/chat/completions`, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": requestedHeader,
      },
    });
    expectCorsHeaders(res, origin, requestedHeader);
  });

  test("OPTIONS /v1/responses returns CORS headers", async () => {
    expect.assertions(4);
    const origin = "https://example.org";
    const requestedHeader = "X-Custom";
    const res = await fetch(`http://127.0.0.1:${server.PORT}/v1/responses`, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": requestedHeader,
      },
    });
    expectCorsHeaders(res, origin, requestedHeader);
  });
});
