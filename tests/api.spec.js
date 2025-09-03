// @ts-check
import { test, expect } from "@playwright/test";

test.describe("API smoke", () => {
  test("healthz returns ok", async ({ request, baseURL }) => {
    const res = await request.get(new URL("/healthz", baseURL).toString());
    expect(res.ok()).toBeTruthy();
    const json = await res.json();
    expect(json).toMatchObject({ ok: true });
  });

  test("models lists codex-5", async ({ request }) => {
    const res = await request.get("/v1/models");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty("object", "list");
    expect(body).toHaveProperty("data");
    const ids = body.data.map((m) => m.id);
    expect(ids).toContain("codex-5");
  });

  test("chat completions (non-stream)", async ({ request }) => {
    const res = await request.post("/v1/chat/completions", {
      headers: { Authorization: "Bearer test-sk-ci" },
      data: {
        model: "codex-5",
        stream: false,
        messages: [{ role: "user", content: "Say hello." }],
      },
    });
    if (!res.ok()) {
      console.error("Non-stream response status:", res.status());
      try { console.error(await res.text()); } catch {}
    }
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty("object", "chat.completion");
    const content = body?.choices?.[0]?.message?.content;
    expect(typeof content).toBe("string");
    expect(content.toLowerCase()).toContain("hello");
  });
});
