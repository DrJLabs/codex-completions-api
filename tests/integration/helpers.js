import fetch from "node-fetch";

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Poll a URL until it returns an OK response or timeout.
export async function waitForUrlOk(url, { timeoutMs = 5000, intervalMs = 100 } = {}) {
  const start = Date.now();
  while (true) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Ignore connection errors while server is starting; continue polling.
    }
    if (Date.now() - start > timeoutMs) throw new Error(`health timeout: ${url}`);
    await wait(intervalMs);
  }
}
