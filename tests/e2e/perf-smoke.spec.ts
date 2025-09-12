import { test, expect } from "@playwright/test";

// Simple perf smoke: measure TTFC (time to first chunk) and total time to [DONE]
test("perf smoke: TTFC and total duration within generous thresholds", async ({ baseURL }) => {
  const url = new URL("/v1/chat/completions", baseURL).toString();
  const iterations = 3;
  const ttfcs: number[] = [];
  const totals: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = Date.now();
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer test-sk-ci` },
      body: JSON.stringify({
        model: "codex-5",
        stream: true,
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    expect(res.ok).toBeTruthy();
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let sawFirst = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const lines = frame.split(/\n/);
        for (const l of lines) {
          if (l.startsWith(":")) continue;
          if (l.startsWith("data: ")) {
            if (!sawFirst) {
              sawFirst = true;
              ttfcs.push(Date.now() - start);
            }
            if (l.slice(6).trim() === "[DONE]") {
              totals.push(Date.now() - start);
              break;
            }
          }
        }
      }
      if (totals.length === i + 1) break;
    }
  }

  const p95 = (arr: number[]) => {
    const a = [...arr].sort((a, b) => a - b);
    const idx = Math.min(a.length - 1, Math.floor(0.95 * (a.length - 1)));
    return a[idx];
  };

  // Generous thresholds to avoid flakiness in CI with shim backend
  expect(p95(ttfcs)).toBeLessThan(2000); // 2s TTFC p95
  expect(p95(totals)).toBeLessThan(5000); // 5s total p95
});
