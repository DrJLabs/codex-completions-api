// Shared SSE reader for Playwright tests
// Returns an array of frame payload strings (without the "data: " prefix);
// stops when it encounters a [DONE] frame.
export async function readSSE(url, init, opts = {}) {
  const { timeoutMs = 15000 } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const frames = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const l of chunk.split("\n")) {
          if (l.startsWith(":")) continue; // keepalive/comment
          if (l.startsWith("data: ")) frames.push(l.slice(6));
        }
      }
      if (frames.some((d) => d.trim() === "[DONE]")) break;
    }
    return frames;
  } finally {
    clearTimeout(timer);
  }
}
