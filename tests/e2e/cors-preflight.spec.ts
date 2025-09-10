import { test, expect } from "@playwright/test";

test("CORS preflight responds with allow-origin", async ({ request, baseURL }) => {
  const url = new URL("/v1/chat/completions", baseURL).toString();
  const res = await request.fetch(url, {
    method: "OPTIONS",
    headers: {
      Origin: "http://example.com",
      "Access-Control-Request-Method": "POST",
    },
  });
  expect([200, 204]).toContain(res.status());
  const h = res.headers();
  const allowOrigin =
    (h as any)["access-control-allow-origin"] ||
    (res.headers() as any).get?.("access-control-allow-origin");
  expect(allowOrigin).toBeTruthy();
});
