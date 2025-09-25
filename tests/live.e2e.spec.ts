// @ts-check
import { test, expect } from "@playwright/test";

// Helper to read SSE and assert [DONE]
async function readSSE(url, init, { maxEvents = 100, timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const events = [];
    while (events.length < maxEvents) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const lines = chunk.split(/\n/);
        for (const l of lines) {
          if (l.startsWith(":")) continue; // comment/keepalive
          if (l.startsWith("data: ")) events.push(l.slice(6));
        }
        if (events.length >= maxEvents) break;
      }
    }
    return events;
  } finally {
    clearTimeout(timer);
  }
}

test.describe("Live E2E (real Codex)", () => {
  test("health + models", async ({ request, baseURL }) => {
    const h = await request.get(new URL("/healthz", baseURL).toString());
    expect(h.ok()).toBeTruthy();
    const m = await request.get("/v1/models");
    const status = m.status();
    // If models are protected in prod, this may be 401. Allow 200 or 401.
    expect([200, 401]).toContain(status);
    const ids = status === 200 ? ((await m.json())?.data || []).map((x) => x.id) : [];
    const lowerBase = (baseURL || "").toLowerCase();
    const expectProdModels = !(lowerBase.includes("codex-dev") || lowerBase.includes("codev"));
    const baseModel = expectProdModels ? "codex-5" : "codev-5";
    const hasExpectedModel = ids.some((id) => id === baseModel || id.startsWith(`${baseModel}-`));
    // Single unconditional expect to satisfy playwright/no-conditional-expect
    expect(status !== 200 || hasExpectedModel).toBeTruthy();
  });

  test("non-stream chat returns content", async ({ request }) => {
    const res = await request.post("/v1/chat/completions", {
      data: {
        model: "codex-5-minimal",
        stream: false,
        messages: [{ role: "user", content: "Say hello." }],
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty("object", "chat.completion");
    const content = body?.choices?.[0]?.message?.content || "";
    expect(content.length).toBeGreaterThan(0);
    // Guard against fallback content that suggests backend failed
    expect(content).not.toContain("No output from backend.");
  });

  test("streaming emits role delta, content, and [DONE]", async ({ baseURL }) => {
    const url = new URL("/v1/chat/completions", baseURL).toString();
    const events = await readSSE(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(process.env.KEY || process.env.PROXY_API_KEY
            ? { Authorization: `Bearer ${process.env.KEY || process.env.PROXY_API_KEY}` }
            : {}),
        },
        body: JSON.stringify({
          model: "codex-5-minimal",
          stream: true,
          messages: [{ role: "user", content: "Say hello." }],
        }),
      },
      { maxEvents: 200, timeoutMs: 20_000 }
    );

    // [DONE]
    expect(events.some((d) => d.trim() === "[DONE]")).toBeTruthy();

    // role delta present
    const hasRoleDelta = events.some((d) => {
      try {
        const obj = JSON.parse(d);
        return (
          obj?.object === "chat.completion.chunk" && obj?.choices?.[0]?.delta?.role === "assistant"
        );
      } catch {
        return false;
      }
    });
    expect(hasRoleDelta).toBeTruthy();

    // at least one content delta
    const hasContentDelta = events.some((d) => {
      try {
        const obj = JSON.parse(d);
        return (
          obj?.object === "chat.completion.chunk" &&
          typeof obj?.choices?.[0]?.delta?.content === "string"
        );
      } catch {
        return false;
      }
    });
    expect(hasContentDelta).toBeTruthy();
  });
});
